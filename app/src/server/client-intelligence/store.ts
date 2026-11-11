import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

/** Subset of a Vault audit entry needed for attribution (the rest is never persisted). */
export interface RawAudit {
  type?: string;
  time?: string;
  error?: string;
  auth?: { entity_id?: string; accessor?: string; display_name?: string; metadata?: Record<string, unknown> };
  request?: { id?: string; operation?: string; path?: string; mount_point?: string; mount_type?: string; remote_address?: string; client_token_accessor?: string };
  response?: { auth?: { entity_id?: string; accessor?: string; display_name?: string; metadata?: Record<string, unknown> } };
}

export interface ObservedRequest {
  id: string;
  time: string;
  key: string; // client key (see clientKey)
  displayName: string;
  entityId?: string;
  role: string; // auth role from the token metadata Vault records on each request ('' if none)
  ip: string;
  operation: string;
  path: string;
  mountPoint: string;
  error: boolean;
}

export interface ClientAgg {
  key: string;
  displayName: string;
  role: string;
  entityId: string;
  requests: number;
  errors: number;
  r24h: number;
  r7d: number;
  r30d: number;
  firstAt: string;
  lastAt: string;
  ips: { ip: string; requests: number; firstSeen: string; lastSeen: string }[];
}

export const GRACE_MS = 10_000; // wait for the response half of a request before counting it
const hourOf = (iso: string) => new Date(iso).toISOString().slice(0, 13);
const DAY_MS = 86_400_000;
// Hourly rows are kept this long, then rolled into one row per UTC day (keeps 90-day queries small).
// shortcut: windows reaching past this are day-aligned (the boundary UTC day counts whole); upgrade if exact hours are needed.
export const HOURLY_KEEP_DAYS = 8;
// Distinct anonymous (per-IP) and non-entity-token clients tracked; later ones fold into '<prefix>overflow'.
export const MAX_UNATTRIBUTED_KEYS = 1000;

/**
 * Client key. Entity clients use the entity id, which equals Vault's activity client_id,
 * so audit data joins to the activity export. Non-entity tokens use the accessor; calls with
 * no identity at all (e.g. failed logins) are grouped per source IP and never merged with real clients.
 */
export function clientKey(a: { entityId?: string; accessor?: string; ip: string }): string {
  if (a.entityId) return a.entityId;
  if (a.accessor) return `token:${a.accessor}`;
  return `anon:${a.ip || 'unknown'}`;
}

/**
 * Pairs request/response records by request id and returns one ObservedRequest per logical
 * request. Identity comes from the request auth, falling back to the response auth (logins).
 */
export function pairAuditEntries(entries: RawAudit[], after: number, upTo: number): ObservedRequest[] {
  const responses = new Map<string, RawAudit>();
  for (const e of entries) if (e.type === 'response' && e.request?.id) responses.set(e.request.id, e);
  const seen = new Set<string>();
  const out: ObservedRequest[] = [];
  for (const e of entries) {
    const id = e.request?.id;
    if (e.type !== 'request' || !id || !e.time || seen.has(id)) continue;
    const t = Date.parse(e.time);
    if (!(t > after && t <= upTo)) continue;
    seen.add(id);
    const resp = responses.get(id);
    const auth = e.auth?.entity_id || e.auth?.accessor ? e.auth : (resp?.response?.auth ?? resp?.auth ?? e.auth);
    const ip = e.request?.remote_address ?? '';
    const entityId = auth?.entity_id || undefined;
    const accessor = auth?.accessor || e.request?.client_token_accessor || undefined;
    const md = (auth as { metadata?: Record<string, unknown> } | undefined)?.metadata;
    const rawRole = md?.['role'] ?? md?.['role_name'];
    // eslint-disable-next-line no-control-regex
    const role = typeof rawRole === 'string' ? rawRole.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 128) : '';
    out.push({
      id,
      time: e.time,
      role,
      ip,
      key: clientKey({ entityId, accessor, ip }),
      displayName: auth?.display_name || '',
      entityId,
      operation: e.request?.operation ?? '',
      path: (e.request?.path ?? '').slice(0, 256),
      mountPoint: e.request?.mount_point ?? '',
      error: !!resp?.error,
    });
  }
  return out;
}

export class ClientIntelStore {
  db: DatabaseSync;
  constructor(path: string, private retentionDays = 90) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS buckets(hour TEXT NOT NULL, client_key TEXT NOT NULL, ip TEXT NOT NULL,
        requests INTEGER NOT NULL, errors INTEGER NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL,
        PRIMARY KEY(hour, client_key, ip));
      CREATE INDEX IF NOT EXISTS buckets_client ON buckets(client_key);
      CREATE TABLE IF NOT EXISTS buckets_daily(day TEXT NOT NULL, client_key TEXT NOT NULL, ip TEXT NOT NULL,
        requests INTEGER NOT NULL, errors INTEGER NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL,
        PRIMARY KEY(day, client_key, ip));
      CREATE INDEX IF NOT EXISTS buckets_daily_client ON buckets_daily(client_key);
      CREATE TABLE IF NOT EXISTS clients(client_key TEXT PRIMARY KEY, display_name TEXT NOT NULL, entity_id TEXT NOT NULL, last_at TEXT NOT NULL, role TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);`);
    // databases created before roles were captured
    const cols = this.db.prepare('PRAGMA table_info(clients)').all() as unknown as { name: string }[];
    if (!cols.some((c) => c.name === 'role')) this.db.exec("ALTER TABLE clients ADD COLUMN role TEXT NOT NULL DEFAULT ''");
  }

  getMeta(k: string): string | undefined {
    return (this.db.prepare('SELECT v FROM meta WHERE k=?').get(k) as { v: string } | undefined)?.v;
  }
  private setMeta(k: string, v: string) {
    this.db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v);
  }

  /** Folds new anonymous/token clients into an overflow key once MAX_UNATTRIBUTED_KEYS are tracked (unbounded cardinality otherwise). */
  private capKeys(reqs: ObservedRequest[]) {
    const known = new Map<string, Set<string>>();
    for (const prefix of ['anon:', 'token:']) {
      const rows = this.db.prepare('SELECT client_key k FROM clients WHERE client_key LIKE ?').all(`${prefix}%`) as unknown as { k: string }[];
      known.set(prefix, new Set(rows.map((r) => r.k)));
    }
    for (const r of reqs) {
      const prefix = r.key.startsWith('anon:') ? 'anon:' : r.key.startsWith('token:') ? 'token:' : '';
      if (!prefix) continue;
      const set = known.get(prefix)!;
      if (set.has(r.key)) continue;
      if (set.size >= MAX_UNATTRIBUTED_KEYS) r.key = `${prefix}overflow`;
      else set.add(r.key);
    }
  }

  /** Once per hour: roll old hourly rows into daily rows, drop past retention, forget clients with no rows left. */
  private maintain(now: number) {
    const hour = hourOf(new Date(now).toISOString());
    if (this.getMeta('maintained_hour') === hour) return;
    const keepFrom = new Date(now - HOURLY_KEEP_DAYS * DAY_MS).toISOString().slice(0, 10); // whole UTC days only
    this.db.prepare(`INSERT INTO buckets_daily SELECT substr(hour,1,10), client_key, ip, SUM(requests), SUM(errors), MIN(first_at), MAX(last_at)
      FROM buckets WHERE hour < ? GROUP BY 1,2,3 ON CONFLICT(day,client_key,ip) DO UPDATE SET requests=requests+excluded.requests,
      errors=errors+excluded.errors, first_at=MIN(first_at,excluded.first_at), last_at=MAX(last_at,excluded.last_at)`).run(keepFrom);
    this.db.prepare('DELETE FROM buckets WHERE hour < ?').run(keepFrom);
    this.db.prepare('DELETE FROM buckets_daily WHERE day < ?').run(new Date(now - this.retentionDays * DAY_MS).toISOString().slice(0, 10));
    this.db.exec('DELETE FROM clients WHERE client_key NOT IN (SELECT client_key FROM buckets UNION SELECT client_key FROM buckets_daily)');
    this.setMeta('maintained_hour', hour);
  }

  /**
   * Counts every request in (watermark, now-GRACE] exactly once; consecutive calls cover
   * disjoint intervals so repeated ingestion of the same buffer cannot double count.
   * `capacity` is the audit source's max entries: a full buffer that starts after the watermark means requests were dropped.
   */
  ingest(entries: RawAudit[], now = Date.now(), capacity?: number): number {
    const upTo = now - GRACE_MS;
    const after = Number(this.getMeta('watermark') ?? 0);
    if (capacity && after > 0 && entries.length >= capacity * 0.95) {
      const earliest = entries.reduce<number>((m, e) => Math.min(m, e.time ? Date.parse(e.time) : Infinity), Infinity);
      if (earliest > after + 1000) this.setMeta('gap_at', new Date(now).toISOString());
    }
    const reqs = pairAuditEntries(entries, after, upTo);
    this.capKeys(reqs);
    // One upsert per (hour, client, ip) rather than per request.
    const rows = new Map<string, { hour: string; key: string; ip: string; n: number; err: number; first: string; last: string }>();
    const latest = new Map<string, ObservedRequest>();
    for (const r of reqs) {
      const hour = hourOf(r.time);
      const k = `${hour}\u0000${r.key}\u0000${r.ip}`;
      const g = rows.get(k) ?? { hour, key: r.key, ip: r.ip, n: 0, err: 0, first: r.time, last: r.time };
      g.n++;
      if (r.error) g.err++;
      if (r.time < g.first) g.first = r.time;
      if (r.time > g.last) g.last = r.time;
      rows.set(k, g);
      // Latest request wins for name/last_at; an empty name or role never overwrites a known one.
      const prev = latest.get(r.key);
      latest.set(r.key, {
        ...r,
        displayName: r.displayName || prev?.displayName || '',
        role: r.role || prev?.role || '',
        time: prev && prev.time > r.time ? prev.time : r.time,
      });
    }
    const up = this.db.prepare(`INSERT INTO buckets VALUES(?,?,?,?,?,?,?) ON CONFLICT(hour,client_key,ip) DO UPDATE SET
      requests=requests+excluded.requests, errors=errors+excluded.errors,
      first_at=MIN(first_at,excluded.first_at), last_at=MAX(last_at,excluded.last_at)`);
    const cl = this.db.prepare(`INSERT INTO clients(client_key,display_name,entity_id,last_at,role) VALUES(?,?,?,?,?) ON CONFLICT(client_key) DO UPDATE SET
      display_name=CASE WHEN excluded.display_name<>'' THEN excluded.display_name ELSE display_name END,
      role=CASE WHEN excluded.role<>'' THEN excluded.role ELSE role END,
      last_at=MAX(last_at,excluded.last_at)`);
    this.db.exec('BEGIN');
    try {
      for (const g of rows.values()) up.run(g.hour, g.key, g.ip, g.n, g.err, g.first, g.last);
      for (const r of latest.values()) cl.run(r.key, r.displayName, r.entityId ?? '', r.time, r.role);
      const earliest = reqs.reduce<string | undefined>((m, r) => (!m || r.time < m ? r.time : m), undefined);
      const started = this.getMeta('started_at');
      if (earliest && (!started || earliest < started)) this.setMeta('started_at', earliest);
      this.setMeta('watermark', String(upTo));
      this.setMeta('last_ingested_at', new Date(now).toISOString());
      this.maintain(now);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return reqs.length;
  }

  /** Per-client aggregates for the window; windows use whole hour buckets (daily rows count as hour 23 of their day). */
  aggregate(days: number, now = Date.now()): ClientAgg[] {
    const h = (ms: number) => new Date(now - ms).toISOString().slice(0, 13);
    const since = h(days * DAY_MS);
    const lo = since < h(30 * DAY_MS) ? since : h(30 * DAY_MS); // 30d counts are always reported
    const rows = this.db
      .prepare(`WITH u AS (
          SELECT hour t, client_key, ip, requests, errors, first_at, last_at FROM buckets WHERE hour>=@lo
          UNION ALL
          SELECT day||'T23', client_key, ip, requests, errors, first_at, last_at FROM buckets_daily WHERE day>=@loDay)
        SELECT g.*, COALESCE(c.display_name,'') dn, COALESCE(c.entity_id,'') eid, COALESCE(c.role,'') role FROM (
          SELECT client_key key, ip,
            SUM(CASE WHEN t>=@since THEN requests END) r, SUM(CASE WHEN t>=@since THEN errors END) e,
            SUM(CASE WHEN t>=@h24 THEN requests END) r24, SUM(CASE WHEN t>=@h7 THEN requests END) r7,
            SUM(CASE WHEN t>=@h30 THEN requests END) r30,
            MIN(CASE WHEN t>=@since THEN first_at END) f, MAX(CASE WHEN t>=@since THEN last_at END) l
          FROM u GROUP BY client_key, ip HAVING r > 0) g LEFT JOIN clients c ON c.client_key=g.key`)
      .all({ lo, loDay: lo.slice(0, 10), since, h24: h(DAY_MS), h7: h(7 * DAY_MS), h30: h(30 * DAY_MS) }) as unknown as {
      key: string; ip: string; dn: string; eid: string; role: string; r: number; e: number | null;
      r24: number | null; r7: number | null; r30: number | null; f: string; l: string;
    }[];
    const by = new Map<string, ClientAgg>();
    for (const r of rows) {
      let a = by.get(r.key);
      if (!a) {
        a = { key: r.key, displayName: r.dn, role: r.role, entityId: r.eid, requests: 0, errors: 0, r24h: 0, r7d: 0, r30d: 0, firstAt: r.f, lastAt: r.l, ips: [] };
        by.set(r.key, a);
      }
      a.requests += r.r;
      a.errors += r.e ?? 0;
      a.r24h += r.r24 ?? 0;
      a.r7d += r.r7 ?? 0;
      a.r30d += r.r30 ?? 0;
      if (r.f < a.firstAt) a.firstAt = r.f;
      if (r.l > a.lastAt) a.lastAt = r.l;
      if (r.ip) a.ips.push({ ip: r.ip, requests: r.r, firstSeen: r.f, lastSeen: r.l });
    }
    return [...by.values()];
  }

  /** Requests per UTC day (or hour) per client for the window (charts and per-client history). */
  daily(days: number, now = Date.now(), bucket: 'day' | 'hour' = 'day'): { day: string; key: string; requests: number }[] {
    const since = new Date(now - days * DAY_MS).toISOString().slice(0, 13);
    const hourly = this.db
      .prepare('SELECT substr(hour,1,?) day, client_key key, SUM(requests) requests FROM buckets WHERE hour>=? GROUP BY day, client_key')
      .all(bucket === 'hour' ? 13 : 10, since) as unknown as { day: string; key: string; requests: number }[];
    if (bucket === 'hour') return hourly; // hourly rows always cover the hourly view
    const rolled = this.db
      .prepare('SELECT day, client_key key, SUM(requests) requests FROM buckets_daily WHERE day>=? GROUP BY day, client_key')
      .all(since.slice(0, 10)) as unknown as { day: string; key: string; requests: number }[];
    return [...rolled, ...hourly]; // disjoint: a UTC day is either rolled up or still hourly
  }

  coverage() {
    return { startedAt: this.getMeta('started_at'), lastIngestedAt: this.getMeta('last_ingested_at'), gapAt: this.getMeta('gap_at') };
  }
}
