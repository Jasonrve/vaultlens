# VaultLens System Policy
# Assigned to the VaultLens AppRole / system token used for background services.
# Do NOT assign this to human users or admin users.
#
# Background services that use this token:
#   - Secret rotation scheduler
#   - Audit log watcher
#   - Backup scheduler
#   - Shared-secret cubbyhole
#   - Policy auto-initialisation on startup
#   - Socket audit device auto-registration
#
# VaultLens will auto-create this policy on startup if it does not exist.

# Full access to KV engines (rotation, backup/restore)
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

# Manage auth methods (list auth methods for graph/identity features)
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
