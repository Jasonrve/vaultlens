import { Router, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { config } from '../config/index.js';
import { VaultClient, VaultError } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import { getAuditBuffer, getAuditSocketStats, autoRegisterSocketAuditWithVault } from '../lib/auditSocket.js';
import { getSystemToken } from '../lib/systemToken.js';
import { auditEventsProcessedTotal } from '../lib/metrics.js';
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

// GET /api/audit/logs — read and return grouped audit log entries (server-side paginated)
// In socket mode: reads from the in-memory ring buffer (no file I/O).
// In file mode: reads from the on-disk audit log file.
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

      let rawEntries: AuditEntry[];

      if (config.auditSource === 'socket') {
        // ── Socket mode: read from in-memory ring buffer (no file I/O) ───────
        rawEntries = getAuditBuffer() as AuditEntry[];
      } else {
        // ── File mode: read from on-disk audit log file ───────────────────────
        if (!fs.existsSync(AUDIT_LOG_FILE)) {
          return res.json({ entries: [], total: 0 });
        }

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
        rawEntries = fileEntries;
      }

      // Group requests and responses by request ID
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

      // Build grouped entries
      const grouped: GroupedAuditEntry[] = [];
      for (const [reqId, reqEntry] of requestMap) {
        const respEntry = responseMap.get(reqId);

        const operation = reqEntry.request?.operation ?? '';
        const reqPath = reqEntry.request?.path ?? '';
        const mountType = reqEntry.request?.mount_type
          ?? respEntry?.response?.mount_type ?? '';
        const mountPoint = reqEntry.request?.mount_point
          ?? respEntry?.response?.mount_point ?? '';
        const displayName = reqEntry.auth?.display_name ?? '';
        const entityId = reqEntry.auth?.entity_id ?? '';
        const policies = reqEntry.auth?.policies ?? reqEntry.auth?.token_policies ?? [];
        const clientTokenAccessor = reqEntry.request?.client_token_accessor
          ?? reqEntry.auth?.accessor ?? '';
        const remoteAddress = reqEntry.request?.remote_address ?? '';
        const error = respEntry?.error ?? '';

        // Apply filters
        if (filterOperation && operation !== filterOperation) continue;
        if (filterMountType && mountType !== filterMountType) continue;
        if (filterMountPath) {
          // mountPoint in audit logs is e.g. "auth/github/" for auth mounts
          const cleanMountPoint = mountPoint.replace(/^auth\//, '').replace(/\/$/, '');
          if (cleanMountPoint !== filterMountPath && !mountPoint.includes(filterMountPath)) continue;
        }
        if (search) {
          const searchFields = [
            reqPath, operation, mountType, displayName,
            entityId, error, remoteAddress, mountPoint,
          ].join(' ').toLowerCase();
          if (!searchFields.includes(search)) continue;
        }

        // Sanitize request/response data — redact HMAC'd tokens
        const requestData = reqEntry.request?.data ?? null;
        const responseData = respEntry?.response?.data ?? null;

        grouped.push({
          requestId: reqId,
          time: reqEntry.time,
          operation,
          path: reqPath,
          mountType,
          mountPoint,
          displayName,
          entityId,
          policies,
          clientTokenAccessor,
          remoteAddress,
          error,
          requestData,
          responseData,
          hasResponse: !!respEntry,
        });
      }

      // Sort by time descending (most recent first)
      grouped.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

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
