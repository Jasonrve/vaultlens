# VaultLens system policy
# Assigned to the VaultLens system token (AppRole) used for background services.
# Do NOT assign this to human users — use vaultlens-admin for admin UI access.
#
# Operations that require the system token (no user session available):
#   - Rotation scheduler: writes new passwords and updates last-rotated metadata
#   - Shared-secret cubbyhole: creates, marks-retrieved, and deletes entries
#   - Policy init at startup: creates vaultlens-admin + vaultlens-system-policy if missing
#   - Audit socket registration: registers socket device at startup
#   - Secure merge: reads existing secret values server-side before merging
#   - OIDC auto-detection: reads auth method list and config for login page
#   - Scheduled backup: downloads Raft snapshot

# KV v2 – all engines (rotation scheduler writes; secure merge reads)
# Wildcard (+) covers every mount. No delete needed: rotation overwrites, restore uses user token.
path "+/data/*" {
  capabilities = ["create", "read", "update", "list"]
}

path "+/metadata/*" {
  capabilities = ["create", "read", "update", "list"]
}

# Legacy default KV engine (secret/)
path "secret/data/*" {
  capabilities = ["create", "read", "update", "list"]
}

path "secret/metadata/*" {
  capabilities = ["create", "read", "update", "list"]
}

# Cubbyhole – encrypted shared secrets (create, retrieve, delete)
path "cubbyhole/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# Secret engine mount enumeration (rotation scheduler, secure merge)
path "sys/mounts" {
  capabilities = ["read"]
}

# Auth method enumeration and OIDC/JWT config detection (login page)
path "sys/auth" {
  capabilities = ["read"]
}

path "auth/+/config" {
  capabilities = ["read"]
}

# Policy management – creates vaultlens-admin and vaultlens-system-policy at startup
path "sys/policy" {
  capabilities = ["read", "list"]
}

path "sys/policy/*" {
  capabilities = ["create", "read", "update"]
}

# Modern ACL policy API – read access so the health check can verify policy existence
path "sys/policies/acl" {
  capabilities = ["read", "list"]
}

path "sys/policies/acl/*" {
  capabilities = ["read"]
}

# Audit device registration (socket auto-registration at startup; requires sudo)
path "sys/audit" {
  capabilities = ["read", "list", "sudo"]
}

path "sys/audit/*" {
  capabilities = ["create", "update", "sudo"]
}

# Raft snapshot download (scheduled backup – read only)
path "sys/storage/raft/snapshot*" {
  capabilities = ["read"]
}
