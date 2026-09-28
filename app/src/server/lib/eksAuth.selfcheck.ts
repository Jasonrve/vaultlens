// Self-check for the EKS IAM token glue logic — run with:
//   npx tsx src/server/lib/eksAuth.selfcheck.ts
import assert from 'node:assert';
import { buildEksTokenFromPresignedRequest, regionFromHost } from './eksAuth.js';
import { envNamesForMount } from './kubernetesClient.js';

// ── buildEksTokenFromPresignedRequest ───────────────────────────────────────
// Token must carry the exact "k8s-aws-v1." prefix EKS's authenticator webhook
// expects, followed by a base64url (no padding, no '+'/'/') encoding of the
// presigned URL.
{
  const token = buildEksTokenFromPresignedRequest({
    hostname: 'sts.us-east-1.amazonaws.com',
    path: '/',
    query: {
      Action: 'GetCallerIdentity',
      Version: '2011-06-15',
      'X-Amz-Signature': 'ab+cd/ef==',
    },
  });

  assert.ok(token.startsWith('k8s-aws-v1.'), 'token must have the k8s-aws-v1. prefix');
  const encoded = token.slice('k8s-aws-v1.'.length);
  assert.ok(!/[+/=]/.test(encoded), 'encoded portion must be base64url (no +, /, or = padding)');

  const decodedUrl = Buffer.from(encoded, 'base64url').toString('utf-8');
  assert.strictEqual(
    decodedUrl,
    'https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15&X-Amz-Signature=ab%2Bcd%2Fef%3D%3D',
    'decoded URL must round-trip with query values percent-encoded',
  );
}

// ── envNamesForMount ─────────────────────────────────────────────────────────
// A plain mount name only ever produces the one direct candidate.
assert.deepStrictEqual(
  envNamesForMount('k3s', '_EKS_CLUSTER'),
  ['K8S_ACCESS_K3S_EKS_CLUSTER'],
);

// Mixed-case / path-like mount names are normalized to a safe env var shape.
assert.deepStrictEqual(
  envNamesForMount('my-cluster/', '_EKS_CLUSTER'),
  ['K8S_ACCESS_MY_CLUSTER_EKS_CLUSTER'],
);

// A mount name that itself starts with "kubernetes" also gets the shorthand
// candidate below, since it normalizes to a KUBERNETES_-prefixed env var name.
assert.deepStrictEqual(
  envNamesForMount('Kubernetes-Prod/', '_EKS_CLUSTER'),
  ['K8S_ACCESS_KUBERNETES_PROD_EKS_CLUSTER', 'K8S_ACCESS_PROD_EKS_CLUSTER'],
);

// The default mount name "kubernetes" (no suffix) normalizes to exactly
// "KUBERNETES", which does not start with "KUBERNETES_" (no trailing
// underscore) — so it does NOT get the shorthand candidate.
assert.deepStrictEqual(
  envNamesForMount('kubernetes', '_EKS_CLUSTER'),
  ['K8S_ACCESS_KUBERNETES_EKS_CLUSTER'],
);

// ── regionFromHost ──────────────────────────────────────────────────────────
// A standard AWS-generated EKS endpoint carries the region as its third-from-last label.
assert.strictEqual(
  regionFromHost('https://ABCDEF1234567890ABCDEF1234567890.gr7.eu-west-1.eks.amazonaws.com'),
  'eu-west-1',
);

// Custom DNS / private-endpoint aliases and non-EKS hosts don't match and must
// fall back to the existing manual-config chain rather than guessing a region.
assert.strictEqual(regionFromHost('https://k8s.internal.example.com'), undefined);
assert.strictEqual(regionFromHost('https://192.168.99.100:8443'), undefined);
assert.strictEqual(regionFromHost('not a url'), undefined);

console.log('eksAuth self-check passed');
