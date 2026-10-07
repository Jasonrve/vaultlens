import type { AuditSnapshot } from './securityAudit.js';

export interface PolicyUsage {
  namespace: string;
  name: string;
  collected: boolean;
  references: {
    path: string;
    kind: string;
    relationship: 'assigned' | 'inherited' | 'allowed';
    sourcePath: string;
  }[];
}

/** Observed references, not effective authorization or proof of unused policies. */
export function policyUsage(snapshot: AuditSnapshot): PolicyUsage[] {
  const rows = new Map<string, PolicyUsage>();
  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter(
          (item): item is string => typeof item === 'string' && !!item,
        )
      : typeof value === 'string'
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
  const row = (namespace: string, name: string) => {
    const key = JSON.stringify([namespace, name]);
    if (!rows.has(key))
      rows.set(key, { namespace, name, collected: false, references: [] });
    return rows.get(key)!;
  };
  for (const resource of snapshot.resources) {
    const namespace = resource.namespace ?? '';
    if (resource.kind === 'policy' && typeof resource.data.name === 'string')
      row(namespace, resource.data.name).collected = true;
    if (!['role', 'entity', 'group'].includes(resource.kind)) continue;
    const names = [
      ...strings(resource.data.policies),
      ...strings(resource.data.token_policies),
    ];
    if (resource.kind === 'role' && !resource.data.token_no_default_policy)
      names.push('default');
    for (const name of new Set(names))
      row(namespace, name).references.push({
        path: resource.path,
        kind: resource.kind,
        relationship: 'assigned',
        sourcePath: resource.path,
      });
    if (resource.kind === 'role' && resource.data.auth_type === 'token')
      for (const name of new Set(strings(resource.data.allowed_policies)))
        row(namespace, name).references.push({
          path: resource.path,
          kind: resource.kind,
          relationship: 'allowed',
          sourcePath: resource.path,
        });
  }
  for (const assignment of snapshot.identity?.assignments ?? []) {
    if (assignment.relationship !== 'inherited') continue;
    row(assignment.namespace ?? '', assignment.policy).references.push({
      path: assignment.subjectPath,
      kind: assignment.subjectKind,
      relationship: 'inherited',
      sourcePath: assignment.sourcePath,
    });
  }
  for (const value of rows.values())
    value.references.sort(
      (a, b) =>
        a.path.localeCompare(b.path) ||
        a.relationship.localeCompare(b.relationship) ||
        a.sourcePath.localeCompare(b.sourcePath),
    );
  return [...rows.values()].sort(
    (a, b) =>
      a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name),
  );
}
