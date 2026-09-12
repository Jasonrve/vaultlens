import { createHash } from 'node:crypto';
import { snapshotNamespaces } from './namespaces.js';
import type {
  AuditDetail,
  AuditFinding,
  AuditResource,
} from '../../shared/securityAudit.js';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
type Change<T> = {
  change: 'added' | 'removed' | 'changed' | 'unchanged';
  old?: T;
  new?: T;
};
function compare<T>(
  oldItems: T[],
  newItems: T[],
  key: (item: T) => string,
  record: (item: T) => unknown = (item) => item,
): Change<T>[] {
  const old = new Map<string, T[]>(),
    next = new Map<string, T[]>();
  for (const [items, map] of [
    [oldItems, old],
    [newItems, next],
  ] as const)
    for (const item of items) {
      const k = key(item);
      map.set(k, [...(map.get(k) ?? []), item]);
    }
  const output: Change<T>[] = [];
  for (const k of [...new Set([...old.keys(), ...next.keys()])].sort()) {
    const before = [...(old.get(k) ?? [])].sort((a, b) =>
      canonical(a).localeCompare(canonical(b)),
    );
    const after = [...(next.get(k) ?? [])].sort((a, b) =>
      canonical(a).localeCompare(canonical(b)),
    );
    for (let i = before.length - 1; i >= 0; i--) {
      const index = after.findIndex(
        (item) => canonical(record(item)) === canonical(record(before[i])),
      );
      if (index >= 0) {
        output.push({ change: 'unchanged', new: after.splice(index, 1)[0] });
        before.splice(i, 1);
      }
    }
    while (before.length && after.length)
      output.push({
        change: 'changed',
        old: before.shift()!,
        new: after.shift()!,
      });
    output.push(
      ...before.map((item) => ({ change: 'removed' as const, old: item })),
      ...after.map((item) => ({ change: 'added' as const, new: item })),
    );
  }
  return output;
}
const counts = <T>(changes: Change<T>[]) =>
  Object.fromEntries(
    ['added', 'removed', 'changed', 'unchanged'].map((name) => [
      name,
      changes.filter((c) => c.change === name).length,
    ]),
  );
const findingRecord = (finding: AuditFinding) => {
  let evidence: unknown = finding.evidence;
  try {
    evidence = JSON.parse(finding.evidence);
  } catch {
    /* Legacy plain-text evidence. */
  }
  // Source line movement and formatting are covered by resource changes.
  return {
    namespace: finding.namespace ?? '',
    ruleId: finding.ruleId,
    path: finding.path,
    policyPath: finding.policyPath ?? '',
    severity: finding.severity,
    evidence,
    title: finding.title,
    recommendation: finding.recommendation,
  };
};
function resourceRecord(input: AuditResource): unknown {
  const {
    observedAt: _observedAt,
    retainedFromSnapshotAt: _retainedFrom,
    ...resource
  } = input;
  if (resource.kind !== 'policy') return resource;
  const data = { ...resource.data };
  const digest =
    typeof data.hcl === 'string'
      ? createHash('sha256').update(data.hcl).digest('hex')
      : data.source_sha256;
  if (typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest)) {
    delete data.hcl;
    delete data.source_redacted;
    data.source_sha256 = digest;
  }
  return { ...resource, data };
}

export function compareRuns(old: AuditDetail, next: AuditDetail) {
  if (
    !old.snapshot ||
    !next.snapshot ||
    !old.snapshot.finishedAt ||
    !next.snapshot.finishedAt ||
    ['collected', 'running', 'failed', 'interrupted'].includes(
      old.run.status,
    ) ||
    ['collected', 'running', 'failed', 'interrupted'].includes(next.run.status)
  )
    throw new Error('Diff requires two finished snapshots');
  if (
    old.snapshot.target !== next.snapshot.target ||
    old.snapshot.version !== next.snapshot.version
  )
    throw new Error('Snapshot targets or schemas are incomparable');
  for (const detail of [old, next])
    if (
      detail.snapshot!.importedFrom &&
      !detail.snapshot!.importedFrom.collection
    )
      throw new Error('Imported snapshot collection scope is unknown');
  const defaultScope = {
    policyFilters: [],
    authMountFilters: [],
    authTypeFilters: [],
    skipIdentity: false,
  };
  const scope = (snapshot: NonNullable<AuditDetail['snapshot']>) => ({
    scope:
      snapshot.importedFrom?.collection?.scope ??
      snapshot.collection?.scope ??
      defaultScope,
    maxObjects:
      snapshot.importedFrom?.collection?.maxObjects ??
      snapshot.collection?.requestPolicy.maxObjects ??
      0,
    namespaceFilters:
      snapshot.importedFrom?.collection?.namespaceFilters ??
      snapshot.collection?.requestPolicy.namespaceFilters ??
      [],
    sources: snapshot.importedFrom?.collection?.sources ??
      snapshot.collection?.requestPolicy.sources ?? [
        'auth_roles',
        'identity',
        'identity_aliases',
        'mounts',
        'policies',
      ],
  });
  if (scope(old.snapshot).maxObjects !== scope(next.snapshot).maxObjects)
    throw new Error('Snapshot object limits are incomparable');
  if (canonical(scope(old.snapshot)) !== canonical(scope(next.snapshot)))
    throw new Error('Snapshot collection scopes are incomparable');
  if (
    canonical(snapshotNamespaces(old.snapshot)) !==
    canonical(snapshotNamespaces(next.snapshot))
  )
    throw new Error('Snapshot namespaces are incomparable');
  if (
    !old.configuration ||
    !next.configuration ||
    old.configuration.fingerprint !== next.configuration.fingerprint ||
    old.configuration.engineVersion !== next.configuration.engineVersion
  )
    throw new Error(
      'Snapshot audit configurations or engine versions are incomparable',
    );
  const resources = compare<AuditResource>(
    old.snapshot.resources,
    next.snapshot.resources,
    (r) => canonical([r.namespace ?? '', r.kind, r.path]),
    resourceRecord,
  );
  const findings = compare(
    old.findings.map(findingRecord),
    next.findings.map(findingRecord),
    (f) => canonical([f.namespace, f.ruleId, f.path, f.policyPath]),
  );
  const assignments = compare(
    old.snapshot.identity?.assignments ?? [],
    next.snapshot.identity?.assignments ?? [],
    (a) =>
      canonical([
        a.namespace ?? '',
        a.subjectKind,
        a.subjectPath,
        a.policy,
        a.relationship,
        a.sourcePath,
      ]),
  );
  const coverage = compare(
    [...old.snapshot.issues, ...old.configuration.issues],
    [...next.snapshot.issues, ...next.configuration.issues],
    (i) => canonical([i.namespace ?? '', i.path]),
  );
  const partial =
    old.run.status === 'partial' ||
    next.run.status === 'partial' ||
    !old.snapshot.policiesComplete ||
    !next.snapshot.policiesComplete ||
    coverage.some((c) => c.old || c.new);
  return {
    oldRunId: old.run.id,
    newRunId: next.run.id,
    target: next.snapshot.target,
    warnings: partial
      ? [
          'Collection or analysis is incomplete; removed findings are not proof of remediation.',
        ]
      : [],
    statistics: {
      resources: counts(resources),
      findings: counts(findings),
      assignments: counts(assignments),
      coverage: counts(coverage),
    },
    changes: {
      resources: resources.filter((c) => c.change !== 'unchanged'),
      findings,
      assignments: assignments.filter((c) => c.change !== 'unchanged'),
      coverage: coverage.filter((c) => c.change !== 'unchanged'),
    },
  };
}
