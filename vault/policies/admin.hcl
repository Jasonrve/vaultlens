# Admin policy — full access to everything
path "*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}
