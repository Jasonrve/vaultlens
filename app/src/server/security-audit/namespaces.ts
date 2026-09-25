import type { AuditSnapshot } from '../../shared/securityAudit.js';
export function snapshotNamespaces(snapshot: AuditSnapshot): string[] {
  const observed = snapshot.resources.map(
    (resource) => resource.namespace ?? '',
  );
  return [
    ...new Set([
      ...(snapshot.namespaces ?? []),
      ...observed,
      ...(!observed.length && !snapshot.namespaces?.length ? [''] : []),
    ]),
  ].sort();
}

export function normalizeNamespace(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    /[\x00-\x20\x7f]/.test(value)
  )
    throw new Error('Invalid Vault namespace');
  const normalized = value.replace(/^\/+|\/+$/g, '');
  if (
    normalized &&
    normalized
      .split('/')
      .some((segment) => !segment || segment === '.' || segment === '..')
  )
    throw new Error('Invalid Vault namespace path');
  return normalized;
}
