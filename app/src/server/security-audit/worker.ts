import { mergeRefresh } from './refresh.js';
import { importFailureReason } from './failureReason.js';
import { importPythonSnapshot } from './pythonImport.js';
import { snapshotNamespaces } from './namespaces.js';
import { applyBaseline } from './baseline.js';
import { workerData } from 'node:worker_threads';
import { collect } from './collector.js';
import { execute } from './engine.js';
import { AuditStore } from './store.js';
const {
  refreshRunId,
  sourceSnapshotId,
  baseSnapshotId,
  collectOnly,
  resumeRunId,
  checkpointMaxAgeMs,
  importPath,
  dbPath,
  id,
  target,
  token,
  skipTlsVerify,
  settings,
  collectionOptions,
  sourceRunId,
  baseline,
  exceptions,
} = workerData;
const store = new AuditStore(dbPath);
let lastUpdate = 0,
  lastStage = '';
const progress = (
  value: import('../../shared/securityAudit.js').AuditProgress,
) => {
  const stage = `${value.namespace}:${value.phase}`;
  if (stage !== lastStage || Date.now() - lastUpdate >= 250) {
    store.updateProgress(id, value);
    lastUpdate = Date.now();
    lastStage = stage;
  }
};
try {
  if (importPath) {
    progress({
      namespace: '',
      phase: 'Importing Python snapshot',
      resources: 0,
      requests: 0,
      updatedAt: new Date().toISOString(),
    });
    const imported = importPythonSnapshot(importPath, target);
    store.saveSnapshot(id, imported, false);
    store.finish(id, imported, []);
  } else {
    const resumeSource = resumeRunId ? store.get(resumeRunId, target) : null;
    if (
      resumeRunId &&
      (!resumeSource?.snapshot ||
        !['failed', 'interrupted'].includes(resumeSource.run.status))
    )
      throw new Error('Checkpoint unavailable');
    const resume = resumeSource?.snapshot
      ? { snapshot: resumeSource.snapshot, maxAgeMs: checkpointMaxAgeMs }
      : undefined;
    const refreshSource = refreshRunId ? store.get(refreshRunId, target) : null;
    if (
      refreshRunId &&
      (!refreshSource?.snapshot ||
        !['collected', 'completed', 'partial'].includes(
          refreshSource.run.status,
        ))
    )
      throw new Error('Refresh source unavailable');
    const base = baseSnapshotId
      ? store.savedSnapshot(baseSnapshotId, target)
      : null;
    const saved = sourceSnapshotId
      ? store.savedSnapshot(sourceSnapshotId, target)
      : null;
    let snapshot = saved
      ? saved.snapshot
      : sourceRunId
        ? store.get(sourceRunId, target)?.snapshot
        : await collect(
            target,
            token,
            skipTlsVerify,
            collectionOptions,
            progress,
            (snapshot) => store.saveCheckpoint(id, snapshot),
            resume,
          );
    if (!snapshot) throw new Error('Source snapshot not found');
    if (
      !sourceRunId &&
      !sourceSnapshotId &&
      !snapshot.resources.length &&
      !snapshot.collection?.stageResults?.some((stage) => stage.complete)
    )
      throw new Error('No collection scope could be read');
    // Explicit historical refresh remains an independent branch. Normal collections
    // reconcile the latest inventory and publish a new immutable revision.
    const mergeBase = refreshSource?.snapshot ?? base?.snapshot;
    if (!sourceRunId && !sourceSnapshotId && mergeBase)
      snapshot = mergeRefresh(mergeBase, snapshot, collectionOptions.sources);
    if (sourceRunId || resumeRunId || refreshRunId)
      snapshot.sourceRunId = sourceRunId ?? resumeRunId ?? refreshRunId;
    if (!sourceRunId && !sourceSnapshotId) {
      const parent = refreshRunId
        ? (refreshSource?.run.snapshotId ?? null)
        : baseSnapshotId;
      store.saveSnapshot(id, snapshot, !refreshRunId, parent);
    } else {
      const snapshotId =
        sourceSnapshotId ?? store.get(sourceRunId, target)?.run.snapshotId;
      if (snapshotId) store.linkSnapshot(id, snapshotId);
    }
    if (collectOnly) {
      snapshot.analysisPerformed = false;
      store.finish(id, snapshot, []);
    } else {
      progress({
        namespace: '',
        phase: 'Analyzing snapshot',
        resources: snapshot.resources.length,
        requests: snapshot.collection?.metrics.requests ?? 0,
        updatedAt: new Date().toISOString(),
      });
      const result = execute(snapshot, settings ?? store.settings());
      snapshot.controls = applyBaseline(
        result.findings,
        result.configuration,
        target,
        baseline,
        exceptions,
        undefined,
        snapshotNamespaces(snapshot),
      );
      snapshot.analysisPerformed = true;
      snapshot.identity = result.identity;
      store.finish(id, snapshot, result.findings, result.configuration);
    }
  }
} catch (error) {
  store.fail(
    id,
    importPath
      ? importFailureReason(error)
      : 'Audit analysis failed. Check the selected rules and snapshot compatibility.',
  );
} finally {
  store.close();
}
