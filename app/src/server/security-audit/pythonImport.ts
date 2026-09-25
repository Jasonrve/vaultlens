import { DatabaseSync } from 'node:sqlite';
import { statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type {
  AuditSnapshot,
  AuditResource,
} from '../../shared/securityAudit.js';
import { normalizeNamespace } from './namespaces.js';
import { COLLECTED_FIELDS } from './collector.js';
import { sanitizeAlias } from './identity.js';

/** Import observed configuration for native reanalysis; never execute source SQL. */
export function importPythonSnapshot(
  path: string,
  target: string,
): AuditSnapshot {
  if (statSync(path).size > 256 * 1024 * 1024)
    throw new Error('Python snapshot exceeds 256 MiB');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF');
    for (const table of [
      'metadata',
      'policies',
      'mounts',
      'subjects',
      'assignments',
      'coverage',
      'warnings',
    ]) {
      const definition = db
        .prepare('SELECT type,sql FROM sqlite_master WHERE name=?')
        .get(table);
      if (
        definition?.type !== 'table' ||
        String(definition.sql).toUpperCase().includes('VIRTUAL TABLE')
      )
        throw new Error(`Missing ordinary Python table: ${table}`);
    }
    let count = 0;
    const rows = (table: string) => {
      const result: Record<string, unknown>[] = [];
      for (const row of db.prepare(`SELECT * FROM ${table}`).iterate()) {
        if (++count > 1000000)
          throw new Error('Python snapshot exceeds one million records');
        result.push(row);
      }
      return result;
    };
    const text = (value: unknown): string => {
      if (typeof value !== 'string')
        throw new Error('Invalid Python snapshot text field');
      return value;
    };
    const meta = Object.fromEntries(
      rows('metadata').map((row) => [text(row.key), text(row.value)]),
    );
    if (meta.schema_version !== '2' && meta.schema_version !== '3')
      throw new Error('Only Python snapshot schemas 2 and 3 are supported');
    if (meta.vault_address !== target)
      throw new Error('Python snapshot target must match VAULT_ADDR');
    if (
      !meta.finished_at ||
      !Number.isFinite(Date.parse(meta.finished_at)) ||
      !Number.isFinite(Date.parse(meta.started_at))
    )
      throw new Error(
        'Import requires a finished Python snapshot with valid timestamps',
      );
    const namespaces: unknown = JSON.parse(meta.namespaces ?? '[]');
    if (
      !Array.isArray(namespaces) ||
      namespaces.some((value) => typeof value !== 'string')
    )
      throw new Error('Invalid Python namespaces');
    const snapshot: AuditSnapshot = {
      importedFrom: {
        tool: 'vault-security-audit',
        schemaVersion: meta.schema_version === '2' ? 2 : 3,
        scanId: meta.scan_id,
      },
      version: 1,
      target,
      startedAt: meta.started_at,
      finishedAt: meta.finished_at,
      analysisPerformed: false,
      namespaces: namespaces.map(normalizeNamespace),
      resources: [],
      issues: [],
      policiesComplete: false,
      namespacePolicyCompleteness: {},
      namespaceAliasCompleteness: {},
    };
    const collection: unknown = JSON.parse(meta.collection_config ?? '{}');
    if (
      !collection ||
      typeof collection !== 'object' ||
      Array.isArray(collection)
    )
      throw new Error('Invalid Python collection config');
    const config = collection as Record<string, unknown>;
    if (Object.keys(config).length) {
      const patterns = (key: string): string[] => {
        const value = config[key];
        if (
          !Array.isArray(value) ||
          value.some((item) => typeof item !== 'string')
        )
          throw new Error(`Invalid Python ${key}`);
        return [...new Set(value as string[])].sort();
      };
      if (
        typeof config.include_identity !== 'boolean' ||
        typeof config.recursive_namespaces !== 'boolean'
      )
        throw new Error('Invalid Python collection booleans');
      const maxObjects = config.max_objects ?? 0;
      if (
        typeof maxObjects !== 'number' ||
        !Number.isSafeInteger(maxObjects) ||
        maxObjects < 0
      )
        throw new Error('Invalid Python object limit');
      const sources =
        config.sources === undefined
          ? ['mounts', 'policies', 'auth_roles', 'identity', 'identity_aliases']
          : patterns('sources');
      snapshot.importedFrom!.collection = {
        scope: {
          policyFilters: patterns('policy_filters'),
          authMountFilters: patterns('auth_mount_filters').map((value) =>
            value.replace(/^auth\//, '').replace(/^\/+|\/+$/g, ''),
          ),
          authTypeFilters: patterns('auth_type_filters'),
          skipIdentity: !config.include_identity,
        },
        maxObjects,
        sources: sources.sort(),
        recursiveNamespaces: config.recursive_namespaces,
        namespaceFilters: patterns('namespace_filters'),
      };
    }
    snapshot.importedCoverage = [];
    const ns = (row: Record<string, unknown>) => {
      const namespace = normalizeNamespace(row.namespace);
      if (!snapshot.namespaces!.includes(namespace))
        snapshot.namespaces!.push(namespace);
      return namespace;
    };
    for (const policy of rows('policies')) {
      const namespace = ns(policy),
        name = text(policy.name),
        digest = text(policy.sha256);
      if (policy.rules !== null && typeof policy.rules !== 'string')
        throw new Error('Invalid Python policy source');
      if (!/^[a-f0-9]{64}$/.test(digest))
        throw new Error('Invalid Python policy digest');
      if (
        typeof policy.rules === 'string' &&
        createHash('sha256').update(policy.rules).digest('hex') !== digest
      )
        throw new Error('Python policy source digest mismatch');
      snapshot.resources.push({
        namespace,
        kind: 'policy',
        path: `sys/policies/acl/${encodeURIComponent(name)}`,
        data: {
          name,
          source_sha256: digest,
          ...(policy.rules === null
            ? { source_redacted: true }
            : { hcl: policy.rules }),
        },
      });
    }
    for (const mount of rows('mounts')) {
      const namespace = ns(mount),
        path = text(mount.path);
      if (!['auth', 'secret'].includes(text(mount.kind)))
        throw new Error('Unknown Python mount kind');
      snapshot.resources.push({
        namespace,
        kind: mount.kind === 'auth' ? 'auth-mount' : 'secret-mount',
        path: mount.kind === 'auth' ? path : `sys/mounts/${path}`,
        data: {
          type: text(mount.mount_type),
          accessor: mount.accessor,
          mount_path: path,
        },
      });
    }
    const subjects = new Map<string, AuditResource>();
    const key = (namespace: string, kind: unknown, id: unknown) =>
      JSON.stringify([namespace, kind, id]);
    for (const subject of rows('subjects')) {
      const namespace = ns(subject),
        kind = text(subject.kind),
        id = text(subject.subject_id);
      const raw: unknown = JSON.parse(text(subject.metadata_json));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('Invalid Python subject metadata');
      const metadata = raw as Record<string, unknown>;
      const data: Record<string, unknown> = Object.fromEntries(
        COLLECTED_FIELDS.filter((field) => field in metadata).map((field) => [
          field,
          metadata[field],
        ]),
      );
      let nativeKind: string, resourcePath: string;
      if (
        ['identity_entity', 'identity_group', 'identity_alias'].includes(kind)
      ) {
        nativeKind =
          kind === 'identity_entity'
            ? 'entity'
            : kind === 'identity_group'
              ? 'group'
              : 'alias';
        resourcePath = `identity/${nativeKind === 'alias' ? 'entity-alias' : nativeKind}/id/${encodeURIComponent(id)}`;
        if (nativeKind === 'alias')
          Object.assign(
            data,
            sanitizeAlias({ ...metadata, id, name: subject.name }),
          );
        else {
          data.id = id;
          if (Array.isArray(metadata.aliases))
            data.aliases = metadata.aliases.map((alias) =>
              alias && typeof alias === 'object' && !Array.isArray(alias)
                ? sanitizeAlias(alias as Record<string, unknown>)
                : null,
            );
        }
      } else if (
        [
          'approle',
          'jwt_role',
          'kubernetes_role',
          'token_role',
          'auth_role',
        ].includes(kind)
      ) {
        nativeKind = 'role';
        resourcePath = id;
        data.auth_type = text(subject.mount_type);
        if (typeof metadata.role_id_sha256 === 'string')
          data.role_id_sha256 = metadata.role_id_sha256;
      } else throw new Error(`Unsupported Python subject kind: ${kind}`);
      const resource = {
        namespace,
        kind: nativeKind,
        path: resourcePath,
        data,
      };
      subjects.set(key(namespace, kind, id), resource);
      snapshot.resources.push(resource);
    }
    for (const assignment of rows('assignments')) {
      const namespace = ns(assignment);
      const subject = subjects.get(
        key(namespace, assignment.subject_kind, assignment.subject_id),
      );
      if (!subject) {
        snapshot.issues.push({
          namespace,
          path: text(assignment.source_path),
          reason: 'Imported assignment subject was not collected',
        });
        continue;
      }
      const fields: Record<string, string> = {
        assigned: 'policies',
        implicit_default: 'policies',
        allowed: 'allowed_policies',
        allowed_glob: 'allowed_policies_glob',
        disallowed: 'disallowed_policies',
        disallowed_glob: 'disallowed_policies_glob',
      };
      const field = fields[text(assignment.relationship)];
      if (!field) {
        // Inheritance is recomputed from observed group membership.
        if (assignment.relationship !== 'inherited')
          snapshot.issues.push({
            namespace,
            path: subject.path,
            reason: 'Unsupported imported assignment relationship',
          });
        continue;
      }
      const prior = Array.isArray(subject.data[field])
        ? (subject.data[field] as string[])
        : [];
      subject.data[field] = [
        ...new Set([...prior, text(assignment.policy_name)]),
      ];
    }
    // Coverage is evidence for absence checks, not just report metadata.
    const resourceCounts = new Map<string, number>();
    for (const resource of snapshot.resources) {
      const countKey = JSON.stringify([resource.namespace, resource.kind]);
      resourceCounts.set(countKey, (resourceCounts.get(countKey) ?? 0) + 1);
    }
    const seenCoverage = new Set<string>();
    for (const coverage of rows('coverage')) {
      const namespace = ns(coverage),
        source = text(coverage.source),
        status = text(coverage.status);
      if (
        !Number.isSafeInteger(coverage.discovered) ||
        !Number.isSafeInteger(coverage.scanned) ||
        Number(coverage.discovered) < 0 ||
        Number(coverage.scanned) < 0
      )
        throw new Error('Invalid Python coverage counts');
      snapshot.importedCoverage!.push({
        namespace,
        source,
        status,
        discovered: Number(coverage.discovered),
        scanned: Number(coverage.scanned),
        details: coverage.details === null ? null : text(coverage.details),
      });
      const coverageKey = JSON.stringify([namespace, source]);
      const duplicate = seenCoverage.has(coverageKey);
      seenCoverage.add(coverageKey);
      const kind =
        source === 'policies'
          ? 'policy'
          : source === 'identity_alias'
            ? 'alias'
            : undefined;
      const inconsistent =
        status === 'complete' &&
        (coverage.discovered !== coverage.scanned ||
          (kind !== undefined &&
            coverage.scanned !==
              (resourceCounts.get(JSON.stringify([namespace, kind])) ?? 0)));
      const complete = status === 'complete' && !duplicate && !inconsistent;
      if (source === 'policies')
        snapshot.namespacePolicyCompleteness![namespace] =
          complete &&
          snapshot.namespacePolicyCompleteness![namespace] !== false;
      if (source === 'identity_alias')
        snapshot.namespaceAliasCompleteness![namespace] =
          complete && snapshot.namespaceAliasCompleteness![namespace] !== false;
      if (duplicate || inconsistent)
        snapshot.issues.push({
          namespace,
          path: `import/coverage/${source}`,
          reason: duplicate
            ? 'Duplicate Python coverage records cannot establish completeness'
            : 'Python complete coverage counts disagree with collected records',
        });
      if (status !== 'complete')
        snapshot.issues.push({
          namespace,
          path: `import/coverage/${source}`,
          reason: `Python coverage ${status}: ${coverage.details ?? ''}`,
        });
    }
    for (const warning of rows('warnings'))
      snapshot.issues.push({
        path: 'import/warning',
        reason: text(warning.message),
      });
    snapshot.policiesComplete =
      snapshot.namespaces!.length > 0 &&
      snapshot.namespaces!.every(
        (namespace) =>
          snapshot.namespacePolicyCompleteness![namespace] === true,
      );
    snapshot.namespaces!.sort();
    return snapshot;
  } finally {
    db.close();
  }
}
