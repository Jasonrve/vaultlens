import axios, { AxiosError } from 'axios';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { config } from '../config/index.js';
import { getEksToken, resolveEksCluster } from './eksAuth.js';

const VSO_GROUP = 'secrets.hashicorp.com';
const VSO_VERSION = 'v1beta1';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface VsoResourceDefinition {
  kind: string;
  resource: string;
  clusterScoped: boolean;
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

export interface VsoResourceRow {
  kind: string;
  resource: string;
  namespace?: string;
  name: string;
  createdAt?: string;
  status?: string;
}

export class KubernetesError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly reason: 'access_denied' | 'not_installed' | 'unavailable' | 'invalid' = 'unavailable',
  ) {
    super(message);
    this.name = 'KubernetesError';
  }
}

function resourceFor(kind: string): VsoResourceDefinition {
  const definition = VSO_RESOURCES.find((item) => item.kind === kind);
  if (!definition) throw new KubernetesError('Unsupported VSO resource', 400, 'invalid');
  return definition;
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

async function tokenForMount(mount: string, kubernetesHost: string): Promise<string> {
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
      return await getEksToken(eksCluster, region);
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
  if (autoDetected) {
    try {
      return await getEksToken(autoDetected.cluster, autoDetected.region);
    } catch (e) {
      throw new KubernetesError(
        `Failed to sign an EKS token using the pod's IAM role: ${e instanceof Error ? e.message : 'unknown error'}`,
        503,
      );
    }
  }

  const token = firstEnv(envNamesForMount(mount, ''));
  if (token) return token;

  try {
    return fs.readFileSync(config.vaultK8sTokenPath, 'utf8').trim();
  } catch {
    throw new KubernetesError('No downstream Kubernetes access token is configured', 503);
  }
}

function caForCluster(): Buffer | undefined {
  const caPath = process.env['K8S_CA_CERT_PATH'] || path.join(path.dirname(config.vaultK8sTokenPath), 'ca.crt');
  try {
    return fs.readFileSync(caPath);
  } catch {
    return undefined;
  }
}

function statusText(item: Record<string, unknown>): string | undefined {
  const status = item['status'];
  if (!status || typeof status !== 'object') return undefined;
  const conditions = (status as Record<string, unknown>)['conditions'];
  if (Array.isArray(conditions)) {
    const ready = conditions.find((condition) => (
      condition && typeof condition === 'object' &&
      ((condition as Record<string, unknown>)['type'] === 'Ready' ||
        (condition as Record<string, unknown>)['type'] === 'Synced')
    ));
    if (ready && typeof ready === 'object') {
      const condition = ready as Record<string, unknown>;
      return `${String(condition['type'])}: ${String(condition['status'])}`;
    }
  }
  return undefined;
}

function rowFromItem(item: Record<string, unknown>, definition: VsoResourceDefinition): VsoResourceRow | null {
  const metadata = item['metadata'];
  if (!metadata || typeof metadata !== 'object') return null;
  const values = metadata as Record<string, unknown>;
  const name = typeof values['name'] === 'string' ? values['name'] : '';
  if (!name) return null;
  return {
    kind: definition.kind,
    resource: definition.resource,
    namespace: typeof values['namespace'] === 'string' ? values['namespace'] : undefined,
    name,
    createdAt: typeof values['creationTimestamp'] === 'string' ? values['creationTimestamp'] : undefined,
    status: statusText(item),
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

export function findVsoResource(kind: string, resource: string): VsoResourceDefinition {
  const definition = resourceFor(kind);
  if (definition.resource !== resource) {
    throw new KubernetesError('Unsupported VSO resource', 400, 'invalid');
  }
  return definition;
}

export async function listVsoResources(mount: string, host: string): Promise<VsoResourceRow[]> {
  const rows: VsoResourceRow[] = [];
  for (const definition of VSO_RESOURCES) {
    const data = await requestKubernetes<Record<string, unknown>>(mount, host, buildListPath(definition));
    const items = Array.isArray(data['items']) ? data['items'] : [];
    for (const item of items) {
      if (item && typeof item === 'object') {
        const row = rowFromItem(item as Record<string, unknown>, definition);
        if (row) rows.push(row);
      }
    }
  }
  return rows;
}

export async function getVsoResource(
  mount: string,
  host: string,
  kind: string,
  resource: string,
  namespace: string | undefined,
  name: string,
): Promise<{ yaml: string; fullYaml: string; row: VsoResourceRow }> {
  if (!validSegment(name) || (namespace !== undefined && !validSegment(namespace))) {
    throw new KubernetesError('Invalid Kubernetes resource name', 400, 'invalid');
  }
  const definition = findVsoResource(kind, resource);
  if (!definition.clusterScoped && !namespace) {
    throw new KubernetesError('Namespace is required for this VSO resource', 400, 'invalid');
  }
  const data = await requestKubernetes<Record<string, unknown>>(
    mount,
    host,
    buildObjectPath(definition, namespace, name),
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

async function requestKubernetes<T>(mount: string, host: string, requestPath: string): Promise<T> {
  let base: URL;
  try {
    base = new URL(host);
  } catch {
    throw new KubernetesError('Kubernetes endpoint is not configured correctly', 502);
  }
  if (!['http:', 'https:'].includes(base.protocol)) {
    throw new KubernetesError('Kubernetes endpoint protocol is not supported', 502);
  }

  try {
    const token = await tokenForMount(mount, host);
    const response = await axios.get<T>(requestPath, {
      baseURL: base.origin,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
      ...(base.protocol === 'https:' && (config.k8sSkipTlsVerify || caForCluster())
        ? { httpsAgent: new https.Agent(config.k8sSkipTlsVerify ? { rejectUnauthorized: false } : { ca: caForCluster() }) }
        : {}),
    });
    return response.data;
  } catch (error) {
    // A specific error from tokenForMount (e.g. missing region, EKS signing failure)
    // should reach the caller as-is, not get flattened into the generic 502 below.
    if (error instanceof KubernetesError) throw error;
    const status = error instanceof AxiosError ? error.response?.status : undefined;
    if (status === 401 || status === 403) {
      throw new KubernetesError('The current workload identity cannot query the downstream Kubernetes cluster', status, 'access_denied');
    }
    if (status === 404) {
      throw new KubernetesError('Vault Secrets Operator is not installed or its API is unavailable', 404, 'not_installed');
    }
    throw new KubernetesError('The downstream Kubernetes cluster could not be queried', 502);
  }
}