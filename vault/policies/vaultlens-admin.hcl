# VaultLens Admin Policy
# Assign this policy to users/entities who should have access to VaultLens
# admin features (backup, branding, webhooks, rotation, analytics, audit log).
#
# This does NOT grant broad Vault access — it is a VaultLens UI access flag.
# VaultLens proxies secret/auth/policy operations through the user's own token.
#
# For the VaultLens system token (background services), use vaultlens-system.hcl instead.
# VaultLens will auto-create both policies on startup if they do not exist.

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
