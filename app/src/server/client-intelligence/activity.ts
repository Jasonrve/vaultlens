import { VaultError } from '../lib/vaultClient.js';
import type { ActivityStatus } from '../../shared/clientIntelligence.js';
import { sanitizeMetadata } from './resolvers.js';

/** One client as reported by Vault's activity export (raw; no enrichment). */
export interface ActivityClient {
  clientId: string;
  clientType: string;
  namespacePath: string;
  mountAccessor: string;
  mountPath: string;
  mountType: string;
  timestamp: string; // last month-bucket Vault saw this client in
  months: number; // number of monthly buckets containing the client
  aliasName?: string;
  metadata: Record<string, string>;
}

export interface MonthlyCount { month: string; clients: number }

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function toClient(r: Record<string, unknown>): ActivityClient | undefined {
  const clientId = str(r['client_id']);
  if (!clientId) return undefined;
  return {
    clientId,
    clientType: str(r['client_type']) || 'unknown',
    namespacePath: str(r['namespace_path']),
    mountAccessor: str(r['mount_accessor']),
    mountPath: str(r['mount_path']),
    mountType: str(r['mount_type']),
    timestamp: str(r['timestamp']),
    months: 1,
    aliasName: str(r['entity_alias_name']) || undefined,
    metadata: {
      ...sanitizeMetadata(r['entity_alias_metadata']),
      ...sanitizeMetadata(r['entity_alias_custom_metadata']),
    },
  };
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Parses a Vault activity export (NDJSON, a JSON array, or CSV) line by line, so the
 * full export is never held as one string. Months are deduplicated: one entry per
 * (client_id, mount_accessor), keeping the latest timestamp.
 */
export async function parseActivityExport(lines: AsyncIterable<string> | Iterable<string>): Promise<ActivityClient[]> {
  const byKey = new Map<string, ActivityClient>();
  let csvHeader: string[] | undefined;
  const add = (r: Record<string, unknown>) => {
    const c = toClient(r);
    if (!c) return;
    const key = `${c.clientId}\u0000${c.mountAccessor}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, c); return; }
    prev.months += 1;
    if (c.timestamp > prev.timestamp) Object.assign(prev, { ...c, months: prev.months });
  };
  for await (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[[,]*\s*\{/.test(line)) {
      try {
        if (line.startsWith('[') && line.endsWith(']')) {
          for (const r of JSON.parse(line) as Record<string, unknown>[]) add(r); // whole array on one line
        } else {
          add(JSON.parse(line.replace(/^[[,\s]+/, '').replace(/[,\]\s]+$/, '')) as Record<string, unknown>);
        }
      } catch { /* skip malformed record */ }
    } else if (line === '[' || line === ']') {
      continue;
    } else if (!csvHeader) {
      csvHeader = splitCsv(line);
    } else {
      const cells = splitCsv(line);
      const rec: Record<string, unknown> = {};
      csvHeader.forEach((h, i) => { rec[h] = cells[i]; });
      for (const k of ['entity_alias_metadata', 'entity_alias_custom_metadata']) {
        try { rec[k] = rec[k] ? JSON.parse(String(rec[k])) : undefined; } catch { rec[k] = undefined; }
      }
      add(rec);
    }
  }
  return [...byKey.values()];
}

/** Maps Vault's /sys/internal/counters/activity response to monthly client counts. */
export function parseActivitySummary(body: unknown): { total: number | null; months: MonthlyCount[]; start?: string; end?: string } {
  const d = ((body as { data?: Record<string, unknown> } | null)?.data ?? {}) as {
    start_time?: string; end_time?: string;
    total?: { clients?: number; distinct_entities?: number; non_entity_tokens?: number };
    months?: { timestamp?: string; counts?: { clients?: number; distinct_entities?: number; non_entity_tokens?: number } }[];
  };
  const n = (c?: { clients?: number; distinct_entities?: number; non_entity_tokens?: number }) =>
    typeof c?.clients === 'number' ? c.clients : c ? (c.distinct_entities ?? 0) + (c.non_entity_tokens ?? 0) : null;
  return {
    total: n(d.total),
    months: (d.months ?? []).filter((m) => m.timestamp && m.counts).map((m) => ({ month: m.timestamp!.slice(0, 7), clients: n(m.counts) ?? 0 })),
    start: d.start_time,
    end: d.end_time,
  };
}

/** Translates a Vault failure into a status the UI can explain instead of a silent zero. */
export function classifyActivityError(e: unknown): ActivityStatus {
  const base = { available: false, exportAvailable: false };
  if (e instanceof VaultError) {
    if (e.statusCode === 403) return { ...base, reason: 'forbidden', message: 'Your token cannot read sys/internal/counters/activity.' };
    if (e.statusCode === 404 || e.statusCode === 405) return { ...base, reason: 'unsupported', message: 'This Vault version or edition does not expose client activity export.' };
    if (/no data/i.test(e.message)) return { ...base, reason: 'no_data', message: 'Vault has no client activity data for this time range yet.' };
    if (/disabled/i.test(e.message)) return { ...base, reason: 'disabled', message: 'Vault client activity counting is disabled.' };
    return { ...base, reason: 'error', message: e.message };
  }
  return { ...base, reason: 'error', message: e instanceof Error ? e.message : 'Unknown error' };
}

export async function* streamLines(stream: AsyncIterable<Buffer | string>): AsyncGenerator<string> {
  let buf = '';
  for await (const chunk of stream) {
    buf += chunk.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, i);
      buf = buf.slice(i + 1);
    }
  }
  if (buf) yield buf;
}

/** True when /sys/internal/counters/config says activity counting is off ('default-disabled' | 'disable'). */
export function countingDisabled(config: unknown): boolean {
  const v = (config as { data?: { enabled?: unknown } } | null)?.data?.enabled;
  return typeof v === 'string' && /disable/i.test(v);
}
