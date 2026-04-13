# VaultLens Admin Policy
# This policy is required to access admin features in VaultLens.
# Assign this policy to users/entities who should have admin access.
#
# VaultLens will auto-create this policy on startup if it does not exist.

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
