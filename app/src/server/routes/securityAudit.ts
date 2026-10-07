import { randomUUID } from 'node:crypto';
import { findingControls } from '../security-audit/findingControls.js';
import { reportArchive } from '../security-audit/reportArchive.js';
import { COLLECTION_SOURCES } from '../security-audit/collectionStages.js';
import { prepareResume } from '../security-audit/resume.js';
import { snapshotNamespaces } from '../security-audit/namespaces.js';
import {
  parseBaseline,
  applyBaseline,
  createBaseline,
} from '../security-audit/baseline.js';
import { parseExceptions } from '../security-audit/exceptions.js';
import { settingsFingerprint } from '../security-audit/catalog.js';
import { ENGINE_VERSION } from '../security-audit/engine.js';
import { parseCollectionOptions } from '../security-audit/requestPolicy.js';
import {
  exportAudit,
  EXPORT_FORMATS,
  type ExportFormat,
} from '../security-audit/exporter.js';
import { compareRuns } from '../security-audit/diff.js';
import { Router, raw } from 'express';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { config } from '../config/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import type { AuthenticatedRequest } from '../types/index.js';
import { AuditStore } from '../security-audit/store.js';
import { catalog, SUPPORTED_DETECTORS } from '../security-audit/catalog.js';
const router = Router();
const dbPath = path.resolve(
  process.env['VAULTLENS_AUDIT_DB'] || 'data/security-audit.sqlite',
);
let store: AuditStore | undefined;
let active: Worker | undefined;
function workerEntry() {
  return import.meta.url.endsWith('.ts')
    ? new URL(
        'data:text/javascript,' +
          encodeURIComponent(
            `import {tsImport} from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))}; await tsImport(${JSON.stringify(new URL('../security-audit/worker.ts', import.meta.url).href)}, ${JSON.stringify(import.meta.url)});`,
          ),
      )
    : new URL('../security-audit/worker.js', import.meta.url);
}
function storage() {
  if (!store) {
    store = new AuditStore(dbPath);
    store.recover();
  }
  return store;
}
router.use(authMiddleware, requireAdmin);
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
router.get('/retention', (_req, res) =>
  res.json(storage().retention(config.vaultAddr)),
);
router.put('/retention', (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }
  res.json(storage().setRetention(config.vaultAddr, req.body.enabled));
});
router.get('/inventory', (_req, res) => {
  const db = storage();
  const current = db.currentSnapshot(config.vaultAddr);
  res.json({
    target: config.vaultAddr,
    storagePath: dbPath,
    current,
    snapshot: current
      ? db.savedSnapshot(current.id, config.vaultAddr)?.snapshot
      : null,
    snapshots: db.snapshots(config.vaultAddr),
  });
});
router.get('/snapshots/:id', (req, res) => {
  const saved = storage().savedSnapshot(
    String(req.params.id),
    config.vaultAddr,
  );
  if (!saved) {
    res.status(404).json({ error: 'Snapshot not found' });
    return;
  }
  res.json(saved);
});
router.post(
  '/imports/python',
  raw({ type: 'application/octet-stream', limit: '32mb' }),
  (req, res, next) => {
    if (
      !Buffer.isBuffer(req.body) ||
      req.body.length < 16 ||
      req.body.subarray(0, 16).toString('binary') !== 'SQLite format 3\0'
    ) {
      res.status(400).json({
        error: 'Expected a Python SQLite snapshot as application/octet-stream',
      });
      return;
    }
    const db = storage();
    let directory: string | undefined, id: string | undefined;
    try {
      id = db.create(config.vaultAddr, 'import');
      directory = mkdtempSync(path.join(tmpdir(), 'vaultlens-python-import-'));
      const importPath = path.join(directory, 'snapshot.sqlite');
      writeFileSync(importPath, req.body, { mode: 0o600, flag: 'wx' });
      const worker = new Worker(workerEntry(), {
        workerData: { dbPath, id, target: config.vaultAddr, importPath },
      });
      active = worker;
      const runId = id,
        uploadDirectory = directory;
      worker.once('error', () => db.fail(runId));
      worker.once('exit', () => {
        db.fail(runId);
        rmSync(uploadDirectory, { recursive: true, force: true });
        if (active === worker) active = undefined;
      });
      res.status(202).json({ id });
    } catch (error) {
      if (directory) rmSync(directory, { recursive: true, force: true });
      if (id) {
        db.fail(id);
        next(error);
      } else res.status(409).json({ error: 'An audit is already running' });
    }
  },
);
router.get('/rules', (_req, res) => {
  const settings = storage().settings();
  res.json({
    settings,
    catalog: catalog(settings),
    detectors: SUPPORTED_DETECTORS,
  });
});
router.put('/rules', (req, res) => {
  const { revision, configYaml, customRulesYaml } = req.body ?? {};
  if (
    !Number.isInteger(revision) ||
    revision < 0 ||
    typeof configYaml !== 'string' ||
    typeof customRulesYaml !== 'string'
  ) {
    res
      .status(400)
      .json({ error: 'Expected revision, configYaml and customRulesYaml' });
    return;
  }
  try {
    const settings = storage().saveSettings({
      revision,
      configYaml,
      customRulesYaml,
    });
    res.json({
      settings,
      catalog: catalog(settings),
      detectors: SUPPORTED_DETECTORS,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid configuration';
    res
      .status(message.includes('Settings changed') ? 409 : 400)
      .json({ error: message });
  }
});
router.get('/runs', (_req, res) =>
  res.json({ runs: storage().list(config.vaultAddr) }),
);
router.delete('/runs', (req, res) => {
  const ids = req.body?.ids;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== 'string' || !id || id.length > 128)
  ) {
    res.status(400).json({ error: 'Provide 1 to 100 run IDs' });
    return;
  }
  try {
    res.json({ deleted: storage().deleteRuns(config.vaultAddr, ids) });
  } catch (error) {
    res.status(409).json({
      error: error instanceof Error ? error.message : 'Could not delete runs',
    });
  }
});
router.get('/diff', (req, res) => {
  if (
    typeof req.query['old'] !== 'string' ||
    typeof req.query['new'] !== 'string'
  ) {
    res.status(400).json({ error: 'Expected old and new run IDs' });
    return;
  }
  const old = storage().get(req.query['old'], config.vaultAddr);
  const next = storage().get(req.query['new'], config.vaultAddr);
  if (!old || !next) {
    res.status(404).json({ error: 'Audit run not found' });
    return;
  }
  try {
    res.json(compareRuns(old, next));
  } catch (error) {
    res.status(400).json({
      error:
        error instanceof Error ? error.message : 'Snapshots cannot be compared',
    });
  }
});
router.get('/runs/:id/baseline', (req, res) => {
  const detail = storage().get(String(req.params['id']), config.vaultAddr);
  if (!detail) {
    res.status(404).json({ error: 'Audit run not found' });
    return;
  }
  try {
    res.json(createBaseline(detail));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Baseline unavailable',
    });
  }
});
router.get('/runs/:id/export', (req, res) => {
  const format = req.query['format'] ?? 'json';
  if (
    typeof format !== 'string' ||
    ![...EXPORT_FORMATS, 'zip'].includes(format)
  ) {
    res.status(400).json({ error: 'Unsupported export format' });
    return;
  }
  const redact = req.query['redactPolicySource'] ?? 'false';
  if (redact !== 'true' && redact !== 'false') {
    res.status(400).json({ error: 'redactPolicySource must be true or false' });
    return;
  }
  const detail = storage().get(String(req.params['id']), config.vaultAddr);
  if (!detail) {
    res.status(404).json({ error: 'Audit run not found' });
    return;
  }
  try {
    const body =
      format === 'zip'
        ? reportArchive(detail, redact === 'true')
        : exportAudit(detail, format as ExportFormat, redact === 'true');
    const contentTypes = {
      zip: 'application/zip',
      json: 'application/json',
      jsonl: 'application/x-ndjson',
      yaml: 'application/yaml',
      csv: 'text/csv',
    };
    res.type(contentTypes[format as keyof typeof contentTypes]);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-report.${format}"`,
    );
    res.send(body);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Export failed',
    });
  }
});
router.get('/exceptions', (_req, res) =>
  res.json(storage().exceptions(config.vaultAddr)),
);
router.post('/exceptions', (req, res) => saveObjectException(req, res, false));
router.put('/exceptions/:id', (req, res) =>
  saveObjectException(req, res, true),
);
function saveObjectException(
  req: import('express').Request,
  res: import('express').Response,
  editing: boolean,
) {
  const { runId, findingIndex, owner, reason, expires } = req.body ?? {};
  if (
    typeof owner !== 'string' ||
    typeof reason !== 'string' ||
    owner.length > 200 ||
    reason.length > 2000
  ) {
    res.status(400).json({ error: 'Provide owner, reason and expiry date' });
    return;
  }
  const db = storage();
  const existing = editing
    ? db
        .exceptions(config.vaultAddr)
        .find((entry) => entry.id === req.params.id)
    : undefined;
  if (editing && !existing) {
    res.status(404).json({ error: 'Exception not found' });
    return;
  }
  let scope = {
    rule_id: req.body?.rule_id,
    namespace: req.body?.namespace,
    object_path: req.body?.object_path,
  };
  if (runId !== undefined) {
    if (
      typeof runId !== 'string' ||
      !Number.isSafeInteger(findingIndex) ||
      findingIndex < 0
    ) {
      res.status(400).json({ error: 'Invalid finding reference' });
      return;
    }
    const detail = db.get(runId, config.vaultAddr),
      finding = detail?.findings[findingIndex];
    if (
      !finding ||
      !detail ||
      !['completed', 'partial'].includes(detail.run.status)
    ) {
      res.status(404).json({ error: 'Analyzed finding not found' });
      return;
    }
    scope = {
      rule_id: finding.ruleId,
      namespace: finding.namespace ?? '',
      object_path: finding.path,
    };
  }
  try {
    const entry = parseExceptions(
      JSON.stringify({
        version: 1,
        exceptions: [
          {
            id: existing?.id ?? randomUUID(),
            match: req.body?.match ?? existing?.match ?? 'exact',
            name: req.body?.name ?? existing?.name,
            enabled: req.body?.enabled ?? existing?.enabled ?? true,
            object_type: req.body?.object_type ?? existing?.object_type,
            builtin: existing?.builtin ?? false,
            policy_path: existing?.policy_path,
            ...scope,
            owner,
            reason,
            expires,
          },
        ],
      }),
      new Set(
        catalog(db.settings())
          .filter((rule) => rule.source === 'builtin')
          .map((rule) => rule.id),
      ),
    )[0];
    if (entry.object_path.length > 2048 || entry.namespace.length > 1024)
      throw new Error('Exception scope is too long');
    const now = new Date(),
      today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (
      entry.enabled !== false &&
      entry.expires !== 'never' &&
      entry.expires < today
    )
      throw new Error('Expiry must be today or later');
    if (editing) {
      if (!db.updateException(config.vaultAddr, entry)) {
        res.status(404).json({ error: 'Exception not found' });
        return;
      }
    } else db.addException(config.vaultAddr, entry);
    res.status(editing ? 200 : 201).json(entry);
  } catch (error) {
    res.status(400).json({
      error:
        error instanceof Error && error.message.includes('UNIQUE')
          ? 'An exception already exists for this check and object'
          : error instanceof Error
            ? error.message
            : 'Invalid exception',
    });
  }
}
router.patch('/exceptions/:id/enabled', (req, res) => {
  const db = storage();
  const entry = db
    .exceptions(config.vaultAddr)
    .find((e) => e.id === req.params.id);
  if (!entry) {
    res.status(404).json({ error: 'Exception not found' });
    return;
  }
  if (typeof req.body?.enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }
  if (
    req.body.enabled &&
    (entry.object_type === 'token' ||
      (entry.expires !== 'never' &&
        entry.expires < new Date().toISOString().slice(0, 10)))
  ) {
    res
      .status(400)
      .json({
        error:
          entry.object_type === 'token'
            ? 'Individual token collection is not supported. This preset cannot be enabled.'
            : 'Update the expiry date before enabling this exception.',
      });
    return;
  }
  const next = { ...entry, enabled: req.body.enabled };
  db.updateException(config.vaultAddr, next);
  res.json(next);
});
router.delete('/exceptions/:id', (req, res) => {
  if (
    storage()
      .exceptions(config.vaultAddr)
      .find((e) => e.id === req.params.id)?.builtin
  ) {
    res
      .status(400)
      .json({ error: 'Built-in presets can be disabled, not removed.' });
    return;
  }
  if (!storage().removeException(config.vaultAddr, String(req.params.id))) {
    res.status(404).json({ error: 'Exception not found' });
    return;
  }
  res.status(204).end();
});
router.get('/runs/:id', (req, res) => {
  const detail = storage().get(String(req.params['id']), config.vaultAddr);
  if (!detail) {
    res.status(404).json({ error: 'Audit run not found' });
    return;
  }
  res.json({ ...detail, findingControls: findingControls(detail) });
});
router.post('/runs', (req: AuthenticatedRequest, res, next) => {
  if (active) {
    res.status(409).json({ error: 'An audit is already running' });
    return;
  }
  let collectionOptions;
  try {
    collectionOptions = parseCollectionOptions(req.body?.collectionOptions);
  } catch (error) {
    res.status(400).json({
      error:
        error instanceof Error ? error.message : 'Invalid collection options',
    });
    return;
  }
  const db = storage();
  const sourceRunId = req.body?.sourceRunId;
  const resumeRunId = req.body?.resumeRunId;
  const refreshRunId = req.body?.refreshRunId;
  const sourceSnapshotId = req.body?.sourceSnapshotId;
  const collectOnly = req.body?.collectOnly ?? false;
  if (typeof collectOnly !== 'boolean') {
    res.status(400).json({ error: 'collectOnly must be boolean' });
    return;
  }
  if (
    sourceSnapshotId !== undefined &&
    (typeof sourceSnapshotId !== 'string' ||
      !db.savedSnapshot(sourceSnapshotId, config.vaultAddr))
  ) {
    res.status(404).json({ error: 'Saved snapshot not found' });
    return;
  }
  if (
    collectOnly &&
    (sourceSnapshotId !== undefined || sourceRunId !== undefined)
  ) {
    res.status(400).json({ error: 'Choose collection or analysis' });
    return;
  }
  const baseSnapshotId = db.currentSnapshot(config.vaultAddr)?.id ?? null;
  if (
    [sourceRunId, resumeRunId, refreshRunId, sourceSnapshotId].filter(
      (value) => value !== undefined,
    ).length > 1
  ) {
    res
      .status(400)
      .json({ error: 'Choose one of reanalysis, resume or refresh' });
    return;
  }
  if (refreshRunId !== undefined) {
    if (
      typeof refreshRunId !== 'string' ||
      req.body?.collectionOptions !== undefined
    ) {
      res.status(400).json({
        error: 'Refresh requires a run ID and its saved collection settings',
      });
      return;
    }
    const source = db.get(refreshRunId, config.vaultAddr);
    if (
      !source?.snapshot?.collection ||
      !['collected', 'completed', 'partial'].includes(source.run.status)
    ) {
      res
        .status(404)
        .json({ error: 'Finished native source snapshot not found' });
      return;
    }
    try {
      collectionOptions = parseCollectionOptions({
        ...source.snapshot.collection.requestPolicy,
        sources: req.body?.refreshSources ?? COLLECTION_SOURCES,
      });
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error ? error.message : 'Invalid refresh sources',
      });
      return;
    }
  }

  const checkpointMaxAgeMs = req.body?.checkpointMaxAgeMs ?? 86400000;
  if (resumeRunId !== undefined) {
    if (
      typeof resumeRunId !== 'string' ||
      sourceRunId !== undefined ||
      req.body?.collectionOptions !== undefined
    ) {
      res.status(400).json({
        error:
          'Resume requires its own run ID and the saved collection options',
      });
      return;
    }
    const source = db.get(resumeRunId, config.vaultAddr);
    if (
      !source?.snapshot ||
      !['failed', 'interrupted'].includes(source.run.status)
    ) {
      res
        .status(404)
        .json({ error: 'Failed or interrupted checkpoint not found' });
      return;
    }
    try {
      collectionOptions = prepareResume(
        source.snapshot,
        config.vaultAddr,
        checkpointMaxAgeMs,
      ).options;
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Invalid checkpoint',
      });
      return;
    }
  }

  if (sourceRunId !== undefined) {
    if (typeof sourceRunId !== 'string') {
      res.status(400).json({ error: 'Invalid source run ID' });
      return;
    }
    const source = db.get(sourceRunId, config.vaultAddr);
    if (
      !source?.snapshot ||
      !['collected', 'completed', 'partial'].includes(source.run.status)
    ) {
      res.status(404).json({ error: 'Finished source snapshot not found' });
      return;
    }
  }
  const settings = db.settings(),
    definitions = catalog(settings);
  let baseline;
  let exceptions;
  try {
    for (const key of ['baselineYaml', 'exceptionsYaml'])
      if (req.body?.[key] !== undefined && typeof req.body[key] !== 'string')
        throw new Error(`${key} must be text`);
    baseline = req.body?.baselineYaml?.trim()
      ? parseBaseline(req.body.baselineYaml)
      : undefined;
    exceptions = req.body?.exceptionsYaml?.trim()
      ? parseExceptions(
          req.body.exceptionsYaml,
          new Set(definitions.map((rule) => rule.id)),
        )
      : [];
    exceptions = parseExceptions(
      JSON.stringify({
        version: 1,
        exceptions: [...db.exceptions(config.vaultAddr), ...exceptions],
      }),
      new Set(definitions.map((rule) => rule.id)),
    );
    applyBaseline(
      [],
      {
        ...settings,
        catalog: definitions,
        fingerprint: settingsFingerprint(settings, definitions),
        engineVersion: ENGINE_VERSION,
        issues: [],
      },
      config.vaultAddr,
      baseline,
      exceptions,
      undefined,
      sourceSnapshotId
        ? snapshotNamespaces(
            db.savedSnapshot(sourceSnapshotId, config.vaultAddr)!.snapshot,
          )
        : sourceRunId
          ? snapshotNamespaces(db.get(sourceRunId, config.vaultAddr)!.snapshot!)
          : collectionOptions.recursiveNamespaces && baseline
            ? (baseline.namespaces ?? [''])
            : [collectionOptions.namespace],
    );
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid audit controls',
    });
    return;
  }
  let id: string;
  try {
    id = db.create(
      config.vaultAddr,
      sourceSnapshotId || sourceRunId ? 'analyze' : 'collect',
    );
  } catch {
    res.status(409).json({ error: 'An audit is already running' });
    return;
  }
  try {
    active = new Worker(workerEntry(), {
      workerData: {
        dbPath,
        id,
        target: config.vaultAddr,
        token: req.vaultToken,
        skipTlsVerify: config.vaultSkipTlsVerify,
        settings,
        baseline,
        exceptions,
        collectionOptions,
        sourceRunId,
        resumeRunId,
        refreshRunId,
        sourceSnapshotId,
        baseSnapshotId,
        collectOnly,
        checkpointMaxAgeMs,
      },
    });
    active.once('error', () => db.fail(id));
    active.once('exit', () => {
      db.fail(id);
      active = undefined;
    });
    res.status(202).json({ id });
  } catch (error) {
    db.fail(id);
    next(error);
  }
});
export default router;
