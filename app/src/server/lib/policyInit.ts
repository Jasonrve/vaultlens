import { config } from '../config/index.js';
import { VaultClient, VaultError } from './vaultClient.js';
import { getSystemToken } from './systemToken.js';

const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

const VAULTLENS_ADMIN_POLICY = `
# VaultLens Admin Policy
# This policy is required to access admin features in VaultLens.
# Assign this policy to users/entities who should have admin access.

# Allow full access to all KV secret engines
path "kv/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# Allow managing secret engines
path "sys/mounts/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

path "sys/mounts" {
  capabilities = ["read", "list"]
}

# Allow managing auth methods
path "sys/auth/*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}

path "sys/auth" {
  capabilities = ["read", "list"]
}

# Allow managing policies
path "sys/policies/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

path "sys/policies" {
  capabilities = ["read", "list"]
}

path "sys/policy/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

path "sys/policy" {
  capabilities = ["read", "list"]
}

# Allow reading audit devices
path "sys/audit" {
  capabilities = ["read", "list", "sudo"]
}

path "sys/audit/*" {
  capabilities = ["read", "list", "sudo"]
}

# Allow managing identity
path "identity/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# Allow reading system health and status
path "sys/health" {
  capabilities = ["read"]
}

path "sys/seal-status" {
  capabilities = ["read"]
}

path "sys/leader" {
  capabilities = ["read"]
}

path "sys/host-info" {
  capabilities = ["read"]
}

path "sys/metrics" {
  capabilities = ["read"]
}

path "sys/internal/counters/*" {
  capabilities = ["read"]
}

# Allow capabilities checking
path "sys/capabilities-self" {
  capabilities = ["create", "update"]
}
`.trim();

/**
 * Check if the vaultlens-admin policy exists in Vault.
 * If it doesn't exist, create it automatically.
 */
export async function ensureVaultLensAdminPolicy(): Promise<void> {
  try {
    const sysToken = await getSystemToken();

    // Check if policy exists
    try {
      await vaultClient.get('/sys/policy/vaultlens-admin', sysToken);
      console.log('[Policy Init] vaultlens-admin policy already exists');
      return;
    } catch (err) {
      if (err instanceof VaultError && err.statusCode === 404) {
        // Policy doesn't exist, create it
      } else {
        throw err;
      }
    }

    // Create the policy
    await vaultClient.put('/sys/policy/vaultlens-admin', sysToken, {
      policy: VAULTLENS_ADMIN_POLICY,
    });

    console.log('[Policy Init] Created vaultlens-admin policy');
  } catch (err) {
    console.error('[Policy Init] Failed to ensure vaultlens-admin policy:', err instanceof Error ? err.message : err);
  }
}
