import { Router, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { config } from '../config/index.js';
import { VaultClient, VaultError } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import { getAuditBuffer, getAuditSocketStats, autoRegisterSocketAuditWithVault } from '../lib/auditSocket.js';
import { subscribeToAuditEvents } from '../lib/auditEvents.js';
import { getSystemToken } from '../lib/systemToken.js';
import { auditEventsProcessedTotal } from '../lib/metrics.js';
import { attributeAuditError } from '../lib/auditErrorAttribution.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

router.use(authMiddleware);

// Configurable audit log path (file mode only)
const AUDIT_LOG_FILE = config.auditLogPath
  ? path.resolve(config.auditLogPath)
  : path.resolve(process.cwd(), '..', 'vault', 'audit', 'vault-audit.log');

interface AuditEntry {
  type: 'request' | 'response';
  time: string;
  auth?: {
    client_token?: string;
    accessor?: string;
    display_name?: string;
    policies?: string[];
    token_policies?: string[];
    identity_policies?: string[];
    entity_id?: string;
    token_type?: string;
    metadata?: Record<string, string>;
  };
  request?: {
    id: string;
    operation: string;
    mount_type?: string;
    mount_accessor?: string;
    mount_point?: string;
    client_token?: string;
    client_token_accessor?: string;
    namespace?: { id: string; path: string };
    path: string;
    data?: Record<string, unknown>;
    remote_address?: string;
    remote_port?: number;
  };
  response?: {
    mount_type?: string;
    mount_accessor?: string;
    mount_point?: string;
    data?: Record<string, unknown>;
    redirect?: string;
    auth?: {
      client_token?: string;
      accessor?: string;
      display_name?: string;
      policies?: string[];
      entity_id?: string;
      token_type?: string;
    };
  };
  error?: string;
}

interface GroupedAuditEntry {
  requestId: string;
  time: string;
  operation: string;
  path: string;
  mountType: string;
  mountPoint: string;
  displayName: string;
  entityId: string;
  policies: string[];
  clientTokenAccessor: string;
  remoteAddress: string;
  error: string;
  requestData: Record<string, unknown> | null;
  responseData: Record<string, unknown> | null;
  hasResponse: boolean;
}

// GET /api/audit/source — returns the active audit log source and socket stats
router.get(
  '/source',
  (_req: AuthenticatedRequest, res: Response) => {
    const stats = getAuditSocketStats();
    res.json({
      source: config.auditSource,
      socket: stats,
    });
  },
);

// Short-lived cache around the raw audit source read (file I/O or ring buffer
// copy). Several widgets (auth method header, roles table, audit tab) can all
// request audit data within the same page load — this avoids re-reading a
// multi-MB file or re-copying the buffer for every one of them.
const RAW_ENTRIES_CACHE_TTL_MS = 5000;
let rawEntriesCache: { data: AuditEntry[]; expires: number } | null = null;

// Reads from the in-memory ring buffer (socket mode) or the on-disk audit
// log file (file mode), cached briefly to absorb bursts of requests.
async function readRawAuditEntries(): Promise<AuditEntry[]> {
  if (rawEntriesCache && rawEntriesCache.expires > Date.now()) {
    return rawEntriesCache.data;
  }

  let entries: AuditEntry[];
  if (config.auditSource === 'socket') {
    entries = getAuditBuffer() as AuditEntry[];
  } else if (!fs.existsSync(AUDIT_LOG_FILE)) {
    entries = [];
  } else {
    // Read efficiently from the end of the file so large multi-GB logs have no impact.
    // We grab the last CHUNK_SIZE_BYTES bytes, which covers ~20k typical audit entries.
    // The first line of a mid-file chunk may be incomplete and is skipped.
    const MAX_AUDIT_LINES = 20_000;
    const CHUNK_SIZE_BYTES = 30 * 1024 * 1024; // 30 MB window from end

    const fileStats = await fs.promises.stat(AUDIT_LOG_FILE);
    const fileSize = fileStats.size;
    const startByte = Math.max(0, fileSize - CHUNK_SIZE_BYTES);

    const fileEntries: AuditEntry[] = [];
    const fileStream = fs.createReadStream(AUDIT_LOG_FILE, {
      encoding: 'utf-8',
      start: startByte,
    });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let skipFirst = startByte > 0; // first line may be incomplete when starting mid-file
    for await (const line of rl) {
      if (skipFirst) { skipFirst = false; continue; }
      if (!line.trim()) continue;
      if (fileEntries.length >= MAX_AUDIT_LINES) break;
      try {
        fileEntries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // Skip malformed lines
      }
    }
    entries = fileEntries;
  }

  rawEntriesCache = { data: entries, expires: Date.now() + RAW_ENTRIES_CACHE_TTL_MS };
  return entries;
}

// Pairs up request/response audit entries by request ID. No filtering here —
// callers (/logs, /error-counts) apply their own filters over the full set.
function buildGroupedEntries(rawEntries: AuditEntry[]): GroupedAuditEntry[] {
  const requestMap = new Map<string, AuditEntry>();
  const responseMap = new Map<string, AuditEntry>();

  for (const entry of rawEntries) {
    const reqId = entry.request?.id;
    if (!reqId) continue;
    if (entry.type === 'request') {
      requestMap.set(reqId, entry);
    } else if (entry.type === 'response') {
      responseMap.set(reqId, entry);
    }
  }

  const grouped: GroupedAuditEntry[] = [];
  for (const [reqId, reqEntry] of requestMap) {
    const respEntry = responseMap.get(reqId);

    grouped.push({
      requestId: reqId,
      time: reqEntry.time,
      operation: reqEntry.request?.operation ?? '',
      path: reqEntry.request?.path ?? '',
      mountType: reqEntry.request?.mount_type ?? respEntry?.response?.mount_type ?? '',
      mountPoint: reqEntry.request?.mount_point ?? respEntry?.response?.mount_point ?? '',
      displayName: reqEntry.auth?.display_name ?? '',
      entityId: reqEntry.auth?.entity_id ?? '',
      policies: reqEntry.auth?.policies ?? reqEntry.auth?.token_policies ?? [],
      clientTokenAccessor: reqEntry.request?.client_token_accessor ?? reqEntry.auth?.accessor ?? '',
      remoteAddress: reqEntry.request?.remote_address ?? '',
      error: respEntry?.error ?? '',
      requestData: reqEntry.request?.data ?? null,
      responseData: respEntry?.response?.data ?? null,
      hasResponse: !!respEntry,
    });
  }

  grouped.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  return grouped;
}

// GET /api/audit/logs — read and return grouped audit log entries (server-side paginated)
router.get(
  '/logs',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const offset = Math.max(parseInt(String(req.query['offset'] ?? '0'), 10), 0);
      const limit = Math.min(
        Math.max(parseInt(String(req.query['limit'] ?? '50'), 10), 1),
        200
      );
      const search = String(req.query['search'] ?? '').toLowerCase();
      const filterOperation = String(req.query['operation'] ?? '');
      const filterMountType = String(req.query['mountType'] ?? '');
      const filterMountPath = String(req.query['mountPath'] ?? '').replace(/\/$/, '');
      const filterRole = String(req.query['role'] ?? '');
      const errorOnly = String(req.query['errorOnly'] ?? '') === 'true';

      const rawEntries = await readRawAuditEntries();
      const allGrouped = buildGroupedEntries(rawEntries);

      const grouped = allGrouped.filter((entry) => {
        if (filterOperation && entry.operation !== filterOperation) return false;
        if (filterMountType && entry.mountType !== filterMountType) return false;
        if (errorOnly && !entry.error) return false;
        if (filterMountPath) {
          // mountPoint in audit logs is e.g. "auth/github/" for auth mounts
          const cleanMountPoint = entry.mountPoint.replace(/^auth\//, '').replace(/\/$/, '');
          if (cleanMountPoint !== filterMountPath && !entry.mountPoint.includes(filterMountPath)) return false;
        }
        // Uses the same role-matching heuristic as /error-counts so the popup
        // shows exactly the entries the badge counted (role isn't in the path
        // for login attempts, so plain text search can't find these).
        if (filterRole && filterMountPath) {
          if (attributeAuditError(filterMountPath, entry).role !== filterRole) return false;
        }
        if (search) {
          const searchFields = [
            entry.path, entry.operation, entry.mountType, entry.displayName,
            entry.entityId, entry.error, entry.remoteAddress, entry.mountPoint,
          ].join(' ').toLowerCase();
          if (!searchFields.includes(search)) return false;
        }
        return true;
      });

      // Apply server-side pagination
      const total = grouped.length;
      const paginated = grouped.slice(offset, offset + limit);

      auditEventsProcessedTotal.inc(total);
      return res.json({ entries: paginated, total, offset, limit });
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/audit/error-counts?mountPath=<method> — error totals for an auth
// method mount plus a per-role breakdown, so the UI can render small "N
// errors" badges without the client re-scanning the audit source itself.
// See attributeAuditError() for the role-matching heuristic and its ceiling.
router.get(
  '/error-counts',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const mountPath = String(req.query['mountPath'] ?? '').replace(/\/$/, '');
      if (!mountPath) {
        res.status(400).json({ error: 'mountPath is required' });
        return;
      }

      const rawEntries = await readRawAuditEntries();
      const grouped = buildGroupedEntries(rawEntries);

      let mountTotal = 0;
      const byRole: Record<string, number> = {};

      for (const entry of grouped) {
        if (!entry.error) continue;
        const { inMount, role } = attributeAuditError(mountPath, entry);
        if (!inMount) continue;
        mountTotal += 1;
        if (role) byRole[role] = (byRole[role] ?? 0) + 1;
      }

      return res.json({ mountTotal, byRole });
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/audit/events — Server-Sent Events stream that tells the UI when to
// refetch audit data (e.g. error badge counts). Notifications are debounced
// server-side (see auditEvents.ts) so bursts of errors don't spam the client.
router.get(
  '/events',
  (req: AuthenticatedRequest, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('\n');

    const unsubscribe = subscribeToAuditEvents(res);
    // Keep the connection alive through proxies/load balancers that drop idle streams
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  },
);

// GET /api/audit/devices — list Vault audit backends (file, socket, syslog, etc.)
router.get(
  '/devices',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const response = await vaultClient.get<{
        data: Record<string, {
          type: string;
          description: string;
          options: Record<string, string>;
          local: boolean;
        }>;
      }>('/sys/audit', req.vaultToken!);

      const rawDevices = response?.data ?? response;
      const devices = Object.entries(rawDevices as Record<string, {
        type: string;
        description: string;
        options: Record<string, string>;
        local: boolean;
      }>).map(([devicePath, device]) => ({
        path: devicePath,
        type: device.type ?? 'unknown',
        description: device.description ?? '',
        options: device.options ?? {},
        local: device.local ?? false,
      }));

      return res.json({ devices });
    } catch (error) {
      if (error instanceof VaultError && error.statusCode === 403) {
        // Return empty list rather than 403 — not all tokens have sys/audit access
        return res.json({ devices: [] });
      }
      return next(error);
    }
  }
);

// POST /api/audit/register-socket — register the socket audit device with Vault
// Uses the system token; requires VAULT_AUDIT_SOURCE=socket.
router.post(
  '/register-socket',
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (config.auditSource !== 'socket') {
        res.status(400).json({ error: "Socket audit is not enabled (VAULT_AUDIT_SOURCE is not 'socket')." });
        return;
      }
      const token = await getSystemToken();
      await autoRegisterSocketAuditWithVault(
        config.vaultAddr,
        token,
        config.auditSocketVaultAddress,
        config.vaultSkipTlsVerify,
      );
      res.json({ success: true, message: `Socket audit device registered with Vault (address: ${config.auditSocketVaultAddress}).` });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/audit/socket — remove all socket-type audit devices from Vault
// Uses the logged-in user's token so Vault's ACL controls access.
router.delete(
  '/socket',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const response = await vaultClient.get<{
        data: Record<string, { type: string }>;
      }>('/sys/audit', req.vaultToken!);

      const rawDevices = response?.data ?? response;
      const socketPaths = Object.entries(rawDevices as Record<string, { type: string }>)
        .filter(([, device]) => device.type === 'socket')
        .map(([p]) => p);

      if (socketPaths.length === 0) {
        res.status(404).json({ error: 'No socket audit devices found.' });
        return;
      }

      for (const devicePath of socketPaths) {
        // Vault's delete path for audit devices is /sys/audit/:path (no trailing slash)
        const cleanPath = devicePath.replace(/\/$/, '');
        await vaultClient.delete(`/sys/audit/${cleanPath}`, req.vaultToken!);
      }

      res.json({ success: true, message: `Removed ${socketPaths.length} socket audit device(s).` });
    } catch (error) {
      if (error instanceof VaultError && error.statusCode === 403) {
        res.status(403).json({ error: 'You do not have permission to manage audit devices.' });
        return;
      }
      next(error);
    }
  }
);

export default router;
