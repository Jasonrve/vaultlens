import { createHash } from 'node:crypto';
import type { AuditResource } from '../../shared/securityAudit.js';

/** Retain only reference fields and a one-way name hash from Vault aliases. */
export function sanitizeAlias(
  data: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...Object.fromEntries(
      ['id', 'canonical_id', 'mount_accessor']
        .filter((key) => typeof data[key] === 'string')
        .map((key) => [key, data[key]]),
    ),
    ...(typeof data.name === 'string'
      ? { name_sha256: createHash('sha256').update(data.name).digest('hex') }
      : {}),
  };
}

/** Correlate only RoleID hashes on the same observed auth mount accessor. */
export function roleEntityIds(
  resources: AuditResource[],
): Map<string, Set<string>> {
  const mounts = new Map(
    resources
      .filter((r) => r.kind === 'auth-mount' && r.data.type === 'approle')
      .filter((r) => typeof r.data.accessor === 'string')
      .map((r) => [r.data.accessor as string, r.path.replace(/\/$/, '')]),
  );
  const roles = new Map(
    resources
      .filter((r) => r.kind === 'role' && r.data.auth_type === 'approle')
      .filter((r) => typeof r.data.role_id_sha256 === 'string')
      .map((r) => [
        `${r.path.slice(0, r.path.lastIndexOf('/role/'))}:${r.data.role_id_sha256}`,
        r.path,
      ]),
  );
  const result = new Map<string, Set<string>>();
  for (const alias of resources.filter((r) => r.kind === 'alias')) {
    const mount = mounts.get(String(alias.data.mount_accessor ?? ''));
    const hash = alias.data.name_sha256;
    const entity = alias.data.canonical_id;
    if (
      !mount ||
      typeof hash !== 'string' ||
      typeof entity !== 'string' ||
      !entity
    )
      continue;
    const role = roles.get(`${mount}:${hash}`);
    if (!role) continue;
    const ids = result.get(role) ?? new Set<string>();
    ids.add(entity);
    result.set(role, ids);
  }
  return result;
}

import type { IdentityAnalysis } from '../../shared/securityAudit.js';
import { values } from './authDetectors.js';

/** Derive group inheritance without changing the observed resource inventory. */
export function analyzeIdentity(
  resources: AuditResource[],
  aliasesComplete = false,
): IdentityAnalysis {
  const id = (r: AuditResource) =>
    String(r.data.id ?? decodeURIComponent(r.path.split('/').pop() ?? ''));
  const groups = new Map(
    resources.filter((r) => r.kind === 'group').map((r) => [id(r), r]),
  );
  const entities = new Map(
    resources.filter((r) => r.kind === 'entity').map((r) => [id(r), r]),
  );
  const parents = new Map<string, Set<string>>();
  const membership = new Map<string, Set<string>>();
  const issues = new Map<string, { path: string; reason: string }>();
  const gap = (path: string, reason: string) =>
    issues.set(`${path}:${reason}`, { path, reason });
  const edge = (
    map: Map<string, Set<string>>,
    child: string,
    parent: string,
  ) => {
    const set = map.get(child) ?? new Set<string>();
    set.add(parent);
    map.set(child, set);
  };
  for (const [groupId, group] of groups) {
    for (const parent of values(group.data.parent_group_ids))
      edge(parents, groupId, parent);
    for (const child of values(group.data.member_group_ids))
      edge(parents, child, groupId);
    for (const entity of values(group.data.member_entity_ids))
      edge(membership, entity, groupId);
  }
  for (const [child, parentIds] of parents) {
    if (!groups.has(child))
      gap(
        `identity/group/id/${child}`,
        'Referenced child group was not collected',
      );
    for (const parent of parentIds)
      if (!groups.has(parent))
        gap(
          `identity/group/id/${parent}`,
          'Referenced parent group was not collected',
        );
  }
  for (const entity of membership.keys())
    if (!entities.has(entity))
      gap(
        `identity/entity/id/${entity}`,
        'Referenced member entity was not collected',
      );
  // Missing observations are coverage gaps, not proof that an alias is stale:
  // older snapshots do not record complete auth-mount/alias inventories.
  const accessors = new Set(
    resources
      .filter((resource) => resource.kind === 'auth-mount')
      .map((resource) => resource.data.accessor)
      .filter((value) => typeof value === 'string' && value),
  );
  for (const alias of resources.filter(
    (resource) => resource.kind === 'alias',
  )) {
    const canonicalId = alias.data.canonical_id;
    if (typeof canonicalId !== 'string' || !canonicalId)
      gap(alias.path, 'Alias is missing its canonical entity ID');
    else if (!entities.has(canonicalId))
      gap(alias.path, 'Alias canonical entity was not collected');
    const accessor = alias.data.mount_accessor;
    if (typeof accessor !== 'string' || !accessor)
      gap(alias.path, 'Alias is missing its auth mount accessor');
    else if (!accessors.has(accessor))
      gap(
        alias.path,
        'Alias auth mount was not collected; stale alias status cannot be established',
      );
  }
  const catalogAliases = resources.filter(
    (resource) => resource.kind === 'alias',
  );
  const signature = (data: Record<string, unknown>) =>
    JSON.stringify([data.canonical_id, data.mount_accessor, data.name_sha256]);
  const aliasesById = new Map(
    catalogAliases.map((alias) => [id(alias), alias]),
  );
  const aliasSignatures = new Set(
    catalogAliases.map((alias) => signature(alias.data)),
  );
  for (const [entityId, entity] of entities) {
    if (!Array.isArray(entity.data.aliases)) continue;
    for (const [index, raw] of entity.data.aliases.entries()) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        gap(entity.path, `Embedded alias ${index} is malformed`);
        continue;
      }
      const alias = { ...raw, canonical_id: raw.canonical_id || entityId };
      const catalogAlias =
        typeof raw.id === 'string' ? aliasesById.get(raw.id) : undefined;
      const label = `Embedded alias ${index}`;
      if (catalogAlias && signature(catalogAlias.data) !== signature(alias))
        gap(
          entity.path,
          `${label} differs from its catalog entry; collection is not atomic`,
        );
      else if (
        !catalogAlias &&
        !aliasSignatures.has(signature(alias)) &&
        aliasesComplete
      )
        gap(entity.path, `${label} is absent from the collected alias catalog`);
      if (alias.canonical_id !== entityId)
        gap(entity.path, `${label} references a different canonical entity`);
      if (!accessors.has(raw.mount_accessor))
        gap(entity.path, `${label} auth mount was not collected`);
    }
  }
  const ancestors = new Map<string, Set<string>>();
  for (const groupId of groups.keys()) {
    const seen = new Set<string>(),
      queue = [...(parents.get(groupId) ?? [])];
    for (let index = 0; index < queue.length; index++) {
      const next = queue[index];
      if (next === groupId) {
        gap(`identity/group/id/${groupId}`, 'Identity group cycle detected');
        continue;
      }
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...(parents.get(next) ?? []));
    }
    ancestors.set(groupId, seen);
  }
  const assignments: IdentityAnalysis['assignments'] = [];
  const add = (
    subject: AuditResource,
    source: AuditResource,
    relationship: 'assigned' | 'inherited',
  ) => {
    for (const policy of values(source.data.policies))
      assignments.push({
        subjectPath: subject.path,
        subjectKind: subject.kind,
        policy,
        relationship,
        sourcePath: source.path,
      });
  };
  for (const [groupId, group] of groups) {
    add(group, group, 'assigned');
    for (const ancestor of ancestors.get(groupId) ?? []) {
      const source = groups.get(ancestor);
      if (source) add(group, source, 'inherited');
    }
  }
  for (const [entityId, entity] of entities) {
    add(entity, entity, 'assigned');
    const effective = new Set(membership.get(entityId) ?? []);
    for (const direct of [...effective])
      for (const ancestor of ancestors.get(direct) ?? [])
        effective.add(ancestor);
    for (const groupId of effective) {
      const source = groups.get(groupId);
      if (source) add(entity, source, 'inherited');
    }
  }
  assignments.sort(
    (a, b) =>
      a.subjectPath.localeCompare(b.subjectPath) ||
      a.policy.localeCompare(b.policy) ||
      a.sourcePath.localeCompare(b.sourcePath),
  );
  return {
    assignments,
    issues: [...issues.values()],
    groupCount: groups.size,
    entityCount: entities.size,
  };
}
