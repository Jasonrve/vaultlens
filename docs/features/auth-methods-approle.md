# AppRole Auth

AppRole authenticates applications with a `role_id` and `secret_id`. It is useful for machine workloads that cannot present a cloud or Kubernetes identity directly.

## Configure The Mount

Use **Configuration** to review the mount. AppRole roles define token policies, TTLs, and whether Secret IDs are required.

## Roles

Create a role with the Vault CLI or the **Roles** tab:

```bash
vault write auth/approle/role/my-service \
  token_policies=app-readonly \
  secret_id_ttl=24h \
  token_ttl=1h \
  token_max_ttl=4h
```

The role's `role_id` identifies the role and is not sufficient to authenticate by itself. Treat every `secret_id` as a credential.

## Secret IDs In VaultLens

AppRole role details include a **Secret IDs** tab. You can generate, list accessors for, and revoke Secret IDs. Secret ID values are shown only once and cannot be retrieved later. Use short TTLs and revoke credentials when a workload is retired.

## VaultLens System Token

VaultLens can store AppRole credentials in its encrypted configuration storage through the setup wizard. Kubernetes auth is preferred for Kubernetes deployments; AppRole is useful for Docker or VM deployments without a workload identity.
