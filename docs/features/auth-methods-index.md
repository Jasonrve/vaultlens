# Backend Auth Methods

VaultLens can browse and manage the Vault authentication backends used by your installation. Choose a backend below for its identity model, configuration requirements, role or policy mapping, and VaultLens-specific behavior.

- [Kubernetes](auth-methods-kubernetes) — ServiceAccount JWTs, Vault roles, EKS, IRSA, and VSO access
- [AppRole](auth-methods-approle) — machine credentials, role IDs, and Secret IDs
- [GitHub](auth-methods-github) — GitHub users, organizations, and teams
- [OIDC and JWT](auth-methods-oidc-jwt) — interactive SSO and signed workload tokens
- [AWS](auth-methods-aws) — IAM identity authentication
- [GCP](auth-methods-gcp) — Google Cloud workload identity authentication
- [Azure](auth-methods-azure) — managed identity authentication
- [LDAP](auth-methods-ldap) — directory users and group-to-policy mapping
- [UserPass](auth-methods-userpass) — Vault-managed username and password access

The shared [Auth Methods](auth-methods) page covers the list screen, description labels, common detail tabs, audit badges, configurable actions, and role navigation.
