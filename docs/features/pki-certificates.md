# PKI Certificates

The Certificates workspace keeps a local inventory of public certificates from
Vault PKI engines. It uses the current Vault session and rechecks source access;
it does not require a separate Vault token or the Security Audit module.

## Inventory

Open **Monitoring → Certificates**. Select sources and search by common name,
serial number or SAN, or use advanced field conditions. Filter by usage, validity
and revocation, sort columns, and inspect the status and expiry summaries.
Source selection is saved for the browser tab and cleared on sign-out.

Certificate details include SANs, issuer information and PEM actions. Copy or
download a certificate, its verified signing chain with or without the root,
or individual CA certificates. Chain assembly verifies signatures and removes
duplicates; incomplete or ambiguous chains are not exported as complete chains.
This does not establish trust, time validity or revocation status.

Export search results as CSV, JSON or NDJSON. Selected certificates can be
exported, revoked when the session has the required Vault capability, or removed
from the local inventory by a root or `vaultlens-admin` session. Destructive
batch actions preview eligible records and require explicit confirmation.
Removing a local record does not revoke or delete its certificate in Vault.

## Sources

- **Collect All Sources** starts collection for all currently authorized sources.
- **Collect Selected** starts collection for checked sources.
- **Run Collection** starts collection for one source.
- **Refresh Source List** reloads available engines and clears comparisons.
- **Compare with Vault** lists serial numbers without downloading certificates.
  Successful comparisons are reused for two minutes in the current page.

The table shows local and Vault counts, serials **Not collected**, **Local only**,
the comparison timestamp and the last collection timestamp. Equal counts do not
imply equal sets; serials are normalized and compared as sets. Local-only records
are retained. Errors are displayed as unavailable, not zero. Comparisons check
at most two sources concurrently and revalidate mount identity after listing.

Coverage refers to the last collection, not a fresh guarantee about Vault.
Certificates issued with `no_store=true` are absent. A matching serial list does
not prove that revocation metadata is current. Lists can change during a check.
The module targets the configured Vault cluster and optional namespace; it does
not aggregate separate performance-replication clusters.

## Collection jobs

Collection history shows status, source count, processed records and failures.
**Details** expands source progress and error samples. One collection is active
at a time; a separate worker persists queue state in SQLite. **Pause** stops at a
safe request boundary. **Resume** uses the current session, retries pending and
failed records, and rereads completed records to refresh evidence.

Worker attempts fence stale writers. Source remounts or lost access stop the
operation. A conflicting certificate identity for a serial preserves the original
record and records conflict evidence. Partial observations do not prove absence.

## PKI engine workspace

PKI entries in Secrets Engines open an engine workspace for issuers, keys, roles,
certificates, URLs, CRLs, tidy settings and CA lifecycle operations. Available
operations depend on the Vault version and current session capabilities.
Certificate inventory links lead back to the live engine. Mutating operations
use explicit confirmation and the current session, not a privileged system token.

## Deployment and storage

Node.js **22.13 or later** is required for built-in SQLite support.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VAULTLENS_PKI_DB_PATH` | `data/pki-certificates.sqlite` | Durable catalog and job database |
| `VAULTLENS_PKI_NAMESPACE` | Empty | Namespace bound to this deployment |
| `VAULTLENS_PKI_CONCURRENCY` | `4` | Worker concurrency, 1–16 |
| `VAULTLENS_PKI_REQUESTS_PER_SECOND` | `20` | Per-worker request limit, 1–100 |

Use persistent storage writable by the service account. The catalog contains
public certificate data and internal names; restrict access and include it in
backup policy. Session tokens are passed to workers through IPC and are not
persisted in job records. No PKI database is committed to the repository.

Back up through SQLite so committed WAL data is included:

```sh
node dist/server/pki/maintenance.js backup /path/catalog.sqlite /path/backup.sqlite
node dist/server/pki/maintenance.js restore /path/backup.sqlite /path/restored.sqlite
```

Restore into a new destination, stop writers before switching databases, and
retain the matching application build for rollback. Do not copy only the main
SQLite file while writers are active. Allow space for the database, WAL and backups.

## Development verification

```sh
cd app
npm run build
npm run lint
npm run test:pki
```

The PKI suite covers authorization, source identity changes, query pagination,
serial comparisons, certificate conflicts, chain exports, worker recovery,
schema upgrades and backup/restore. Browser checks should cover Inventory,
Sources, comparison, collection history and native engine navigation using a
disposable Vault lab before enabling mutating operations in a real environment.
