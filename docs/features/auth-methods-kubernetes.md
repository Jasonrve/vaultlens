# Kubernetes Auth

Vault's Kubernetes auth method lets workloads authenticate with a Kubernetes ServiceAccount JWT. Vault validates the JWT with the Kubernetes API and returns the policies assigned to the matching Vault role.

## Configure The Mount

In **Access → Auth Methods**, open a Kubernetes mount and use **Configuration** to review:

- Kubernetes API host
- CA certificate or CA certificate path
- Kubernetes reviewer JWT
- Token issuer and service-account JWT settings

The reviewer JWT is used by Vault to validate presented ServiceAccount tokens. Keep it in Vault configuration, not in application code.

## Roles

A Kubernetes role maps one or more Kubernetes ServiceAccount names and namespaces to Vault policies:

```bash
vault write auth/kubernetes/role/vaultlens \
  bound_service_account_names=vaultlens \
  bound_service_account_namespaces=vaultlens \
  policies=vaultlens-system \
  ttl=1h
```

Use the **Roles** tab to inspect role bindings, policies, and token settings. VaultLens uses the logged-in user's Vault token for these operations.

## VaultLens System Authentication

VaultLens can use this auth method for its own background services instead of a static `VAULT_SYSTEM_TOKEN`. Configure `VAULT_K8S_AUTH_ROLE`, `VAULT_K8S_AUTH_MOUNT`, and `VAULT_K8S_TOKEN_PATH`; the Helm chart enables the same settings with `kubernetesAuth.enabled=true`.

## VSO Resources

Kubernetes mounts can also expose the read-only **VSO Resources** and **VSO Logs** tabs. VSO Resources queries the downstream Kubernetes API using EKS IRSA, an explicit bearer token, or the VaultLens pod's ServiceAccount token. See [VSO access and RBAC](auth-methods#downstream-cluster-access) for EKS and ServiceAccount setup.

## Common Problems

- A Vault role can exist while the Kubernetes ServiceAccount or namespace binding is wrong.
- The Vault reviewer JWT must have permission to review token authentication.
- The VSO Resources identity is separate from the Vault Kubernetes-auth identity; authorize it in the downstream cluster as well.
