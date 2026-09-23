import axios, { AxiosError } from 'axios';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { config } from '../config/index.js';
import { getEksToken, resolveEksCluster } from './eksAuth.js';

const VSO_GROUP = 'secrets.hashicorp.com';
const VSO_VERSION = 'v1beta1';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_VSO_NAMESPACE = 'vault-secrets-operator-system';

export interface VsoResourceDefinition {
  kind: string;
  resource: string;
  clusterScoped: boolean;
}

interface KubernetesApiResourceList {
  resources?: Array<{ name?: unknown; kind?: unknown; namespaced?: unknown }>;
}

export const VSO_RESOURCES: readonly VsoResourceDefinition[] = [
  { kind: 'VaultConnection', resource: 'vaultconnections', clusterScoped: false },
  { kind: 'VaultAuth', resource: 'vaultauths', clusterScoped: false },
  { kind: 'VaultAuthGlobal', resource: 'vaultauthglobals', clusterScoped: true },
  { kind: 'VaultStaticSecret', resource: 'vaultstaticsecrets', clusterScoped: false },
  { kind: 'VaultDynamicSecret', resource: 'vaultdynamicsecrets', clusterScoped: false },
  { kind: 'VaultPKISecret', resource: 'vaultpkisecrets', clusterScoped: false },
  { kind: 'SecretTransformation', resource: 'secrettransformations', clusterScoped: false },
  { kind: 'CSISecrets', resource: 'csisecrets', clusterScoped: false },
];

export type VsoHealth = 'healthy' | 'warning' | 'error' | 'unknown';

export interface VsoCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface VsoIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface VsoResourceRow {
  kind: string;
  resource: string;
  namespace?: string;
  name: string;
  createdAt?: string;
  status?: string;
  health: VsoHealth;
  conditions?: VsoCondition[];
  // Relational fields — only the ones relevant to a given kind are populated.
  vaultAuthRef?: { name: string; namespace?: string };
  vaultConnectionRef?: { name: string; namespace?: string };
  authMount?: string;        // VaultAuth.spec.mount — the Vault auth mount this identity authenticates against
  role?: string;             // VaultAuth.spec.kubernetes.role
  serviceAccount?: string;   // VaultAuth.spec.kubernetes.serviceAccount
  secretMount?: string;      // secret kinds' spec.mount — the Vault secrets-engine mount
  path?: string;             // secret kinds' spec.path (static) or spec.role (dynamic)
  destinationSecret?: { name: string; namespace?: string; create?: boolean };
  issues?: VsoIssue[];
}

export interface VsoOperatorPod {
  name: string;
  namespace: string;
  startedAt?: string;
}

export interface KubernetesIdentityDiagnostics {
  source: 'eks-explicit-override' | 'eks-auto-detected' | 'eks-auto-detect-failed' | 'static-token' | 'local-serviceaccount';
  eksCluster?: string;
  eksRegion?: string;
  detail?: string;
}

export interface KubernetesRequestDiagnostics {
  method: 'GET';
  host: string;
  path: string;
  tls?: {
    verification: 'enabled' | 'disabled';
    caCertificate: 'configured' | 'not-configured';
    caSource?: 'local-file' | 'auth-mount-config';
    caPath?: string;
  };
  identity?: KubernetesIdentityDiagnostics;
  status?: number;
  errorCode?: string;
  errorMessage?: string;
}

export class KubernetesError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly reason: 'access_denied' | 'not_installed' | 'unavailable' | 'invalid' = 'unavailable',
    public diagnostics?: KubernetesRequestDiagnostics,
  ) {
    super(message);
    this.name = 'KubernetesError';
  }
}

async function discoverVsoResources(mount: string, host: string, fallbackCaCertPem?: string): Promise<VsoResourceDefinition[]> {
  const data = await requestKubernetes<KubernetesApiResourceList>(mount, host, `/apis/${VSO_GROUP}/${VSO_VERSION}`, fallbackCaCertPem);
  return (data.resources ?? [])
    .filter((resource) => typeof resource.name === 'string' && !resource.name.includes('/') && typeof resource.kind === 'string')
    .map((resource) => ({
      kind: resource.kind as string,
      resource: resource.name as string,
      clusterScoped: resource.namespaced !== true,
    }));
}

function validSegment(value: string): boolean {
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(value) && !value.includes('..');
}

/** Per-mount env var names to check for a given suffix, e.g. '' or '_EKS_CLUSTER'. */
export function envNamesForMount(mount: string, suffix: string): string[] {
  const normalized = mount.replace(/\/$/, '').replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
  return [
    `K8S_ACCESS_${normalized}${suffix}`,
    ...(normalized.startsWith('KUBERNETES_')
      ? [`K8S_ACCESS_${normalized.slice('KUBERNETES_'.length)}${suffix}`]
      : []),
  ];
}

function firstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

async function tokenForMount(mount: string, kubernetesHost: string): Promise<{ token: string; identity: KubernetesIdentityDiagnostics }> {
  // Explicit per-mount override: use the pod's own IAM role (IRSA or EKS Pod Identity)
  // to sign an EKS bearer token for a specific cluster/region, instead of a static
  // Kubernetes ServiceAccount token. Needed only when the mount's host isn't a
  // standard AWS-generated EKS endpoint (see resolveEksCluster below).
  const eksCluster = firstEnv(envNamesForMount(mount, '_EKS_CLUSTER'));
  if (eksCluster) {
    const region = firstEnv(envNamesForMount(mount, '_EKS_REGION'))
      || process.env['AWS_REGION']
      || process.env['AWS_DEFAULT_REGION'];
    if (!region) {
      throw new KubernetesError(
        'EKS IAM auth requires an AWS region — set AWS_REGION or K8S_ACCESS_<MOUNT>_EKS_REGION',
        503,
      );
    }
    try {
      const token = await getEksToken(eksCluster, region);
      return { token, identity: { source: 'eks-explicit-override', eksCluster, eksRegion: region } };
    } catch (e) {
      throw new KubernetesError(
        `Failed to sign an EKS token using the pod's IAM role: ${e instanceof Error ? e.message : 'unknown error'}`,
        503,
      );
    }
  }

  // Default: recognize a standard EKS endpoint from the mount's own configured
  // host and sign a token for it with the pod's IAM role — no per-mount config.
  const autoDetected = await resolveEksCluster(kubernetesHost);
  if (autoDetected.attempted && autoDetected.matched) {
    try {
      const token = await getEksToken(autoDetected.cluster, autoDetected.region);
      return { token, identity: { source: 'eks-auto-detected', eksCluster: autoDetected.cluster, eksRegion: autoDetected.region } };
    } catch (e) {
      throw new KubernetesError(
        `Failed to sign an EKS token using the pod's IAM role: ${e instanceof Error ? e.message : 'unknown error'}`,
        503,
      );
    }
  }
  // Auto-detection was attempted (the host matched a standard EKS endpoint) but
  // found no cluster the pod's IAM role could see — falling through to a static
  // token or the local ServiceAccount token below almost certainly sends the
  // wrong cluster's identity, so this failure needs to reach the caller.
  const autoDetectFailure: KubernetesIdentityDiagnostics | undefined = autoDetected.attempted
    ? {
      source: 'eks-auto-detect-failed',
      eksRegion: autoDetected.region,
      detail: autoDetected.error
        ? `Could not list/describe EKS clusters in ${autoDetected.region}: ${autoDetected.error}`
        : `No EKS cluster in ${autoDetected.region} visible to the pod's IAM role matches this endpoint — check that role has eks:ListClusters/DescribeCluster and an access entry on the target cluster.`,
    }
    : undefined;

  const token = firstEnv(envNamesForMount(mount, ''));
  if (token) return { token, identity: autoDetectFailure ?? { source: 'static-token' } };

  try {
    const saToken = fs.readFileSync(config.vaultK8sTokenPath, 'utf8').trim();
    return { token: saToken, identity: autoDetectFailure ?? { source: 'local-serviceaccount' } };
  } catch {
    throw new KubernetesError('No downstream Kubernetes access token is configured', 503);
  }
}

// Falls back to the CA cert already configured on the Vault auth mount (`kubernetes_ca_cert`)
// when no local override is set — that cert is the trust the admin already established for
// this cluster, so a request with no local CA config shouldn't need a second copy of it.
function caForCluster(fallbackCaCertPem?: string): { certificate?: Buffer; path: string; source?: 'local-file' | 'auth-mount-config' } {
  const caPath = process.env['K8S_CA_CERT_PATH'] || path.join(path.dirname(config.vaultK8sTokenPath), 'ca.crt');
  try {
    return { certificate: fs.readFileSync(caPath), path: caPath, source: 'local-file' };
  } catch {
    if (fallbackCaCertPem) {
      return { certificate: Buffer.from(fallbackCaCertPem), path: caPath, source: 'auth-mount-config' };
    }
    return { path: caPath };
  }
}

function extractConditions(item: Record<string, unknown>): VsoCondition[] {
  const status = item['status'];
  if (!status || typeof status !== 'object') return [];
  const conditions = (status as Record<string, unknown>)['conditions'];
  if (!Array.isArray(conditions)) return [];
  return conditions
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      type: typeof c['type'] === 'string' ? c['type'] : '',
      status: typeof c['status'] === 'string' ? c['status'] : '',
      reason: typeof c['reason'] === 'string' ? c['reason'] : undefined,
      message: typeof c['message'] === 'string' ? c['message'] : undefined,
      lastTransitionTime: typeof c['lastTransitionTime'] === 'string' ? c['lastTransitionTime'] : undefined,
    }));
}

function readyCondition(conditions: VsoCondition[]): VsoCondition | undefined {
  return conditions.find((c) => c.type === 'Ready' || c.type === 'Synced');
}

function statusText(conditions: VsoCondition[]): string | undefined {
  const ready = readyCondition(conditions);
  return ready ? `${ready.type}: ${ready.status}` : undefined;
}

function computeHealth(conditions: VsoCondition[], issues: VsoIssue[]): VsoHealth {
  if (issues.some((issue) => issue.severity === 'error')) return 'error';
  const ready = readyCondition(conditions);
  if (ready?.status === 'False') return 'error';
  if (issues.some((issue) => issue.severity === 'warning')) return 'warning';
  if (ready?.status === 'Unknown') return 'warning';
  if (ready?.status === 'True') return 'healthy';
  return 'unknown';
}

function stringField(obj: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = obj?.[key];
  return typeof value === 'string' ? value : undefined;
}

type RelationFields = Pick<VsoResourceRow,
  'vaultAuthRef' | 'vaultConnectionRef' | 'authMount' | 'role' | 'serviceAccount' | 'secretMount' | 'path' | 'destinationSecret'>;

/** Pulls the relational fields this redesign cares about out of each VSO kind's `spec` — every kind has a different shape. */
function extractRelations(item: Record<string, unknown>, definition: VsoResourceDefinition, namespace: string | undefined): RelationFields {
  const spec = item['spec'];
  if (!spec || typeof spec !== 'object') return {};
  const s = spec as Record<string, unknown>;

  if (definition.kind === 'VaultAuth' || definition.kind === 'VaultAuthGlobal') {
    const kubernetesField = s['kubernetes'];
    const k8s = kubernetesField && typeof kubernetesField === 'object' ? kubernetesField as Record<string, unknown> : undefined;
    const connectionRefName = stringField(s, 'vaultConnectionRef');
    return {
      authMount: stringField(s, 'mount'),
      role: stringField(k8s, 'role'),
      serviceAccount: stringField(k8s, 'serviceAccount'),
      vaultConnectionRef: connectionRefName ? { name: connectionRefName, namespace } : undefined,
    };
  }

  if (definition.kind === 'VaultConnection') return {};

  // VaultStaticSecret, VaultDynamicSecret, VaultPKISecret, SecretTransformation, CSISecrets
  const authRefName = stringField(s, 'vaultAuthRef');
  const destinationField = s['destination'];
  const destination = destinationField && typeof destinationField === 'object' ? destinationField as Record<string, unknown> : undefined;
  const destinationName = stringField(destination, 'name');
  return {
    vaultAuthRef: authRefName ? { name: authRefName, namespace } : undefined,
    secretMount: stringField(s, 'mount'),
    path: stringField(s, 'path') ?? stringField(s, 'role'),
    destinationSecret: destinationName ? { name: destinationName, namespace, create: destination?.['create'] === true } : undefined,
  };
}

function rowFromItem(item: Record<string, unknown>, definition: VsoResourceDefinition): VsoResourceRow | null {
  const metadata = item['metadata'];
  if (!metadata || typeof metadata !== 'object') return null;
  const values = metadata as Record<string, unknown>;
  const name = typeof values['name'] === 'string' ? values['name'] : '';
  if (!name) return null;
  const namespace = typeof values['namespace'] === 'string' ? values['namespace'] : undefined;
  const conditions = extractConditions(item);
  return {
    kind: definition.kind,
    resource: definition.resource,
    namespace,
    name,
    createdAt: typeof values['creationTimestamp'] === 'string' ? values['creationTimestamp'] : undefined,
    status: statusText(conditions),
    health: computeHealth(conditions, []),
    conditions: conditions.length > 0 ? conditions : undefined,
    ...extractRelations(item, definition, namespace),
  };
}

function yamlScalar(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return value === '' || /[:[{\]#,&*!|>'"%@`]/.test(value) || /^[-?]\s/.test(value)
      ? JSON.stringify(value)
      : value;
  }
  return JSON.stringify(value);
}

function toYaml(value: unknown, indent = 0): string {
  const spaces = ' '.repeat(indent);
  if (value === null || typeof value !== 'object') return `${spaces}${yamlScalar(value)}`;
  if (Array.isArray(value)) {
    return value.length === 0
      ? `${spaces}[]`
      : value.map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const entries = Object.entries(item as Record<string, unknown>);
          if (entries.length === 0) return `${spaces}- {}`;
          const [firstKey, firstValue] = entries[0];
          const itemIndent = indent + 2;
          const firstLine = firstValue && typeof firstValue === 'object'
            ? `${spaces}- ${firstKey}:\n${toYaml(firstValue, indent + 4)}`
            : `${spaces}- ${firstKey}: ${yamlScalar(firstValue)}`;
          const remaining = entries.slice(1).map(([key, child]) => child && typeof child === 'object'
            ? `${' '.repeat(itemIndent)}${key}:\n${toYaml(child, indent + 4)}`
            : `${' '.repeat(itemIndent)}${key}: ${yamlScalar(child)}`);
          return [firstLine, ...remaining].join('\n');
        }
        return `${spaces}- ${yamlScalar(item)}`;
      }).join('\n');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return `${spaces}{}`;
  return entries.map(([key, item]) => {
    if (item && typeof item === 'object') return `${spaces}${key}:\n${toYaml(item, indent + 2)}`;
    return `${spaces}${key}: ${yamlScalar(item)}`;
  }).join('\n');
}

function withManagedFields(value: Record<string, unknown>, includeManagedFields: boolean): Record<string, unknown> {
  if (includeManagedFields) return value;
  const metadata = value['metadata'];
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return value;
  const { managedFields: _managedFields, ...cleanMetadata } = metadata as Record<string, unknown>;
  return { ...value, metadata: cleanMetadata };
}

export function findVsoResource(kind: string, resource: string, definitions: VsoResourceDefinition[] = [...VSO_RESOURCES]): VsoResourceDefinition {
  const definition = definitions.find((item) => item.kind === kind);
  if (!definition) throw new KubernetesError('Unsupported VSO resource', 400, 'invalid');
  if (definition.resource !== resource) {
    throw new KubernetesError('Unsupported VSO resource', 400, 'invalid');
  }
  return definition;
}

/**
 * Best-effort existence check against the core Kubernetes API. A 403 means we
 * can't tell (missing RBAC beyond the VSO CRD read scope) and must not be
 * treated as "missing" — only a confirmed 404 counts as an actual issue.
 */
async function checkExists(mount: string, host: string, requestPath: string, fallbackCaCertPem?: string): Promise<'found' | 'missing' | 'unknown'> {
  try {
    await requestKubernetes<unknown>(mount, host, requestPath, fallbackCaCertPem);
    return 'found';
  } catch (error) {
    if (error instanceof KubernetesError && error.statusCode === 404) return 'missing';
    return 'unknown';
  }
}

function serviceAccountExists(mount: string, host: string, namespace: string, name: string, fallbackCaCertPem?: string) {
  return checkExists(mount, host, `/api/v1/namespaces/${encodeURIComponent(namespace)}/serviceaccounts/${encodeURIComponent(name)}`, fallbackCaCertPem);
}

/**
 * Adds best-effort relation issues (missing ServiceAccount/VaultAuth, a
 * Vault role that no longer exists) to each row and recomputes its health.
 * # ponytail: one Promise.all pass over the given rows — fine for the handful
 * of VSO objects a typical mount has; batch/cache if a cluster has hundreds.
 */
async function enrichRelations(
  rows: VsoResourceRow[],
  mount: string,
  host: string,
  vaultRoleNames: Set<string> | undefined,
  fallbackCaCertPem?: string,
): Promise<VsoResourceRow[]> {
  const authKeys = new Set(
    rows
      .filter((row) => row.kind === 'VaultAuth' || row.kind === 'VaultAuthGlobal')
      .map((row) => `${row.namespace ?? ''}/${row.name}`),
  );

  return Promise.all(rows.map(async (row) => {
    const issues: VsoIssue[] = [];

    if (row.kind === 'VaultAuth' || row.kind === 'VaultAuthGlobal') {
      if (vaultRoleNames && row.role && !vaultRoleNames.has(row.role)) {
        issues.push({ severity: 'error', message: `Vault role "${row.role}" was not found on auth mount "${row.authMount ?? mount}".` });
      }
      if (row.serviceAccount && row.namespace) {
        const exists = await serviceAccountExists(mount, host, row.namespace, row.serviceAccount, fallbackCaCertPem);
        if (exists === 'missing') {
          issues.push({ severity: 'error', message: `ServiceAccount "${row.namespace}/${row.serviceAccount}" does not exist in the cluster.` });
        }
      }
    } else if (row.vaultAuthRef) {
      const authKey = `${row.vaultAuthRef.namespace ?? row.namespace ?? ''}/${row.vaultAuthRef.name}`;
      if (!authKeys.has(authKey)) {
        issues.push({ severity: 'error', message: `Referenced VaultAuth "${row.vaultAuthRef.name}" was not found in namespace "${row.vaultAuthRef.namespace ?? row.namespace ?? ''}".` });
      }
    }

    if (issues.length === 0) return row;
    return { ...row, issues, health: computeHealth(row.conditions ?? [], issues) };
  }));
}

export async function listVsoResources(
  mount: string,
  host: string,
  options?: { role?: string; vaultRoleNames?: string[] },
  fallbackCaCertPem?: string,
): Promise<VsoResourceRow[]> {
  const rows: VsoResourceRow[] = [];
  const definitions = await discoverVsoResources(mount, host, fallbackCaCertPem);
  for (const definition of definitions) {
    const data = await requestKubernetes<Record<string, unknown>>(mount, host, buildListPath(definition), fallbackCaCertPem);
    const items = Array.isArray(data['items']) ? data['items'] : [];
    for (const item of items) {
      if (item && typeof item === 'object') {
        const row = rowFromItem(item as Record<string, unknown>, definition);
        if (row) rows.push(row);
      }
    }
  }

  const vaultRoleNames = options?.vaultRoleNames ? new Set(options.vaultRoleNames) : undefined;

  if (!options?.role) {
    return enrichRelations(rows, mount, host, vaultRoleNames, fallbackCaCertPem);
  }

  const matchedAuthKeys = new Set(
    rows
      .filter((row) => (row.kind === 'VaultAuth' || row.kind === 'VaultAuthGlobal') && row.authMount === mount && row.role === options.role)
      .map((row) => `${row.namespace ?? ''}/${row.name}`),
  );
  const filtered = rows.filter((row) => {
    if (row.kind === 'VaultAuth' || row.kind === 'VaultAuthGlobal') {
      return matchedAuthKeys.has(`${row.namespace ?? ''}/${row.name}`);
    }
    if (row.vaultAuthRef) {
      return matchedAuthKeys.has(`${row.vaultAuthRef.namespace ?? row.namespace ?? ''}/${row.vaultAuthRef.name}`);
    }
    return false;
  });
  return enrichRelations(filtered, mount, host, vaultRoleNames, fallbackCaCertPem);
}

export async function getVsoResource(
  mount: string,
  host: string,
  kind: string,
  resource: string,
  namespace: string | undefined,
  name: string,
  fallbackCaCertPem?: string,
): Promise<{ yaml: string; fullYaml: string; row: VsoResourceRow }> {
  if (!validSegment(name) || (namespace !== undefined && !validSegment(namespace))) {
    throw new KubernetesError('Invalid Kubernetes resource name', 400, 'invalid');
  }
  const definitions = await discoverVsoResources(mount, host, fallbackCaCertPem);
  const definition = findVsoResource(kind, resource, definitions);
  if (!definition.clusterScoped && !namespace) {
    throw new KubernetesError('Namespace is required for this VSO resource', 400, 'invalid');
  }
  const data = await requestKubernetes<Record<string, unknown>>(
    mount,
    host,
    buildObjectPath(definition, namespace, name),
    fallbackCaCertPem,
  );
  const row = rowFromItem(data, definition);
  if (!row) throw new KubernetesError('Kubernetes object has no valid metadata', 502);
  return { yaml: `${toYaml(withManagedFields(data, false))}\n`, fullYaml: `${toYaml(data)}\n`, row };
}

function buildListPath(definition: VsoResourceDefinition): string {
  return `/apis/${VSO_GROUP}/${VSO_VERSION}/${definition.resource}`;
}

function buildObjectPath(definition: VsoResourceDefinition, namespace: string | undefined, name: string): string {
  const base = `/apis/${VSO_GROUP}/${VSO_VERSION}`;
  return definition.clusterScoped
    ? `${base}/${definition.resource}/${encodeURIComponent(name)}`
    : `${base}/namespaces/${encodeURIComponent(namespace!)}/${definition.resource}/${encodeURIComponent(name)}`;
}

/** Per-mount override for where the VSO operator itself runs (its Helm chart's default namespace otherwise). */
function vsoNamespaceForMount(mount: string): string {
  return firstEnv(envNamesForMount(mount, '_VSO_NAMESPACE')) || DEFAULT_VSO_NAMESPACE;
}

export async function listOperatorPods(mount: string, host: string, namespaceOverride?: string, fallbackCaCertPem?: string): Promise<VsoOperatorPod[]> {
  const namespace = namespaceOverride || vsoNamespaceForMount(mount);
  const labelSelector = encodeURIComponent('app.kubernetes.io/name=vault-secrets-operator');
  const data = await requestKubernetes<Record<string, unknown>>(
    mount,
    host,
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?labelSelector=${labelSelector}`,
    fallbackCaCertPem,
  );
  const items = Array.isArray(data['items']) ? data['items'] : [];
  const pods: VsoOperatorPod[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const metadata = (item as Record<string, unknown>)['metadata'];
    const name = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>)['name'] : undefined;
    if (typeof name !== 'string') continue;
    const status = (item as Record<string, unknown>)['status'];
    const startTime = status && typeof status === 'object' ? (status as Record<string, unknown>)['startTime'] : undefined;
    pods.push({ name, namespace, startedAt: typeof startTime === 'string' ? startTime : undefined });
  }
  return pods;
}

export async function getPodLogs(
  mount: string,
  host: string,
  namespace: string,
  pod: string,
  options: { container?: string; tailLines?: number } = {},
  fallbackCaCertPem?: string,
): Promise<string> {
  if (!validSegment(namespace) || !validSegment(pod)) {
    throw new KubernetesError('Invalid Kubernetes resource name', 400, 'invalid');
  }
  const tailLines = Math.min(Math.max(options.tailLines ?? 500, 1), 2000);
  const params = new URLSearchParams({ tailLines: String(tailLines) });
  if (options.container) params.set('container', options.container);
  return requestKubernetesText(
    mount,
    host,
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/log?${params.toString()}`,
    fallbackCaCertPem,
  );
}

// The Kubernetes API returns a Status object with the actual reason (RBAC denial,
// not-found detail, etc.) in its body — axios's own error.message is just the
// generic "Request failed with status code NNN" and hides that.
function apiErrorMessage(data: unknown): string | undefined {
  if (typeof data === 'string') return data.slice(0, 4000);
  if (data && typeof data === 'object') {
    const message = (data as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    try { return JSON.stringify(data).slice(0, 4000); } catch { return undefined; }
  }
  return undefined;
}

async function kubernetesGet<T>(mount: string, host: string, requestPath: string, responseType: 'json' | 'text', fallbackCaCertPem?: string): Promise<T> {
  const diagnostics: KubernetesRequestDiagnostics = { method: 'GET', host, path: requestPath };
  let base: URL;
  try {
    base = new URL(host);
  } catch {
    diagnostics.errorMessage = 'The configured endpoint is not a valid URL';
    console.warn('[Kubernetes] Invalid downstream endpoint', diagnostics);
    throw new KubernetesError('Kubernetes endpoint is not configured correctly', 502, 'invalid', diagnostics);
  }
  if (!['http:', 'https:'].includes(base.protocol)) {
    diagnostics.errorMessage = `Unsupported protocol: ${base.protocol}`;
    console.warn('[Kubernetes] Unsupported downstream endpoint protocol', diagnostics);
    throw new KubernetesError('Kubernetes endpoint protocol is not supported', 502, 'invalid', diagnostics);
  }

  const ca = base.protocol === 'https:' ? caForCluster(fallbackCaCertPem) : undefined;
  diagnostics.tls = {
    verification: config.k8sSkipTlsVerify ? 'disabled' : 'enabled',
    caCertificate: ca?.certificate ? 'configured' : 'not-configured',
    ...(ca?.source ? { caSource: ca.source } : {}),
    ...(ca ? { caPath: ca.path } : {}),
  };
  console.info('[Kubernetes] Requesting downstream endpoint', {
    method: diagnostics.method,
    host: diagnostics.host,
    path: diagnostics.path,
    tls: diagnostics.tls,
  });

  try {
    const { token, identity } = await tokenForMount(mount, host);
    diagnostics.identity = identity;
    if (identity.source === 'eks-auto-detect-failed') {
      console.warn('[Kubernetes] EKS auto-detection failed — falling back to a token that likely belongs to the wrong cluster', { host, identity });
    }
    const response = await axios.get<T>(requestPath, {
      baseURL: base.origin,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
      responseType,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
      ...(base.protocol === 'https:' && (config.k8sSkipTlsVerify || ca?.certificate)
        ? { httpsAgent: new https.Agent(config.k8sSkipTlsVerify ? { rejectUnauthorized: false } : { ca: ca?.certificate }) }
        : {}),
    });
    console.info('[Kubernetes] Downstream request succeeded', {
      method: diagnostics.method,
      host: diagnostics.host,
      path: diagnostics.path,
      identity: diagnostics.identity,
      status: response.status,
    });
    return response.data;
  } catch (error) {
    // A specific error from tokenForMount (e.g. missing region, EKS signing failure)
    // should reach the caller as-is, not get flattened into the generic 502 below.
    if (error instanceof KubernetesError) {
      error.diagnostics = diagnostics;
      console.warn('[Kubernetes] Downstream request failed before HTTP response', diagnostics);
      throw error;
    }
    const axiosError = error instanceof AxiosError ? error : undefined;
    const status = axiosError?.response?.status;
    diagnostics.status = status;
    diagnostics.errorCode = axiosError?.code;
    diagnostics.errorMessage = apiErrorMessage(axiosError?.response?.data)
      ?? (error instanceof Error ? error.message : String(error));
    console.warn('[Kubernetes] Downstream request failed', diagnostics);
    if (status === 401 || status === 403) {
      throw new KubernetesError('The current workload identity cannot query the downstream Kubernetes cluster', status, 'access_denied', diagnostics);
    }
    if (status === 404) {
      throw new KubernetesError('Vault Secrets Operator is not installed or its API is unavailable', 404, 'not_installed', diagnostics);
    }
    if (axiosError?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || axiosError?.code === 'SELF_SIGNED_CERT_IN_CHAIN' || axiosError?.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
      throw new KubernetesError(
        diagnostics.tls?.caCertificate === 'not-configured'
          ? 'TLS certificate verification failed because no trusted CA certificate is configured for the downstream Kubernetes cluster'
          : 'TLS certificate verification failed for the downstream Kubernetes cluster',
        502,
        'unavailable',
        diagnostics,
      );
    }
    throw new KubernetesError('The downstream Kubernetes cluster could not be queried', 502, 'unavailable', diagnostics);
  }
}

async function requestKubernetes<T>(mount: string, host: string, requestPath: string, fallbackCaCertPem?: string): Promise<T> {
  return kubernetesGet<T>(mount, host, requestPath, 'json', fallbackCaCertPem);
}

async function requestKubernetesText(mount: string, host: string, requestPath: string, fallbackCaCertPem?: string): Promise<string> {
  return kubernetesGet<string>(mount, host, requestPath, 'text', fallbackCaCertPem);
}
