import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { VaultClient, VaultError } from '../lib/vaultClient.js';
import { getSystemToken, isSystemTokenConfigured } from '../lib/systemToken.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { rotationRunsTotal, rotationSecretsRotated } from '../lib/metrics.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

router.use(authMiddleware);

// ── Time parsing ─────────────────────────────────────────────────────────────

/** Parse interval strings like 1m, 2h, 3d, 1y into milliseconds. */
export function parseInterval(interval: string): number | null {
  const match = interval.trim().match(/^(\d+)\s*(m|h|d|w|y)$/i);
  if (!match) return null;
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'w': return value * 7 * 24 * 60 * 60 * 1000;
    case 'y': return value * 365 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

/** Default character set for generated passwords. */
const DEFAULT_CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';

/** Generate a random password using the specified charset (rejection sampling to avoid modulo bias). */
function generatePassword(length: number, charset: string): string {
  const charsetLen = charset.length;
  // Largest multiple of charsetLen that fits in a byte, for unbiased sampling
  const maxValid = Math.floor(256 / charsetLen) * charsetLen;
  let result = '';
  while (result.length < length) {
    const bytes = crypto.randomBytes(length - result.length + 16); // over-request to reduce iterations
    for (let i = 0; i < bytes.length && result.length < length; i++) {
      if (bytes[i]! < maxValid) {
        result += charset[bytes[i]! % charsetLen];
      }
    }
  }
  return result;
}

interface MountsResponse {
  data: Record<string, {
    type: string;
    options: Record<string, string> | null;
  }>;
}

interface RotationEntry {
  path: string;
  mount: string;
  rotateInterval: string;
  rotateIntervalMs: number;
  rotateFormat: string;           // default charset for password generation
  rotateKeys: string[];           // keys configured to rotate (empty = all)
  keyFormats: Record<string, string>; // per-key charset overrides (rotate-format-<key>)
  lastRotated: string | null;
  nextRotation: string;
  secretKeys: string[];           // all keys present in the secret
}

/** Get all KV v2 mounts. */
async function getKvV2Mounts(token: string): Promise<string[]> {
  const mounts = await vaultClient.get<MountsResponse>('/sys/mounts', token);
  const kvMounts: string[] = [];
  for (const [mountPath, info] of Object.entries(mounts.data)) {
    if (info.type === 'kv' && info.options?.version === '2') {
      kvMounts.push(mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath);
    }
  }
  return kvMounts;
}

/** Recursively list all secrets in a KV v2 mount. */
async function listAllSecrets(mount: string, prefix: string, token: string): Promise<string[]> {
  const paths: string[] = [];
  try {
    const listPath = prefix ? `/${mount}/metadata/${prefix}` : `/${mount}/metadata`;
    const resp = await vaultClient.list<{ data: { keys: string[] } }>(listPath, token);
    const keys = resp.data.keys ?? [];
    for (const key of keys) {
      const fullPath = prefix ? `${prefix}${key}` : key;
      if (key.endsWith('/')) {
        // Directory — recurse
        const subPaths = await listAllSecrets(mount, fullPath, token);
        paths.push(...subPaths);
      } else {
        paths.push(fullPath);
      }
    }
  } catch {
    // No access or empty
  }
  return paths;
}

/** Read metadata for a specific secret path. */
async function getSecretMetadata(mount: string, secretPath: string, token: string): Promise<{
  custom_metadata: Record<string, string> | null;
  created_time: string;
  updated_time: string;
  current_version: number;
} | null> {
  try {
    const resp = await vaultClient.get<{
      data: {
        custom_metadata: Record<string, string> | null;
        created_time: string;
        updated_time: string;
        current_version: number;
      };
    }>(`/${mount}/metadata/${secretPath}`, token);
    return resp.data;
  } catch {
    return null;
  }
}

// GET /api/rotation — list all secrets registered for auto-rotation
router.get(
  '/',
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      const kvMounts = await getKvV2Mounts(token);
      const entries: RotationEntry[] = [];

      for (const mount of kvMounts) {
        const allPaths = await listAllSecrets(mount, '', token);
        for (const secretPath of allPaths) {
          const metadata = await getSecretMetadata(mount, secretPath, token);
          if (!metadata?.custom_metadata) continue;

          const rotateInterval = metadata.custom_metadata['rotate-interval'];
          if (!rotateInterval) continue;

          const intervalMs = parseInterval(rotateInterval);
          if (!intervalMs) continue;

          const rotateFormat = metadata.custom_metadata['rotate-format'] || DEFAULT_CHARSET;
          const lastRotated = metadata.custom_metadata['last-rotated'] || null;

          // Parse rotate-keys (empty / missing / '*' = rotate all keys)
          const rotateKeysRaw = metadata.custom_metadata['rotate-keys'] || '';
          const rotateKeys = (rotateKeysRaw === '*' || !rotateKeysRaw)
            ? []
            : rotateKeysRaw.split(',').map(k => k.trim()).filter(Boolean);

          // Parse per-key format overrides (rotate-format-<keyname>)
          const keyFormats: Record<string, string> = {};
          for (const [metaKey, metaVal] of Object.entries(metadata.custom_metadata)) {
            if (metaKey.startsWith('rotate-format-')) {
              const keyName = metaKey.slice('rotate-format-'.length);
              if (keyName) keyFormats[keyName] = metaVal;
            }
          }

          // Calculate next rotation time
          const baseTime = lastRotated
            ? new Date(lastRotated).getTime()
            : new Date(metadata.updated_time).getTime();
          const nextRotation = new Date(baseTime + intervalMs);

          // Read secret keys (field names only)
          let secretKeys: string[] = [];
          try {
            const dataResp = await vaultClient.get<{
              data: { data: Record<string, unknown> };
            }>(`/${mount}/data/${secretPath}`, token);
            secretKeys = Object.keys(dataResp.data.data ?? {});
          } catch {
            // Can't read — list empty
          }

          entries.push({
            path: `${mount}/${secretPath}`,
            mount,
            rotateInterval,
            rotateIntervalMs: intervalMs,
            rotateFormat,
            rotateKeys,
            keyFormats,
            lastRotated,
            nextRotation: nextRotation.toISOString(),
            secretKeys,
          });
        }
      }

      // Sort by next rotation (soonest first)
      entries.sort((a, b) => new Date(a.nextRotation).getTime() - new Date(b.nextRotation).getTime());

      // Group by mount path
      const grouped: Record<string, RotationEntry[]> = {};
      for (const entry of entries) {
        const key = entry.mount;
        if (!grouped[key]) grouped[key] = [];
        grouped[key]!.push(entry);
      }

      res.json({ entries, grouped, total: entries.length });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/rotation/rotate — manually trigger rotation for a specific path
router.post(
  '/rotate',
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!isSystemTokenConfigured()) {
        res.status(503).json({ error: 'Rotation requires system token configuration' });
        return;
      }

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        res.status(400).json({ error: 'Request body must be a JSON object' });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const secretFullPath = typeof body['path'] === 'string' ? body['path'] : '';
      const rotateKeys = Array.isArray(body['keys']) ? body['keys'].filter((k): k is string => typeof k === 'string') : undefined;
      const length = typeof body['length'] === 'number' ? body['length'] : undefined;

      if (!secretFullPath) {
        res.status(400).json({ error: 'Secret path is required' });
        return;
      }

      const token = req.vaultToken!;
      const sysToken = await getSystemToken();

      // Parse mount and sub-path
      const kvMounts = await getKvV2Mounts(token);
      let mount = '';
      let subPath = '';
      for (const m of kvMounts) {
        const prefix = m + '/';
        if (secretFullPath.startsWith(prefix)) {
          mount = m;
          subPath = secretFullPath.slice(prefix.length);
          break;
        }
      }

      if (!mount) {
        res.status(400).json({ error: 'Could not find KV v2 mount for path' });
        return;
      }

      // Read current metadata
      const metadata = await getSecretMetadata(mount, subPath, token);
      if (!metadata?.custom_metadata?.['rotate-interval']) {
        res.status(400).json({ error: 'Secret is not registered for auto-rotation (missing rotate-interval metadata)' });
        return;
      }

      const defaultCharset = metadata.custom_metadata['rotate-format'] || DEFAULT_CHARSET;
      const pwLength = Math.min(Math.max(length || 32, 8), 256);

      // Read existing secret with system token
      let existingData: Record<string, unknown> = {};
      try {
        const existing = await vaultClient.get<{
          data: { data: Record<string, unknown> };
        }>(`/${mount}/data/${subPath}`, sysToken);
        existingData = existing.data.data ?? {};
      } catch {
        // Secret might not exist yet
      }

      // Determine which keys to rotate:
      // 1. Explicit keys passed in the request body take priority
      // 2. Fall back to rotate-keys metadata config
      // 3. Fall back to all keys
      let keysToRotate: string[];
      if (rotateKeys && rotateKeys.length > 0) {
        keysToRotate = rotateKeys.filter(k => k in existingData);
      } else {
        const configuredKeysRaw = metadata.custom_metadata['rotate-keys'] || '';
        const configuredKeys = (configuredKeysRaw === '*' || !configuredKeysRaw)
          ? null
          : configuredKeysRaw.split(',').map(k => k.trim()).filter(Boolean);
        keysToRotate = configuredKeys
          ? configuredKeys.filter(k => k in existingData)
          : Object.keys(existingData);
      }

      // Generate new values with per-key charset support
      const updates: Record<string, unknown> = { ...existingData };
      for (const key of keysToRotate) {
        const keyCharset = metadata.custom_metadata[`rotate-format-${key}`] || defaultCharset;
        updates[key] = generatePassword(pwLength, keyCharset);
      }

      // Write updated secret using user's token
      await vaultClient.post(`/${mount}/data/${subPath}`, token, { data: updates });

      // Update last-rotated metadata
      const now = new Date().toISOString();
      await vaultClient.post(`/${mount}/metadata/${subPath}`, token, {
        custom_metadata: {
          ...metadata.custom_metadata,
          'last-rotated': now,
        },
      });

      res.json({
        success: true,
        path: secretFullPath,
        rotatedKeys: keysToRotate,
        rotatedAt: now,
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/rotation/status — get rotation scheduler status
router.get(
  '/status',
  requireAdmin,
  (_req: AuthenticatedRequest, res: Response) => {
    res.json({
      schedulerRunning: rotationTimerId !== null,
      lastCheck: lastSchedulerCheck,
      nextCheck: nextSchedulerCheck,
    });
  }
);

// ── Background rotation scheduler ────────────────────────────────────────────

let rotationTimerId: ReturnType<typeof setTimeout> | null = null;
let lastSchedulerCheck: string | null = null;
let nextSchedulerCheck: string | null = null;

// Maximum interval between scheduler checks (fallback / safety net)
const SCHEDULER_INTERVAL_MS = 60 * 1000;

async function runRotationCheck(): Promise<void> {
  if (!isSystemTokenConfigured()) return;

  try {
    const sysToken = await getSystemToken();
    const kvMounts = await getKvV2Mounts(sysToken);
    const now = Date.now();

    for (const mount of kvMounts) {
      const allPaths = await listAllSecrets(mount, '', sysToken);
      for (const secretPath of allPaths) {
        try {
          const metadata = await getSecretMetadata(mount, secretPath, sysToken);
          if (!metadata?.custom_metadata) continue;

          const rotateInterval = metadata.custom_metadata['rotate-interval'];
          if (!rotateInterval) continue;

          const intervalMs = parseInterval(rotateInterval);
          if (!intervalMs) continue;

          const lastRotated = metadata.custom_metadata['last-rotated'];
          const baseTime = lastRotated
            ? new Date(lastRotated).getTime()
            : new Date(metadata.updated_time).getTime();

          if (baseTime + intervalMs > now) continue; // Not due yet

          // Rotation is due — rotate configured keys with per-key charset support
          const defaultCharset = metadata.custom_metadata['rotate-format'] || DEFAULT_CHARSET;

          // Parse rotate-keys config
          const rotateKeysRaw = metadata.custom_metadata['rotate-keys'] || '';
          const configuredKeys = (rotateKeysRaw === '*' || !rotateKeysRaw)
            ? null
            : rotateKeysRaw.split(',').map(k => k.trim()).filter(Boolean);

          let existingData: Record<string, unknown> = {};
          try {
            const existing = await vaultClient.get<{
              data: { data: Record<string, unknown> };
            }>(`/${mount}/data/${secretPath}`, sysToken);
            existingData = existing.data.data ?? {};
          } catch {
            continue; // Can't read, skip
          }

          const keysToRotate = configuredKeys
            ? configuredKeys.filter(k => k in existingData)
            : Object.keys(existingData);

          const updates: Record<string, unknown> = { ...existingData };
          for (const key of keysToRotate) {
            const keyCharset = metadata.custom_metadata[`rotate-format-${key}`] || defaultCharset;
            updates[key] = generatePassword(32, keyCharset);
          }

          await vaultClient.post(`/${mount}/data/${secretPath}`, sysToken, { data: updates });

          const rotatedAt = new Date().toISOString();
          await vaultClient.post(`/${mount}/metadata/${secretPath}`, sysToken, {
            custom_metadata: {
              ...metadata.custom_metadata,
              'last-rotated': rotatedAt,
            },
          });

          console.log(`[Rotation] Rotated secrets at ${mount}/${secretPath}`);
          rotationSecretsRotated.inc();
        } catch (err) {
          console.error(`[Rotation] Error rotating ${mount}/${secretPath}:`, err instanceof Error ? err.message : err);
        }
      }
    }
    rotationRunsTotal.inc({ result: 'success' });
  } catch (err) {
    console.error('[Rotation] Scheduler error:', err instanceof Error ? err.message : err);
    rotationRunsTotal.inc({ result: 'failure' });
  }

  lastSchedulerCheck = new Date().toISOString();
  // nextSchedulerCheck is updated by scheduleNextCheck() after this function returns
}

/** Schedule the next rotation check using the earliest due time across all secrets. */
async function scheduleNextCheck(): Promise<void> {
  if (!isSystemTokenConfigured()) return;

  let delayMs = SCHEDULER_INTERVAL_MS;

  try {
    const sysToken = await getSystemToken();
    const kvMounts = await getKvV2Mounts(sysToken);
    const now = Date.now();
    let earliest = now + SCHEDULER_INTERVAL_MS;

    for (const mount of kvMounts) {
      const allPaths = await listAllSecrets(mount, '', sysToken);
      for (const secretPath of allPaths) {
        const metadata = await getSecretMetadata(mount, secretPath, sysToken);
        if (!metadata?.custom_metadata) continue;
        const rotateInterval = metadata.custom_metadata['rotate-interval'];
        if (!rotateInterval) continue;
        const intervalMs = parseInterval(rotateInterval);
        if (!intervalMs) continue;
        const lastRotated = metadata.custom_metadata['last-rotated'];
        const baseTime = lastRotated
          ? new Date(lastRotated).getTime()
          : new Date(metadata.updated_time).getTime();
        const dueAt = baseTime + intervalMs;
        if (dueAt < earliest) earliest = dueAt;
      }
    }

    delayMs = Math.max(1000, earliest - now);
  } catch {
    // Fall back to fixed interval on error
  }

  rotationTimerId = setTimeout(() => {
    runRotationCheck()
      .catch(err => {
        console.error('[Rotation] Check failed:', err instanceof Error ? err.message : err);
      })
      .finally(() => {
        scheduleNextCheck().catch(() => {});
      });
  }, delayMs) as unknown as ReturnType<typeof setTimeout>;

  nextSchedulerCheck = new Date(Date.now() + delayMs).toISOString();
}

/** Start the background rotation scheduler. */
export function startRotationScheduler(): void {
  if (rotationTimerId) return;

  console.log('[Rotation] Starting rotation scheduler (smart scheduling)');

  // Run immediately on startup to catch any missed rotations, then smart-schedule
  runRotationCheck()
    .catch(err => {
      console.error('[Rotation] Initial check failed:', err instanceof Error ? err.message : err);
    })
    .finally(() => {
      scheduleNextCheck().catch(() => {});
    });
}

// POST /api/rotation/configure — register a secret for auto-rotation by writing its metadata
router.post(
  '/configure',
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Record<string, unknown>;
      const secretFullPath = typeof body['path'] === 'string' ? body['path'] : '';
      const rotateInterval = typeof body['rotateInterval'] === 'string' ? body['rotateInterval'] : '';
      const rotateKeys = typeof body['rotateKeys'] === 'string' ? body['rotateKeys'] : '';
      const rotateFormat = typeof body['rotateFormat'] === 'string' ? body['rotateFormat'] : '';

      if (!secretFullPath) {
        res.status(400).json({ error: 'Secret path is required' });
        return;
      }
      if (!rotateInterval || !parseInterval(rotateInterval)) {
        res.status(400).json({ error: 'Invalid rotate-interval. Use e.g. 1h, 24h, 7d.' });
        return;
      }

      const token = req.vaultToken!;
      const kvMounts = await getKvV2Mounts(token);
      let mount = '';
      let subPath = '';
      for (const m of kvMounts) {
        const prefix = m + '/';
        if (secretFullPath.startsWith(prefix)) {
          mount = m;
          subPath = secretFullPath.slice(prefix.length);
          break;
        }
      }

      if (!mount) {
        res.status(400).json({ error: 'Path does not match any KV v2 mount' });
        return;
      }

      // Read existing metadata to preserve it
      const existing = await getSecretMetadata(mount, subPath, token);
      const existingMeta = existing?.custom_metadata ?? {};

      const newMeta: Record<string, string> = {
        ...existingMeta,
        'rotate-interval': rotateInterval,
      };
      if (rotateKeys.trim()) newMeta['rotate-keys'] = rotateKeys.trim();
      else delete newMeta['rotate-keys'];
      if (rotateFormat.trim()) newMeta['rotate-format'] = rotateFormat.trim();
      else delete newMeta['rotate-format'];

      await vaultClient.post(
        `/${mount}/metadata/${subPath}`,
        token,
        { custom_metadata: newMeta }
      );

      // Reschedule so the new entry is picked up promptly
      scheduleNextCheck().catch(() => {});

      res.json({ success: true, path: secretFullPath });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/rotation/registration — remove rotation metadata from a secret
router.delete(
  '/registration',
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const secretFullPath = typeof req.query['path'] === 'string' ? req.query['path'] : '';
      if (!secretFullPath) {
        res.status(400).json({ error: 'path query parameter is required' });
        return;
      }

      const token = req.vaultToken!;
      const kvMounts = await getKvV2Mounts(token);
      let mount = '';
      let subPath = '';
      for (const m of kvMounts) {
        const prefix = m + '/';
        if (secretFullPath.startsWith(prefix)) {
          mount = m;
          subPath = secretFullPath.slice(prefix.length);
          break;
        }
      }

      if (!mount) {
        res.status(400).json({ error: 'Path does not match any KV v2 mount' });
        return;
      }

      // Read existing metadata and strip rotation fields
      const existing = await getSecretMetadata(mount, subPath, token);
      const meta: Record<string, string> = { ...(existing?.custom_metadata ?? {}) };
      const rotationKeys = ['rotate-interval', 'rotate-keys', 'rotate-format', 'last-rotated'];
      // Also remove any per-key format overrides
      for (const k of Object.keys(meta)) {
        if (k.startsWith('rotate-format-') || rotationKeys.includes(k)) delete meta[k];
      }

      await vaultClient.post(
        `/${mount}/metadata/${subPath}`,
        token,
        { custom_metadata: meta }
      );

      res.json({ success: true, path: secretFullPath });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
