import { Router, Response, NextFunction } from 'express';
import { AxiosError } from 'axios';
import { config } from '../config/index.js';
import { VaultClient, VaultError } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { readRawAuditEntries } from './audit.js';
import { MAX_BUFFER_ENTRIES } from '../lib/auditSocket.js';
import { sanitizeMetadata } from '../client-intelligence/resolvers.js';
import { classifyActivityError, countingDisabled, parseActivityExport, parseActivitySummary, streamLines } from '../client-intelligence/activity.js';
import { csvChunks, jsonChunks, topCsv } from '../client-intelligence/export.js';
import { ClientIntelService, WINDOWS, type Ctx, type EntityInfo } from '../client-intelligence/service.js';
import { ClientIntelStore, type RawAudit } from '../client-intelligence/store.js';
import type { AuthenticatedRequest } from '../types/index.js';
import type { ClientQuery, Confidence } from '../../shared/clientIntelligence.js';

const router = Router();
const vault = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

const RETENTION_DAYS = Math.min(Math.max(parseInt(process.env['VAULTLENS_CLIENT_INTEL_RETENTION_DAYS'] ?? '90', 10) || 90, 1), 400);
const INGEST_INTERVAL_MS = 60_000;

const store = new ClientIntelStore(process.env['VAULTLENS_CLIENT_INTEL_DB'] || 'data/client-intelligence.sqlite', RETENTION_DAYS);

const ENTITY_LOOKUP_CAP = 500;
const ENTITY_TTL_MS = 5 * 60_000;
const entityCache = new Map<string, { at: number; info?: EntityInfo }>();

const service = new ClientIntelService({
  store,
  retentionDays: RETENTION_DAYS,
  rawAudit: async () => (await readRawAuditEntries()) as unknown as RawAudit[],
  bufferCapacity: config.auditSource === 'socket' ? MAX_BUFFER_ENTRIES : 20_000, // 20k = line cap in readRawAuditEntries
  async loadMounts(ctx) {
    const body = await vault.get<{ data?: Record<string, { type?: string; accessor?: string }> } & Record<string, unknown>>('/sys/auth', ctx.token);
    const m = (body.data ?? body) as Record<string, { type?: string; accessor?: string }>;
    const out: Record<string, { path: string; type: string }> = {};
    for (const [path, v] of Object.entries(m)) if (v && typeof v === 'object' && v.accessor) out[v.accessor] = { path: `auth/${path}`, type: v.type ?? '' };
    return out;
  },
  async loadEntities(ctx, ids) {
    // Bounded, cached lookups: one Vault read per entity, never one per rendered row.
    const out = new Map<string, EntityInfo>();
    const todo = ids.slice(0, ENTITY_LOOKUP_CAP).filter((id) => {
      const hit = entityCache.get(id);
      if (hit && hit.at > Date.now() - ENTITY_TTL_MS) { if (hit.info) out.set(id, hit.info); return false; }
      return true;
    });
    for (let i = 0; i < todo.length; i += 10) {
      await Promise.all(todo.slice(i, i + 10).map(async (id) => {
        try {
          const r = await vault.get<{ data?: { name?: string; aliases?: { mount_accessor?: string; mount_type?: string; mount_path?: string; name?: string; metadata?: unknown; custom_metadata?: unknown }[] } }>(`/identity/entity/id/${encodeURIComponent(id)}`, ctx.token);
          const info: EntityInfo = {
            name: r.data?.name ?? '',
            aliases: (r.data?.aliases ?? []).map((a) => ({ mountAccessor: a.mount_accessor ?? '', mountType: a.mount_type, mountPath: a.mount_path, name: a.name ?? '', metadata: { ...sanitizeMetadata(a.metadata), ...sanitizeMetadata(a.custom_metadata) } })),
          };
          entityCache.set(id, { at: Date.now(), info });
          out.set(id, info);
        } catch (e) {
          if (e instanceof VaultError && e.statusCode === 404) entityCache.set(id, { at: Date.now() }); // deleted/merged entity
          else console.warn(`[client-intelligence] entity lookup failed for ${id}: ${e instanceof Error ? e.message : e}`);
        }
      }));
    }
    return out;
  },
  async loadActivity(days, ctx) {
    const qs = `start_time=${encodeURIComponent(new Date(Date.now() - days * 86_400_000).toISOString())}&end_time=${encodeURIComponent(new Date().toISOString())}`;
    const cfg = await vault.get('/sys/internal/counters/config', ctx.token).catch(() => undefined);
    if (countingDisabled(cfg)) {
      return { status: { available: false, exportAvailable: false, reason: 'disabled' as const, message: 'Vault client activity counting is disabled (sys/internal/counters/config). Enable it in Vault to collect client counts.' }, clients: [], total: null, months: [] };
    }
    const [sum, exp] = await Promise.allSettled([
      vault.get(`/sys/internal/counters/activity?${qs}`, ctx.token),
      (async () => {
        try {
          const res = await vault.getStream(`/sys/internal/counters/activity/export?format=json&${qs}`, ctx.token);
          return await parseActivityExport(streamLines(res.data as AsyncIterable<Buffer>));
        } catch (e) {
          if (e instanceof AxiosError) throw new VaultError(e.message, e.response?.status ?? 500);
          throw e;
        }
      })(),
    ]);
    const summary = sum.status === 'fulfilled' ? parseActivitySummary(sum.value) : undefined;
    const clients = exp.status === 'fulfilled' ? exp.value : [];
    if (!summary && exp.status === 'rejected') {
      return { status: classifyActivityError(exp.reason), clients: [], total: null, months: [] };
    }
    return {
      status: { available: true, exportAvailable: exp.status === 'fulfilled', startTime: summary?.start, endTime: summary?.end,
        ...(exp.status === 'rejected' ? { reason: classifyActivityError(exp.reason).reason, message: `Client export unavailable: ${classifyActivityError(exp.reason).message}` } : {}) },
      clients,
      total: summary?.total ?? null,
      months: summary?.months ?? [],
    };
  },
});

// Background audit ingestion: independent of page views so request history accrues continuously.
// Ingest sooner as the audit buffer fills so a busy Vault doesn't overwrite requests before they are counted.
const nextIngestMs = () => (service.bufferFill > 0.5 ? 5_000 : service.bufferFill > 0.2 ? 15_000 : INGEST_INTERVAL_MS);
const scheduleIngest = () => {
  setTimeout(() => {
    service.ingest().catch((e: unknown) => console.warn('[client-intelligence] ingest failed:', e instanceof Error ? e.message : e)).finally(scheduleIngest);
  }, nextIngestMs()).unref();
};
scheduleIngest();

router.use(authMiddleware, requireAdmin);

const ctxOf = (req: AuthenticatedRequest): Ctx => ({ token: req.vaultToken!, principal: req.tokenInfo?.accessor ?? 'unknown' });
const str = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 200) : undefined);
const CONF = new Set(['high', 'medium', 'low', 'unknown']);

function parseQuery(req: AuthenticatedRequest): ClientQuery {
  const q = req.query;
  const days = Number(q['days']);
  const sort = str(q['sort']);
  return {
    days: (WINDOWS as readonly number[]).includes(days) ? days : 30,
    search: str(q['search']), backend: str(q['backend']), clientType: str(q['clientType']), mount: str(q['mount']),
    confidence: CONF.has(String(q['confidence'])) ? (q['confidence'] as Confidence) : undefined,
    unidentified: q['unidentified'] === 'true',
    ip: str(q['ip']),
    sort: ['client', 'backend', 'role', 'type', 'requests', 'lastSeen', 'confidence'].includes(sort ?? '') ? (sort as ClientQuery['sort']) : 'requests',
    dir: q['dir'] === 'asc' ? 'asc' : 'desc',
    offset: Math.max(parseInt(String(q['offset'] ?? '0'), 10) || 0, 0),
    limit: Math.min(Math.max(parseInt(String(q['limit'] ?? '25'), 10) || 25, 1), 200),
  };
}

type H = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const wrap = (h: H) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => { h(req, res).catch(next); };

router.get('/summary', wrap(async (req, res) => { await service.ingest().catch(() => undefined); res.json(await service.summary(ctxOf(req), parseQuery(req).days)); }));
router.get('/clients', wrap(async (req, res) => res.json(await service.list(ctxOf(req), parseQuery(req)))));
router.get('/backends', wrap(async (req, res) => res.json(await service.backends(ctxOf(req), parseQuery(req).days))));
const topLimit = (req: AuthenticatedRequest) => Math.min(Math.max(parseInt(String(req.query['limit'] ?? '10'), 10) || 10, 1), 1000);
router.get('/top', wrap(async (req, res) => res.json(await service.top(ctxOf(req), parseQuery(req).days, topLimit(req)))));
router.get('/top/export', wrap(async (req, res) => {
  const t = await service.top(ctxOf(req), parseQuery(req).days, topLimit(req));
  const json = req.query['format'] === 'json';
  res.setHeader('Content-Type', json ? 'application/json' : 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="vault-top-callers-${new Date().toISOString().slice(0, 10)}.${json ? 'json' : 'csv'}"`);
  res.send(json ? JSON.stringify(t) : topCsv(t));
}));
router.get('/activity', wrap(async (req, res) => res.json(await service.activity(ctxOf(req), parseQuery(req).days, str(req.query['backend']), req.query['bucket'] === 'hour' ? 'hour' : 'day'))));
router.get('/clients/:id', wrap(async (req, res) => {
  const d = await service.detail(ctxOf(req), String(req.params['id']), parseQuery(req).days);
  if (!d) { res.status(404).json({ error: 'Client not found' }); return; }
  res.json(d);
}));

router.get('/export', wrap(async (req, res) => {
  const q = parseQuery(req);
  const { clients, coverage, status } = await service.all(ctxOf(req), q);
  const json = req.query['format'] === 'json';
  res.setHeader('Content-Type', json ? 'application/json' : 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="vault-clients-${new Date().toISOString().slice(0, 10)}.${json ? 'json' : 'csv'}"`);
  if (!status.available || !status.exportAvailable) res.setHeader('X-Export-Partial', 'true');
  const chunks = json ? jsonChunks(clients, { days: q.days, coverage, exportedAt: new Date().toISOString() }) : csvChunks(clients);
  for (const c of chunks) {
    if (!res.write(c)) await new Promise<void>((r) => res.once('drain', r));
  }
  res.end();
}));

export default router;
