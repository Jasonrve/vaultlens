import type {
  ActivityPoint, ActivityResponse, BackendsResponse, ClientDetailResponse, ClientListResponse, ClientQuery,
  ClientSummary, Confidence, CoverageInfo, ActivityStatus, VaultClientIdentity, TopResponse,
} from '../../shared/clientIntelligence.js';
import type { ActivityClient, MonthlyCount } from './activity.js';
import { normalizeBackend, resolveIdentity } from './resolvers.js';
import { ClientIntelStore, pairAuditEntries, type ClientAgg, type RawAudit } from './store.js';

export interface MountInfo { path: string; type: string }
export interface EntityAlias { mountAccessor: string; mountType?: string; mountPath?: string; name: string; metadata: Record<string, string> }
export interface EntityInfo { name: string; aliases: EntityAlias[] }
/** Caller context: Vault calls use the caller's own token; cache entries are per principal. */
export interface Ctx { token: string; principal: string }

/** Everything the service needs from the outside world; injected so it is testable offline. */
export interface Deps {
  store: ClientIntelStore;
  retentionDays: number;
  loadActivity(days: number, ctx: Ctx): Promise<{ status: ActivityStatus; clients: ActivityClient[]; total: number | null; months: MonthlyCount[] }>;
  loadMounts(ctx: Ctx): Promise<Record<string, MountInfo>>; // keyed by mount accessor
  /** Identity-API enrichment for entities seen only in audit (used when the activity export is unavailable). */
  loadEntities?(ctx: Ctx, ids: string[]): Promise<Map<string, EntityInfo>>;
  rawAudit(): Promise<RawAudit[]>;
  /** Max entries the audit source retains; a full buffer means requests may have been dropped before ingest. */
  bufferCapacity?: number;
  now?: () => number;
}

export const WINDOWS = [1, 7, 30, 90] as const;
const DAY = 86_400_000;
const CONF_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1, unknown: 0 };

export const isUnattributed = (c: VaultClientIdentity) => c.source.confidence === 'low' || c.source.confidence === 'unknown';

export function coverageFor(store: ClientIntelStore, days: number, now: number, retentionDays: number): CoverageInfo {
  const { startedAt, lastIngestedAt, gapAt } = store.coverage();
  const covered = startedAt ? Math.min(days, Math.max(0, (now - Date.parse(startedAt)) / DAY)) : 0;
  const requested = Math.min(days, retentionDays);
  return {
    auditAvailable: !!startedAt,
    collectionStartedAt: startedAt,
    lastIngestedAt,
    dataGapAt: gapAt && Date.parse(gapAt) >= now - days * DAY ? gapAt : undefined,
    requestedDays: days,
    coveredDays: Math.round(covered * 10) / 10,
    partial: covered < requested - 0.05,
  };
}

function ipv4ToInt(ip: string): number | undefined {
  const p = ip.split('.').map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0 : undefined;
}

/** Matches an exact IP, an IPv4 CIDR, or (for IPv6/partial input) a prefix. */
export function ipMatches(ip: string, filter: string): boolean {
  const f = filter.trim();
  const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(f);
  if (m) {
    const base = ipv4ToInt(m[1]!);
    const a = ipv4ToInt(ip);
    const bits = Number(m[2]);
    if (base === undefined || a === undefined || bits > 32) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (a & mask) >>> 0 === (base & mask) >>> 0;
  }
  return ip === f || ip.startsWith(f);
}

const KNOWN_TYPES = new Set(['kubernetes', 'aws', 'github', 'approle', 'ldap', 'userpass', 'oidc', 'jwt', 'cert', 'okta', 'azure', 'gcp', 'radius']);

/**
 * Vault names a login token "<mount path with / as ->-<name>" (e.g. "userpass-alice", "kubernetes-demo-ns-sa"; AppRole is just "approle").
 * Used only when the identity API can't resolve the entity: longest matching mount wins, else a known auth type prefix.
 */
export function backendFromDisplayName(dn: string, mounts: Record<string, MountInfo>): { type: string; mountPath?: string } | undefined {
  let best: MountInfo | undefined;
  for (const m of Object.values(mounts)) {
    const name = m.path.replace(/^auth\//, '').replace(/\/$/, '').replace(/\//g, '-');
    if ((dn === name || dn.startsWith(`${name}-`)) && (!best || m.path.length > best.path.length)) best = m;
  }
  if (best) return { type: normalizeBackend(best.type), mountPath: best.path };
  const head = dn.split('-')[0] ?? '';
  return KNOWN_TYPES.has(head) ? { type: head } : undefined;
}

function build(act: ActivityClient[], aggs: ClientAgg[], mounts: Record<string, MountInfo>, auditAvailable: boolean, entities: Map<string, EntityInfo> = new Map()): VaultClientIdentity[] {
  const aggByKey = new Map(aggs.map((a) => [a.key, a]));
  const used = new Set<string>();
  const out: VaultClientIdentity[] = [];

  const finish = (c: VaultClientIdentity, a: ClientAgg | undefined) => {
    if (a) {
      c.network = {
        ips: a.ips.sort((x, y) => y.requests - x.requests),
        observedIps: a.ips.map((i) => i.ip),
        lastObservedIp: [...a.ips].sort((x, y) => (x.lastSeen < y.lastSeen ? 1 : -1))[0]?.ip,
      };
      c.activity = { ...c.activity, firstObservedAt: a.firstAt, lastObservedAt: a.lastAt, requests: a.requests, requests24h: a.r24h, requests7d: a.r7d, requests30d: a.r30d, observedErrors: a.errors };
      if (!c.origins.includes('audit')) c.origins.push('audit');
      c.source.evidence.push(`${a.requests} audit-observed request(s) from ${a.ips.length} source IP(s)`);
    } else if (auditAvailable) {
      c.activity.requests = 0; // collection is running and saw nothing in this window
    }
    // Role: identity metadata first, then the role Vault records on the token in audit, then (AWS) the IAM role from the ARN.
    if (!c.auth.role && a?.role) {
      c.auth.role = a.role;
      c.source.evidence.push('auth role observed in audit token metadata');
    }
    if (!c.auth.role && c.auth.type === 'aws') {
      const iam = c.source.fields.find((f) => f.key === 'principalName')?.value;
      if (iam) { c.auth.role = iam; c.source.evidence.push('role shown is the IAM role parsed from the ARN (Vault auth role not observed)'); }
    }
    out.push(c);
  };

  for (const r of act) {
    const m = mounts[r.mountAccessor];
    const mountType = normalizeBackend(r.mountType || m?.type);
    const mountPath = r.mountPath || m?.path;
    const rawType = mountType === 'unknown' ? '' : mountType;
    // Some Vault versions omit alias data from the export; fill it from the identity API, matched by mount accessor.
    const ent = entities.get(r.clientId);
    const ealias = !r.aliasName && ent ? (ent.aliases.find((x) => x.mountAccessor === r.mountAccessor) ?? undefined) : undefined;
    const aliasName = r.aliasName ?? ealias?.name;
    const metadata = ealias ? { ...ealias.metadata, ...r.metadata } : r.metadata;
    const role = metadata['role'] ?? metadata['role_name'];
    const res = resolveIdentity({ mountType: rawType, aliasName, metadata, role });
    const a = aggByKey.get(r.clientId);
    if (a) used.add(a.key);
    const c: VaultClientIdentity = {
      id: r.clientId, vaultClientId: r.clientId,
      displayName: res.fields.find((f) => f.key.toLowerCase() === 'repository')?.value ?? res.title ?? role ?? aliasName ?? a?.displayName ?? r.clientId,
      clientType: r.clientType, category: res.category,
      vaultNamespace: r.namespacePath || undefined,
      auth: { type: mountType, mountPath, mountAccessor: r.mountAccessor || undefined, role },
      identity: { entityId: r.clientType === 'entity' ? r.clientId : undefined, aliasName, metadata },
      source: { platform: res.platform, primaryIdentifier: res.primaryIdentifier, fields: res.fields, confidence: res.confidence, evidence: [...res.evidence, `listed in Vault client activity (last month bucket ${r.timestamp.slice(0, 7) || 'unknown'})`] },
      network: { observedIps: [], ips: [] },
      activity: { inVaultActivity: true },
      origins: ['vault-activity', ...(aliasName || Object.keys(metadata).length ? (['identity-api'] as const) : [])],
    };
    finish(c, a);
  }

  // Clients seen in audit only: kept separate from Vault-reported clients, never merged by IP or name.
  for (const a of aggs) {
    if (used.has(a.key)) continue;
    const anon = a.key.startsWith('anon:');
    const tok = a.key.startsWith('token:');
    const type = tok ? 'token' : '';
    const ent = entities.get(a.key);
    const alias = ent?.aliases[0];
    if (ent && alias) {
      const m = mounts[alias.mountAccessor];
      const mountType = normalizeBackend(alias.mountType || m?.type);
      const role = alias.metadata['role'] ?? alias.metadata['role_name'];
      const r = resolveIdentity({ mountType: mountType === 'unknown' ? '' : mountType, aliasName: alias.name, metadata: alias.metadata, role });
      finish({
        id: a.key, vaultClientId: a.key,
        displayName: r.fields.find((f) => f.key.toLowerCase() === 'repository')?.value ?? r.title ?? role ?? (r.platform === 'AppRole' ? a.displayName : alias.name) ?? a.displayName,
        clientType: 'entity', category: r.category,
        auth: { type: mountType, mountPath: alias.mountPath || m?.path, mountAccessor: alias.mountAccessor, role },
        identity: { entityId: a.key, aliasName: alias.name, metadata: alias.metadata },
        source: {
          platform: r.platform, primaryIdentifier: r.primaryIdentifier, fields: r.fields,
          confidence: ent.aliases.length > 1 && r.confidence === 'high' ? 'medium' : r.confidence,
          evidence: [...r.evidence, `identity resolved via Vault identity API${ent.aliases.length > 1 ? ` (entity has ${ent.aliases.length} aliases; first used)` : ''}`, 'not listed in Vault client activity (export unavailable or not yet recorded)'],
        },
        network: { observedIps: [], ips: [] },
        activity: { inVaultActivity: false },
        origins: ['audit', 'identity-api'],
      }, a);
      continue;
    }
    const inferred = !tok && !anon ? backendFromDisplayName(a.displayName, mounts) : undefined;
    const res = resolveIdentity({ mountType: inferred?.type ?? type, aliasName: undefined, metadata: a.displayName ? { display_name: a.displayName } : {} });
    if (inferred && res.primaryIdentifier === 'Not available') res.primaryIdentifier = `display: ${a.displayName}`;
    if (inferred && res.confidence === 'low') res.confidence = 'medium';
    finish({
      id: a.key, vaultClientId: undefined,
      displayName: anon ? `Unauthenticated (${a.ips[0]?.ip ?? 'unknown IP'})` : a.displayName || a.key,
      clientType: anon ? 'unauthenticated' : tok ? 'non-entity-token' : 'entity',
      category: anon ? 'Unknown' : res.category,
      auth: { type: tok ? 'token' : inferred?.type ?? 'unknown', mountPath: inferred?.mountPath },
      identity: { entityId: a.entityId || undefined, metadata: {} },
      source: {
        platform: anon ? 'Unknown' : res.platform,
        primaryIdentifier: anon ? 'unresolved (see audit logs)' : res.primaryIdentifier,
        fields: anon ? [] : res.fields,
        confidence: anon ? 'unknown' : tok ? res.confidence : 'low',
        evidence: [anon ? 'requests with no authenticated identity (e.g. rejected logins); grouped by source IP only' : 'seen in audit logs but not in Vault client activity', ...(inferred ? ['auth method inferred from the token display name (entity not found in the identity API)'] : [])],
      },
      network: { observedIps: [], ips: [] },
      activity: { inVaultActivity: false },
      origins: ['audit'],
    }, a);
  }
  return out;
}

export class ClientIntelService {
  private cache = new Map<string, { at: number; clients: VaultClientIdentity[]; status: ActivityStatus; total: number | null; months: MonthlyCount[] }>();
  private static TTL = 30_000;
  /** Fraction of the audit buffer in use at the last ingest; the scheduler ingests sooner as it fills. */
  bufferFill = 0;
  constructor(private d: Deps) {}
  private now() { return (this.d.now ?? Date.now)(); }

  /** Pulls the current audit buffer into the persistent store (idempotent; see store.ingest). */
  async ingest(): Promise<number> {
    const entries = await this.d.rawAudit();
    this.bufferFill = this.d.bufferCapacity ? entries.length / this.d.bufferCapacity : 0;
    return this.d.store.ingest(entries, this.now(), this.d.bufferCapacity);
  }

  private async load(ctx: Ctx, days: number) {
    const ck = `${ctx.principal}:${days}`;
    const hit = this.cache.get(ck);
    if (hit && this.now() - hit.at < ClientIntelService.TTL) return hit;
    const [act, mounts] = await Promise.all([this.d.loadActivity(days, ctx), this.d.loadMounts(ctx).catch(() => ({}) as Record<string, MountInfo>)]);
    const cov = coverageFor(this.d.store, days, this.now(), this.d.retentionDays);
    const aggs = this.d.store.aggregate(days, this.now());
    const needAlias = act.clients.filter((c) => c.clientType === 'entity' && !c.aliasName).map((c) => c.clientId);
    const known = new Set(act.clients.map((c) => c.clientId));
    const ids = [...new Set([...needAlias, ...aggs.map((a) => a.key).filter((k) => !known.has(k))])].filter((k) => !k.startsWith('token:') && !k.startsWith('anon:'));
    const entities = this.d.loadEntities && ids.length ? await this.d.loadEntities(ctx, ids).catch(() => new Map<string, EntityInfo>()) : undefined;
    const clients = build(act.clients, aggs, mounts, cov.auditAvailable, entities);
    const entry = { at: this.now(), clients, status: act.status, total: act.total, months: act.months };
    for (const [k, v] of this.cache) if (this.now() - v.at >= ClientIntelService.TTL) this.cache.delete(k); // principals change with every login
    this.cache.set(ck, entry);
    return entry;
  }

  invalidate() { this.cache.clear(); }

  async summary(ctx: Ctx, days: number): Promise<ClientSummary> {
    const { clients, status, total } = await this.load(ctx, days);
    const cov = coverageFor(this.d.store, days, this.now(), this.d.retentionDays);
    const ips = new Set(clients.flatMap((c) => c.network.observedIps));
    return {
      uniqueClients: status.available ? (total ?? clients.filter((c) => c.activity.inVaultActivity).length) : null,
      activeClients: cov.auditAvailable ? clients.filter((c) => (c.activity.requests ?? 0) > 0).length : null,
      unattributed: clients.length || status.available || cov.auditAvailable ? clients.filter(isUnattributed).length : null,
      uniqueIps: cov.auditAvailable ? ips.size : null,
      windowDays: days,
      coverage: cov,
      activity: status,
      retentionDays: this.d.retentionDays,
    };
  }

  filter(all: VaultClientIdentity[], q: ClientQuery): VaultClientIdentity[] {
    const s = q.search?.trim().toLowerCase();
    let list = all.filter((c) => {
      if (q.backend && c.auth.type !== q.backend) return false;
      if (q.clientType && c.category !== q.clientType) return false;
      if (q.mount && c.auth.mountPath !== q.mount) return false;
      if (q.confidence && c.source.confidence !== q.confidence) return false;
      if (q.unidentified && !isUnattributed(c)) return false;
      if (q.ip && !c.network.observedIps.some((ip) => ipMatches(ip, q.ip!))) return false;
      if (s) {
        const hay = [c.displayName, c.id, c.source.primaryIdentifier, c.auth.mountPath, c.auth.role, c.identity.aliasName, c.identity.entityId, c.source.platform,
          ...c.source.fields.map((f) => f.value), ...c.network.observedIps, ...Object.values(c.identity.metadata)].filter(Boolean).join('\n').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
    const dir = q.dir === 'asc' ? 1 : -1;
    const key = (c: VaultClientIdentity): string | number => {
      switch (q.sort) {
        case 'client': return c.displayName.toLowerCase();
        case 'backend': return c.auth.type;
        case 'role': return (c.auth.role ?? '\uffff').toLowerCase(); // clients without a role sort last when ascending
        case 'type': return c.category;
        case 'lastSeen': return c.activity.lastObservedAt ?? '';
        case 'confidence': return CONF_RANK[c.source.confidence];
        default: return c.activity.requests ?? -1;
      }
    };
    list = [...list].sort((a, b) => (key(a) < key(b) ? -dir : key(a) > key(b) ? dir : a.id < b.id ? -1 : 1));
    return list;
  }

  async list(ctx: Ctx, q: ClientQuery): Promise<ClientListResponse> {
    const { clients } = await this.load(ctx, q.days);
    const filtered = this.filter(clients, q);
    const offset = Math.max(0, q.offset ?? 0);
    const limit = Math.min(Math.max(q.limit ?? 25, 1), 200);
    return { clients: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit, coverage: coverageFor(this.d.store, q.days, this.now(), this.d.retentionDays) };
  }

  /** Full filtered set for exports; iterated, never paginated through the API. */
  async all(ctx: Ctx, q: ClientQuery): Promise<{ clients: VaultClientIdentity[]; coverage: CoverageInfo; status: ActivityStatus }> {
    const { clients, status } = await this.load(ctx, q.days);
    return { clients: this.filter(clients, q), coverage: coverageFor(this.d.store, q.days, this.now(), this.d.retentionDays), status };
  }

  async backends(ctx: Ctx, days: number): Promise<BackendsResponse> {
    const { clients } = await this.load(ctx, days);
    const m = new Map<string, number>();
    for (const c of clients) m.set(c.auth.type, (m.get(c.auth.type) ?? 0) + 1);
    return {
      backends: [...m].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      mounts: [...new Set(clients.map((c) => c.auth.mountPath).filter((p): p is string => !!p))].sort(),
    };
  }

  async activity(ctx: Ctx, days: number, backend?: string, bucket: 'day' | 'hour' = 'day'): Promise<ActivityResponse> {
    const { clients, months } = await this.load(ctx, days);
    const type = new Map(clients.map((c) => [c.id, c.auth.type]));
    const byDay = new Map<string, ActivityPoint>();
    for (const r of this.d.store.daily(days, this.now(), bucket)) {
      const b = type.get(r.key) ?? (r.key.startsWith('token:') ? 'token' : 'unknown');
      if (backend && b !== backend) continue;
      const p = byDay.get(r.day) ?? { day: r.day, total: 0, byBackend: {} };
      p.total += r.requests;
      p.byBackend[b] = (p.byBackend[b] ?? 0) + r.requests;
      byDay.set(r.day, p);
    }
    return { bucket, points: [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)), coverage: coverageFor(this.d.store, days, this.now(), this.d.retentionDays), vaultMonthly: months };
  }

  /** Heaviest callers and per-auth-method request totals for the window (audit-observed requests only). */
  async top(ctx: Ctx, days: number, limit = 10): Promise<TopResponse> {
    const { clients } = await this.load(ctx, days);
    const active = clients.filter((c) => (c.activity.requests ?? 0) > 0);
    const totalRequests = active.reduce((n, c) => n + (c.activity.requests ?? 0), 0);
    const share = (n: number) => (totalRequests ? n / totalRequests : 0);
    const by = new Map<string, { clients: number; requests: number }>();
    for (const c of active) {
      const b = by.get(c.auth.type) ?? { clients: 0, requests: 0 };
      b.clients++;
      b.requests += c.activity.requests ?? 0;
      by.set(c.auth.type, b);
    }
    return {
      totalRequests,
      clients: [...active].sort((a, b) => (b.activity.requests ?? 0) - (a.activity.requests ?? 0)).slice(0, limit).map((c) => ({
        id: c.id, displayName: c.displayName, backend: c.auth.type, role: c.auth.role, detail: c.auth.role ?? (c.id.startsWith('token:') ? `accessor ${c.id.slice(6, 12)}…` : c.source.primaryIdentifier.startsWith('display:') ? undefined : c.source.primaryIdentifier.split('\n')[0]), requests: c.activity.requests ?? 0,
        share: share(c.activity.requests ?? 0), errors: c.activity.observedErrors ?? 0, lastSeen: c.activity.lastObservedAt,
      })),
      backends: [...by].map(([type, v]) => ({ type, ...v, share: share(v.requests) })).sort((a, b) => b.requests - a.requests),
      coverage: coverageFor(this.d.store, days, this.now(), this.d.retentionDays),
    };
  }

  async detail(ctx: Ctx, id: string, days: number): Promise<ClientDetailResponse | undefined> {
    const { clients } = await this.load(ctx, days);
    const client = clients.find((c) => c.id === id);
    if (!client) return undefined;
    const history = this.d.store.daily(days, this.now()).filter((r) => r.key === id).map((r) => ({ day: r.day, requests: r.requests })).sort((a, b) => (a.day < b.day ? -1 : 1));
    const now = this.now();
    const evidence = pairAuditEntries(await this.d.rawAudit(), 0, now)
      .filter((r) => r.key === id)
      .sort((a, b) => (a.time < b.time ? 1 : -1))
      .slice(0, 25)
      .map((r) => ({ time: r.time, requestId: r.id, operation: r.operation, path: r.path, ip: r.ip, error: r.error }));
    return { client, history, evidence, coverage: coverageFor(this.d.store, days, now, this.d.retentionDays) };
  }
}

