import { Router, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { VaultClient } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getConfigStorage } from '../lib/config-storage/index.js';
import { backupsTotal, backupDurationSeconds, lastBackupTimestamp, lastBackupSizeBytes, lastBackupSecretsCount } from '../lib/metrics.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

router.use(authMiddleware);
router.use(requireAdmin);

const BACKUP_DIR = config.backupStoragePath
  ? path.resolve(config.backupStoragePath)
  : path.resolve(process.cwd(), 'data', 'backups');

const BACKUP_SCHEDULE_SECTION = 'backup-schedule';

function ensureBackupDir(): void {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/** Generate snapshot filename: datetime-counter format. */
function generateSnapshotFilename(): string {
  ensureBackupDir();
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const existingFiles = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith(dateStr.slice(0, 10)));
  const counter = existingFiles.length + 1;
  return `${dateStr}-${counter}.snap`;
}

/** Download a Raft snapshot from Vault and write it to disk. Returns the filename. */
async function takeSnapshot(token: string): Promise<{ filename: string; size: number; createdAt: string }> {
  ensureBackupDir();
  const filename = generateSnapshotFilename();
  const filePath = path.join(BACKUP_DIR, filename);
  const response = await vaultClient.getStream('/sys/storage/raft/snapshot', token);
  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(filePath);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (response.data as NodeJS.ReadableStream).pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    (response.data as NodeJS.ReadableStream).on('error', reject);
  });
  const stats = fs.statSync(filePath);
  return { filename, size: stats.size, createdAt: new Date().toISOString() };
}

/** Check if Vault is using Raft storage (required for snapshots). */
async function checkRaftAvailable(token: string): Promise<boolean> {
  try {
    // Try a HEAD request to the Raft snapshot endpoint
    await vaultClient.get('/sys/storage/raft/snapshot', token);
    return true;
  } catch (err) {
    // If we get a 404 or similar, Raft storage is not available
    return false;
  }
}

// GET /api/backup/status — check if Raft snapshot backups are available
router.get(
  '/status',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const raftAvailable = await checkRaftAvailable(req.vaultToken!);
      res.json({ raftAvailable });
    } catch {
      // If we can't determine status, assume not available
      res.json({ raftAvailable: false });
    }
  }
);

// POST /api/backup/create — take a native Vault Raft snapshot
router.post(
  '/create',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const backupStart = process.hrtime.bigint();
    try {
      const { filename, size, createdAt } = await takeSnapshot(req.vaultToken!);
      const durationSec = Number(process.hrtime.bigint() - backupStart) / 1e9;
      backupsTotal.inc({ result: 'success' });
      backupDurationSeconds.observe({ result: 'success' }, durationSec);
      lastBackupTimestamp.set(Date.now() / 1000);
      lastBackupSizeBytes.set(size);
      res.json({ success: true, filename, size, createdAt });
    } catch (error) {
      const durationSec = Number(process.hrtime.bigint() - backupStart) / 1e9;
      backupsTotal.inc({ result: 'failure' });
      backupDurationSeconds.observe({ result: 'failure' }, durationSec);
      next(error);
    }
  }
);

// GET /api/backup/list — list all snapshots (.snap) and legacy JSON backups
router.get(
  '/list',
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      ensureBackupDir();
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.snap') || f.endsWith('.json'))
        .sort()
        .reverse();

      const backups = files.map(filename => {
        const filePath = path.join(BACKUP_DIR, filename);
        const stats = fs.statSync(filePath);
        let type: 'snapshot' | 'legacy-json' | 'kv-json';
        if (filename.endsWith('.snap')) {
          type = 'snapshot';
        } else if (filename.startsWith('kv-backup-')) {
          type = 'kv-json';
        } else {
          type = 'legacy-json';
        }
        return {
          filename,
          size: stats.size,
          createdAt: stats.mtime.toISOString(),
          type,
        };
      });

      res.json({ backups });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/backup/restore — restore a Vault Raft snapshot
router.post(
  '/restore',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { filename } = req.body as { filename?: string };

      if (!filename || typeof filename !== 'string') {
        res.status(400).json({ error: 'Backup filename is required' });
        return;
      }

      const safeFilename = path.basename(filename);
      if (!safeFilename.endsWith('.snap')) {
        res.status(400).json({ error: 'Only native Vault snapshots (.snap) can be restored. Legacy JSON backups are read-only.' });
        return;
      }

      const filePath = path.join(BACKUP_DIR, safeFilename);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Snapshot file not found' });
        return;
      }

      const snapshotData = fs.readFileSync(filePath);
      await vaultClient.postBinary('/sys/storage/raft/snapshot-force-restore', req.vaultToken!, snapshotData);

      res.json({ success: true, filename: safeFilename });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/backup/download/:filename — download a backup file
router.get(
  '/download/:filename',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const safeFilename = path.basename(String(req.params['filename']));
      if (!safeFilename.endsWith('.snap') && !safeFilename.endsWith('.json')) {
        res.status(400).json({ error: 'Invalid backup filename' });
        return;
      }

      const filePath = path.join(BACKUP_DIR, safeFilename);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Backup file not found' });
        return;
      }

      const stats = fs.statSync(filePath);
      const contentType = safeFilename.endsWith('.snap')
        ? 'application/octet-stream'
        : 'application/json';

      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stats.size);

      const readStream = fs.createReadStream(filePath);
      readStream.pipe(res);
      readStream.on('error', next);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/backup/:filename — delete a backup file
router.delete(
  '/:filename',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const safeFilename = path.basename(String(req.params['filename']));
      if (!safeFilename.endsWith('.snap') && !safeFilename.endsWith('.json')) {
        res.status(400).json({ error: 'Invalid backup filename' });
        return;
      }

      const filePath = path.join(BACKUP_DIR, safeFilename);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Backup file not found' });
        return;
      }

      fs.unlinkSync(filePath);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/backup/schedule — get backup schedule
router.get(
  '/schedule',
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const storage = getConfigStorage();
      const schedule = await storage.get(BACKUP_SCHEDULE_SECTION);
      // Migrate old `interval` field to `cron` on first read
      const cron = schedule?.['cron'] || schedule?.['interval'] || '0 2 * * *';
      res.json({
        enabled: schedule?.['enabled'] === 'true',
        cron,
        lastBackup: schedule?.['lastBackup'] || null,
        nextBackup: schedule?.['nextBackup'] || null,
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/backup/schedule — update backup schedule
router.put(
  '/schedule',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { enabled, cron } = req.body as { enabled?: boolean; cron?: string };

      if (cron !== undefined) {
        if (typeof cron !== 'string' || !getNextCronOccurrence(cron)) {
          res.status(400).json({ error: 'Invalid cron expression. Use 5-field format: MIN HOUR DOM MON DOW. Example: "0 2 * * *" (daily at 2 AM).' });
          return;
        }
      }

      const storage = getConfigStorage();
      const current = await storage.get(BACKUP_SCHEDULE_SECTION) || {};
      if (enabled !== undefined) current['enabled'] = String(enabled);
      if (cron) current['cron'] = cron;

      // Calculate next backup occurrence from new cron
      if (current['enabled'] === 'true' && current['cron']) {
        const next = getNextCronOccurrence(current['cron']);
        current['nextBackup'] = next ? next.toISOString() : '';
      }

      await storage.set(BACKUP_SCHEDULE_SECTION, current);

      // Restart scheduler
      startBackupScheduler();

      res.json({
        enabled: current['enabled'] === 'true',
        cron: current['cron'] || '0 2 * * *',
        lastBackup: current['lastBackup'] || null,
        nextBackup: current['nextBackup'] || null,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ── KV Backup / Restore ───────────────────────────────────────────────────────

interface KvSecret {
  [key: string]: unknown;
}

interface KvEngineBackup {
  kvVersion: number;
  secrets: Record<string, KvSecret>;
}

interface KvBackupFile {
  version: 1;
  backupType: 'kv';
  createdAt: string;
  engines: Record<string, KvEngineBackup>;
}

/** List KV secret paths recursively under a prefix. */
async function listKVSecretsRecursive(
  mount: string,
  prefix: string,
  kvVersion: number,
  token: string,
  depth = 0
): Promise<string[]> {
  if (depth > 20) return []; // Guard against infinite recursion
  const listPath =
    kvVersion === 2
      ? `/${mount}/metadata/${prefix}`
      : `/${mount}/${prefix}`;

  let keys: string[] = [];
  try {
    const resp = await vaultClient.list<{ data: { keys: string[] } }>(listPath, token);
    keys = resp.data?.keys ?? [];
  } catch {
    return [];
  }

  const paths: string[] = [];
  for (const key of keys) {
    if (key.endsWith('/')) {
      const nested = await listKVSecretsRecursive(mount, prefix + key, kvVersion, token, depth + 1);
      paths.push(...nested);
    } else {
      paths.push(prefix + key);
    }
  }
  return paths;
}

/** Read a KV secret's plaintext data. */
async function readKVSecret(
  mount: string,
  secretPath: string,
  kvVersion: number,
  token: string
): Promise<KvSecret | null> {
  try {
    if (kvVersion === 2) {
      const resp = await vaultClient.get<{ data: { data: KvSecret } }>(
        `/${mount}/data/${secretPath}`,
        token
      );
      return resp.data?.data ?? null;
    } else {
      const resp = await vaultClient.get<{ data: KvSecret }>(`/${mount}/${secretPath}`, token);
      return resp.data ?? null;
    }
  } catch {
    return null;
  }
}

/** Generate a KV JSON backup filename. */
function generateKvBackupFilename(): string {
  ensureBackupDir();
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `kv-backup-${dateStr}.json`;
}

// POST /api/backup/kv-create — dump all KV secrets to a JSON file
router.post(
  '/kv-create',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;

      // List all mounts and filter KV engines
      const mounts = await vaultClient.get<{
        data: Record<string, { type: string; options: Record<string, string> | null }>;
      }>('/sys/mounts', token);

      const kvMounts = Object.entries(mounts.data)
        .filter(([, info]) => info.type === 'kv')
        .map(([mountPath, info]) => ({
          mount: mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath,
          kvVersion: info.options?.version === '2' ? 2 : 1,
        }));

      const backupData: KvBackupFile = {
        version: 1,
        backupType: 'kv',
        createdAt: new Date().toISOString(),
        engines: {},
      };

      for (const { mount, kvVersion } of kvMounts) {
        const secretPaths = await listKVSecretsRecursive(mount, '', kvVersion, token);
        const engineBackup: KvEngineBackup = { kvVersion, secrets: {} };

        for (const secretPath of secretPaths) {
          const data = await readKVSecret(mount, secretPath, kvVersion, token);
          if (data !== null) {
            engineBackup.secrets[secretPath] = data;
          }
        }

        backupData.engines[mount] = engineBackup;
      }

      ensureBackupDir();
      const filename = generateKvBackupFilename();
      const filePath = path.join(BACKUP_DIR, filename);
      fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2));
      const stats = fs.statSync(filePath);

      const secretCount = Object.values(backupData.engines).reduce(
        (sum, eng) => sum + Object.keys(eng.secrets).length, 0
      );

      lastBackupTimestamp.set(Date.now() / 1000);
      lastBackupSizeBytes.set(stats.size);
      lastBackupSecretsCount.set(secretCount);
      res.json({ success: true, filename, size: stats.size, createdAt: backupData.createdAt, secretCount });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/backup/kv-restore — restore KV secrets from a JSON backup file
router.post(
  '/kv-restore',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { filename } = req.body as { filename?: string };

      if (!filename || typeof filename !== 'string') {
        res.status(400).json({ error: 'Backup filename is required' });
        return;
      }

      const safeFilename = path.basename(filename);
      if (!safeFilename.endsWith('.json')) {
        res.status(400).json({ error: 'Invalid backup file type. Expected a .json KV backup.' });
        return;
      }

      const filePath = path.join(BACKUP_DIR, safeFilename);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Backup file not found' });
        return;
      }

      const raw = fs.readFileSync(filePath, 'utf-8');
      let backupData: KvBackupFile;
      try {
        backupData = JSON.parse(raw) as KvBackupFile;
      } catch {
        res.status(400).json({ error: 'Invalid backup file: not valid JSON' });
        return;
      }

      if (backupData.backupType !== 'kv' || backupData.version !== 1 || typeof backupData.engines !== 'object') {
        res.status(400).json({ error: 'Invalid backup file: unrecognised format' });
        return;
      }

      const token = req.vaultToken!;
      let restoredCount = 0;
      let failedCount = 0;

      for (const [mount, engineBackup] of Object.entries(backupData.engines)) {
        const { kvVersion, secrets } = engineBackup;
        for (const [secretPath, secretData] of Object.entries(secrets)) {
          try {
            if (kvVersion === 2) {
              await vaultClient.post(`/${mount}/data/${secretPath}`, token, { data: secretData });
            } else {
              await vaultClient.post(`/${mount}/${secretPath}`, token, secretData);
            }
            restoredCount++;
          } catch {
            failedCount++;
          }
        }
      }

      res.json({ success: true, filename: safeFilename, restoredCount, failedCount });
    } catch (error) {
      next(error);
    }
  }
);

// ── Backup scheduler ─────────────────────────────────────────────────────────

/**
 * Parse a single cron field into the allowed set of integer values.
 * Supports: * | *\/n | n | n,m | n-m | n-m/step
 */
function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (/^\*\/\d+$/.test(part)) {
      const step = parseInt(part.slice(2), 10);
      if (step < 1) return null;
      for (let i = min; i <= max; i += step) values.add(i);
    } else if (/^\d+-\d+(\/\d+)?$/.test(part)) {
      const [rangePart, stepStr] = part.split('/');
      const [loStr, hiStr] = rangePart!.split('-');
      const lo = parseInt(loStr!, 10);
      const hi = parseInt(hiStr!, 10);
      const step = stepStr ? parseInt(stepStr, 10) : 1;
      if (lo < min || hi > max || lo > hi || step < 1) return null;
      for (let i = lo; i <= hi; i += step) values.add(i);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n < min || n > max) return null;
      values.add(n);
    } else {
      return null; // Invalid syntax
    }
  }
  return values;
}

/**
 * Validate a 5-field cron expression and return the next occurrence date after `from`.
 * Returns null if the expression is invalid or has no upcoming occurrence within 4 years.
 */
export function getNextCronOccurrence(cron: string, from = new Date()): Date | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minuteField, hourField, domField, monthField, dowField] = parts as [string, string, string, string, string];

  const allowedMinutes = parseCronField(minuteField, 0, 59);
  const allowedHours   = parseCronField(hourField,   0, 23);
  const allowedDoms    = parseCronField(domField,    1, 31);
  const allowedMonths  = parseCronField(monthField,  1, 12);
  const allowedDows    = parseCronField(dowField,    0, 6);

  if (!allowedMinutes || !allowedHours || !allowedDoms || !allowedMonths || !allowedDows) return null;
  if ([allowedMinutes, allowedHours, allowedDoms, allowedMonths, allowedDows].some(s => s.size === 0)) return null;

  // Start from the next minute
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const deadline = new Date(candidate.getTime() + 4 * 366 * 24 * 60 * 60 * 1000);

  while (candidate < deadline) {
    const month = candidate.getMonth() + 1; // 1–12
    if (!allowedMonths.has(month)) {
      candidate.setMonth(candidate.getMonth() + 1, 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    const dom = candidate.getDate();
    const dow = candidate.getDay(); // 0=Sun
    // Standard cron: if both DOM and DOW are restricted (non-*), either match suffices
    const domRestricted = domField !== '*';
    const dowRestricted = dowField !== '*';
    let dayOk: boolean;
    if (!domRestricted && !dowRestricted) dayOk = true;
    else if (domRestricted && dowRestricted) dayOk = allowedDoms.has(dom) || allowedDows.has(dow);
    else if (domRestricted) dayOk = allowedDoms.has(dom);
    else dayOk = allowedDows.has(dow);

    if (!dayOk) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    const hour = candidate.getHours();
    if (!allowedHours.has(hour)) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
      continue;
    }

    const minute = candidate.getMinutes();
    if (!allowedMinutes.has(minute)) {
      candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
      continue;
    }

    return new Date(candidate);
  }

  return null;
}

let backupTimerId: ReturnType<typeof setTimeout> | null = null;

async function runScheduledBackup(): Promise<void> {
  try {
    const storage = getConfigStorage();
    const schedule = await storage.get(BACKUP_SCHEDULE_SECTION);
    if (schedule?.['enabled'] !== 'true') return;

    const nextBackup = schedule['nextBackup'];
    if (!nextBackup || new Date(nextBackup).getTime() > Date.now()) return;

    // Use system token to take a Vault Raft snapshot
    const { getSystemToken } = await import('../lib/systemToken.js');
    const sysToken = await getSystemToken();
    const { filename } = await takeSnapshot(sysToken);

    // Compute next occurrence from cron
    const cron = schedule['cron'] || schedule['interval'] || '0 2 * * *';
    const next = getNextCronOccurrence(cron);
    schedule['lastBackup'] = new Date().toISOString();
    schedule['nextBackup'] = next ? next.toISOString() : '';
    await storage.set(BACKUP_SCHEDULE_SECTION, schedule);

    console.log(`[Backup] Scheduled snapshot created: ${filename}`);
  } catch (err) {
    console.error('[Backup] Scheduled backup failed:', err instanceof Error ? err.message : err);
  }
}

export function startBackupScheduler(): void {
  if (backupTimerId) {
    clearInterval(backupTimerId);
    backupTimerId = null;
  }

  // Check every minute if a scheduled backup is due
  backupTimerId = setInterval(() => {
    runScheduledBackup().catch(err => {
      console.error('[Backup] Scheduler check failed:', err instanceof Error ? err.message : err);
    });
  }, 60 * 1000);
}

export default router;
