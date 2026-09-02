/**
 * VaultLens internal audit logger.
 * Writes audit entries to a daily-rolling log file under the data directory.
 * Files are named `vaultlens-audit-YYYY-MM-DD.log` (one JSON object per line).
 */
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

export interface VaultLensAuditEntry {
  timestamp: string;
  action: string;
  status?: 'success' | 'failure';
  /** Display name, entity ID, or system identity that performed the action. */
  actor?: string;
  /** Resource, path, or object affected by the action. */
  target?: string;
  /** Additional event-specific values. Never include credentials or secret values. */
  details?: Record<string, string | number | boolean | null>;
  /** IP address of the client */
  clientIp?: string;
}

interface LegacyVaultLensAuditEntry {
  timestamp: string;
  action: 'share_created' | 'share_viewed' | 'login' | 'logout';
  result?: 'success' | 'failure';
  shareId?: string;
  shareMode?: 'one-time' | 'otp' | 'auth-login';
  url?: string;
  creator?: string;
  viewer?: string;
  user?: string;
  clientIp?: string;
}

function normalizeAuditEntry(entry: VaultLensAuditEntry | LegacyVaultLensAuditEntry): VaultLensAuditEntry {
  if (!('result' in entry) && !('shareId' in entry) && !('creator' in entry) && !('user' in entry)) {
    return entry;
  }

  const legacy = entry as LegacyVaultLensAuditEntry;
  const isShare = legacy.action.startsWith('share_');
  return {
    timestamp: legacy.timestamp,
    action: isShare ? legacy.action.replace('_', '.') : legacy.action,
    status: legacy.result,
    actor: legacy.user || legacy.creator || legacy.viewer,
    target: legacy.url || legacy.shareId,
    details: {
      ...(legacy.shareMode ? { shareMode: legacy.shareMode } : {}),
      ...(legacy.creator ? { creator: legacy.creator } : {}),
      ...(legacy.viewer ? { viewer: legacy.viewer } : {}),
    },
    clientIp: legacy.clientIp,
  };
}

function getDataDir(): string {
  if (config.configStoragePath) return config.configStoragePath;
  return path.resolve(process.cwd(), 'data');
}

function getAuditDir(): string {
  return path.join(getDataDir(), 'audit');
}

function todayFilename(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `vaultlens-audit-${yyyy}-${mm}-${dd}.log`;
}

/**
 * Append an audit entry to today's log file.
 * Creates the audit directory and file if they don't exist.
 */
export function writeAuditEntry(entry: VaultLensAuditEntry): void {
  try {
    const dir = getAuditDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, todayFilename());
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
  } catch (err) {
    // Best-effort — don't crash the server if audit write fails
    console.error('[vaultlens-audit] Failed to write audit entry:', err);
  }
}

/**
 * Read audit entries, optionally filtering by date range.
 * Returns entries newest-first.
 */
export function readAuditEntries(options?: {
  from?: string; // ISO date string YYYY-MM-DD
  to?: string;   // ISO date string YYYY-MM-DD
  limit?: number;
  offset?: number;
}): { entries: VaultLensAuditEntry[]; total: number } {
  const dir = getAuditDir();
  if (!fs.existsSync(dir)) {
    return { entries: [], total: 0 };
  }

  // List all audit log files sorted descending (newest first)
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('vaultlens-audit-') && f.endsWith('.log'))
    .sort()
    .reverse();

  const fromDate = options?.from || '';
  const toDate = options?.to || '';

  let allEntries: VaultLensAuditEntry[] = [];

  for (const file of files) {
    // Extract date from filename: vaultlens-audit-YYYY-MM-DD.log
    const dateMatch = file.match(/vaultlens-audit-(\d{4}-\d{2}-\d{2})\.log/);
    if (!dateMatch) continue;
    const fileDate = dateMatch[1] as string;

    // Date range filter on file level
    if (fromDate && fileDate < fromDate) continue;
    if (toDate && fileDate > toDate) continue;

    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as VaultLensAuditEntry | LegacyVaultLensAuditEntry;
          allEntries.push(normalizeAuditEntry(entry));
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Sort newest first
  allEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const total = allEntries.length;
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 100;
  const entries = allEntries.slice(offset, offset + limit);

  return { entries, total };
}

/**
 * List available audit log dates (for date picker / filtering).
 */
export function listAuditDates(): string[] {
  const dir = getAuditDir();
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => f.startsWith('vaultlens-audit-') && f.endsWith('.log'))
    .map(f => {
      const m = f.match(/vaultlens-audit-(\d{4}-\d{2}-\d{2})\.log/);
      return m ? m[1] as string : '';
    })
    .filter(Boolean)
    .sort()
    .reverse();
}
