# App-specific policy — access to product/service secrets in nprd environment

# Read secrets
path "kv/data/product/service/nprd/*" {
  capabilities = ["create", "read", "update", "delete"]
}

# List secrets
path "kv/metadata/product/service/nprd/*" {
  capabilities = ["read", "list"]
}

# Allow listing the parent paths
path "kv/metadata/product/*" {
  capabilities = ["list"]
}

path "kv/metadata/product/service/*" {
  capabilities = ["list"]
}
