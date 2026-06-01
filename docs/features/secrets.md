# Secret Management

VaultLens provides a full-featured interface for browsing and editing secrets across all mounted KV engines.

## Browsing Secrets

The **Secrets** page lists all KV v1 and v2 engines (excluding internal engines like `identity/` and `sys/`). Navigate into any engine to browse its path hierarchy and individual secrets.

## Viewing a Secret

Click any secret to open the detail view. Two display modes are available:

| Mode | Behaviour |
|------|-----------|
| **Key / Value** | Table rows with key names and masked values. Per-key eye icon to reveal/hide. Show all / Hide all buttons. |
| **JSON** | Full secret as a formatted JSON object. Reveal/mask toggle + copy-to-clipboard. |

Values are loaded when you open the secret (if you have `read` permission).

## Editing Secrets

Click **Edit** to modify a secret. The editor supports:
- Adding / removing key-value pairs
- Editing values inline
- Updating custom metadata (for KV v2)

## Restricted-Access Secrets

When you have `list` permission on a secret path but not `read` permission:

1. VaultLens displays the **field names** (keys) but never reveals values
2. Values are permanently masked with `••••••••`
3. An amber **"Restricted access"** banner explains the situation
4. A **Partial Update** button is available

### Partial Update (Secure Merge)

The Partial Update flow lets you modify individual fields of a secret you cannot read:

1. Open the merge editor — it shows field names with `********` placeholders
2. Edit only the fields you want to change (leave others blank to preserve them)
3. Submit — the backend reads the existing secret with the system token, merges your changes, and writes back using **your token**

Vault's ACL policies still control write access. You never see values you aren't permitted to read.

## KV v2 Metadata

For KV v2 secrets, VaultLens displays:
- Current version number
- Creation and update timestamps
- Deletion state
- **Custom metadata** — editable key-value pairs

### Secret Rotation

Set `rotate-interval` in the custom metadata to enable automatic rotation. See [Secret Rotation](/features/rotation) for details.

## Path Validation

VaultLens validates secret paths on the client and server to prevent path traversal attacks. Paths are encoded with `encodeURIComponent()` before being passed to the Vault API.
