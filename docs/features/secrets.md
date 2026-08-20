# Secret Management

VaultLens provides a full-featured interface for browsing and editing secrets across all mounted KV engines.

## Secrets Engines

![Secrets Engines](/screenshots/secrets-engines.png)

The **Secrets** page lists all KV v1 and v2 engines with their type, accessor ID, and description. Internal engines (`identity/`, `sys/`) are hidden.

## Browsing Secrets Within an Engine

![Secrets List](/screenshots/secrets-list.png)

Click any engine to navigate its path hierarchy. Folders and secrets are listed together with breadcrumb navigation.

## Viewing a Secret

![Secret Detail](/screenshots/secret-detail.png)

Click any secret to open the detail view. Two display modes are available:

| Mode | Behaviour |
|------|-----------|
| **Key / Value** | Table rows with key names and masked values. Per-key eye icon to reveal/hide. Show all / Hide all buttons. |
| **JSON** | Full secret as a formatted JSON object. Reveal/mask toggle + copy-to-clipboard. |

Values are loaded when you open the secret (if you have `read` permission).

## Version History (KV v2)

KV v2 secrets preserve every write as a numbered version. VaultLens exposes the full version history directly in the secret detail view.

### Version dropdown

Next to the **Edit** / **Delete** buttons a **Version** selector appears once metadata loads (only for KV v2 secrets with more than one version). Choose any version from the dropdown to view its field names and values at that point in time.

While viewing a historical version an amber banner at the top of the page shows:
- Which version you are viewing
- What the current version is
- A **Restore as new version** button to promote that snapshot to the latest version

Selecting the *current* version from the dropdown returns to the normal live view.

### Version History table

Expand the **Metadata** section and scroll past Version Info to find the **Version History** table. Each row shows:

| Column | Description |
|--------|-------------|
| **Version** | Version number (e.g. `v3`) |
| **Created** | Timestamp when this version was written |
| **Status** | `Current`, `Active`, `Deleted`, or `Destroyed` |
| **Actions** | Restore as new / Compare buttons |

#### Status meanings

| Status | Meaning |
|--------|---------|
| **Current** | The latest, active version |
| **Active** | A previous version whose data is intact |
| **Deleted** | Soft-deleted — data is still in Vault but marked deleted |
| **Destroyed** | Permanently destroyed — data is gone |

#### Restore as new version

Clicking **Restore as new** on any `Active` row creates a new version whose data matches that snapshot. This always creates a new version number — it never silently overwrites the current version.

You must have `read` permission on the secret to restore it (the restore reads that version and writes it back through your own token).

### Comparing two versions

Every non-destroyed version row has a **Compare** button. Clicking it opens a full-screen diff overlay pre-loaded with that version vs the current version.

Inside the overlay you can change either version using the **From** / **To** dropdowns and click **Compare** to reload the diff.

The diff shows the JSON representation of each version, line by line:

| Highlight | Meaning |
|-----------|---------|
| Blue background with `−` | Line present in the **From** version but removed in the **To** version |
| Green background with `+` | Line added or changed in the **To** version |
| No highlight | Unchanged line |

Keys are sorted alphabetically so that unrelated reordering does not produce false-positive changes.

If you only have `list` permission (restricted access), values are shown as `••••••••` in the diff — you can still see which keys were added or removed.

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
2. Click a field to clear its placeholder, then enter the replacement value
3. Click away without entering a value to restore the placeholder and leave that field unchanged
4. Edit only the fields you want to change (empty fields are omitted from the update)
5. Submit — the backend reads the existing secret with the system token, merges your changes, and writes back using **your token**

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
