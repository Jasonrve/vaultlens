import { prepareResume } from './resume.js';
import {
  RESOURCE_STAGE,
  SOURCE_STAGES,
  COLLECTION_SOURCES,
  stageKey,
} from './collectionStages.js';
import { normalizeNamespace } from './namespaces.js';
import { sanitizeAlias } from './identity.js';
import { globMatch } from './authDetectors.js';
import { forEachConcurrent } from './concurrency.js';
import {
  createRequestPolicy,
  parseCollectionOptions,
  type CollectionOptions,
} from './requestPolicy.js';
import { createHash, X509Certificate } from 'node:crypto';
import { VaultClient, VaultError } from '../lib/vaultClient.js';
import type { AuditSnapshot } from '../../shared/securityAudit.js';
export const COLLECTED_FIELDS = [
  'bound_cidrs',
  'num_uses',
  'local_secret_ids',
  'user_claim',
  'groups_claim',
  'alias_name_source',
  'allowed_entity_aliases',
  'name',
  'id',
  'parent_group_ids',
  'type',
  'policies',
  'token_policies',
  'allowed_policies',
  'allowed_policies_glob',
  'disallowed_policies',
  'disallowed_policies_glob',
  'orphan',
  'renewable',
  'path_suffix',
  'token_type',
  'bind_secret_id',
  'secret_id_bound_cidrs',
  'token_bound_cidrs',
  'bound_service_account_names',
  'bound_service_account_namespaces',
  'group_ids',
  'member_entity_ids',
  'member_group_ids',
  'disabled',
  'role_type',
  'bound_audiences',
  'bound_subject',
  'bound_claims',
  'bound_claims_type',
  'ttl',
  'max_ttl',
  'period',
  'token_no_default_policy',
  'token_ttl',
  'token_max_ttl',
  'token_explicit_max_ttl',
  'explicit_max_ttl',
  'token_period',
  'token_num_uses',
  'secret_id_ttl',
  'secret_id_num_uses',
  'bound_service_account_namespace_selector',
];
export async function collect(
  target: string,
  token: string,
  skipTlsVerify = false,
  requestOptions: Partial<CollectionOptions> = {},
  onProgress?: (
    progress: import('../../shared/securityAudit.js').AuditProgress,
  ) => void,
  onCheckpoint?: (snapshot: AuditSnapshot) => void,
  resume?: { snapshot: AuditSnapshot; maxAgeMs: number },
): Promise<AuditSnapshot> {
  const policyOptions = parseCollectionOptions(requestOptions);
  const previous = resume
    ? prepareResume(resume.snapshot, target, resume.maxAgeMs)
    : undefined;
  if (
    previous &&
    JSON.stringify(previous.options) !== JSON.stringify(policyOptions)
  )
    throw new Error('Checkpoint collection options differ');
  const { workers, timeoutMs, maxDurationMs } = policyOptions;
  const selectedStages = new Set(
    policyOptions.sources.flatMap((source) => SOURCE_STAGES[source]),
  );
  const matches = (value: string, patterns: string[]) =>
    !patterns.length || patterns.some((pattern) => globMatch(pattern, value));
  const limitAbort = new AbortController();
  const signal = AbortSignal.any([
    AbortSignal.timeout(maxDurationMs),
    limitAbort.signal,
  ]);
  const policy = createRequestPolicy(policyOptions, undefined, signal);
  let namespace = policyOptions.namespace;
  let client = new VaultClient(target, skipTlsVerify, {
    timeoutMs,
    signal,
    namespace: policyOptions.namespace,
  });
  const snapshot: AuditSnapshot = {
    version: 1,
    analysisPerformed: false,
    namespaces: [policyOptions.namespace],
    target,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    resources: [],
    issues: [],
    policiesComplete: false,
    collection: {
      workers,
      requestPolicy: policyOptions,
      metrics: policy.metrics,
      scope: {
        policyFilters: policyOptions.policyFilters,
        authMountFilters: policyOptions.authMountFilters,
        authTypeFilters: policyOptions.authTypeFilters,
        skipIdentity: policyOptions.skipIdentity,
      },
    },
  };
  const completedNamespaces: string[] = [];
  const completedStages: { namespace: string; stage: string }[] = [];
  const checkpoint = () =>
    onCheckpoint?.({
      ...snapshot,
      finishedAt: '',
      analysisPerformed: false,
      policiesComplete: false,
      checkpoint: {
        savedAt: new Date().toISOString(),
        completedNamespaces: [...completedNamespaces],
        completedStages: structuredClone(completedStages),
      },
    });
  let phase = 'Starting';
  const report = () =>
    onProgress?.({
      namespace,
      phase,
      resources: snapshot.resources.length,
      requests: policy.metrics.requests,
      updatedAt: new Date().toISOString(),
    });
  const stage = (value: string) => {
    phase = value;
    report();
    if (value !== 'Namespace discovery' && value !== 'Collection finished')
      checkpoint();
  };
  let aliasesComplete = false;
  let countedObjects = 0;
  function addResource(
    resource: import('../../shared/securityAudit.js').AuditResource,
  ) {
    if (signal.aborted) return;
    const counted = !['auth-mount', 'secret-mount'].includes(resource.kind);
    if (
      counted &&
      policyOptions.maxObjects &&
      countedObjects >= policyOptions.maxObjects
    ) {
      snapshot.policiesComplete = false;
      snapshot.issues.push({
        path: 'collection/object-limit',
        reason: 'Object limit reached; snapshot is incomplete',
      });
      limitAbort.abort();
      return;
    }
    if (counted) countedObjects++;
    snapshot.resources.push({
      ...resource,
      observedAt: new Date().toISOString(),
      ...(namespace ? { namespace } : {}),
    });
    report();
  }
  async function read(
    path: string,
    list = false,
  ): Promise<Record<string, unknown> | null> {
    try {
      const response = await policy.request(() =>
        list
          ? client.list<{ data: Record<string, unknown> }>(path, token)
          : client.get<{ data: Record<string, unknown> }>(path, token),
      );
      const data = response?.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        snapshot.issues.push({
          path,
          reason: 'Vault response is missing an object data field',
        });
        return null;
      }
      if (
        list &&
        (!Array.isArray(data.keys) ||
          data.keys.some((key) => typeof key !== 'string' || !key))
      ) {
        snapshot.issues.push({
          path,
          reason: 'Vault LIST response contains an invalid keys field',
        });
        return null;
      }
      return data;
    } catch (error) {
      if (signal.aborted) {
        if (
          !limitAbort.signal.aborted &&
          !snapshot.issues.some((issue) => issue.path === 'collection/deadline')
        )
          snapshot.issues.push({
            path: 'collection/deadline',
            reason: 'Collection duration limit reached; snapshot is incomplete',
          });
        snapshot.policiesComplete = false;
        return null;
      }
      // Vault LIST returns 404 for empty collections. Other failures remain explicit.
      if (list && error instanceof VaultError && error.statusCode === 404)
        return { keys: [] };
      snapshot.issues.push({
        path,
        reason:
          error instanceof VaultError
            ? `Vault HTTP ${error.statusCode}`
            : 'Request failed',
      });
      return null;
    }
  }
  const keys = (data: Record<string, unknown> | null): string[] =>
    Array.isArray(data?.keys)
      ? data.keys.filter((x): x is string => typeof x === 'string')
      : [];
  const select = (data: Record<string, unknown>) =>
    Object.fromEntries(
      COLLECTED_FIELDS.filter((k) => k in data).map((k) => [k, data[k]]),
    );
  async function runStage(name: string, operation: () => Promise<void>) {
    if (!selectedStages.has(name)) return;
    stage(name);
    if (
      completedStages.some(
        (value) => value.namespace === namespace && value.stage === name,
      )
    )
      return;
    const issueStart = snapshot.issues.length;
    await operation();
    for (const issue of snapshot.issues.slice(issueStart))
      if (namespace) issue.namespace = namespace;
    if (name === 'Policies')
      snapshot.namespacePolicyCompleteness![namespace] =
        snapshot.policiesComplete && !signal.aborted;
    if (name === 'Identity aliases')
      snapshot.namespaceAliasCompleteness![namespace] =
        aliasesComplete && !signal.aborted;
    if (!signal.aborted && snapshot.issues.length === issueStart)
      completedStages.push({ namespace, stage: name });
    snapshot.collection!.stageResults ??= [];
    snapshot.collection!.stageResults.push({
      namespace,
      stage: name,
      complete: !signal.aborted && snapshot.issues.length === issueStart,
      finishedAt: new Date().toISOString(),
    });
    checkpoint();
  }
  async function collectNamespace() {
    snapshot.policiesComplete =
      snapshot.namespacePolicyCompleteness?.[namespace] ?? false;
    aliasesComplete = snapshot.namespaceAliasCompleteness?.[namespace] ?? false;
    // Discovery stages are ordered; independent reads share one rate limiter.
    await runStage('Policies', async () => {
      const policyList = await read('sys/policies/acl', true);
      snapshot.policiesComplete =
        policyList !== null && !policyOptions.policyFilters.length;
      await forEachConcurrent(
        keys(policyList).filter(
          (name) =>
            name !== 'root' && matches(name, policyOptions.policyFilters),
        ),
        workers,
        async (name) => {
          const path = `sys/policies/acl/${encodeURIComponent(name)}`;
          const data = await read(path);
          if (data && typeof (data.policy ?? data.rules) !== 'string') {
            snapshot.issues.push({
              path,
              reason: 'Policy response is missing its ACL source',
            });
            snapshot.policiesComplete = false;
          } else if (data)
            addResource({
              kind: 'policy',
              path,
              data: { name, hcl: data.policy ?? data.rules ?? '' },
            });
          else snapshot.policiesComplete = false;
        },
      );
    });
    if (!policyOptions.skipIdentity) {
      for (const kind of ['entity', 'group']) {
        await runStage(
          kind === 'entity' ? 'Identity entities' : 'Identity groups',
          async () => {
            const base = `identity/${kind}/id`;
            await forEachConcurrent(
              keys(await read(base, true)),
              workers,
              async (id) => {
                const path = `${base}/${encodeURIComponent(id)}`;
                const data = await read(path);
                if (data) {
                  const selected = select(data);
                  if (kind === 'entity' && Array.isArray(data.aliases))
                    selected.aliases = data.aliases.map((alias) =>
                      alias &&
                      typeof alias === 'object' &&
                      !Array.isArray(alias)
                        ? sanitizeAlias(alias as Record<string, unknown>)
                        : null,
                    );
                  addResource({ kind, path, data: selected });
                }
              },
            );
          },
        );
      }
      await runStage('Identity aliases', async () => {
        const aliasBase = 'identity/entity-alias/id';
        const aliasList = await read(aliasBase, true);
        aliasesComplete = aliasList !== null;
        await forEachConcurrent(keys(aliasList), workers, async (id) => {
          const path = `${aliasBase}/${encodeURIComponent(id)}`;
          const data = await read(path);
          if (data)
            addResource({ kind: 'alias', path, data: sanitizeAlias(data) });
          else aliasesComplete = false;
        });
      });
    } else
      snapshot.issues.push({
        path: 'identity',
        reason: 'Identity collection was explicitly skipped',
      });
    await runStage('Secret mounts', async () => {
      const secretMounts = await read('sys/mounts');
      for (const [mount, value] of Object.entries(secretMounts ?? {})) {
        addResource({
          kind: 'secret-mount',
          path: `sys/mounts/${mount}`,
          data: {
            mount_path: mount,
            type: (value as Record<string, unknown>).type,
            audit_config_collected: ['pki', 'transit'].includes(
              String((value as Record<string, unknown>).type),
            ),
            options: {
              version: (
                (value as Record<string, unknown>).options as
                  | Record<string, unknown>
                  | undefined
              )?.version,
            },
          },
        });
        const type = (value as Record<string, unknown>).type;
        if (type === 'pki') {
          for (const name of keys(await read(mount + 'roles', true))) {
            const path = mount + 'roles/' + encodeURIComponent(name),
              data = await read(path);
            if (data)
              addResource({
                kind: 'pki-role',
                path,
                data: Object.fromEntries(
                  [
                    'allow_any_name',
                    'allowed_domains',
                    'allow_glob_domains',
                    'allow_subdomains',
                    'max_ttl',
                    'ttl',
                    'no_store',
                    'key_type',
                    'key_bits',
                  ]
                    .filter((k) => data[k] !== undefined)
                    .map((k) => [k, data[k]]),
                ),
              });
          }
          for (const name of keys(await read(mount + 'issuers', true))) {
            const path = mount + 'issuer/' + encodeURIComponent(name),
              data = await read(path);
            if (data && typeof data.certificate === 'string') {
              try {
                const cert = new X509Certificate(data.certificate);
                addResource({
                  kind: 'pki-issuer',
                  path,
                  data: {
                    issuer_name: data.issuer_name,
                    not_after: Date.parse(cert.validTo),
                  },
                });
              } catch {
                snapshot.issues.push({
                  path,
                  reason: 'Issuer certificate could not be parsed',
                });
              }
            } else if (data)
              snapshot.issues.push({
                path,
                reason: 'Issuer response is missing a certificate',
              });
          }
        }
        if (type === 'transit')
          for (const name of keys(await read(mount + 'keys', true))) {
            const path = mount + 'keys/' + encodeURIComponent(name),
              data = await read(path);
            if (data) {
              const selected = Object.fromEntries(
                [
                  'type',
                  'exportable',
                  'allow_plaintext_backup',
                  'deletion_allowed',
                  'auto_rotate_period',
                  'latest_version',
                  'min_decryption_version',
                  'min_encryption_version',
                ]
                  .filter((k) => data[k] !== undefined)
                  .map((k) => [k, data[k]]),
              );
              const versions = data.keys as Record<string, unknown> | undefined;
              const latest = versions?.[String(data.latest_version)];
              const created = transitVersionCreatedAt(latest);
              if (created !== undefined)
                selected.latest_version_created_at = created;
              else
                snapshot.issues.push({
                  path,
                  reason:
                    'Latest key version creation time is unavailable; rotation age cannot be evaluated',
                });
              addResource({ kind: 'transit-key', path, data: selected });
            }
          }
      }
    });
    await runStage('Auth mounts and roles', async () => {
      const auth = await read('sys/auth');
      const supported: Record<string, string> = {
        approle: 'role',
        kubernetes: 'role',
        jwt: 'role',
        oidc: 'role',
        token: 'roles',
        aws: 'role',
        azure: 'role',
        alicloud: 'role',
        oci: 'role',
        gcp: 'roles',
      };
      for (const [mount, value] of Object.entries(auth ?? {})) {
        const type = String((value as Record<string, unknown>)?.type ?? '');
        addResource({
          kind: 'auth-mount',
          path: `auth/${mount}`,
          data: { type, accessor: (value as Record<string, unknown>).accessor },
        });
        if (
          !matches(mount.replace(/\/$/, ''), policyOptions.authMountFilters) ||
          !matches(type, policyOptions.authTypeFilters)
        )
          continue;
        if (!supported[type]) {
          snapshot.issues.push({
            path: `auth/${mount}`,
            reason: `Auth type ${type} is not collected by v1`,
          });
          continue;
        }
        const base = `auth/${mount}${supported[type]}`;
        await forEachConcurrent(
          keys(await read(base, true)),
          workers,
          async (name) => {
            const path = `${base}/${encodeURIComponent(name)}`;
            const data = await read(path);
            if (data) {
              const selected = select(data);
              if (type === 'approle') {
                const roleId = await read(`${path}/role-id`);
                if (typeof roleId?.role_id === 'string')
                  selected.role_id_sha256 = createHash('sha256')
                    .update(roleId.role_id)
                    .digest('hex');
                else if (roleId)
                  snapshot.issues.push({
                    path: `${path}/role-id`,
                    reason: 'RoleID response is missing role_id',
                  });
              }
              addResource({
                kind: 'role',
                path,
                data: { ...selected, auth_type: type },
              });
            }
          },
        );
      }
    });
  }
  function selectNamespace(value: string) {
    namespace = value;
    client = new VaultClient(target, skipTlsVerify, {
      timeoutMs,
      signal,
      namespace,
    });
  }
  const discovered = [policyOptions.namespace];
  if (policyOptions.recursiveNamespaces) {
    for (let index = 0; index < discovered.length && !signal.aborted; index++) {
      selectNamespace(discovered[index]);
      stage('Namespace discovery');
      const issueStart = snapshot.issues.length;
      const children = keys(await read('sys/namespaces', true));
      for (const rawChild of children) {
        const child = rawChild.replace(/\/$/, '');
        if (!child || child.includes('/') || child === '.' || child === '..') {
          snapshot.issues.push({
            path: 'sys/namespaces',
            reason: 'Invalid child namespace path',
          });
          continue;
        }
        let full: string;
        try {
          full = normalizeNamespace(
            [namespace, child].filter(Boolean).join('/'),
          );
        } catch {
          snapshot.issues.push({
            path: 'sys/namespaces',
            reason: 'Invalid child namespace path',
          });
          continue;
        }
        if (discovered.includes(full)) continue;
        if (discovered.length >= 10000) {
          snapshot.issues.push({
            path: 'sys/namespaces',
            reason: 'Namespace discovery limit reached',
          });
          break;
        }
        discovered.push(full);
      }
      for (const issue of snapshot.issues.slice(issueStart))
        if (namespace) issue.namespace = namespace;
    }
  }
  const selected = discovered.filter((value) =>
    matches(value || 'root', policyOptions.namespaceFilters),
  );
  if (!selected.length)
    snapshot.issues.push({
      path: 'collection/namespaces',
      reason: 'Namespace filters selected no discovered namespaces',
    });
  snapshot.namespaces = selected;
  if (policyOptions.sources.length < COLLECTION_SOURCES.length)
    snapshot.issues.push({
      path: 'collection/source-scope',
      reason: 'Only selected collection sources were refreshed or collected',
    });
  snapshot.namespacePolicyCompleteness = Object.fromEntries(
    selected.map((value) => [value, false]),
  );
  snapshot.namespaceAliasCompleteness = Object.fromEntries(
    selected.map((value) => [value, false]),
  );
  if (resume && previous) {
    snapshot.startedAt = resume.snapshot.startedAt;
    for (const current of selected) {
      const reusableKinds = Object.keys(RESOURCE_STAGE).filter((kind) =>
        previous.reusableStages.has(stageKey(current, RESOURCE_STAGE[kind])),
      );
      snapshot.resources.push(
        ...structuredClone(
          resume.snapshot.resources.filter(
            (resource) =>
              (resource.namespace ?? '') === current &&
              reusableKinds.includes(resource.kind),
          ),
        ),
      );
      snapshot.namespacePolicyCompleteness[current] =
        reusableKinds.includes('policy') &&
        (resume.snapshot.namespacePolicyCompleteness?.[current] ?? false);
      snapshot.namespaceAliasCompleteness[current] =
        reusableKinds.includes('alias') &&
        (resume.snapshot.namespaceAliasCompleteness?.[current] ?? false);
      for (const name of new Set(
        reusableKinds.map((kind) => RESOURCE_STAGE[kind]),
      ))
        completedStages.push({ namespace: current, stage: name });
      if (previous.reusable.has(current)) completedNamespaces.push(current);
    }
    countedObjects = snapshot.resources.filter(
      (resource) => !['auth-mount', 'secret-mount'].includes(resource.kind),
    ).length;
    for (const metric of [
      'requests',
      'retries',
      'rateWaitMs',
      'retryWaitMs',
    ] as const)
      policy.metrics[metric] += resume.snapshot.collection!.metrics[metric];
  }
  for (const current of selected) {
    if (completedNamespaces.includes(current)) continue;
    if (signal.aborted) break;
    selectNamespace(current);
    const issueStart = snapshot.issues.length;
    await collectNamespace();
    snapshot.namespacePolicyCompleteness[current] =
      snapshot.policiesComplete && !signal.aborted;
    snapshot.namespaceAliasCompleteness[current] =
      aliasesComplete && !signal.aborted;
    for (const issue of snapshot.issues.slice(issueStart))
      if (current) issue.namespace = current;
    if (!signal.aborted) completedNamespaces.push(current);
    checkpoint();
  }
  snapshot.policiesComplete =
    selected.length > 0 &&
    selected.every((value) => snapshot.namespacePolicyCompleteness![value]);
  snapshot.resources.sort(
    (a, b) =>
      (a.namespace ?? '').localeCompare(b.namespace ?? '') ||
      a.path.localeCompare(b.path) ||
      a.kind.localeCompare(b.kind),
  );
  snapshot.issues.sort(
    (a, b) => a.path.localeCompare(b.path) || a.reason.localeCompare(b.reason),
  );
  snapshot.finishedAt = new Date().toISOString();
  stage('Collection finished');
  return snapshot;
}

/** Normalize symmetric Unix timestamps and asymmetric RFC3339 metadata to seconds. */
export function transitVersionCreatedAt(latest: unknown): number | undefined {
  const value = latest && typeof latest === 'object'
    ? (latest as Record<string, unknown>).creation_time
    : latest;
  if (typeof value === 'number')
    return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? milliseconds / 1000 : undefined;
}
