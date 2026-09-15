/**
 * Generates the "aws-iam-authenticator" style bearer token EKS expects when a client
 * authenticates as an IAM identity (IRSA or EKS Pod Identity) rather than a static
 * Kubernetes ServiceAccount token. This is the same token format `aws eks get-token`
 * and `aws-iam-authenticator` produce: a SigV4-presigned `sts:GetCallerIdentity`
 * request, base64url-encoded and prefixed with "k8s-aws-v1.". The EKS API server's
 * authenticator webhook decodes it and forwards it to STS to verify the caller's
 * identity — no network call happens here beyond what credential resolution needs.
 */

import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { SignatureV4 } from '@smithy/signature-v4';
import { Hash } from '@smithy/hash-node';
import { HttpRequest } from '@smithy/protocol-http';
import type { SourceData } from '@smithy/types';

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
