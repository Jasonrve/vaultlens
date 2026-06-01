# Auth Methods

VaultLens lets you browse and manage all authentication methods configured in your Vault instance.

![Auth Methods](/screenshots/auth-methods.png)

## Auth Methods List

The **Access → Auth Methods** page shows all enabled auth methods with:
- Mount path and type
- Description
- Accessor ID

## Auth Method Detail

Click any auth method to view its details across three tabs:

### Roles Tab

Lists all roles defined for the auth method. Click a role to view its configuration (bound service account names, token policies, TTLs, etc.).

Supported auth method types with role browsing:
- Kubernetes
- AppRole
- GitHub
- JWT/OIDC
- AWS
- GCP
- Azure
- LDAP
- UserPass

::: tip Empty State
If an auth method has no roles configured, the Roles tab shows an empty table — not an error.
:::

### Configuration Tab

Shows the current configuration for the auth method (e.g., Kubernetes host, CA cert, JWT validation settings). Fields are read-only in this view.

### Method Options Tab

Shows the tuned mount options: default/max lease TTL, token type, and other mount-level settings.

## OIDC Login

VaultLens supports OIDC login via a popup flow. If your Vault has an OIDC auth method enabled:

1. On the login page, select the OIDC mount
2. Click **Login with OIDC** — a popup opens for the identity provider
3. After completing authentication, the popup closes and you are logged in

The OIDC callback page (`/oidc-callback/:mountPath`) is always accessible without authentication.
