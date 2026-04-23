import { Router, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { VaultClient } from '../lib/vaultClient.js';
import { getSystemToken } from '../lib/systemToken.js';
import { authMiddleware } from '../middleware/auth.js';
import { secretOperationsTotal } from '../lib/metrics.js';
import type { AuthenticatedRequest, SecretEngine } from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

router.use(authMiddleware);

/** Reject paths containing traversal sequences or null bytes */
function isValidSecretPath(p: string): boolean {
  if (p.includes('\0')) return false;
  const segments = p.split('/');
  return segments.every(s => s !== '..' && s !== '.');
}

const MAX_SECRET_KEYS = 100;
const MAX_KEY_LENGTH = 512;
const MAX_VALUE_LENGTH = 1024 * 1024; // 1 MB per value

/** Validate that secret data meets size/structure constraints */
function validateSecretData(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return 'Request body must be a plain object';
  }
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length > MAX_SECRET_KEYS) {
    return `Too many keys (max ${MAX_SECRET_KEYS})`;
  }
  for (const [key, value] of entries) {
    if (key.length > MAX_KEY_LENGTH) {
      return `Key "${key.slice(0, 50)}…" exceeds max length (${MAX_KEY_LENGTH})`;
    }
    if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) {
      return `Value for key "${key.slice(0, 50)}" exceeds max length (1 MB)`;
    }
    if (value !== null && typeof value === 'object') {
      return 'Nested objects/arrays are not allowed in secret data';
    }
  }
  return null;
}

interface MountsResponse {
  data: Record<string, {
    type: string;
    description: string;
    accessor: string;
    options: Record<string, string> | null;
    local: boolean;
    seal_wrap: boolean;
  }>;
}

// Cache for engine info to avoid repeated lookups
const engineCache = new Map<string, { version: number; type: string; expiry: number }>();
const CACHE_TTL = 60000; // 1 minute
const CACHE_MAX_SIZE = 100;

function pruneCache(): void {
  if (engineCache.size <= CACHE_MAX_SIZE) return;
  const now = Date.now();
  // Remove expired entries first
  for (const [key, val] of engineCache) {
    if (val.expiry < now) engineCache.delete(key);
  }
  // If still over limit, remove oldest entries
  if (engineCache.size > CACHE_MAX_SIZE) {
    const entries = [...engineCache.entries()].sort((a, b) => a[1].expiry - b[1].expiry);
    const toRemove = entries.slice(0, entries.length - CACHE_MAX_SIZE);
    for (const [key] of toRemove) engineCache.delete(key);
  }
}

async function getEngineInfo(
  token: string,
  secretPath: string
): Promise<{ mount: string; subPath: string; version: number; type: string }> {
  // Check cache first (keyed by first path segment, i.e. the mount name)
  const mountGuess = secretPath.replace(/^\//, '').split('/')[0] || '';
  const cached = engineCache.get(mountGuess);
  if (cached && cached.expiry > Date.now()) {
    const subPath = secretPath.replace(/^\//, '').slice(mountGuess.length + 1);
    return { mount: mountGuess, subPath, version: cached.version, type: cached.type };
  }

  // Try to get mount info with user token; fall back to system token if denied
  let mountsData: MountsResponse | null = null;
  try {
    mountsData = await vaultClient.get<MountsResponse>('/sys/mounts', token);
  } catch {
    // User token lacks sys/mounts access — use system token for mount lookup only
    try {
      const sysToken = await getSystemToken();
      mountsData = await vaultClient.get<MountsResponse>('/sys/mounts', sysToken);
    } catch {
      mountsData = null;
    }
  }

  if (!mountsData) {
    // Ultimate fallback: derive from path
    const segments = secretPath.replace(/^\//, '').split('/');
    return {
      mount: segments[0] || secretPath,
      subPath: segments.slice(1).join('/'),
      version: 1,
      type: 'kv',
    };
  }

  // Find the mount that matches the path (longest prefix match)
  let bestMount = '';
  let bestEngine: { type: string; options: Record<string, string> | null } | null = null;

  for (const [mountPath, engineInfo] of Object.entries(mountsData.data)) {
    const normalizedMount = mountPath.endsWith('/') ? mountPath : `${mountPath}/`;
    const normalizedPath = secretPath.startsWith('/')
      ? secretPath.slice(1)
      : secretPath;

    if (
      normalizedPath.startsWith(normalizedMount) ||
      normalizedPath === normalizedMount.slice(0, -1)
    ) {
      if (normalizedMount.length > bestMount.length) {
        bestMount = normalizedMount;
        bestEngine = engineInfo;
      }
    }
  }

  if (!bestMount || !bestEngine) {
    // Default: treat as KV v1 with the first path segment as mount
    const segments = secretPath.replace(/^\//, '').split('/');
    return {
      mount: segments[0] || secretPath,
      subPath: segments.slice(1).join('/'),
      version: 1,
      type: 'kv',
    };
  }

  const mount = bestMount.endsWith('/') ? bestMount.slice(0, -1) : bestMount;
  const subPath = secretPath.replace(/^\//, '').slice(bestMount.length);

  const cacheKey = mount;
  const version =
    bestEngine.options?.version === '2' || bestEngine.type === 'kv'
      ? (bestEngine.options?.version === '2' ? 2 : 1)
      : 1;

  engineCache.set(cacheKey, {
    version,
    type: bestEngine.type,
    expiry: Date.now() + CACHE_TTL,
  });
  pruneCache();

  return { mount, subPath, version, type: bestEngine.type };
}

function buildKVPath(
  mount: string,
  subPath: string,
  version: number,
  operation: 'data' | 'metadata' | 'delete'
): string {
  if (version === 2) {
    const pathSuffix = subPath ? `/${subPath}` : '';
    return `/${mount}/${operation}${pathSuffix}`;
  }
  const pathSuffix = subPath ? `/${subPath}` : '';
  return `/${mount}${pathSuffix}`;
}

// List secret engines
router.get(
  '/engines',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // Try user token first; fall back to system token if user lacks sys/mounts
      let mounts: MountsResponse;
      try {
        mounts = await vaultClient.get<MountsResponse>('/sys/mounts', req.vaultToken!);
      } catch {
        try {
          const sysToken = await getSystemToken();
          mounts = await vaultClient.get<MountsResponse>('/sys/mounts', sysToken);
        } catch {
          // If both fail, return empty list
          res.json({ engines: [] });
          return;
        }
      }

      const engines: SecretEngine[] = Object.entries(mounts.data).map(
        ([path, info]) => ({
          type: info.type,
          description: info.description,
          accessor: info.accessor,
          options: info.options,
          local: info.local,
          seal_wrap: info.seal_wrap,
          path,
        })
      );

      res.json({ engines });
    } catch (error) {
      next(error);
    }
  }
);

// List secrets at a path
router.get(
  '/list/*',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const secretPath = String(req.params[0] || '');
      if (!isValidSecretPath(secretPath)) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      const engineInfo = await getEngineInfo(req.vaultToken!, secretPath);

      // Non-KV engines (aws, pki, transit, ssh, database, etc.) don't expose
      // secrets via the standard KV list API — return an empty list.
      if (engineInfo.type !== 'kv' && engineInfo.type !== 'cubbyhole') {
        res.json({
          keys: [],
          mount: engineInfo.mount,
          version: engineInfo.version,
          engineType: engineInfo.type,
        });
        return;
      }

      const vaultPath = buildKVPath(
        engineInfo.mount,
        engineInfo.subPath,
        engineInfo.version,
        'metadata'
      );
      let keys: string[] = [];
      try {
        const response = await vaultClient.list<{
          data: { keys: string[] };
        }>(vaultPath, req.vaultToken!);
        keys = response.data.keys ?? [];
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // Vault 404 = empty path, 403 = no list permission — both treated as empty
        if (status === 404 || status === 403) {
          keys = [];
        } else {
          throw e;
        }
      }

      res.json({
        keys,
        mount: engineInfo.mount,
        version: engineInfo.version,
      });
      secretOperationsTotal.inc({ operation: 'list' });
    } catch (error) {
      next(error);
    }
  }
);

// Read a secret
router.get(
  '/read/*',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const secretPath = String(req.params[0] || '');
      if (!isValidSecretPath(secretPath)) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      const engineInfo = await getEngineInfo(req.vaultToken!, secretPath);
      const vaultPath = buildKVPath(
        engineInfo.mount,
        engineInfo.subPath,
        engineInfo.version,
        'data'
      );

      const response = await vaultClient.get<{ data: unknown }>(
        vaultPath,
        req.vaultToken!
      );

      // Extract field names only — values are never sent to the client
      const rawData = response.data as Record<string, unknown> | { data: Record<string, unknown> } | null;
      let fieldKeys: string[] = [];
      if (rawData && typeof rawData === 'object') {
        // KV v2 wraps actual data under a nested .data property
        const inner =
          engineInfo.version === 2 && 'data' in rawData && rawData.data && typeof rawData.data === 'object'
            ? (rawData.data as Record<string, unknown>)
            : (rawData as Record<string, unknown>);
        fieldKeys = Object.keys(inner);
      }

      res.json({
        keys: fieldKeys,
        mount: engineInfo.mount,
        version: engineInfo.version,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Read a secret with values — used by the editor to pre-fill the form
router.get(
  '/values/*',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const secretPath = String(req.params[0] || '');
      if (!isValidSecretPath(secretPath)) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      const engineInfo = await getEngineInfo(req.vaultToken!, secretPath);
      const vaultPath = buildKVPath(
        engineInfo.mount,
        engineInfo.subPath,
        engineInfo.version,
        'data'
      );

      const response = await vaultClient.get<{ data: unknown }>(
        vaultPath,
        req.vaultToken!
      );

      const rawData = response.data as Record<string, unknown> | { data: Record<string, unknown> } | null;
      let data: Record<string, unknown> = {};
      if (rawData && typeof rawData === 'object') {
        const inner =
          engineInfo.version === 2 && 'data' in rawData && rawData.data && typeof rawData.data === 'object'
            ? (rawData.data as Record<string, unknown>)
            : (rawData as Record<string, unknown>);
        data = inner;
      }

      res.json({ data, mount: engineInfo.mount, version: engineInfo.version });
    } catch (error) {
      next(error);
    }
  }
);

// Write a secret
router.post(
  '/write/*',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const secretPath = String(req.params[0] || '');
      if (!isValidSecretPath(secretPath)) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      const engineInfo = await getEngineInfo(req.vaultToken!, secretPath);
      const vaultPath = buildKVPath(
        engineInfo.mount,
        engineInfo.subPath,
        engineInfo.version,
        'data'
      );

      const validationError = validateSecretData(req.body);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      const writeData =
        engineInfo.version === 2
          ? { data: req.body as Record<string, unknown> }
          : (req.body as Record<string, unknown>);

      const response = await vaultClient.post(
        vaultPath,
        req.vaultToken!,
        writeData
      );

      secretOperationsTotal.inc({ operation: 'write' });
      res.json({ success: true, data: response });
    } catch (error) {
      next(error);
    }
  }
);

// Merge (partial update) a secret - uses system token for read, user token for write
router.post(
  '/merge/*',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const secretPath = String(req.params[0] || '');
      if (!isValidSecretPath(secretPath)) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      const userFields = req.body as Record<string, unknown>;

      if (!userFields || typeof userFields !== 'object') {
        res.status(400).json({ error: 'Request body must be an object' });
        return;
      }

      const validationError = validateSecretData(userFields);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      // Try to get system token — works with env var, K8s auth, or stored AppRole credentials
      let sysToken: string;
      try {
        sysToken = await getSystemToken();
        if (!sysToken) throw new Error('empty token');
      } catch {
        res.status(503).json({
          error: 'Merge operation requires system token configuration. Please complete system token setup at /setup.',
        });
        return;
      }

      const engineInfo = await getEngineInfo(req.vaultToken!, secretPath);
      const readPath = buildKVPath(
        engineInfo.mount,
        engineInfo.subPath,
        engineInfo.version,
        'data'
      );

      // Read existing secret with system token (never exposed to user)
      let existingData: Record<string, unknown> = {};
      try {
        const existing = await vaultClient.get<{
          data: { data: Record<string, unknown> } | Record<string, unknown>;
        }>(readPath, sysToken);

        existingData =
          engineInfo.version === 2
            ? (existing.data as { data: Record<string, unknown> }).data
            : (existing.data as Record<string, unknown>);
      } catch {
        // Secret may not exist yet, start with empty
      }

      // Merge user-provided fields with existing values
      const mergedData = { ...existingData, ...userFields };

      const writePath = buildKVPath(
        engineInfo.mount,
        engineInfo.subPath,
        engineInfo.version,
        'data'
      );

      const writeData =
        engineInfo.version === 2
          ? { data: mergedData }
          : mergedData;

      await vaultClient.post(writePath, req.vaultToken!, writeData);

      // Return only confirmation with the keys that were updated (never existing values)
      res.json({
        success: true,
        updatedKeys: Object.keys(userFields),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Delete a secret
router.delete(
  '/delete/*',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const secretPath = String(req.params[0] || '');
      if (!isValidSecretPath(secretPath)) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      const engineInfo = await getEngineInfo(req.vaultToken!, secretPath);
      const vaultPath = buildKVPath(
        engineInfo.mount,
        engineInfo.subPath,
        engineInfo.version,
        engineInfo.version === 2 ? 'metadata' : 'data'
      );

      await vaultClient.delete(vaultPath, req.vaultToken!);

      secretOperationsTotal.inc({ operation: 'delete' });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// Get secret metadata (KV v2 only)
router.get(
  '/metadata/*',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const secretPath = String(req.params[0] || '');
      if (!isValidSecretPath(secretPath)) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      const engineInfo = await getEngineInfo(req.vaultToken!, secretPath);

      if (engineInfo.version !== 2) {
        res.status(400).json({
          error: 'Metadata is only available for KV v2 engines',
        });
        return;
      }

      const vaultPath = buildKVPath(
        engineInfo.mount,
        engineInfo.subPath,
        engineInfo.version,
        'metadata'
      );

      const response = await vaultClient.get<{ data: unknown }>(
        vaultPath,
        req.vaultToken!
      );

      res.json({ data: response.data });
    } catch (error) {
      next(error);
    }
  }
);

// Update secret custom metadata (KV v2 only)
router.post(
  '/metadata/*',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const secretPath = String(req.params[0] || '');
      if (!isValidSecretPath(secretPath)) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      const engineInfo = await getEngineInfo(req.vaultToken!, secretPath);

      if (engineInfo.version !== 2) {
        res.status(400).json({
          error: 'Metadata is only available for KV v2 engines',
        });
        return;
      }

      const { custom_metadata } = req.body as {
        custom_metadata?: Record<string, string>;
      };

      if (!custom_metadata || typeof custom_metadata !== 'object') {
        res.status(400).json({ error: 'custom_metadata object is required' });
        return;
      }

      // Validate that all values are strings (Vault requirement)
      for (const [key, value] of Object.entries(custom_metadata)) {
        if (typeof value !== 'string') {
          res.status(400).json({
            error: `custom_metadata value for key "${key}" must be a string`,
          });
          return;
        }
      }

      const vaultPath = buildKVPath(
        engineInfo.mount,
        engineInfo.subPath,
        engineInfo.version,
        'metadata'
      );

      await vaultClient.post(vaultPath, req.vaultToken!, { custom_metadata });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// Enable a new secrets engine
router.post(
  '/engines/enable',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { path: mountPath, type, description, options } = req.body as {
        path?: string;
        type?: string;
        description?: string;
        options?: Record<string, string>;
      };

      if (!mountPath || !type) {
        res.status(400).json({ error: 'Both path and type are required' });
        return;
      }

      // Sanitize path — no slashes allowed except trailing
      const cleanPath = mountPath.replace(/^\/+|\/+$/g, '');
      if (!cleanPath || /[^a-zA-Z0-9_-]/.test(cleanPath)) {
        res.status(400).json({ error: 'Invalid mount path. Use only letters, numbers, hyphens, and underscores.' });
        return;
      }

      const payload: Record<string, unknown> = { type };
      if (description) payload['description'] = description;
      if (options) payload['options'] = options;

      await vaultClient.post(
        `/sys/mounts/${encodeURIComponent(cleanPath)}`,
        req.vaultToken!,
        payload
      );

      // Clear engine cache
      engineCache.clear();

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/secrets/engines/:path — disable (unmount) a secrets engine
router.delete(
  '/engines/:enginePath',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const enginePath = String(req.params['enginePath'] ?? '');
      if (!enginePath || /[^a-zA-Z0-9_-]/.test(enginePath)) {
        res.status(400).json({ error: 'Invalid engine path' });
        return;
      }

      await vaultClient.delete(
        `/sys/mounts/${encodeURIComponent(enginePath)}`,
        req.vaultToken!
      );

      // Clear engine cache
      engineCache.clear();

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// List accessible paths for the current token
router.get(
  '/accessible-paths',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const mounts = await vaultClient.get<MountsResponse>(
        '/sys/mounts',
        req.vaultToken!
      );

      const paths: string[] = [];

      async function walkKv(mount: string, version: number, prefix: string): Promise<void> {
        const listPath = version === 2
          ? (prefix ? `/${mount}/metadata/${prefix}` : `/${mount}/metadata`)
          : (prefix ? `/${mount}/${prefix}` : `/${mount}`);
        try {
          const resp = await vaultClient.list<{ data: { keys: string[] } }>(listPath, req.vaultToken!);
          for (const key of resp.data.keys ?? []) {
            const fullKey = prefix ? `${prefix}${key}` : key;
            if (key.endsWith('/')) {
              await walkKv(mount, version, fullKey);
            } else {
              paths.push(`${mount}/${fullKey}`);
            }
          }
        } catch {
          // No access or empty — skip
        }
      }

      for (const [mountPath, info] of Object.entries(mounts.data)) {
        if (info.type !== 'kv') continue;
        const mount = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath;
        const version = info.options?.version === '2' ? 2 : 1;
        await walkKv(mount, version, '');
      }

      return res.json({ paths });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
