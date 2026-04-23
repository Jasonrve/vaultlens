import fs from 'fs';
import { config } from '../config/index.js';
import { VaultClient } from './vaultClient.js';
import { getConfigStorage } from './config-storage/index.js';
import { tryDecryptConfigValue } from './configEncryption.js';

const K8S_SA_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const APPROLE_ROLE_NAME = 'vaultlens-system-token';
const CREDS_SECTION = 'sys_token_approle';

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

// Backoff state for AppRole authentication failures.
// After the first failure we wait at least 1 minute before retrying, doubling
// up to a maximum of 1 hour so that stale/misconfigured credentials don't
// produce a continuous stream of error log lines.
let appRoleBackoffMs: number = 0;
let appRoleLastFailTime: number = 0;
const APPROLE_BACKOFF_MIN_MS = 60_000;    // 1 minute
const APPROLE_BACKOFF_MAX_MS = 3_600_000; // 1 hour

/**
 * Authenticate to Vault using AppRole credentials stored in config storage.
 * Uses the stored secret-id that was generated during setup.
 * Both role_id and secret_id are encrypted in storage for security.
 */
async function authenticateAppRole(): Promise<string | null> {
  // Respect backoff window to avoid log spam when credentials are wrong/missing.
  if (appRoleBackoffMs > 0 && Date.now() - appRoleLastFailTime < appRoleBackoffMs) {
    // Silent — caller falls back to static token; no need to log on every call.
    return null;
  }
  try {
    const storage = getConfigStorage();
    const creds = await storage.get(CREDS_SECTION);
    if (!creds || !creds['role_id'] || !creds['secret_id']) {
      console.debug('[AppRole Auth] No AppRole credentials found in config storage');
      return null;
    }

    // Decrypt the stored credentials
    const roleId = tryDecryptConfigValue(creds['role_id']);
    const secretId = tryDecryptConfigValue(creds['secret_id']);

    if (!roleId || !secretId) {
      const hasFallback = !!config.vaultSystemToken;
      if (hasFallback) {
        console.debug('[AppRole Auth] Failed to decrypt stored credentials (falling back to static token)');
      } else {
        console.error('[AppRole Auth] Failed to decrypt stored credentials — the encryption key may be wrong or credentials are corrupted');
      }
      appRoleLastFailTime = Date.now();
      appRoleBackoffMs = appRoleBackoffMs
        ? Math.min(appRoleBackoffMs * 2, APPROLE_BACKOFF_MAX_MS)
        : APPROLE_BACKOFF_MIN_MS;
      return null;
    }

    const vaultClientInst = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

    // Use the stored role_id and secret_id to authenticate
    // These are generated and stored once during setup, then used indefinitely
    const loginResponse = await vaultClientInst.post<{
      auth: { client_token: string; lease_duration: number };
    }>(
      '/auth/approle/login',
      '', // unauthenticated
      { role_id: roleId, secret_id: secretId }
    );

    const { client_token, lease_duration } = loginResponse.auth;
    // Cache at 75% of TTL so background services reuse the same token (cubbyhole is per-token)
    cachedToken = client_token;
    tokenExpiry = Date.now() + lease_duration * 750;
    // Reset backoff on success
    appRoleBackoffMs = 0;
    appRoleLastFailTime = 0;
    console.log(`[AppRole Auth] Authenticated to Vault via AppRole (ttl=${lease_duration}s)`);
    return client_token;
  } catch (e) {
    const hasFallback = !!config.vaultSystemToken;
    const errMsg = e instanceof Error ? e.message : String(e);
    if (hasFallback) {
      console.debug('[AppRole Auth] Failed to authenticate (falling back to static token):', errMsg);
    } else {
      console.error('[AppRole Auth] Failed to authenticate:', errMsg);
    }
    // If the credentials themselves are invalid/stale, clear them so we don't keep retrying
    const isInvalidCreds =
      errMsg.toLowerCase().includes('invalid role') ||
      errMsg.toLowerCase().includes('invalid secret id') ||
      errMsg.toLowerCase().includes('role id is invalid');
    if (isInvalidCreds) {
      try {
        const storage = getConfigStorage();
        await storage.delete(CREDS_SECTION);
        console.log('[AppRole Auth] Cleared stale AppRole credentials from storage — re-run setup to reconfigure');
      } catch {
        // Ignore cleanup errors
      }
    }
    appRoleLastFailTime = Date.now();
    appRoleBackoffMs = appRoleBackoffMs
      ? Math.min(appRoleBackoffMs * 2, APPROLE_BACKOFF_MAX_MS)
      : APPROLE_BACKOFF_MIN_MS;
    return null;
  }
}

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
 * 2. AppRole — if credentials are stored in config storage
 * 3. Static token — VAULT_SYSTEM_TOKEN environment variable
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

  // Try AppRole credentials stored in config storage
  // Check cache first — AppRole tokens are cached at module level to ensure
  // the same token is reused across calls (cubbyhole is per-token in Vault)
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  const appRoleToken = await authenticateAppRole();
  if (appRoleToken) return appRoleToken;

  // Fall back to static system token
  return config.vaultSystemToken;
}

/**
 * Seed the system token cache with a freshly-obtained token.
 * Called from the setup wizard after creating the AppRole so that subsequent
 * config storage writes (which need a system token) work immediately without
 * waiting for the next authentication cycle.
 */
export function seedSystemTokenCache(token: string, ttlSeconds: number): void {
  cachedToken = token;
  tokenExpiry = Date.now() + ttlSeconds * 750; // 75% of TTL, same as other auth paths
  // Reset backoff — a freshly seeded token means credentials are now valid
  appRoleBackoffMs = 0;
  appRoleLastFailTime = 0;
}

/**
 * Clear the in-memory system token cache.
 * Call this when a Vault request fails with 403/401 using the cached token
 * so that the next call re-authenticates instead of reusing a stale token.
 */
export function clearSystemTokenCache(): void {
  cachedToken = null;
  tokenExpiry = 0;
}

/**
 * Check whether the system token source is configured (synchronous).
 * Covers env-var sources. For AppRole, checks the module-level cachedToken
 * or falls back to a synchronous config file check.
 * For a definitive async check, use getSystemToken() in a try/catch.
 */
export function isSystemTokenConfigured(): boolean {
  if (config.vaultK8sAuthRole) return true;
  if (config.vaultSystemToken) return true;
  // AppRole credentials may be stored in config storage (set during setup wizard)
  // We can't do async here, but if cachedToken is populated it means AppRole worked
  if (cachedToken) return true;
  // Best-effort: try to read config synchronously (file backend only)
  try {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    // Use the same default path as FileConfigStorage
    const configPath = config.configStoragePath || './data';
    const iniPath = path.resolve(configPath, 'config.ini');
    if (fs.existsSync(iniPath)) {
      const contents = fs.readFileSync(iniPath, 'utf-8');
      // Check for AppRole credentials — may be encrypted (v1:...) or plaintext
      if (contents.includes('[sys_token_approle]') && contents.includes('role_id=')) {
        return true;
      }
    }
  } catch (e) {
    // If there's an error reading the file, log it for debugging
    console.debug('[systemToken] isSystemTokenConfigured() sync check failed:', e instanceof Error ? e.message : e);
  }
  return false;
}
