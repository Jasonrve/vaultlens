import { canonicalCheckId } from '../../shared/auditCheckIds.js';
import { withoutPolicySource } from './sourceRedaction.js';
import { DEFAULT_SETTINGS, catalog, normalizeConfigIds } from './catalog.js';
import type {
  RuleSettings,
  RunConfiguration,
} from '../../shared/auditRules.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type {
  AuditException,
  AuditRun,
  AuditSnapshot,
  AuditFinding,
  AuditDetail,
  SavedAuditSnapshot,
} from '../../shared/securityAudit.js';
export class AuditStore {
  private db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS audit_runs (id TEXT PRIMARY KEY, target TEXT NOT NULL, startedAt TEXT NOT NULL, finishedAt TEXT,
      status TEXT NOT NULL, resourceCount INTEGER NOT NULL DEFAULT 0, issueCount INTEGER NOT NULL DEFAULT 0,
      findingCount INTEGER NOT NULL DEFAULT 0, snapshot TEXT, findings TEXT NOT NULL DEFAULT '[]');
      CREATE UNIQUE INDEX IF NOT EXISTS audit_single_running ON audit_runs(status) WHERE status='running';`);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS audit_settings (revision INTEGER PRIMARY KEY, configYaml TEXT NOT NULL, customRulesYaml TEXT NOT NULL)',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS audit_object_exceptions (target TEXT NOT NULL, id TEXT NOT NULL, scope TEXT NOT NULL, entry TEXT NOT NULL, PRIMARY KEY(target,id), UNIQUE(target,scope))',
    );
    const columns = this.db.prepare('PRAGMA table_info(audit_runs)').all();
    if (!columns.some((c) => c.name === 'configuration'))
      this.db.exec('ALTER TABLE audit_runs ADD COLUMN configuration TEXT');
    if (!columns.some((c) => c.name === 'failureReason'))
      this.db.exec('ALTER TABLE audit_runs ADD COLUMN failureReason TEXT');
    if (!columns.some((c) => c.name === 'progress'))
      this.db.exec('ALTER TABLE audit_runs ADD COLUMN progress TEXT');
    if (!columns.some((c) => c.name === 'snapshotId'))
      this.db.exec('ALTER TABLE audit_runs ADD COLUMN snapshotId TEXT');
    if (!columns.some((c) => c.name === 'operation'))
      this.db.exec(
        "ALTER TABLE audit_runs ADD COLUMN operation TEXT NOT NULL DEFAULT 'analyze'",
      );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_snapshots (
        id TEXT PRIMARY KEY, target TEXT NOT NULL, createdAt TEXT NOT NULL,
        sourceJobId TEXT, parentId TEXT, origin TEXT NOT NULL,
        resourceCount INTEGER NOT NULL, issueCount INTEGER NOT NULL,
        retainedCount INTEGER NOT NULL, changes TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS audit_snapshot_target ON audit_snapshots(target,createdAt);
      CREATE TABLE IF NOT EXISTS audit_inventory (target TEXT PRIMARY KEY, snapshotId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_retention (target TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS audit_migrations (name TEXT PRIMARY KEY);
    `);
    this.migrateSnapshots();
  }
  private migrateSnapshots() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (
        !this.db
          .prepare(
            "SELECT name FROM audit_migrations WHERE name='snapshots-v1'",
          )
          .get()
      ) {
        const rows = this.db
          .prepare(
            "SELECT id,target,snapshot FROM audit_runs WHERE status IN ('collected','completed','partial') AND snapshot IS NOT NULL ORDER BY startedAt,id",
          )
          .all();
        for (const row of rows) {
          const snapshot = JSON.parse(String(row.snapshot)) as AuditSnapshot;
          if (!snapshot.finishedAt) continue;
          // Reanalysis of an older snapshot must not move the current inventory backwards.
          const native =
            !!snapshot.collection &&
            (!snapshot.sourceRunId || !!snapshot.refresh);
          const id = this.insertSnapshot(
            String(row.id),
            snapshot,
            native,
            null,
          );
          this.db
            .prepare(
              'UPDATE audit_runs SET snapshotId=?,operation=? WHERE id=?',
            )
            .run(
              id,
              snapshot.importedFrom ? 'import' : native ? 'collect' : 'analyze',
              row.id,
            );
        }
        this.db
          .prepare("INSERT INTO audit_migrations VALUES ('snapshots-v1')")
          .run();
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private insertSnapshot(
    jobId: string,
    snapshot: AuditSnapshot,
    publish: boolean,
    parentId: string | null,
  ): string {
    const id = randomUUID();
    const saved = structuredClone(
      snapshot.collection?.requestPolicy.redactPolicySource
        ? withoutPolicySource(snapshot)
        : snapshot,
    );
    delete saved.controls;
    delete saved.identity;
    saved.analysisPerformed = false;
    const parent = parentId
      ? this.savedSnapshot(parentId, snapshot.target)?.snapshot
      : undefined;
    const key = (r: AuditSnapshot['resources'][number]) =>
      JSON.stringify([r.namespace ?? '', r.kind, r.path]);
    const previous = new Map(parent?.resources.map((r) => [key(r), r]) ?? []);
    const changes = { added: 0, changed: 0, unchanged: 0, absent: 0 };
    for (const resource of saved.resources) {
      const old = previous.get(key(resource));
      if (!old) changes.added++;
      else if (isDeepStrictEqual(old.data, resource.data)) changes.unchanged++;
      else changes.changed++;
      previous.delete(key(resource));
    }
    changes.absent = previous.size;
    this.db
      .prepare('INSERT INTO audit_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        saved.target,
        new Date().toISOString(),
        jobId,
        parentId,
        saved.importedFrom ? 'import' : 'collection',
        saved.resources.length,
        saved.issues.length,
        saved.resources.filter((r) => r.retainedFromSnapshotAt).length,
        JSON.stringify(changes),
        JSON.stringify(saved),
      );
    if (publish)
      this.db
        .prepare(
          'INSERT INTO audit_inventory VALUES (?,?) ON CONFLICT(target) DO UPDATE SET snapshotId=excluded.snapshotId',
        )
        .run(saved.target, id);
    return id;
  }
  saveSnapshot(
    jobId: string,
    snapshot: AuditSnapshot,
    publish: boolean,
    parentId: string | null = null,
  ): string {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const job = this.db
        .prepare(
          "SELECT id FROM audit_runs WHERE id=? AND target=? AND status='running'",
        )
        .get(jobId, snapshot.target);
      if (!job || !snapshot.finishedAt)
        throw new Error('Finished collection and active job required');
      if (
        publish &&
        (this.currentSnapshot(snapshot.target)?.id ?? null) !== parentId
      )
        throw new Error(
          'Inventory changed during collection; retry the update',
        );
      const id = this.insertSnapshot(jobId, snapshot, publish, parentId);
      this.linkSnapshot(jobId, id);
      this.db.exec('COMMIT');
      return id;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  linkSnapshot(jobId: string, snapshotId: string) {
    this.db
      .prepare(
        "UPDATE audit_runs SET snapshotId=? WHERE id=? AND status='running'",
      )
      .run(snapshotId, jobId);
  }
  snapshots(target: string): SavedAuditSnapshot[] {
    return this.db
      .prepare(
        'SELECT id,target,createdAt,sourceJobId,parentId,origin,resourceCount,issueCount,retainedCount,changes FROM audit_snapshots WHERE target=? ORDER BY rowid DESC LIMIT 100',
      )
      .all(target)
      .map((row) => ({
        ...row,
        changes: JSON.parse(String(row.changes)),
      })) as unknown as SavedAuditSnapshot[];
  }
  savedSnapshot(
    id: string,
    target: string,
  ): { info: SavedAuditSnapshot; snapshot: AuditSnapshot } | null {
    const row = this.db
      .prepare('SELECT * FROM audit_snapshots WHERE id=? AND target=?')
      .get(id, target);
    if (!row) return null;
    const { payload, ...info } = row;
    return {
      info: {
        ...info,
        changes: JSON.parse(String(row.changes)),
      } as unknown as SavedAuditSnapshot,
      snapshot: JSON.parse(String(payload)),
    };
  }
  currentSnapshot(target: string): SavedAuditSnapshot | null {
    const row = this.db
      .prepare('SELECT snapshotId FROM audit_inventory WHERE target=?')
      .get(target);
    return row
      ? (this.savedSnapshot(String(row.snapshotId), target)?.info ?? null)
      : null;
  }
  exceptions(target: string): AuditException[] {
    const presets: AuditException[] = [
      {
        id: 'preset-default-policy',
        name: 'Default policy',
        object_type: 'policy',
        object_path: 'sys/policies/acl/default',
        reason: 'Built-in policy exception; review before enabling.',
      },
      {
        id: 'preset-root-policy',
        name: 'Root policy',
        object_type: 'policy',
        object_path: 'sys/policies/acl/root',
        reason: 'Root policy object only. Root assignments remain in scope.',
      },
      {
        id: 'preset-bootstrap-token',
        name: 'Bootstrap root token',
        object_type: 'token',
        object_path: 'Not configured',
        reason:
          'Individual token collection is not supported; this preset remains disabled.',
      },
    ].map(
      (value) =>
        ({
          ...value,
          enabled: false,
          builtin: true,
          rule_id: '*',
          namespace: '',
          match: 'exact',
          owner: 'Vault administrators',
          expires: 'never',
        }) as AuditException,
    );
    for (const entry of presets) {
      const scope = JSON.stringify([
        entry.rule_id,
        entry.namespace,
        entry.object_path,
        null,
      ]);
      this.db
        .prepare(
          'INSERT OR IGNORE INTO audit_object_exceptions(target,id,scope,entry) VALUES(?,?,?,?)',
        )
        .run(target, entry.id, scope, JSON.stringify(entry));
    }
    return this.db
      .prepare(
        'SELECT entry FROM audit_object_exceptions WHERE target=? ORDER BY id',
      )
      .all(target)
      .map((row) => { const entry = JSON.parse(String(row.entry)); return { ...entry, rule_id: canonicalCheckId(entry.rule_id) }; });
  }
  addException(target: string, entry: AuditException): void {
    entry = { ...entry, rule_id: canonicalCheckId(entry.rule_id) };
    const scope = JSON.stringify([
      entry.rule_id,
      entry.namespace,
      entry.object_path,
      entry.policy_path ?? null,
    ]);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.exceptions(target).some(existing => existing.rule_id === entry.rule_id && existing.namespace === entry.namespace && existing.object_path === entry.object_path && (existing.policy_path ?? null) === (entry.policy_path ?? null)))
        throw new Error('An exception already exists for this check and object');
      if (this.exceptions(target).length >= 1000)
        throw new Error('At most 1000 object exceptions are supported');
      if (
        this.db
          .prepare(
            'SELECT id FROM audit_object_exceptions WHERE target=? AND scope=?',
          )
          .get(target, scope)
      )
        throw new Error(
          'An exception already exists for this check and object',
        );
      this.db
        .prepare(
          'INSERT INTO audit_object_exceptions(target,id,scope,entry) VALUES(?,?,?,?)',
        )
        .run(target, entry.id, scope, JSON.stringify(entry));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  updateException(target: string, entry: AuditException): boolean {
    entry = { ...entry, rule_id: canonicalCheckId(entry.rule_id) };
    const scope = JSON.stringify([
      entry.rule_id,
      entry.namespace,
      entry.object_path,
      entry.policy_path ?? null,
    ]);
    return (
      this.db
        .prepare(
          'UPDATE audit_object_exceptions SET scope=?,entry=? WHERE target=? AND id=?',
        )
        .run(scope, JSON.stringify(entry), target, entry.id).changes > 0
    );
  }
  removeException(target: string, id: string): boolean {
    return (
      this.db
        .prepare('DELETE FROM audit_object_exceptions WHERE target=? AND id=?')
        .run(target, id).changes > 0
    );
  }
  settings(): RuleSettings {
    const row = this.db
      .prepare(
        'SELECT revision,configYaml,customRulesYaml FROM audit_settings ORDER BY revision DESC LIMIT 1',
      )
      .get() as unknown as RuleSettings | undefined;
    return row ? { ...row, configYaml: normalizeConfigIds(row.configYaml) } : { ...DEFAULT_SETTINGS };
  }
  saveSettings(next: RuleSettings): RuleSettings {
    next = { ...next, configYaml: normalizeConfigIds(next.configYaml) };
    catalog(next);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.settings().revision !== next.revision)
        throw new Error('Settings changed; reload before saving');
      const saved = { ...next, revision: next.revision + 1 };
      this.db
        .prepare(
          'INSERT INTO audit_settings(revision,configYaml,customRulesYaml) VALUES (?,?,?)',
        )
        .run(saved.revision, saved.configYaml, saved.customRulesYaml);
      this.db.exec('COMMIT');
      return saved;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  list(target: string): AuditRun[] {
    return this.db
      .prepare(
        'SELECT id,target,startedAt,finishedAt,status,resourceCount,issueCount,findingCount,failureReason,snapshotId,operation FROM audit_runs WHERE target=? ORDER BY startedAt DESC LIMIT 100',
      )
      .all(target) as unknown as AuditRun[];
  }
  retention(target: string) {
    const row = this.db
      .prepare('SELECT enabled FROM audit_retention WHERE target=?')
      .get(target);
    return { enabled: row?.enabled === 1, maxRuns: 100 };
  }
  setRetention(target: string, enabled: boolean) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          'INSERT INTO audit_retention(target,enabled) VALUES (?,?) ON CONFLICT(target) DO UPDATE SET enabled=excluded.enabled',
        )
        .run(target, enabled ? 1 : 0);
      const deleted = this.cleanupRuns(target);
      this.db.exec('COMMIT');
      return { ...this.retention(target), deleted };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private cleanupRuns(target: string): number {
    if (!this.retention(target).enabled) return 0;
    return Number(
      this.db
        .prepare(
          `DELETE FROM audit_runs WHERE target=? AND id IN (
      SELECT id FROM audit_runs WHERE target=? AND status!='running'
      ORDER BY COALESCE(finishedAt,startedAt) DESC, startedAt DESC, rowid DESC LIMIT -1 OFFSET 100
    )`,
        )
        .run(target, target).changes,
    );
  }
  private cleanupForRun(id: string) {
    const row = this.db
      .prepare('SELECT target FROM audit_runs WHERE id=?')
      .get(id);
    if (row) this.cleanupRuns(String(row.target));
  }
  deleteRuns(target: string, ids: string[]): number {
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length)
      throw new Error('Select between 1 and 100 distinct runs');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (
        this.db
          .prepare(
            "SELECT id FROM audit_runs WHERE target=? AND status='running'",
          )
          .get(target)
      )
        throw new Error(
          'Wait for the active audit to finish before deleting runs',
        );
      const lookup = this.db.prepare(
        'SELECT id FROM audit_runs WHERE target=? AND id=?',
      );
      for (const id of ids)
        if (!lookup.get(target, id))
          throw new Error(
            'A selected run is unavailable. Refresh the list and try again',
          );
      const remove = this.db.prepare(
        'DELETE FROM audit_runs WHERE target=? AND id=?',
      );
      for (const id of ids) remove.run(target, id);
      this.db.exec('COMMIT');
      return ids.length;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  get(id: string, target: string): AuditDetail | null {
    const row = this.db
      .prepare('SELECT * FROM audit_runs WHERE id=? AND target=?')
      .get(id, target) as unknown as
      | (Omit<AuditRun, 'progress'> & {
          progress: string | null;
          snapshot: string | null;
          findings: string;
          configuration: string | null;
        })
      | undefined;
    if (!row) return null;
    const { snapshot, findings, configuration, progress, ...run } = row;
    return {
      run: { ...run, progress: progress ? JSON.parse(progress) : null },
      snapshot: snapshot ? JSON.parse(snapshot) : null,
      findings: JSON.parse(findings),
      configuration: configuration ? JSON.parse(configuration) : null,
    };
  }
  create(
    target: string,
    operation: 'collect' | 'analyze' | 'import' = 'analyze',
  ): string {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO audit_runs(id,target,startedAt,status,operation) VALUES (?,?,?,'running',?)",
      )
      .run(id, target, new Date().toISOString(), operation);
    return id;
  }
  finish(
    id: string,
    snapshot: AuditSnapshot,
    findings: AuditFinding[],
    configuration?: RunConfiguration,
  ) {
    this.db
      .prepare(
        "UPDATE audit_runs SET status=?,finishedAt=?,resourceCount=?,issueCount=?,findingCount=?,snapshot=?,findings=?,configuration=? WHERE id=? AND status='running'",
      )
      .run(
        snapshot.analysisPerformed === false
          ? 'collected'
          : snapshot.issues.length || configuration?.issues.length
            ? 'partial'
            : 'completed',
        new Date().toISOString(),
        snapshot.resources.length,
        snapshot.issues.length + (configuration?.issues.length ?? 0),
        findings.length,
        JSON.stringify(
          snapshot.collection?.requestPolicy.redactPolicySource
            ? withoutPolicySource(snapshot)
            : snapshot,
        ),
        JSON.stringify(findings),
        configuration ? JSON.stringify(configuration) : null,
        id,
      );
    this.cleanupForRun(id);
  }
  saveCheckpoint(id: string, snapshot: AuditSnapshot) {
    const saved = snapshot.collection?.requestPolicy.redactPolicySource
      ? withoutPolicySource(snapshot)
      : snapshot;
    this.db
      .prepare(
        "UPDATE audit_runs SET snapshot=?,resourceCount=? WHERE id=? AND status='running'",
      )
      .run(
        JSON.stringify({
          ...saved,
          analysisPerformed: false,
          finishedAt: '',
          policiesComplete: false,
        }),
        snapshot.resources.length,
        id,
      );
  }
  updateProgress(
    id: string,
    progress: import('../../shared/securityAudit.js').AuditProgress,
  ) {
    this.db
      .prepare(
        "UPDATE audit_runs SET progress=?,resourceCount=? WHERE id=? AND status='running'",
      )
      .run(JSON.stringify(progress), progress.resources, id);
  }
  fail(id: string, reason = 'The background audit stopped before completion.') {
    this.db
      .prepare(
        "UPDATE audit_runs SET status='failed',finishedAt=?,failureReason=? WHERE id=? AND status='running'",
      )
      .run(new Date().toISOString(), reason, id);
    this.cleanupForRun(id);
  }
  recover() {
    this.db
      .prepare(
        "UPDATE audit_runs SET status='interrupted',finishedAt=? WHERE status='running'",
      )
      .run(new Date().toISOString());
    for (const row of this.db
      .prepare('SELECT target FROM audit_retention WHERE enabled=1')
      .all())
      this.cleanupRuns(String(row.target));
  }
  close() {
    this.db.close();
  }
}
