import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CertificateRecord,
  PkiSummary,
  PkiJob,
  PkiJobSource,
  PkiJobDetails,
  PkiQuery,
  PkiSource,
  Revocation,
} from "../../shared/pki.js";
import { parseCertificate } from "./certificate.js";
import { queryKey, whereQuery } from "./query.js";
import { PkiError } from "./adapter.js";
export class WorkerStopped extends Error {}
export class CertificateConflict extends Error {
  constructor(
    public expectedFingerprint: string,
    public observedFingerprint: string,
  ) {
    super(
      `Certificate identity conflict: retained ${expectedFingerprint}; observed ${observedFingerprint}`,
    );
  }
}
export class PkiStore {
  workerAttempt?: { id: string; attempt: number };
  db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS pki_schema(version INTEGER PRIMARY KEY);

      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, cluster TEXT NOT NULL, namespace TEXT NOT NULL, accessor TEXT NOT NULL, path TEXT NOT NULL, description TEXT NOT NULL, lastCollected TEXT, coverage TEXT NOT NULL DEFAULT 'not_collected');
      CREATE TABLE IF NOT EXISTS blobs(fingerprint TEXT PRIMARY KEY, der BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS certificates(id INTEGER PRIMARY KEY, sourceId TEXT NOT NULL REFERENCES sources(id), serial TEXT NOT NULL, fingerprint TEXT NOT NULL REFERENCES blobs(fingerprint), cn TEXT NOT NULL COLLATE NOCASE, subject TEXT NOT NULL, issuer TEXT NOT NULL, notBefore INTEGER NOT NULL, notAfter INTEGER NOT NULL, algorithm TEXT NOT NULL, keySize INTEGER NOT NULL, curve TEXT NOT NULL, type TEXT NOT NULL, revoked TEXT NOT NULL, revocationObservedAt TEXT, firstSeen TEXT NOT NULL, lastSeen TEXT NOT NULL, presence TEXT NOT NULL DEFAULT 'present', eku TEXT NOT NULL, UNIQUE(sourceId,serial));
      CREATE INDEX IF NOT EXISTS cert_source_expiry ON certificates(sourceId,notAfter,id);
      CREATE INDEX IF NOT EXISTS cert_source_cn ON certificates(sourceId,cn,id);
      CREATE INDEX IF NOT EXISTS cert_fingerprint ON certificates(fingerprint);
      CREATE TABLE IF NOT EXISTS sans(certificateId INTEGER NOT NULL REFERENCES certificates(id) ON DELETE CASCADE, type TEXT NOT NULL, value TEXT NOT NULL COLLATE NOCASE, PRIMARY KEY(certificateId,type,value));
      CREATE INDEX IF NOT EXISTS san_lookup ON sans(type,value,certificateId);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,sources TEXT NOT NULL,status TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,error TEXT,pid INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS single_active_job ON jobs((1)) WHERE status IN ('queued','running','pausing');
      CREATE TABLE IF NOT EXISTS job_sources(jobId TEXT NOT NULL REFERENCES jobs(id), sourceId TEXT NOT NULL REFERENCES sources(id), listed INTEGER NOT NULL DEFAULT 0, revoked TEXT, error TEXT, PRIMARY KEY(jobId,sourceId));
      CREATE TABLE IF NOT EXISTS job_items(jobId TEXT NOT NULL REFERENCES jobs(id),sourceId TEXT NOT NULL,serial TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',error TEXT,PRIMARY KEY(jobId,sourceId,serial));
      CREATE INDEX IF NOT EXISTS pending_items ON job_items(jobId,sourceId,state,serial);
    `);
    try {
      this.transaction(() => {
        const version = Number(
          this.db
            .prepare("SELECT MAX(version) AS version FROM pki_schema")
            .get()!.version ?? 1,
        );
        if (version > 3) throw new Error("Unsupported PKI database schema");
        if (version < 3) {
          if (
            this.db
              .prepare(
                "SELECT 1 FROM jobs WHERE status IN ('queued','running','pausing') LIMIT 1",
              )
              .get()
          )
            throw new Error(
              "Stop legacy PKI workers and resolve active jobs before schema upgrade",
            );
          if (version < 2)
            this.db
              .exec(`ALTER TABLE jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE jobs ADD COLUMN concurrency INTEGER;
          ALTER TABLE jobs ADD COLUMN requestsPerSecond INTEGER;
          ALTER TABLE job_sources ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
          ALTER TABLE job_sources ADD COLUMN startedAt TEXT;
          ALTER TABLE job_sources ADD COLUMN finishedAt TEXT;
          ALTER TABLE job_sources ADD COLUMN revocationMode TEXT NOT NULL DEFAULT 'unknown';
          ALTER TABLE job_sources ADD COLUMN revocationError TEXT;
          ALTER TABLE job_sources ADD COLUMN errorCategory TEXT;
          UPDATE job_sources SET status='legacy_unknown';
          ALTER TABLE job_items ADD COLUMN errorCategory TEXT;
          CREATE INDEX job_errors ON job_items(jobId,sourceId,serial) WHERE error IS NOT NULL;
          DELETE FROM pki_schema; INSERT INTO pki_schema VALUES(2);`);
          this.db.exec(`CREATE TABLE certificate_conflicts (
          sourceId TEXT NOT NULL REFERENCES sources(id), serial TEXT NOT NULL,
          expectedFingerprint TEXT NOT NULL REFERENCES blobs(fingerprint),
          observedFingerprint TEXT NOT NULL REFERENCES blobs(fingerprint),
          firstSeen TEXT NOT NULL,lastSeen TEXT NOT NULL,observations INTEGER NOT NULL DEFAULT 1,lastJobId TEXT,
          PRIMARY KEY(sourceId,serial,expectedFingerprint,observedFingerprint));
          DELETE FROM pki_schema; INSERT INTO pki_schema VALUES(3);`);
        }
      });
    } catch (e) {
      this.db.close();
      throw e;
    }
  }
  close() {
    this.db.close();
  }
  transaction(fn: () => void) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.workerAttempt) this.assertWorker();
      fn();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  assertWorker() {
    if (!this.workerAttempt) return;
    const { id, attempt } = this.workerAttempt;
    const row = this.db
      .prepare(
        "SELECT 1 FROM jobs WHERE id=? AND attempt=? AND status='running'",
      )
      .get(id, attempt);
    if (!row) throw new WorkerStopped("Worker no longer owns a running job");
  }
  dispatch(id: string, concurrency = 4, requestsPerSecond = 20): number {
    const row = this.db
      .prepare(
        "UPDATE jobs SET attempt=attempt+1,concurrency=?,requestsPerSecond=?,updatedAt=? WHERE id=? AND status='queued' RETURNING attempt",
      )
      .get(concurrency, requestsPerSecond, new Date().toISOString(), id);
    if (!row) throw new PkiError(409, "Job is no longer queued");
    return Number(row.attempt);
  }
  claim(id: string, attempt: number): boolean {
    const row = this.db
      .prepare(
        "UPDATE jobs SET status='running',updatedAt=? WHERE id=? AND attempt=? AND status='queued' RETURNING id",
      )
      .get(new Date().toISOString(), id, attempt);
    if (row) this.workerAttempt = { id, attempt };
    return !!row;
  }
  heartbeat(id: string, attempt: number) {
    return this.db
      .prepare(
        "UPDATE jobs SET updatedAt=? WHERE id=? AND attempt=? AND status IN ('running','pausing')",
      )
      .run(new Date().toISOString(), id, attempt).changes;
  }
  finish(
    id: string,
    attempt: number,
    status: string,
    error: string | null = null,
  ) {
    this.db
      .prepare(
        "UPDATE jobs SET status=CASE WHEN status='pausing' THEN 'paused' ELSE ? END,error=?,updatedAt=? WHERE id=? AND attempt=? AND status IN ('queued','running','pausing')",
      )
      .run(status, error, new Date().toISOString(), id, attempt);
  }
  pause(id: string) {
    const changed = this.db
      .prepare(
        "UPDATE jobs SET status=CASE WHEN status='queued' THEN 'paused' ELSE 'pausing' END,updatedAt=? WHERE id=? AND status IN ('queued','running')",
      )
      .run(new Date().toISOString(), id).changes;
    if (!changed) throw new PkiError(409, "Job is not active");
  }
  resume(id: string) {
    try {
      this.transaction(() => {
        const changed = this.db
          .prepare(
            "UPDATE jobs SET status='queued',attempt=attempt+1,error=NULL,updatedAt=? WHERE id=? AND status IN ('paused','partial','interrupted')",
          )
          .run(new Date().toISOString(), id).changes;
        if (!changed) throw new PkiError(409, "Job cannot be resumed");
        this.db
          .prepare(
            "UPDATE job_items SET state='pending',error=NULL,errorCategory=NULL WHERE jobId=? AND state='failed'",
          )
          .run(id);
      });
    } catch (e) {
      if (e instanceof PkiError) throw e;
      throw new PkiError(409, "Another collection is active");
    }
  }
  jobDetails(
    id: string,
    authorizedIds: string[],
    errorLimit = 20,
  ): PkiJobDetails | null {
    const job = this.job(id);
    if (!job || !job.sources.every((source) => authorizedIds.includes(source)))
      return null;
    const sources = this.db
      .prepare(
        `SELECT js.sourceId,s.path,s.namespace,js.listed,js.status,js.startedAt,js.finishedAt,js.revocationMode,js.revocationError,js.error,js.errorCategory,
      COUNT(i.serial) AS total,COALESCE(SUM(i.state='done'),0) AS completed,COALESCE(SUM(i.state='failed'),0) AS failed,COALESCE(SUM(i.state='pending'),0) AS pending
      FROM job_sources js JOIN sources s ON s.id=js.sourceId LEFT JOIN job_items i ON i.jobId=js.jobId AND i.sourceId=js.sourceId
      WHERE js.jobId=? GROUP BY js.sourceId ORDER BY s.path`,
      )
      .all(id) as unknown as PkiJobSource[];
    const errors = this.db
      .prepare(
        "SELECT sourceId,serial,errorCategory,error FROM job_items WHERE jobId=? AND error IS NOT NULL ORDER BY sourceId,serial LIMIT ?",
      )
      .all(id, errorLimit + 1) as unknown as PkiJobDetails["errors"];
    return {
      job,
      sources: sources.map((source) => ({
        ...source,
        status:
          source.status === "running" && job.status !== "running"
            ? job.status
            : source.status,
      })),
      errors: errors.slice(0, errorLimit),
      errorsTruncated: errors.length > errorLimit,
    };
  }
  source(source: PkiSource) {
    this.db
      .prepare(
        `INSERT INTO sources(id,cluster,namespace,accessor,path,description) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,description=excluded.description`,
      )
      .run(
        source.id,
        source.cluster,
        source.namespace,
        source.accessor,
        source.path,
        source.description,
      );
  }
  sources(ids: string[]): PkiSource[] {
    if (!ids.length) return [];
    return this.db
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM certificates c WHERE c.sourceId=s.id) AS certificateCount FROM sources s WHERE s.id IN (${ids.map(() => "?")}) ORDER BY s.path`,
      )
      .all(...ids) as unknown as PkiSource[];
  }
  save(
    sourceId: string,
    pem: string,
    revoked: Revocation,
    expectedSerial?: string,
    afterSave?: () => void,
  ) {
    const c = parseCertificate(pem),
      now = new Date().toISOString();
    if (expectedSerial !== undefined && c.serial !== expectedSerial)
      throw new Error("Returned certificate serial mismatch");
    let conflict: CertificateConflict | undefined;
    this.transaction(() => {
      this.db
        .prepare("INSERT OR IGNORE INTO blobs VALUES(?,?)")
        .run(c.fingerprint, c.der);
      const existing = this.db
        .prepare(
          "SELECT fingerprint FROM certificates WHERE sourceId=? AND serial=?",
        )
        .get(sourceId, c.serial);
      if (existing && existing.fingerprint !== c.fingerprint) {
        conflict = new CertificateConflict(
          String(existing.fingerprint),
          c.fingerprint,
        );
        this.db
          .prepare(
            `INSERT INTO certificate_conflicts(sourceId,serial,expectedFingerprint,observedFingerprint,firstSeen,lastSeen,lastJobId) VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(sourceId,serial,expectedFingerprint,observedFingerprint) DO UPDATE SET lastSeen=excluded.lastSeen,observations=observations+1,lastJobId=excluded.lastJobId`,
          )
          .run(
            sourceId,
            c.serial,
            existing.fingerprint,
            c.fingerprint,
            now,
            now,
            this.workerAttempt?.id ?? null,
          );
        return;
      }

      // Confirmed revocation is permanent for this source/serial/fingerprint.
      // Keep its evidence timestamp when a later observation cannot confirm it.
      this.db
        .prepare(
          `INSERT INTO certificates(sourceId,serial,fingerprint,cn,subject,issuer,notBefore,notAfter,algorithm,keySize,curve,type,revoked,revocationObservedAt,firstSeen,lastSeen,eku) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(sourceId,serial) DO UPDATE SET fingerprint=excluded.fingerprint,cn=excluded.cn,subject=excluded.subject,issuer=excluded.issuer,notBefore=excluded.notBefore,notAfter=excluded.notAfter,algorithm=excluded.algorithm,keySize=excluded.keySize,curve=excluded.curve,type=excluded.type,revoked=CASE WHEN certificates.revoked='revoked' THEN 'revoked' ELSE excluded.revoked END,revocationObservedAt=CASE WHEN certificates.revoked='revoked' AND excluded.revoked!='revoked' THEN certificates.revocationObservedAt ELSE excluded.revocationObservedAt END,lastSeen=excluded.lastSeen,presence='present',eku=excluded.eku`,
        )
        .run(
          sourceId,
          c.serial,
          c.fingerprint,
          c.cn,
          c.subject,
          c.issuer,
          c.notBefore,
          c.notAfter,
          c.algorithm,
          c.keySize,
          c.curve,
          c.type,
          revoked,
          revoked === "unknown" ? null : now,
          now,
          now,
          JSON.stringify(c.eku),
        );
      const id = this.db
        .prepare("SELECT id FROM certificates WHERE sourceId=? AND serial=?")
        .get(sourceId, c.serial)!.id;
      this.db.prepare("DELETE FROM sans WHERE certificateId=?").run(id);
      for (const san of c.sans)
        this.db
          .prepare("INSERT OR IGNORE INTO sans VALUES(?,?,?)")
          .run(id, san.type, san.value);
      afterSave?.();
    });
    if (conflict) throw conflict;
    return c;
  }
  conflicts(sourceId: string, serial: string, limit = 20) {
    const rows = this.db
      .prepare(
        "SELECT expectedFingerprint,observedFingerprint,firstSeen,lastSeen,observations,lastJobId FROM certificate_conflicts WHERE sourceId=? AND serial=? ORDER BY lastSeen DESC,observedFingerprint LIMIT ?",
      )
      .all(sourceId, serial, limit + 1);
    return {
      observations: rows.slice(0, limit),
      truncated: rows.length > limit,
    };
  }
  decorate(row: any): CertificateRecord {
    return {
      ...row,
      eku: JSON.parse(row.eku),
      role: null,
      sans: this.db
        .prepare("SELECT type,value FROM sans WHERE certificateId=?")
        .all(row.id),
    };
  }
  certificate(id: number, ids: string[]) {
    const row = this.db
      .prepare(
        "SELECT c.*,s.path AS sourcePath FROM certificates c JOIN sources s ON s.id=c.sourceId WHERE c.id=?",
      )
      .get(id);
    return row && ids.includes(String(row.sourceId))
      ? this.decorate(row)
      : null;
  }
  pem(fingerprint: string) {
    const row = this.db
      .prepare("SELECT der FROM blobs WHERE fingerprint=?")
      .get(fingerprint);
    if (!row) return null;
    const base64 = Buffer.from(row.der as Uint8Array).toString("base64");
    return (
      "-----BEGIN CERTIFICATE-----\n" +
      base64.match(/.{1,64}/g)!.join("\n") +
      "\n-----END CERTIFICATE-----\n"
    );
  }
  query(query: PkiQuery, count = true, now = Date.now()) {
    const base = whereQuery(query, now);
    let sql = base.sql;
    const params = [...base.params],
      key = queryKey(query);
    // Match VCV's whole-day thresholds; aggregate before cursor pagination.
    const day = 86400000;
    const aggregate = count ? this.db.prepare(`
      SELECT COUNT(*) AS total,
        COALESCE(SUM(c.revoked='revoked'),0) AS revoked,
        COALESCE(SUM(c.revoked='unknown'),0) AS revocationUnknown,
        COALESCE(SUM(c.revoked!='revoked' AND c.notAfter < ?),0) AS expired,
        COALESCE(SUM(c.revoked!='revoked' AND c.notAfter >= ? AND c.notAfter < ?),0) AS critical,
        COALESCE(SUM(c.revoked!='revoked' AND c.notAfter >= ? AND c.notAfter < ?),0) AS warning,
        COALESCE(SUM(c.revoked!='revoked' AND c.notAfter >= ?),0) AS valid,
        COALESCE(SUM(c.revoked!='revoked' AND c.notAfter >= ? AND c.notAfter < ?),0) AS near,
        COALESCE(SUM(c.revoked!='revoked' AND c.notAfter >= ?),0) AS later
      FROM certificates c WHERE ${base.sql}
    `).get(now, now, now + 8*day, now + 8*day, now + 31*day,
      now + 31*day, now + 31*day, now + 91*day, now + 91*day, ...base.params) : undefined;
    const total = Number(aggregate?.total ?? 0);
    const summary = aggregate ? Object.fromEntries(
      Object.entries(aggregate).filter(([key]) => key !== "total").map(([key, value]) => [key, Number(value)])
    ) as unknown as PkiSummary : undefined;
    if (query.cursor) {
      try {
        const cursor = JSON.parse(
          Buffer.from(query.cursor, "base64url").toString(),
        );
        if (
          cursor.key !== key ||
          !Number.isSafeInteger(cursor.id) ||
          !["string", "number"].includes(typeof cursor.value)
        )
          throw new Error();
        const cmp = query.direction === "desc" ? "<" : ">";
        sql += ` AND (${query.sort === "sourcePath" ? "s.path" : "c." + query.sort} ${cmp} ? OR (${query.sort === "sourcePath" ? "s.path" : "c." + query.sort}=? AND c.id ${cmp} ?))`;
        params.push(cursor.value, cursor.value, cursor.id);
      } catch {
        throw new PkiError(400, "Cursor does not match the query");
      }
    }
    const rows = this.db
      .prepare(
        `SELECT c.*,s.path AS sourcePath FROM certificates c JOIN sources s ON s.id=c.sourceId WHERE ${sql} ORDER BY ${query.sort === "sourcePath" ? "s.path" : "c." + query.sort} ${query.direction},c.id ${query.direction} LIMIT ? OFFSET ?`,
      )
      .all(...params, query.limit + 1, query.offset ?? 0);
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      certificates: page.map((r) => this.decorate(r)),
      total,
      summary,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ key, id: last.id, value: last[query.sort] }),
            ).toString("base64url")
          : null,
    };
  }
  recover() {
    this.db
      .prepare(
        "UPDATE jobs SET attempt=attempt+1,status='interrupted',error='Worker heartbeat expired; resume with a valid Vault session' WHERE status IN ('queued','running','pausing') AND updatedAt<?",
      )
      .run(new Date(Date.now() - 120000).toISOString());
  }
  createJob(sources: string[]) {
    this.recover();
    const id = randomUUID(),
      now = new Date().toISOString();
    try {
      this.transaction(() => {
        this.db
          .prepare(
            "INSERT INTO jobs(id,sources,status,createdAt,updatedAt) VALUES(?,?,?,?,?)",
          )
          .run(id, JSON.stringify(sources), "queued", now, now);
        for (const s of sources)
          this.db
            .prepare("INSERT INTO job_sources(jobId,sourceId) VALUES(?,?)")
            .run(id, s);
      });
    } catch {
      throw new PkiError(409, "Another collection is active");
    }
    return id;
  }
  job(id: string): PkiJob | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
    if (!row) return null;
    const counts = this.db
      .prepare(
        "SELECT COUNT(*) AS total,SUM(state='done') AS completed,SUM(state='failed') AS failed FROM job_items WHERE jobId=?",
      )
      .get(id)!;
    return {
      ...row,
      sources: JSON.parse(String(row.sources)),
      total: Number(counts.total),
      completed: Number(counts.completed ?? 0),
      failed: Number(counts.failed ?? 0),
    } as unknown as PkiJob;
  }
  jobs(ids: string[]): PkiJob[] {
    if (!ids.length) return [];
    return this.db
      .prepare("SELECT id FROM jobs ORDER BY createdAt DESC LIMIT 100")
      .all()
      .map((r) => this.job(String(r.id))!)
      .filter((j) => j.sources.every((s) => ids.includes(s)));
  }
  state(id: string, status: string, error: string | null = null) {
    this.db
      .prepare("UPDATE jobs SET status=?,error=?,updatedAt=? WHERE id=?")
      .run(status, error, new Date().toISOString(), id);
  }
  enqueue(
    job: string,
    source: string,
    serials: string[],
    revoked: string[] | null,
  ) {
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO job_items(jobId,sourceId,serial) VALUES(?,?,?)",
    );
    for (let offset = 0; offset < serials.length; offset += 1000)
      this.transaction(() => {
        for (const serial of serials.slice(offset, offset + 1000))
          stmt.run(job, source, serial);
      });
    this.transaction(() =>
      this.db
        .prepare(
          "UPDATE job_sources SET listed=1,revoked=?,error=NULL WHERE jobId=? AND sourceId=?",
        )
        .run(revoked ? JSON.stringify(revoked) : null, job, source),
    );
  }
}
