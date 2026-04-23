import { config } from '../config/index.js';
import { VaultClient, VaultError } from './vaultClient.js';
import { getSystemToken } from './systemToken.js';

const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

/**
 * System policy — assigned to the VaultLens system token used for background operations.
 * This grants only the permissions needed by the rotation scheduler, audit watcher,
 * backup scheduler, shared-secret cubbyhole, and policy initialisation.
 * It should NOT be assigned to human users.
 */
const VAULTLENS_SYSTEM_POLICY = `
# VaultLens System Policy
# Assigned to the VaultLens AppRole / system token used for background services.
# Do NOT assign this to regular users or admin users.

# Full access to KV engines (rotation, backup/restore, shared secrets)
path "kv/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# Cubbyhole access for shared secrets
path "cubbyhole/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# Manage secret engine mounts (backup/restore)
path "sys/mounts/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

path "sys/mounts" {
  capabilities = ["read", "list"]
}

# Manage auth methods (needed to list auth methods for graph/identity features)
path "sys/auth/*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}

path "sys/auth" {
  capabilities = ["read", "list"]
}

# Manage ACL policies (backup/restore, policy init)
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

# Manage audit devices (socket auto-registration)
path "sys/audit" {
  capabilities = ["read", "list", "sudo"]
}

path "sys/audit/*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}

# Manage identity (entity/group resolution for graphs and suggestions)
path "identity/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# System health and status
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

# Raft storage snapshots (scheduled backup)
path "sys/storage/raft/snapshot*" {
  capabilities = ["read", "create", "update"]
}

# Capabilities self-check (used during setup wizard validation)
path "sys/capabilities-self" {
  capabilities = ["create", "update"]
}
`.trim();

/**
 * Admin policy — assigned to human users who need access to VaultLens admin features.
 * This grants only what is needed to use the admin menu items:
 * backup/restore, branding, webhooks, rotation, audit log, and analytics.
 *
 * Vault-level operations (secret CRUD, auth method management, policy management)
 * are controlled separately by the token's own policies — VaultLens proxies those
 * through the user's token, so the user only sees what Vault allows them to see.
 */
const VAULTLENS_ADMIN_POLICY = `
# VaultLens Admin Policy
# Assign this policy to users/entities who should have access to VaultLens
# admin features (backup, branding, webhooks, rotation, analytics, audit log).
# This does NOT grant broad Vault access — it is a VaultLens UI access flag.

# Allow reading system health and status (analytics dashboard)
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

# Allow reading audit devices (audit log viewer)
path "sys/audit" {
  capabilities = ["read", "list"]
}

# Capabilities self-check
path "sys/capabilities-self" {
  capabilities = ["create", "update"]
}
`.trim();

async function ensurePolicy(name: string, policyHcl: string, sysToken: string): Promise<void> {
  try {
    await vaultClient.get(`/sys/policy/${name}`, sysToken);
    console.log(`[Policy Init] ${name} policy already exists`);
  } catch (err) {
    if (err instanceof VaultError && err.statusCode === 404) {
      await vaultClient.put(`/sys/policy/${name}`, sysToken, { policy: policyHcl });
      console.log(`[Policy Init] Created ${name} policy`);
    } else {
      throw err;
    }
  }
}

/**
 * Ensure both the vaultlens-system and vaultlens-admin policies exist in Vault.
 * Called once at server startup using the system token.
 */
export async function ensureVaultLensAdminPolicy(): Promise<void> {
  try {
    const sysToken = await getSystemToken();
    await Promise.all([
      ensurePolicy('vaultlens-system', VAULTLENS_SYSTEM_POLICY, sysToken),
      ensurePolicy('vaultlens-admin', VAULTLENS_ADMIN_POLICY, sysToken),
    ]);
  } catch (err) {
    console.error('[Policy Init] Failed to ensure VaultLens policies:', err instanceof Error ? err.message : err);
  }
}

