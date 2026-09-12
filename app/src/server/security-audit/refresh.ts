import { globMatch } from './authDetectors.js';
import type { AuditSnapshot } from '../../shared/securityAudit.js';
import { RESOURCE_STAGE, stageKey } from './collectionStages.js';

/** Replace absence only within a successfully collected stage. */
export function mergeRefresh(
  base: AuditSnapshot,
  fresh: AuditSnapshot,
  sources: string[],
): AuditSnapshot {
  if (base.target !== fresh.target || !base.finishedAt || !fresh.finishedAt)
    throw new Error('Refresh requires matching finished snapshots');
  const complete = new Set(
    fresh.collection?.stageResults
      ?.filter((stage) => stage.complete)
      .map((stage) => stageKey(stage.namespace, stage.stage)) ?? [],
  );
  const key = (resource: AuditSnapshot['resources'][number]) =>
    JSON.stringify([resource.namespace ?? '', resource.kind, resource.path]);
  const scope = fresh.collection?.scope;
  const matches = (value: string, patterns: string[] = []) =>
    !patterns.length || patterns.some((pattern) => globMatch(pattern, value));
  const inScope = (resource: AuditSnapshot['resources'][number]) => {
    if (resource.kind === 'policy')
      return matches(
        String(
          resource.data.name ??
            decodeURIComponent(resource.path.split('/').pop()!),
        ),
        scope?.policyFilters,
      );
    if (resource.kind === 'role') {
      const mounts = [...fresh.resources, ...base.resources].filter(
        (r) =>
          r.kind === 'auth-mount' &&
          (r.namespace ?? '') === (resource.namespace ?? '') &&
          resource.path.startsWith(
            r.path.endsWith('/') ? r.path : r.path + '/',
          ),
      );
      const mount = mounts.sort((a, b) => b.path.length - a.path.length)[0];
      if (!mount)
        return (
          !scope?.authMountFilters.length && !scope?.authTypeFilters.length
        );
      return (
        matches(
          mount.path.replace(/^auth\//, '').replace(/\/$/, ''),
          scope?.authMountFilters,
        ) &&
        matches(
          String(resource.data.auth_type ?? mount.data.type ?? ''),
          scope?.authTypeFilters,
        )
      );
    }
    return true;
  };
  const resources = new Map<string, AuditSnapshot['resources'][number]>(
    base.resources
      .filter(
        (resource) =>
          !(
            inScope(resource) &&
            complete.has(
              stageKey(resource.namespace ?? '', RESOURCE_STAGE[resource.kind]),
            )
          ),
      )
      .map((resource) => [
        key(resource),
        {
          ...structuredClone(resource),
          retainedFromSnapshotAt:
            resource.retainedFromSnapshotAt ?? base.finishedAt,
        },
      ]),
  );
  let retained = resources.size;
  for (const resource of fresh.resources) {
    if (resources.has(key(resource))) retained--;
    resources.set(key(resource), structuredClone(resource));
  }
  const namespaces = [
    ...new Set([...(base.namespaces ?? ['']), ...(fresh.namespaces ?? [''])]),
  ].sort();
  const policyCoverage: Record<string, boolean> = {},
    aliasCoverage: Record<string, boolean> = {};
  const refreshedStages = new Set(
    fresh.collection?.stageResults?.map((stage) =>
      stageKey(stage.namespace, stage.stage),
    ) ?? [],
  );
  for (const namespace of namespaces) {
    policyCoverage[namespace] = refreshedStages.has(
      stageKey(namespace, 'Policies'),
    )
      ? (fresh.namespacePolicyCompleteness?.[namespace] ?? false)
      : false;
    aliasCoverage[namespace] = refreshedStages.has(
      stageKey(namespace, 'Identity aliases'),
    )
      ? (fresh.namespaceAliasCompleteness?.[namespace] ?? false)
      : false;
  }
  return {
    ...fresh,
    resources: [...resources.values()],
    namespaces,
    namespacePolicyCompleteness: policyCoverage,
    namespaceAliasCompleteness: aliasCoverage,
    policiesComplete: namespaces.every(
      (namespace) => policyCoverage[namespace],
    ),
    issues: [
      ...base.issues.filter((issue) => {
        const resource = base.resources.find(
          (r) =>
            r.path === issue.path &&
            (r.namespace ?? '') === (issue.namespace ?? ''),
        );
        const namespace = issue.namespace ?? '';
        if (resource)
          return (
            !inScope(resource) ||
            !complete.has(stageKey(namespace, RESOURCE_STAGE[resource.kind]))
          );
        const fullStage =
          issue.path.startsWith('sys/policies/acl') &&
          !scope?.policyFilters.length
            ? 'Policies'
            : issue.path.startsWith('identity/entity')
              ? 'Identity entities'
              : issue.path.startsWith('identity/group') &&
                  !issue.path.includes('alias')
                ? 'Identity groups'
                : issue.path.includes('identity/') &&
                    issue.path.includes('alias')
                  ? 'Identity aliases'
                  : (issue.path === 'sys/auth' ||
                        issue.path.startsWith('auth/')) &&
                      !scope?.authMountFilters.length &&
                      !scope?.authTypeFilters.length
                    ? 'Auth mounts and roles'
                    : issue.path === 'sys/mounts'
                      ? 'Secret mounts'
                      : undefined;
        if (issue.path === 'collection/source-scope') return false;
        return !fullStage || !complete.has(stageKey(namespace, fullStage));
      }),
      ...fresh.issues.filter(
        (issue) => issue.path !== 'collection/source-scope',
      ),
    ],
    collection: fresh.collection
      ? {
          ...fresh.collection,
          requestPolicy: fresh.collection.requestPolicy,
          scope: fresh.collection.scope,
        }
      : undefined,
    refresh: {
      sources,
      retainedResources: retained,
      retainedFrom: base.refresh?.retainedFrom ?? base.finishedAt,
    },
  };
}
