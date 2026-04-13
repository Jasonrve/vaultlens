import { Router, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { config } from '../config/index.js';
import { VaultClient } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

router.use(authMiddleware);

// Configurable audit log path (Finding #5)
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

// GET /api/audit/logs — read and return grouped audit log entries
router.get(
  '/logs',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(
        Math.max(parseInt(String(req.query['limit'] ?? '500'), 10), 1),
        5000
      );
      const search = String(req.query['search'] ?? '').toLowerCase();
      const filterOperation = String(req.query['operation'] ?? '');
      const filterMountType = String(req.query['mountType'] ?? '');

      if (!fs.existsSync(AUDIT_LOG_FILE)) {
        return res.json({ entries: [], total: 0 });
      }

      // Read all lines (JSONL format) — read from end for most recent first
      const entries: AuditEntry[] = [];
      const fileStream = fs.createReadStream(AUDIT_LOG_FILE, { encoding: 'utf-8' });
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as AuditEntry);
        } catch {
          // Skip malformed lines
        }
      }

      // Group requests and responses by request ID
      const requestMap = new Map<string, AuditEntry>();
      const responseMap = new Map<string, AuditEntry>();

      for (const entry of entries) {
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

      // Paginate
      const total = grouped.length;
      const paginated = grouped.slice(0, limit);

      return res.json({ entries: paginated, total });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
