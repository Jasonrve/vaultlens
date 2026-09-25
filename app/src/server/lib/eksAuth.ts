/**
 * Generates the "aws-iam-authenticator" style bearer token EKS expects when a client
 * authenticates as an IAM identity (IRSA or EKS Pod Identity) rather than a static
 * Kubernetes ServiceAccount token. This is the same token format `aws eks get-token`
 * and `aws-iam-authenticator` produce: a SigV4-presigned `sts:GetCallerIdentity`
 * request, base64url-encoded and prefixed with "k8s-aws-v1.". The EKS API server's
 * authenticator webhook decodes it and forwards it to STS to verify the caller's
 * identity — no network call happens here beyond what credential resolution needs.
 */

import axios, { AxiosError } from 'axios';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { SignatureV4 } from '@smithy/signature-v4';
import { Hash } from '@smithy/hash-node';
import { HttpRequest } from '@smithy/protocol-http';
import type { SourceData } from '@smithy/types';
import { concurrentMap } from './concurrency.js';

// @smithy/hash-node's Hash class takes the algorithm name as its first constructor
// arg; SignatureV4 expects a ChecksumConstructor (secret-only constructor), hence this
// one-line adapter fixing the algorithm to sha256.
class Sha256 extends Hash {
  constructor(secret?: SourceData) {
    super('sha256', secret);
  }
}

// The pod's IAM role (via IRSA or EKS Pod Identity) doesn't change per downstream
// cluster, so one provider — with its own internal credential caching/refresh — is
// reused for every mount instead of re-resolving credentials on every request.
let credentialProvider: AwsCredentialIdentityProvider | null = null;
function getCredentialProvider(): AwsCredentialIdentityProvider {
  if (!credentialProvider) credentialProvider = fromNodeProviderChain();
  return credentialProvider;
}

/**
 * Assembles the final "k8s-aws-v1.<base64url>" token from an already-presigned
 * GetCallerIdentity request. Pulled out as a pure function so it's testable without
 * real AWS credentials — see eksAuth.selfcheck.ts.
 */
export function buildEksTokenFromPresignedRequest(presigned: {
  hostname: string;
  path: string;
  query?: Record<string, string | string[] | null | undefined>;
}): string {
  const query = Object.entries(presigned.query ?? {})
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  const url = `https://${presigned.hostname}${presigned.path}?${query}`;
  return `k8s-aws-v1.${Buffer.from(url).toString('base64url')}`;
}

/**
 * Build a fresh EKS bearer token for `clusterName` in `region`, signed with the
 * pod's own IAM role. Callers should generate a new token per request rather than
 * caching it — EKS treats a token as valid only for ~15 minutes from the moment it
 * was signed, and generating one is a local signing operation, not a network call.
 */
export async function getEksToken(clusterName: string, region: string): Promise<string> {
  const signer = new SignatureV4({
    credentials: getCredentialProvider(),
    region,
    service: 'sts',
    sha256: Sha256,
  });

  const host = `sts.${region}.amazonaws.com`;
  const request = new HttpRequest({
    protocol: 'https:',
    hostname: host,
    path: '/',
    method: 'GET',
    query: { Action: 'GetCallerIdentity', Version: '2011-06-15' },
    headers: {
      host,
      // Binds the token to this specific cluster — EKS rejects a token presigned
      // for a different cluster name.
      'x-k8s-aws-id': clusterName,
    },
  });

  // Matches the TTL aws-iam-authenticator itself uses: short enough that a leaked
  // presigned URL is useless well before EKS's own ~15 minute token-age limit expires.
  const presigned = await signer.presign(request, { expiresIn: 60 });
  return buildEksTokenFromPresignedRequest(presigned);
}

/**
 * Extracts the AWS region from a standard EKS-generated API server hostname
 * (`https://<id>.<random>.<region>.eks.amazonaws.com`). Returns undefined for
 * anything else — custom DNS, a private VPC PrivateLink alias, or a non-EKS
 * cluster — so callers can fall back to the existing manual-config chain.
 */
export function regionFromHost(host: string): string | undefined {
  let hostname: string;
  try {
    hostname = new URL(host).hostname;
  } catch {
    return undefined;
  }
  const match = /\.([a-z]{2}-[a-z]+-\d)\.eks\.amazonaws\.com$/i.exec(hostname);
  return match ? match[1]!.toLowerCase() : undefined;
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return undefined;
  }
}

interface EksClusterSummary { name: string; endpoint: string }

// AWS's JSON error body names the exact denied action (e.g. "... is not
// authorized to perform: eks:ListClusters ...") — axios's own error.message is
// just "Request failed with status code 403" and throws that away.
function awsErrorMessage(data: unknown): string | undefined {
  if (typeof data === 'string') return data.slice(0, 2000);
  if (data && typeof data === 'object') {
    const message = (data as { message?: unknown; Message?: unknown }).message ?? (data as { Message?: unknown }).Message;
    if (typeof message === 'string') return message;
    try { return JSON.stringify(data).slice(0, 2000); } catch { return undefined; }
  }
  return undefined;
}

async function signedEksGet(region: string, path: string, query?: Record<string, string>): Promise<unknown> {
  const host = `eks.${region}.amazonaws.com`;
  const signer = new SignatureV4({
    credentials: getCredentialProvider(),
    region,
    service: 'eks',
    sha256: Sha256,
  });
  const request = new HttpRequest({
    protocol: 'https:',
    hostname: host,
    path,
    method: 'GET',
    query,
    headers: { host },
  });
  const signed = await signer.sign(request);
  try {
    const response = await axios.get(`https://${host}${path}`, {
      params: query,
      headers: signed.headers as Record<string, string>,
      timeout: 10000,
    });
    return response.data;
  } catch (e) {
    if (e instanceof AxiosError) {
      const errorType = e.response?.headers?.['x-amzn-errortype'] as string | undefined;
      const message = awsErrorMessage(e.response?.data) ?? e.message;
      throw new Error(errorType ? `${errorType}: ${message}` : message);
    }
    throw e;
  }
}

// ponytail: fixed 5-minute TTL, no invalidation when a cluster is added/removed
// mid-window — upgrade to event-driven invalidation if that gap ever matters.
const CLUSTER_CACHE_TTL_MS = 5 * 60 * 1000;
const clusterListCache = new Map<string, { clusters: EksClusterSummary[]; expiresAt: number }>();

async function listClustersInRegion(region: string): Promise<EksClusterSummary[]> {
  const cached = clusterListCache.get(region);
  if (cached && cached.expiresAt > Date.now()) return cached.clusters;

  const names: string[] = [];
  let nextToken: string | undefined;
  do {
    const query: Record<string, string> = {};
    if (nextToken) query['nextToken'] = nextToken;
    let data: { clusters?: unknown; nextToken?: unknown };
    try {
      data = await signedEksGet(region, '/clusters', query) as { clusters?: unknown; nextToken?: unknown };
    } catch (e) {
      throw new Error(`eks:ListClusters — ${e instanceof Error ? e.message : String(e)}`);
    }
    if (Array.isArray(data.clusters)) names.push(...data.clusters.filter((n): n is string => typeof n === 'string'));
    nextToken = typeof data.nextToken === 'string' ? data.nextToken : undefined;
  } while (nextToken);

  const clusters: EksClusterSummary[] = [];
  await concurrentMap(names, 5, async (name) => {
    let data: { cluster?: { endpoint?: unknown } };
    try {
      data = await signedEksGet(region, `/clusters/${encodeURIComponent(name)}`) as { cluster?: { endpoint?: unknown } };
    } catch (e) {
      throw new Error(`eks:DescribeCluster on "${name}" — ${e instanceof Error ? e.message : String(e)}`);
    }
    const endpoint = data.cluster?.endpoint;
    if (typeof endpoint === 'string') clusters.push({ name, endpoint });
  });

  clusterListCache.set(region, { clusters, expiresAt: Date.now() + CLUSTER_CACHE_TTL_MS });
  return clusters;
}

export type EksAutoDetectResult =
  // Host doesn't look like a standard EKS endpoint — auto-detection was never attempted.
  | { attempted: false }
  // Host matched the EKS hostname pattern, but no cluster in that region (visible to
  // the pod's IAM role) had a matching endpoint — either the role can't list/describe
  // clusters, or the target genuinely isn't in this account/region. `visibleClusters`
  // lists what WAS found (ListClusters/DescribeCluster only ever return clusters in the
  // caller's own AWS account — never across accounts, no matter the IAM permissions or
  // access entries) so an empty list points at a permissions/region problem, while a
  // non-empty list that just doesn't include the target points at a cross-account cluster.
  | { attempted: true; matched: false; region: string; visibleClusters: string[]; error?: string }
  | { attempted: true; matched: true; cluster: string; region: string };

/**
 * Finds the EKS cluster (in the account/region reachable via the pod's own IAM
 * role) whose API server endpoint matches `kubernetesHost` — the same host
 * already configured on the Vault Kubernetes auth mount. Lets VaultLens use the
 * pod's IAM role against any EKS cluster it has an access entry for, without a
 * per-mount cluster-name mapping. Never throws — a non-EKS host, or a pod role
 * without `eks:ListClusters`/`DescribeCluster`, falls straight through to the
 * existing static-token/ServiceAccount chain — but the result says which case
 * happened, since a silent miss here means the caller sends the wrong cluster's
 * token instead.
 */
export async function resolveEksCluster(kubernetesHost: string): Promise<EksAutoDetectResult> {
  const region = regionFromHost(kubernetesHost);
  const targetOrigin = originOf(kubernetesHost);
  if (!region || !targetOrigin) return { attempted: false };

  try {
    const clusters = await listClustersInRegion(region);
    const match = clusters.find((c) => originOf(c.endpoint) === targetOrigin);
    if (match) return { attempted: true, matched: true, cluster: match.name, region };
    return { attempted: true, matched: false, region, visibleClusters: clusters.map((c) => c.name) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn(`[EKS Auto-Detect] Could not list/describe EKS clusters in ${region} using the pod's IAM role:`, error);
    return { attempted: true, matched: false, region, visibleClusters: [], error };
  }
}
