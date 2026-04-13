import fs from 'fs';
import { config } from '../config/index.js';
import { VaultClient } from './vaultClient.js';

const K8S_SA_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

/**
 * Authenticate to Vault using the Kubernetes auth method.
 * Reads the pod's service account token and exchanges it for a Vault token.
 */
async function authenticateK8s(): Promise<string> {
  const jwt = fs.readFileSync(
    config.vaultK8sTokenPath || K8S_SA_TOKEN_PATH,
    'utf-8',
  ).trim();

  const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);
  const mount = config.vaultK8sAuthMount || 'kubernetes';

  const response = await vaultClient.post<{
    auth: {
      client_token: string;
      lease_duration: number;
      renewable: boolean;
    };
  }>(`/auth/${encodeURIComponent(mount)}/login`, '', {
    role: config.vaultK8sAuthRole,
    jwt,
  });

  const { client_token, lease_duration } = response.auth;

  // Cache the token; renew before it expires (at 75% of TTL)
  cachedToken = client_token;
  tokenExpiry = Date.now() + lease_duration * 750; // 75% of TTL in ms

  console.log(
    `[K8s Auth] Authenticated to Vault (mount=${mount}, role=${config.vaultK8sAuthRole}, ttl=${lease_duration}s)`,
  );

  return client_token;
}

/**
 * Return the system token for server-side operations.
 *
 * Resolution order:
 * 1. Kubernetes auth — if VAULT_K8S_AUTH_ROLE is set and a service account token exists
 * 2. Static token — VAULT_SYSTEM_TOKEN environment variable
 *
 * Kubernetes tokens are automatically renewed before expiry.
 */
export async function getSystemToken(): Promise<string> {
  // If Kubernetes auth is configured, use it
  if (config.vaultK8sAuthRole) {
    if (cachedToken && Date.now() < tokenExpiry) {
      return cachedToken;
    }
    return authenticateK8s();
  }

  // Fall back to static system token
  return config.vaultSystemToken;
}

/**
 * Check whether the system token source is configured.
 */
export function isSystemTokenConfigured(): boolean {
  if (config.vaultK8sAuthRole) return true;
  return !!config.vaultSystemToken;
}
