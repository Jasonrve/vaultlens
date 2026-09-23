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

Administrators can enable **Vault Secrets Operator resources** from **Settings → Features → Auth Methods**. The setting is global: when enabled, every Kubernetes auth mount gets a **VSO Resources** tab, and each of that mount's roles gets a role-scoped **🔗 VSO Resources** tab filtered to just the resources tied to that role. It is disabled by default for normal installations.

The tab is read-only and loads only when opened. It queries the Kubernetes endpoint configured in that auth mount and discovers every resource type exposed by the `secrets.hashicorp.com` API group, so newer VSO CRDs are included automatically. It then lists existing resources across all namespaces:

- `VaultConnection`
- `VaultAuth`
- `VaultAuthGlobal`
- `VaultStaticSecret`
- `VaultDynamicSecret`
- `VaultPKISecret`
- `SecretTransformation`
- `CSISecrets`

Each row shows a **Health** status (Healthy / Warning / Error / Unknown) derived from the object's own `status.conditions` (`Ready`/`Synced`) plus a set of relationship checks VaultLens performs on your behalf:

- A `VaultAuth`'s Vault role (`spec.kubernetes.role`) still exists on the auth mount.
- A `VaultAuth`'s bound ServiceAccount exists in the cluster.
- A secret resource's `vaultAuthRef` resolves to an actual `VaultAuth`/`VaultAuthGlobal` object.
- A secret resource's destination Secret exists, when it isn't configured to create one (`destination.create: false`).

Rows with issues show the specific problem inline (e.g. *"ServiceAccount default/foo does not exist in the cluster."*), and a **Related** column links each resource to what it depends on — click a chip to jump straight to that related object's own YAML drawer, or see it flagged in red when the reference is broken. Filter chips above the table narrow the list to just errors, warnings, healthy, or unknown resources. These relationship checks are best-effort: a permission error on any individual check (see RBAC below) is silently skipped rather than failing the whole tab, so existing installations keep working exactly as before.

Rows are sorted by health first (errors, then warnings, then unknown, then healthy), then grouped by kind (`VaultStaticSecret`, `VaultDynamicSecret`, `VaultAuth`, `VaultConnection`, others). Use the resource search above the table to filter by kind, namespace, name, or status. Select an entry to open an animated YAML drawer from the right — it now also shows the parsed conditions and issues before the raw YAML — and copy the YAML. Kubernetes managed fields are hidden from the default output so internal `f:` bookkeeping does not obscure the object; use **Show Kubernetes managed fields** when you need to inspect them. YAML keys, strings, booleans, numbers, and comments are color formatted for easier scanning. VaultLens never sends Kubernetes credentials to the browser. The VaultLens workload identity needs Kubernetes `get` and `list` permissions for the VSO resources (plus `serviceaccounts`/`secrets` for the relationship checks). If access is denied, the tab shows the Kubernetes URL configured on the Vault auth mount, the current ServiceAccount and workload role, and an example `ClusterRole`/`ClusterRoleBinding` granting read-only access across namespaces.

The feature does not browse arbitrary Kubernetes resources and does not modify VSO objects. Missing VSO CRDs are reported as unavailable rather than being shown as an empty inventory.

### Vault Secrets Operator Logs

Administrators can separately enable **Vault Secrets Operator logs** from **Settings → Features → Auth Methods**. When enabled, every Kubernetes auth mount gets a **VSO Logs** tab that tails the operator's own pod logs — useful for reconcile errors, permission failures, or operator-wide issues (leader election, webhook failures) that aren't tied to any single resource and so never show up as a condition on a VSO object.

This is a separate toggle from VSO Resources because it needs broader RBAC — `get`/`list` on `pods` and `pods/log` in the operator's namespace, in addition to the VSO CRD read scope. VaultLens looks for a pod labeled `app.kubernetes.io/name=vault-secrets-operator` in the operator's namespace, which defaults to `vault-secrets-operator-system` (the Helm chart default) and can be overridden per mount with `K8S_ACCESS_<MOUNT>_VSO_NAMESPACE`. The tab lets you pick a tail length (100–2000 lines), refresh manually, or turn on **Live tail** to poll every 5 seconds.

#### Downstream cluster access

Access to a Kubernetes auth mount's own cluster is resolved per mount, in this order:

1. **EKS IAM role, explicit override** — set `K8S_ACCESS_<MOUNT>_EKS_CLUSTER=<eks-cluster-name>` to have VaultLens sign a short-lived EKS bearer token using the IAM role attached to its own pod (via IRSA or EKS Pod Identity), instead of a static Kubernetes token. Optionally set `K8S_ACCESS_<MOUNT>_EKS_REGION` if the downstream cluster's region differs from `AWS_REGION`/`AWS_DEFAULT_REGION`. Only needed for a cluster whose API server isn't a standard AWS-generated EKS endpoint (see auto-detection below) — e.g. a custom DNS name or a VPC PrivateLink alias.
2. **EKS IAM role, auto-detected** — when the mount's `kubernetes_host` is a standard AWS-generated EKS endpoint (`https://<id>.<random>.<region>.eks.amazonaws.com`), VaultLens parses the region straight out of it and uses the pod's own IAM role to look up (`eks:ListClusters` + `eks:DescribeCluster`) which cluster in that region owns that exact endpoint, then signs a token for it — no per-mount configuration needed. This is best-effort: it silently falls through to the next step if the host doesn't match that pattern, or if the pod's IAM role can't list/describe clusters.
3. **Static bearer token** — `K8S_ACCESS_<MOUNT>=<kubernetes-bearer-token>`, used as-is.
4. **Local ServiceAccount token** — if none of the above apply, VaultLens falls back to its own pod's mounted ServiceAccount token (`VAULT_K8S_TOKEN_PATH`), which only makes sense when the Kubernetes auth mount's cluster *is* the cluster VaultLens itself runs in.

For both EKS IAM role paths, the pod's IAM role must be allowed (via the target EKS cluster's `aws-auth` ConfigMap or access entries) to authenticate, and the resulting Kubernetes identity needs `get`/`list` on the VSO resources. No token is stored anywhere — it's signed fresh for each request. Auto-detection additionally requires the pod's IAM role to have the read-only `eks:ListClusters` and `eks:DescribeCluster` permissions in that region.

When a VSO request fails, the tab's **Request diagnostics** section walks through what happened as three steps — whether the endpoint was reached, whether TLS verification passed, and whether the request was authorized — plus the raw path, HTTP or network error code, and the upstream Kubernetes API error message. HTTPS verification uses `K8S_CA_CERT_PATH` when set, otherwise the ServiceAccount `ca.crt` beside `VAULT_K8S_TOKEN_PATH`, otherwise the `kubernetes_ca_cert` already configured on that auth mount (`auth/<mount>/config`) — reusing the CA trust the admin already established for that cluster instead of requiring a second copy of it. If none of the three resolve to a certificate, the diagnostic identifies the missing CA. The server logs the same request and failure details, but never logs the bearer token.

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

Click any auth method to view its details across tabs (Configuration, Method Options, Roles, and — for Kubernetes mounts with the features enabled — VSO Resources and VSO Logs):

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
| **🔗 VSO Resources** | Kubernetes only, when VSO Resources is enabled | VSO resources whose chain (`VaultAuth` → secrets) traces back to this role, with health and relationship checks |
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
