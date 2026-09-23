import { FiCheckCircle, FiXCircle, FiHelpCircle } from 'react-icons/fi';

export interface VsoDiagnostics {
  method?: string;
  path?: string;
  status?: number;
  errorCode?: string;
  errorMessage?: string;
  tls?: { verification: string; caCertificate: string; caSource?: 'local-file' | 'auth-mount-config'; caPath?: string };
  identity?: {
    source: 'eks-explicit-override' | 'eks-auto-detected' | 'eks-auto-detect-failed' | 'static-token' | 'local-serviceaccount';
    eksCluster?: string;
    eksRegion?: string;
    detail?: string;
  };
}

export type VsoErrorReason = 'access_denied' | 'not_installed' | 'unavailable' | 'invalid';

// Network-level failures: the TCP connection to the endpoint never completed.
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNABORTED',
]);
// TLS-level failures: the TCP connection was established but the handshake/cert check failed.
const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

type StepStatus = 'ok' | 'fail' | 'unknown';

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'ok') return <FiCheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />;
  if (status === 'fail') return <FiXCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />;
  return <FiHelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />;
}

/**
 * Turns the raw request diagnostics into a three-step story — reach, TLS,
 * authorization — since a bare status/errorCode dump doesn't say where in
 * that chain the request actually stopped.
 */
export function VsoRequestDiagnostics({ reason, diagnostics }: { reason?: VsoErrorReason; diagnostics?: VsoDiagnostics }) {
  if (!diagnostics) return null;

  const isNetworkError = !!diagnostics.errorCode && NETWORK_ERROR_CODES.has(diagnostics.errorCode);
  const isTlsError = !!diagnostics.errorCode && TLS_ERROR_CODES.has(diagnostics.errorCode);

  const reached: StepStatus =
    reason === 'invalid' ? 'unknown'
      : diagnostics.status !== undefined || isTlsError ? 'ok'
        : isNetworkError ? 'fail'
          : 'unknown';
  const reachedDetail =
    reason === 'invalid' ? 'The configured Kubernetes URL is invalid or unsupported — no request was sent.'
      : reached === 'ok' ? 'Connected to the Kubernetes API server.'
        : reached === 'fail' ? 'Could not reach the endpoint — check the URL, network path, and that the API server is listening.'
          : 'Could not determine whether the endpoint was reachable.';

  const tlsSkipped = diagnostics.tls?.verification === 'disabled';
  const caSourceLabel = diagnostics.tls?.caSource === 'auth-mount-config'
    ? "the auth mount's kubernetes_ca_cert"
    : diagnostics.tls?.caSource === 'local-file' ? 'a local CA file' : undefined;
  const tls: StepStatus = reached !== 'ok' ? 'unknown' : isTlsError ? 'fail' : 'ok';
  const tlsDetail =
    reached !== 'ok' ? 'Not attempted.'
      : tlsSkipped ? 'Skipped — TLS verification is disabled for this connection.'
        : isTlsError ? `Certificate verification failed${diagnostics.tls?.caCertificate === 'not-configured' ? ' — no CA certificate is configured (checked K8S_CA_CERT_PATH, the local ServiceAccount CA, and the auth mount\'s kubernetes_ca_cert)' : caSourceLabel ? ` using ${caSourceLabel}` : ''}.`
          : `Certificate verified successfully${caSourceLabel ? ` using ${caSourceLabel}` : ''}.`;

  const identity = diagnostics.identity;
  const identityLabel =
    identity?.source === 'eks-explicit-override' ? `EKS token signed for cluster "${identity.eksCluster}" (explicit override)`
      : identity?.source === 'eks-auto-detected' ? `EKS token auto-detected for cluster "${identity.eksCluster}" in ${identity.eksRegion}`
        : identity?.source === 'eks-auto-detect-failed' ? `EKS auto-detection failed${identity.eksRegion ? ` in ${identity.eksRegion}` : ''} — fell back to a token that almost certainly belongs to the wrong cluster`
          : identity?.source === 'static-token' ? 'a statically configured bearer token'
            : identity?.source === 'local-serviceaccount' ? "VaultLens's own local pod ServiceAccount token"
              : undefined;

  const authorized: StepStatus =
    reached !== 'ok' ? 'unknown'
      : reason === 'access_denied' ? 'fail'
        : reason === 'not_installed' ? 'unknown'
          : diagnostics.status !== undefined && diagnostics.status < 400 ? 'ok'
            : 'unknown';
  const authorizedDetail =
    reached !== 'ok' ? 'Not attempted.'
      : reason === 'access_denied' && identity?.source === 'eks-auto-detect-failed'
        ? `Rejected (HTTP ${diagnostics.status}) — this used ${identityLabel}, not the target cluster's identity. ${identity.detail ?? ''}`
        : reason === 'access_denied' ? `Rejected (HTTP ${diagnostics.status}) — the workload identity does not have permission.${identityLabel ? ` Sent ${identityLabel}.` : ''}`
          : reason === 'not_installed' ? `The API responded with HTTP ${diagnostics.status} — the Vault Secrets Operator API is not installed, or the path is wrong.`
            : authorized === 'ok' ? `Access allowed.${identityLabel ? ` Used ${identityLabel}.` : ''}`
              : `Unexpected response (HTTP ${diagnostics.status ?? 'unknown'}).`;

  return (
    <details className="mt-3 rounded border border-amber-200 bg-white/60 p-3 text-xs">
      <summary className="cursor-pointer font-medium">Request diagnostics</summary>
      <ul className="mt-2 space-y-1.5">
        <li className="flex items-start gap-2"><StepIcon status={reached} /><span><span className="font-medium">Reach endpoint — </span>{reachedDetail}</span></li>
        <li className="flex items-start gap-2"><StepIcon status={tls} /><span><span className="font-medium">TLS — </span>{tlsDetail}</span></li>
        <li className="flex items-start gap-2"><StepIcon status={authorized} /><span><span className="font-medium">Authorized — </span>{authorizedDetail}</span></li>
      </ul>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-amber-100 pt-2 text-[11px] text-gray-500">
        <dt className="font-medium">Request</dt><dd>{diagnostics.method || 'GET'} {diagnostics.path || 'unknown path'}</dd>
        {identity && <><dt className="font-medium">Identity used</dt><dd>{identity.source}{identity.eksCluster ? ` (${identity.eksCluster}, ${identity.eksRegion})` : identity.eksRegion ? ` (${identity.eksRegion})` : ''}</dd></>}
        {diagnostics.status !== undefined && <><dt className="font-medium">HTTP status</dt><dd>{diagnostics.status}</dd></>}
        {diagnostics.errorCode && <><dt className="font-medium">Error code</dt><dd>{diagnostics.errorCode}</dd></>}
        {diagnostics.tls?.caPath && <><dt className="font-medium">CA path</dt><dd className="break-all">{diagnostics.tls.caPath}</dd></>}
        {diagnostics.errorMessage && <><dt className="font-medium">Upstream error</dt><dd className="break-words">{diagnostics.errorMessage}</dd></>}
      </dl>
    </details>
  );
}
