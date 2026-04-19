import { Router, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import crypto from 'crypto';
import axios from 'axios';
import { config } from '../config/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getConfigStorage } from '../lib/config-storage/index.js';
import { webhookFiresTotal, webhookDeliveryDurationSeconds } from '../lib/metrics.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();

router.use(authMiddleware);
router.use(requireAdmin);

const HOOKS_SECTION_PREFIX = 'hook-';

/**
 * Validate a webhook endpoint URL.
 * Returns an error string if invalid, or null if the URL is acceptable.
 */
function validateWebhookEndpoint(endpoint: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return 'Invalid endpoint URL';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return 'Only HTTP and HTTPS endpoints are allowed';
  }
  if (parsed.hash) {
    return 'Endpoint URL must not contain a URL fragment (#). Use the direct endpoint URL — e.g. https://webhook.site/your-uuid, not the https://webhook.site/#!/view/... browser URL.';
  }
  const hostname = parsed.hostname.toLowerCase();
  // Strip IPv6 brackets: [::1] → ::1
  const rawHost = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;

  // In development, allow localhost and private networks for testing
  if (config.nodeEnv === 'development') {
    return null;
  }

  const isBlocked =
    // Localhost by name and common loopback addresses
    rawHost === 'localhost' ||
    rawHost === '127.0.0.1' ||
    rawHost === '::1' ||
    rawHost === '0.0.0.0' ||
    rawHost === '::' ||
    rawHost === '0:0:0:0:0:0:0:0' ||
    rawHost === '0:0:0:0:0:0:0:1' ||
    // IPv4 loopback range 127.0.0.0/8
    /^127\./.test(rawHost) ||
    // IPv4 private ranges
    rawHost.startsWith('10.') ||
    rawHost.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(rawHost) ||
    // IPv4 link-local and cloud metadata
    rawHost.startsWith('169.254.') ||
    // IPv4 CGNAT range 100.64.0.0/10
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(rawHost) ||
    // IPv6 link-local fe80::/10
    rawHost.startsWith('fe80:') ||
    rawHost.startsWith('fe80::') ||
    // IPv6 Unique Local Addresses (ULA) fc00::/7 — covers fc:: and fd::
    rawHost.startsWith('fc') ||
    rawHost.startsWith('fd') ||
    // IPv4-mapped IPv6 ::ffff:192.168.x.x  or  ::ffff:10.x.x.x
    rawHost.startsWith('::ffff:') ||
    rawHost.startsWith('::ffff:0:') ||
    // Internal hostnames
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal' ||
    hostname === 'metadata.aws.internal';

  if (isBlocked) {
    return 'Webhook endpoints must not target internal or metadata addresses';
  }
  return null;
}

/**
 * Strip URL fragment (#...) from an endpoint before using it in HTTP requests.
 * This is defensive against malformed URLs stored in config.
 */
function sanitizeEndpointUrl(endpoint: string): string {
  const hashIndex = endpoint.indexOf('#');
  if (hashIndex > -1) {
    return endpoint.substring(0, hashIndex);
  }
  return endpoint;
}

/**
 * Normalise a Vault audit-log path for webhook matching.
 * KV v2 write paths contain "/data/" and metadata writes contain "/metadata/".
 * Users configure webhook paths without those segments (e.g. "kv/foo/bar"),
 * so we strip them before comparing.
 */
function normalizeVaultPath(p: string): string {
  return p.replace(/\/data\//, '/').replace(/\/metadata\//, '/');
}

interface WebhookConfig {
  id: string;
  name: string;
  secretPath: string;
  endpoint: string;
  enabled: boolean;
  createdAt: string;
  lastTriggered: string | null;
  triggerCount: number;
  matchFields: string[];
  matchValues: Record<string, string>;
}

// GET /api/hooks — list all configured webhooks
router.get(
  '/',
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const storage = getConfigStorage();
      const sections = await storage.list();
      const hooks: WebhookConfig[] = [];

      for (const section of sections) {
        if (!section.startsWith(HOOKS_SECTION_PREFIX)) continue;
        const data = await storage.get(section);
        if (!data) continue;
        let matchFields: string[] = [];
        let matchValues: Record<string, string> = {};
        try { matchFields = JSON.parse(data['matchFields'] || '[]'); } catch { /* ignore */ }
        try { matchValues = JSON.parse(data['matchValues'] || '{}'); } catch { /* ignore */ }
        hooks.push({
          id: section.slice(HOOKS_SECTION_PREFIX.length),
          name: data['name'] || '',
          secretPath: data['secretPath'] || '',
          endpoint: data['endpoint'] || '',
          enabled: data['enabled'] !== 'false',
          createdAt: data['createdAt'] || '',
          lastTriggered: data['lastTriggered'] || null,
          triggerCount: parseInt(data['triggerCount'] || '0', 10),
          matchFields,
          matchValues,
        });
      }

      res.json({ hooks });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/hooks — create a new webhook
router.post(
  '/',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { name, secretPath, endpoint, matchFields, matchValues } = req.body as {
        name?: string;
        secretPath?: string;
        endpoint?: string;
        matchFields?: string[];
        matchValues?: Record<string, string>;
      };

      if (!name || !secretPath || !endpoint) {
        res.status(400).json({ error: 'name, secretPath, and endpoint are required' });
        return;
      }

      if (typeof name !== 'string' || name.length > 100) {
        res.status(400).json({ error: 'name must be a string of 100 characters or fewer' });
        return;
      }
      if (typeof secretPath !== 'string' || secretPath.length > 500) {
        res.status(400).json({ error: 'secretPath must be a string of 500 characters or fewer' });
        return;
      }

      const endpointError = validateWebhookEndpoint(endpoint);
      if (endpointError) {
        res.status(400).json({ error: endpointError });
        return;
      }

      const validFields = ['accessor', 'display_name', 'entity_id', 'user'];
      const safeFields = (matchFields || []).filter((f) => validFields.includes(f));
      const safeValues: Record<string, string> = {};
      for (const f of safeFields) {
        if (matchValues?.[f]) safeValues[f] = String(matchValues[f]).slice(0, 256);
      }

      const id = crypto.randomUUID();
      const storage = getConfigStorage();

      await storage.set(`${HOOKS_SECTION_PREFIX}${id}`, {
        name,
        secretPath,
        endpoint,
        enabled: 'true',
        createdAt: new Date().toISOString(),
        lastTriggered: '',
        triggerCount: '0',
        matchFields: JSON.stringify(safeFields),
        matchValues: JSON.stringify(safeValues),
      });

      res.json({
        id,
        name,
        secretPath,
        endpoint,
        enabled: true,
        createdAt: new Date().toISOString(),
        lastTriggered: null,
        triggerCount: 0,
        matchFields: safeFields,
        matchValues: safeValues,
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/hooks/:id — update a webhook
router.put(
  '/:id',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const hookId = String(req.params['id']);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(hookId)) {
        res.status(400).json({ error: 'Invalid hook ID format' });
        return;
      }
      const storage = getConfigStorage();
      const existing = await storage.get(`${HOOKS_SECTION_PREFIX}${hookId}`);

      if (!existing) {
        res.status(404).json({ error: 'Webhook not found' });
        return;
      }

      const { name, secretPath, endpoint, enabled, matchFields, matchValues } = req.body as {
        name?: string;
        secretPath?: string;
        endpoint?: string;
        enabled?: boolean;
        matchFields?: string[];
        matchValues?: Record<string, string>;
      };

      if (name !== undefined) {
        if (typeof name !== 'string' || name.length > 100) {
          res.status(400).json({ error: 'name must be a string of 100 characters or fewer' });
          return;
        }
        existing['name'] = name;
      }
      if (secretPath !== undefined) {
        if (typeof secretPath !== 'string' || secretPath.length > 500) {
          res.status(400).json({ error: 'secretPath must be a string of 500 characters or fewer' });
          return;
        }
        existing['secretPath'] = secretPath;
      }
      if (endpoint !== undefined) {
        const endpointError = validateWebhookEndpoint(endpoint);
        if (endpointError) {
          res.status(400).json({ error: endpointError });
          return;
        }
        existing['endpoint'] = endpoint;
      }
      if (enabled !== undefined) existing['enabled'] = String(enabled);
      if (matchFields !== undefined) {
        const validFields = ['accessor', 'display_name', 'entity_id', 'user'];
        const safeFields = matchFields.filter((f) => validFields.includes(f));
        const safeValues: Record<string, string> = {};
        for (const f of safeFields) {
          if (matchValues?.[f]) safeValues[f] = String(matchValues[f]).slice(0, 256);
        }
        existing['matchFields'] = JSON.stringify(safeFields);
        existing['matchValues'] = JSON.stringify(safeValues);
      }

      await storage.set(`${HOOKS_SECTION_PREFIX}${hookId}`, existing);

      let parsedMatchFields: string[] = [];
      let parsedMatchValues: Record<string, string> = {};
      try { parsedMatchFields = JSON.parse(existing['matchFields'] || '[]'); } catch { /* ignore */ }
      try { parsedMatchValues = JSON.parse(existing['matchValues'] || '{}'); } catch { /* ignore */ }

      res.json({
        id: hookId,
        name: existing['name'] || '',
        secretPath: existing['secretPath'] || '',
        endpoint: existing['endpoint'] || '',
        enabled: existing['enabled'] !== 'false',
        createdAt: existing['createdAt'] || '',
        lastTriggered: existing['lastTriggered'] || null,
        triggerCount: parseInt(existing['triggerCount'] || '0', 10),
        matchFields: parsedMatchFields,
        matchValues: parsedMatchValues,
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/hooks/:id — delete a webhook
router.delete(
  '/:id',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const hookId = String(req.params['id']);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(hookId)) {
        res.status(400).json({ error: 'Invalid hook ID format' });
        return;
      }
      const storage = getConfigStorage();
      await storage.delete(`${HOOKS_SECTION_PREFIX}${hookId}`);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/hooks/:id/test — test a webhook by sending a test payload
router.post(
  '/:id/test',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const hookId = String(req.params['id']);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(hookId)) {
        res.status(400).json({ error: 'Invalid hook ID format' });
        return;
      }

      const storage = getConfigStorage();
      const hookData = await storage.get(`${HOOKS_SECTION_PREFIX}${hookId}`);

      if (!hookData) {
        res.status(404).json({ error: 'Webhook not found' });
        return;
      }

      const endpoint = hookData['endpoint'];
      if (!endpoint) {
        res.status(400).json({ error: 'Webhook has no endpoint configured' });
        return;
      }

      const payload = {
        name: hookData['name'],
        operation: 'test',
        user: 'test',
        remote_addr: '127.0.0.1',
        entity_id: null,
        status: 'test',
        secretPath: hookData['secretPath'],
        timestamp: new Date().toISOString(),
      };

      try {
        const cleanEndpoint = sanitizeEndpointUrl(endpoint);
        const testStart = process.hrtime.bigint();
        const response = await axios.post(cleanEndpoint, payload, {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'VaultLens-Webhook/1.0',
          },
          // Accept all HTTP status codes so we can report the actual status
          validateStatus: () => true,
        });
        const testDuration = Number(process.hrtime.bigint() - testStart) / 1e9;
        if (response.status >= 200 && response.status < 300) {
          webhookDeliveryDurationSeconds.observe({ result: 'success' }, testDuration);
          // Always return HTTP 200 from our server — put success/failure info
          // in the JSON body so the client's Axios interceptor never throws.
          res.json({ success: true, statusCode: response.status });
        } else {
          webhookDeliveryDurationSeconds.observe({ result: 'failure' }, testDuration);
          res.json({
            success: false,
            statusCode: response.status,
            error: `Endpoint responded with HTTP ${response.status}`,
          });
        }
      } catch (err) {
        // Network-level failure (DNS, connection refused, timeout)
        const message = err instanceof Error ? err.message : 'Connection failed';
        res.json({ success: false, statusCode: 0, error: `Webhook delivery failed: ${message}` });
      }
    } catch (error) {
      next(error);
    }
  }
);

// ── Audit log watcher for webhook triggers ────────────────────────────────────

const AUDIT_LOG_FILE = config.auditLogPath
  ? path.resolve(config.auditLogPath)
  : path.resolve(process.cwd(), '..', 'vault', 'audit', 'vault-audit.log');

let lastFileSize = 0;
let watcherTimerId: ReturnType<typeof setInterval> | null = null;

interface AuditLogEntry {
  type: string;
  time: string;
  request?: {
    id: string;
    operation: string;
    path: string;
    client_token_ttl?: number;
    client_id?: string;
    user_id?: string;
  };
  auth?: {
    client_token_ttl?: number;
    entity_id?: string;
    policies?: string[];
    display_name?: string;
    accessor?: string;
  };
  request_path?: string;
  remote_address?: string;
  response?: {
    auth?: {
      entity_id?: string;
    };
  };
}

/**
 * Match a path against a pattern that may contain * wildcards.
 * Without wildcards: prefix-match (existing behaviour).
 * With wildcards: * matches any non-slash sequence.
 */
function pathMatchesPattern(pattern: string, vaultPath: string): boolean {
  const normalizedPattern = normalizeVaultPath(pattern);
  const normalizedPath = normalizeVaultPath(vaultPath);
  if (!normalizedPattern.includes('*')) {
    // Legacy prefix match
    return (
      normalizedPath === normalizedPattern ||
      normalizedPath.startsWith(normalizedPattern + '/') ||
      normalizedPath.startsWith(normalizedPattern)
    );
  }
  // Wildcard match: * → any non-slash chars
  // Guard against excessively long patterns that could cause ReDoS
  if (normalizedPattern.length > 512) return false;
  const regexStr = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${regexStr}(/.*)?$`).test(normalizedPath);
}

/**
 * Check whether an audit entry satisfies all configured match field conditions.
 * Returns true when no fields are configured (no additional constraints).
 */
function auditFieldMatches(
  matchFields: string[],
  matchValues: Record<string, string>,
  entry: AuditLogEntry,
): boolean {
  if (matchFields.length === 0) return true;
  for (const field of matchFields) {
    const expected = matchValues[field];
    if (!expected) continue;
    let actual: string | undefined;
    switch (field) {
      case 'accessor': actual = entry.auth?.accessor; break;
      case 'display_name': actual = entry.auth?.display_name; break;
      case 'entity_id': actual = entry.auth?.entity_id; break;
      case 'user': actual = entry.auth?.display_name || entry.request?.user_id; break;
    }
    if (!actual || !actual.toLowerCase().includes(expected.toLowerCase())) return false;
  }
  return true;
}

async function checkAuditLogForChanges(): Promise<void> {
  try {
    if (!fs.existsSync(AUDIT_LOG_FILE)) return;

    const stats = fs.statSync(AUDIT_LOG_FILE);
    if (stats.size <= lastFileSize) {
      lastFileSize = stats.size;
      return;
    }

    // Read only the new portion of the file
    const stream = fs.createReadStream(AUDIT_LOG_FILE, {
      start: lastFileSize,
      encoding: 'utf-8',
    });

    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const changedEntries: Array<{ path: string; entry: AuditLogEntry }> = [];

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as AuditLogEntry;
        if (entry.type === 'request' && entry.request) {
          const op = entry.request.operation;
          // Only trigger on write operations
          if (['create', 'update', 'delete'].includes(op)) {
            changedEntries.push({ path: entry.request.path, entry });
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    lastFileSize = stats.size;

    if (changedEntries.length === 0) return;

    // Check for matching webhooks
    const storage = getConfigStorage();
    const sections = await storage.list();
    
    // Track which (hookId, normalizedPath) pairs we've already fired to avoid duplicates
    // This prevents firing the same webhook twice when both /data/ and /metadata/ are updated
    const firedHookPaths = new Set<string>();

    for (const section of sections) {
      if (!section.startsWith(HOOKS_SECTION_PREFIX)) continue;
      const hookData = await storage.get(section);
      if (!hookData || hookData['enabled'] === 'false') continue;

      const hookPath = hookData['secretPath'] || '';
      const hookId = section.slice(HOOKS_SECTION_PREFIX.length);

      // Check if any changed path matches this hook's secret path.
      // Normalize both sides to strip KV v2 "/data/" and "/metadata/" segments
      // so "kv/data/foo/bar" matches a webhook configured for "kv/foo/bar".
      let hookMatchFields: string[] = [];
      let hookMatchValues: Record<string, string> = {};
      try { hookMatchFields = JSON.parse(hookData['matchFields'] || '[]'); } catch { /* ignore */ }
      try { hookMatchValues = JSON.parse(hookData['matchValues'] || '{}'); } catch { /* ignore */ }

      for (const { path: changedPath, entry } of changedEntries) {
        if (
          pathMatchesPattern(hookPath, changedPath) &&
          auditFieldMatches(hookMatchFields, hookMatchValues, entry)
        ) {
          // Create a unique key for this webhook+path combination to track if we've already fired it
          const firedKey = `${hookId}:${normalizeVaultPath(changedPath)}`;
          if (!firedHookPaths.has(firedKey)) {
            firedHookPaths.add(firedKey);
            await fireWebhook(hookId, hookData, entry);
          }
        }
      }
    }
  } catch (err) {
    console.error('[Hooks] Audit watcher error:', err instanceof Error ? err.message : err);
  }
}

async function fireWebhook(hookId: string, hookData: Record<string, string>, auditEntry: AuditLogEntry): Promise<void> {
  const operation = auditEntry.request?.operation || 'update';
  const user = auditEntry.auth?.display_name || auditEntry.request?.user_id || 'unknown';
  const remoteAddr = auditEntry.remote_address || 'unknown';
  const entityId = auditEntry.auth?.entity_id || auditEntry.response?.auth?.entity_id || '';
  const status = auditEntry.request?.operation || '';

  const payload = {
    name: hookData['name'],
    operation,
    user,
    remote_addr: remoteAddr,
    entity_id: entityId || null,
    status,
    secretPath: hookData['secretPath'],
    timestamp: auditEntry.time || new Date().toISOString(),
  };

  const fireStart = process.hrtime.bigint();
  try {
    const cleanEndpoint = sanitizeEndpointUrl(hookData['endpoint']!);
    await axios.post(cleanEndpoint, payload, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'VaultLens-Webhook/1.0',
      },
    });
    const fireDuration = Number(process.hrtime.bigint() - fireStart) / 1e9;

    // Update trigger stats
    const storage = getConfigStorage();
    hookData['lastTriggered'] = new Date().toISOString();
    hookData['triggerCount'] = String(parseInt(hookData['triggerCount'] || '0', 10) + 1);
    await storage.set(`${HOOKS_SECTION_PREFIX}${hookId}`, hookData);

    console.log(`[Hooks] Fired webhook "${hookData['name']}" for path: ${auditEntry.request?.path}`);
    webhookFiresTotal.inc({ result: 'success' });
    webhookDeliveryDurationSeconds.observe({ result: 'success' }, fireDuration);
  } catch (err) {
    const fireDuration = Number(process.hrtime.bigint() - fireStart) / 1e9;
    console.error(`[Hooks] Failed to fire webhook "${hookData['name']}":`, err instanceof Error ? err.message : err);
    webhookFiresTotal.inc({ result: 'failure' });
    webhookDeliveryDurationSeconds.observe({ result: 'failure' }, fireDuration);
  }
}

/** Start watching the audit log for changes. */
export function startAuditWatcher(): void {
  if (watcherTimerId) return;

  // Initialize file size to avoid processing old entries
  try {
    if (fs.existsSync(AUDIT_LOG_FILE)) {
      lastFileSize = fs.statSync(AUDIT_LOG_FILE).size;
    }
  } catch {
    // File doesn't exist yet
  }

  console.log('[Hooks] Starting audit log watcher for webhook triggers');
  watcherTimerId = setInterval(() => {
    checkAuditLogForChanges().catch(err => {
      console.error('[Hooks] Watcher error:', err instanceof Error ? err.message : err);
    });
  }, 5000); // Check every 5 seconds
}

export default router;
