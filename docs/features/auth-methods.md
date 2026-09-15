# Auth Methods

VaultLens lets you browse and manage all authentication methods configured in your Vault instance.

![Auth Methods](/screenshots/auth-methods.png)

## Auth Methods List

The **Access → Auth Methods** page shows all enabled auth methods with:
- Mount path and type
- Description (rendered as rich labels and links — see below)
- Accessor ID

## Description Labels & Links

VaultLens parses the **description** field of each auth method and renders it as visual chips and link pills automatically — no extra configuration needed.

### Key–Value Labels (Badges)

Any `key=value` or `key:value` pair in the description is rendered as a colour-coded badge chip.

![KV Label Badges](/screenshots/auth-methods-kv-labels.png)

**Inline format** — multiple pairs on one line, separated by spaces:
```
org=example-org env=prod
org:example-org env:prod
```

**Newline format** — one pair per line, supports multi-word keys:
```
Cluster Name: example-npr
Region: af-south-1
VPC ID: vpc-054614f1876c12345
Account Name: example-npr
EKS Module Version: 0.25.1
```

Both `=` and `:` are supported as separators. Spaces after the separator are optional.

### Service Link Pills

Any HTTP(S) URL in the description is rendered as a clickable pill with a service icon when the URL matches a known service:

![Service Link Pills](/screenshots/auth-methods-link-pills.png)

| Service | Detected by |
|---------|------------|
| GitHub | `github.com` or `github.io` |
| Kubernetes | `kubernetes` or `k8s` in the URL |
| Rancher | `rancher` in the URL |
| Argo / ArgoCD | `argo` or `argocd` in the URL |
| Backstage | `backstage` in the URL |
| Roadie | `roadie` in the URL |

Unrecognised URLs are shown as a truncated plain pill.

### Combined Example

A description like:
```
org:example-org env:prod https://github.com/example-org
```

Renders as a GitHub link pill **and** two badge chips (`org` / `example-org` and `env` / `prod`).

A newline description like:
```
Cluster Name: example-npr
Region: af-south-1
VPC ID: vpc-054614f1876c12345
Account Name: example-npr
EKS Module Version: 0.25.1
https://kubernetes.rancher.example.com/nprd
```

Renders as five badge chips with their full multi-word key names, plus a Rancher link pill.

### Setting Descriptions

Auth method descriptions are set when enabling or tuning the auth method in Vault:

```bash
# At enable time
vault auth enable \
  -description="org:example-org env:prod https://github.com/example-org" \
  github

# Or tune an existing mount
vault auth tune \
  -description="Cluster Name: example-npr
Region: af-south-1
EKS Module Version: 0.25.1" \
  kubernetes/
```

Plain text (no `=` or `:`) is displayed as a standard description paragraph below the badges.

## Auth Method Detail

### Vault Secrets Operator Resources

Administrators can enable **Vault Secrets Operator resources** from **Settings → Features → Auth Methods**. The setting is global: when enabled, every Kubernetes auth mount gets a **VSO Resources** tab. It is disabled by default for normal installations; the checked-in local development configuration enables it so the k3s fixture can be tested immediately.

The tab is read-only and loads only when opened. It queries the Kubernetes endpoint configured in that auth mount and lists existing resources across all namespaces:

- `VaultConnection`
- `VaultAuth`
- `VaultAuthGlobal`
- `VaultStaticSecret`
- `VaultDynamicSecret`
- `VaultPKISecret`
- `SecretTransformation`
- `CSISecrets`

The resource list includes the kind, namespace, name, age, and current status. Rows are grouped in this order: `VaultStaticSecret`, `VaultAuth`, then `VaultConnection`; other supported kinds follow afterward. Use the resource search above the table to filter by kind, namespace, name, or status. Select an entry to open an animated YAML drawer from the right and copy the YAML. Kubernetes managed fields are hidden from the default output so internal `f:` bookkeeping does not obscure the object; use **Show Kubernetes managed fields** when you need to inspect them. YAML keys, strings, booleans, numbers, and comments are color formatted for easier scanning. VaultLens never sends Kubernetes credentials to the browser. The VaultLens workload identity needs Kubernetes `get` and `list` permissions for the VSO resources. If access is denied, the tab shows the Kubernetes URL configured on the Vault auth mount, the current ServiceAccount and workload role, and an example `ClusterRole`/`ClusterRoleBinding` granting read-only access across namespaces.

The feature does not browse arbitrary Kubernetes resources and does not modify VSO objects. Missing VSO CRDs are reported as unavailable rather than being shown as an empty inventory.

#### Downstream cluster access

Access to a Kubernetes auth mount's own cluster is resolved per mount, in this order:

1. **EKS IAM role** — set `K8S_ACCESS_<MOUNT>_EKS_CLUSTER=<eks-cluster-name>` to have VaultLens sign a short-lived EKS bearer token using the IAM role attached to its own pod (via IRSA or EKS Pod Identity), instead of a static Kubernetes token. Optionally set `K8S_ACCESS_<MOUNT>_EKS_REGION` if the downstream cluster's region differs from `AWS_REGION`/`AWS_DEFAULT_REGION`. The pod's IAM role must be allowed (via the target EKS cluster's `aws-auth` ConfigMap or access entries) to authenticate, and the resulting Kubernetes identity needs `get`/`list` on the VSO resources. No token is stored anywhere — it's signed fresh for each request.
2. **Static bearer token** — `K8S_ACCESS_<MOUNT>=<kubernetes-bearer-token>`, used as-is.
3. **Local ServiceAccount token** — if neither of the above is set, VaultLens falls back to its own pod's mounted ServiceAccount token (`VAULT_K8S_TOKEN_PATH`), which only makes sense when the Kubernetes auth mount's cluster *is* the cluster VaultLens itself runs in.

`<MOUNT>` is the auth mount path, uppercased with non-alphanumeric characters replaced by `_` (e.g. `kubernetes-prod` → `KUBERNETES_PROD`). A mount name that already starts with `kubernetes` also accepts the same suffix with that prefix stripped (e.g. `K8S_ACCESS_PROD_EKS_CLUSTER` for a mount named `kubernetes-prod`).

Access to VSO resources for a mount is gated on the caller's *own* Vault token having `read` capability on that mount's `auth/<mount>/config` path — not on being a VaultLens admin — since the downstream Kubernetes call itself always uses VaultLens's own workload identity rather than the caller's.

#### Local k3s testing

The development Compose file includes an optional k3s cluster and VSO fixture. The fixture installs the VSO CRDs, creates read-only access, and seeds sample `VaultConnection`, `VaultAuth`, and `VaultStaticSecret` objects. The normal `docker-compose-refresh` task starts the fixture before Vault bootstrap and VaultLens.

For an explicit local downstream token, set the cluster-specific environment variable before starting Compose:

```env
K8S_ACCESS_K3S=<kubernetes-bearer-token>
```

The value is treated only as a bearer token and is never logged or returned. When it is omitted in the development fixture, the generated read-only ServiceAccount token is shared with VaultLens through the local development volume. `K8S_SKIP_TLS_VERIFY=true` is enabled by default for the self-signed k3s API and should not be used for production clusters.

## Configurable Auth Actions

Administrators can add shortcut buttons to auth-method screens using the gear icon in the screen header. Buttons can be configured for an individual mount or shared by every mount of an auth type. Mount settings override an action with the same ID from the auth-type settings.

Actions support HTTP GET links and POST form submissions. Each action can stay in the current tab, open a new tab, or show a popup outcome. URLs and form fields can use context placeholders such as `{{MOUNT_PATH}}`, `{{ROLE_NAME}}`, `{{AUTH_TYPE}}`, and `{{VAULT_ADDR}}`; values are resolved for the current backend and role and are encoded for their destination. Missing placeholders are not sent.

The action editor stores a safe icon name rather than custom markup and includes icons from Lucide, Material Design, Font Awesome, and Iconify. Iconify supports the `simple-icons`, `logos`, `devicon`, `vscode-icons`, `skill-icons`, `material-icon-theme`, `mdi`, `material-symbols`, and `tabler` collections. Choose a collection and enter any icon name in the `collection:name` format, such as `mdi:shield` or `simple-icons:hashicorp`. Iconify icon data is loaded from its public API when an icon is first displayed. Vault tokens, Secret IDs, credentials, and secret values are never available as placeholders. Action configuration is included in VaultLens application settings backups.

Actions can be configured as **icon-only** buttons. The button label is then used as its hover tooltip and accessible label, so users can identify the action without displaying text beside the icon.

The icon search is optimized for the large catalog: matching is deferred while typing and the picker renders a bounded set of local results at a time. All local icons remain searchable, and Iconify icons can be entered directly using their collection prefix and name.

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

## Audit Error Badges

The auth method detail page and its Roles tab show a small red **error counter** whenever recent Vault audit log entries contain an error for that backend:

- **Auth method header** — next to the Relationships button, shows the total error count for the whole mount.
- **Roles table** — each role row shows its own error count next to the Delete action.

Badges only appear when at least one error is found — a healthy backend shows no badge. Click a badge to open a popup with the audit log pre-filtered to that mount (or role), with the "Errors only" filter checked by default. It's the same filterable audit table used on the main Audit Log page and the Role Detail Audits tab, so you can search, change filters, or turn off "Errors only" to see all activity.

::: tip Role attribution is best-effort
Errors are attributed to a role when the audit entry's path includes `role/<name>` (role admin operations) or the request body has a `role` field (e.g. login attempts). Errors that don't reference a role by name — like a malformed login request before Vault can pick a role — only count toward the mount's total, not any specific role.
:::

### Role Detail Tabs

Each role opens a detail page with the following tabs (some are type-specific):

| Tab | Visible when | Purpose |
|-----|-------------|---------|
| **Role Details** | Always | Displays all role configuration fields grouped into General and Token sections |
| **Secret IDs** | AppRole only | Generate and revoke Secret IDs for the role (see below) |
| **Developer Guide** | When a template exists or you are an admin | Integration guide with code snippets |
| **Audits** | Always | Recent Vault audit log entries for this auth mount |

## AppRole Secret ID Management

When viewing a role on an **AppRole** auth method, the **Secret IDs** tab gives you full Secret ID lifecycle management:

### Generating a Secret ID

1. Open **Access → Auth Methods**, select your AppRole mount, then click the role.
2. Click the **Secret IDs** tab.
3. Click **+ Generate Secret ID**.
4. A one-time display modal appears showing the **Secret ID** and its **Accessor**.
   - Copy both values before closing — the Secret ID is **never shown again**.
5. Click **I've saved the Secret ID** to dismiss.

### Listing Active Secret IDs

The Secret IDs tab lists all active accessor IDs. Secret ID values are never stored or retrievable; only the accessor (a reference ID) is listed. Accessors are displayed masked — only the first two and last two characters are shown (`ab••••••••••••••••12`).

### Revoking a Secret ID

Click **Revoke** next to any accessor to destroy that Secret ID. The action is permanent and cannot be undone.

::: warning Security
Secret IDs grant access to your Vault roles. Generate them only when needed, set short TTLs in the role configuration, and revoke any that are no longer in use.
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
