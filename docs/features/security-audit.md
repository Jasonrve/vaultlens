# Security Audit

Security Audit reviews Vault configuration snapshots for risky policies, role
settings and Identity assignments. It is separate from request audit logs and
from the Permission Tester. A finding is a configuration assessment, not proof
that a particular person can authenticate or exploit the permission.

![Security Audit findings](/screenshots/security-audit-findings.png)

## Start an audit

1. Sign in to VaultLens with a token carrying `root` or `vaultlens-admin`, as
   required by the existing administrator middleware.
2. Open **Security Audit → Findings → Run audit**.
3. Select the namespace and optional filters, concurrency and collection limits.
4. Start the run. Collection and analysis continue in a background worker; you
   can leave the page and return through **Runs**.
5. Review coverage gaps before interpreting the findings. A completed run is not
   a certificate that Vault is secure.

The collector uses the initiating user's token. It does not require the
VaultLens system token or the background-service setup wizard. Administrator
access to the UI does not imply permission to read every Vault configuration
endpoint: denied reads are recorded as coverage gaps.

The collector uses GET/LIST requests for policy source, auth role configuration,
Identity entities/groups/aliases, mounts, PKI roles/public issuer expiry, and
Transit key metadata. It does not read secret values, issue tokens or SecretIDs,
export private keys, or change Vault configuration. Ordinary VaultLens background
services retain their existing behavior if you configure their credentials.

## Workspace tabs

| Tab | Workflow |
| --- | --- |
| Findings | Use Change run to select an analyzed result, search/filter findings and group by check or object. Check groups split by actual severity and sort critical first. Expand a finding for its reason, matched HCL block, policy assignments, technical evidence and recommendation. |
| Runs | Use Show to open findings, select runs to compare two compatible results, or delete selected finished runs. Info shows collection parameters, coverage, metrics and saved configuration. Reanalyze snapshot creates a new run using current saved checks and exceptions without fetching Vault data. |
| Reports | Select a saved run and download JSON, JSONL, YAML, CSV or a complete ZIP report. |
| Checks | Enable built-in checks, change severity, and edit supported parameters. Default severity remains visible. Save the draft before collecting or reanalyzing. |
| Exceptions | Manage a searchable exception table with per-row enable switches, object types, exact/glob paths, owner, reason and expiry. A finding also offers Exclude this object. |
| Sources | Update current inventory with scoped collection, browse immutable snapshots and update history, analyze saved snapshots, and configure run cleanup. |

Only the latest 100 runs appear in the run list. Findings and assignments have
client-side pagination; a run's detail is still loaded as one snapshot. Object
links open the current VaultLens object in a new tab, not its historical state.
Cross-namespace object links are omitted because existing object pages do not
accept the snapshot namespace.

![Security Audit checks](/screenshots/security-audit-checks.png)

## Checks and severity

The catalog covers Policies, AppRole, Kubernetes, JWT/OIDC, Token, Identity, PKI,
Transit and Assignments. Specialized checks include secrets-engine management,
token issuance/lifetime, inherited Identity privileges, certificate name/lifetime
restrictions, CA expiry, key exportability/deletion and rotation age.

The default profile enables stable rules. Review and experimental checks need an
explicit enable override or the extended profile. Enable them deliberately for
your environment; broad domain permissions or periodic tokens may be justified.
Some detectors select severity from the evidence. A saved severity override
replaces that selection. Temporal checks use the snapshot's collection end time.

Built-in rule definitions are package defaults. The UI saves environment
configuration revisions rather than modifying the definitions. Advanced custom
YAML is supported through the API/CLI for registered declarative detectors; the
current Checks UI focuses on built-in checks. Uploading executable plugins or
JavaScript is not supported.

## Exceptions and history

Exceptions have a name, enabled state, object type, check, namespace, path,
owner, reason and expiry (`YYYY-MM-DD` or `never`). Exact matching is the default;
glob matching is explicit. All-check exceptions require a specific object type.
Policy matching is limited to policy object paths and does not suppress findings
on roles or identities assigned that policy. Existing exceptions without an
explicit enabled field retain their previous enabled behavior.

Each connection receives disabled Default policy and Root policy presets, scoped
to their exact object paths in the root namespace. The disabled Bootstrap root
token preset documents an unsupported source: the collector reads token roles,
not individual tokens, so token exceptions cannot be enabled. Never enter token
values. Presets are editable and can be disabled but cannot be removed.

Exceptions apply to future analysis. Switching, editing or removing an exception
does not rewrite historical runs; reanalyze to apply current settings. Expired
exceptions cannot be re-enabled until their expiry is updated. The table appears
above Search and uses the shared pagination controls.

Reanalysis preserves collection timestamps and records a source run. Native
engine code comes from the installed application; pinning the configuration does
not retain executable copies of older engines. Run comparison requires matching
configuration/engine fingerprints and compatible collection coverage. A removed
finding means it was not observed in the comparison; it does not prove remediation.

## Deployment and storage

Requires Node.js 22.13 or newer. The existing Node 22 Docker image is supported.
There is no PostgreSQL, Redis, Python runtime or external queue requirement.

```sh
cd app
npm ci
npm run build
HOST=127.0.0.1 VAULT_ADDR=https://vault.example.com \
  VAULTLENS_AUDIT_DB=/var/lib/vaultlens/security-audit.sqlite npm start
```

Provision the writable database directory first. Without `VAULTLENS_AUDIT_DB`,
the path is `data/security-audit.sqlite` relative to the application working
directory. SQLite uses WAL; persist the directory, not just the main file. The
file is created with mode 0600. Back up with the process stopped or a SQLite-aware
backup, including WAL state. Snapshot retention is unlimited. There is no encryption at
rest. Reports and policy source should be treated as sensitive configuration.

Use one application instance per database. All VaultLens administrators can read
snapshots for the configured Vault address, even if their own collection token
has fewer permissions. This is an administrator trust boundary, not per-user or
per-namespace report isolation. Do not run a writing CLI against the live web
server's database. After a restart, stale running jobs become interrupted; no
credentials are retained. Resume requires a valid initiating token again.

## Coverage limits

- Collection is not atomic; resources may change while they are read.
- Literal ACL parsing and observed assignments do not reproduce all Vault ACL
  precedence, parameter constraints, templating or effective token permissions.
- Missing data and unsupported syntax are coverage gaps. Incomplete inventories
  suppress absence-based findings where completeness is required.
- Refresh retains previously observed resources when selected collection fails;
  retained data is not evidence of current existence or deletion.
- PKI/Transit checks require a fresh snapshot with engine configuration metadata.
  Reanalyzing an older snapshot reports the missing coverage.
- Large-cluster performance, multiple web instances and automated remediation are
  outside this first implementation. No remediation buttons write to Vault.

See [architecture](../architecture/security-audit.md) for extension points,
[CLI and development](../development/security-audit.md) for commands, and
[local lab](../development/audit-lab.md) for disposable test data.

## Local inventory and immutable snapshots

Sources now manages the current local configuration inventory, saved snapshots,
collection history and the server-side SQLite location. No additional database
service is required. This is manual synchronization; schedules and unattended
credentials are not enabled.

- **Update inventory** rereads the selected resource categories and filters,
  merges observations into the current inventory and saves a new immutable snapshot.
  **Analyze after update** additionally runs the saved checks and exceptions.
- **Analyze latest snapshot**, or **Analyze** beside an older snapshot, creates an
  analysis run without collecting Vault configuration again. Request authentication
  still validates the current session with Vault.
- The Findings **Run audit** action also updates the inventory before analysis.
- Snapshot IDs are independent of run IDs. Deleting a run does not delete its
  snapshot or the current inventory. Snapshot cleanup is not enabled yet.
- Existing completed run payloads are preserved. A one-time SQLite migration
  creates independent snapshot records and selects the latest native collection;
  a later reanalysis or imported snapshot does not become the current inventory.
- Imports remain separate. The legacy explicit historical-refresh endpoint creates
  an independent snapshot branch; it does not replace the current inventory.

Filters define the update scope, not the inventory's entire contents. For example,
refreshing `atlas-*` policies retains `cedar-*` and all untouched Identity data.
An absent object is removed from the current view only after its namespace/stage
was completely read and the object belongs to the selected filter. Errors and
limits retain previous observations. Historical snapshots still contain objects
that disappeared. No Vault deletion is performed.

Retained objects keep their original observation times. Snapshot details show the
collection interval, filters, parent snapshot and retained count. A snapshot is a
set of API observations, not an atomic Vault/Raft backup. Policy and alias absence
checks require current coverage; retained data does not imply fresh completeness.
Full policy-source redaction continues to limit later offline analysis.

The backend executes one worker job at a time. Browser closure does not cancel it;
server shutdown or token expiry can interrupt it. Snapshot publication and the
inventory pointer update occur in one SQLite transaction. Failed collections with
no usable reads leave the inventory unchanged. A successful collection remains
available even if subsequent analysis fails. A restart marks unfinished jobs
interrupted; it does not persist the browser token or silently restart them.

Storage remains protected by the existing audit administrator access checks and
partitioned by the configured Vault address. This first version assumes that an
address continues to identify the same cluster and authorization boundary; cluster
replacement and multiple independent credential profiles require explicit source
identity management before sharing a database between those deployments.

### Automatic run cleanup

Sources → Connection & storage offers a persisted, per-Vault-connection
Auto-cleanup runs checkbox. New connections default to disabled. Enabling it
immediately keeps the latest 100 finished runs ordered by finish time, then
start time and insertion order. Cleanup also runs after completion, failure,
and startup recovery. Collection-only, failed and interrupted runs count toward
the limit; running jobs do not. Disabling cleanup stops future deletions.
Snapshots and the current inventory remain intact; deleted run findings and
configuration are no longer available for viewing or comparison. This setting
does not limit snapshot disk usage. Retention changes require administrator access.

## Expanded finding examples

The following screenshots use saved disposable-lab data. They show the evidence
retained with a run; object links open the current Vault object, not its historical
state. Observed assignments do not prove effective access or token usage.

### Policy evidence

The matched HCL block and technical fields explain why the sudo capability was
flagged and identify the relevant API scope. The recommendation stays next to
the evidence.

![Expanded policy evidence](/screenshots/security-audit-finding-technical.png)

### Policy assignments

Expand Policy assignments to inspect the observed auth role, Identity entity and
group references, with separate relationship/type/namespace/path columns.

![Policy assignments and object links](/screenshots/security-audit-finding-assignments.png)

### Authentication configuration

The AppRole example connects privileged policies to weak credential settings.
The technical details retain the specific conditions used by the check.

![Expanded AppRole finding](/screenshots/security-audit-finding-approle.png)


### Check identifier changes

Token, Identity, Transit and PKI checks use their category prefix:

| Previous ID | Current ID |
| --- | --- |
| POL-005 | TOKEN-005 |
| POL-012 | TOKEN-006 |
| POL-016 | IDENTITY-004 |
| POL-017 | TRANSIT-006 |
| POL-019 | PKI-007 |

Saved configuration overrides and exception references accept the previous IDs
and expose the current IDs. Saving settings writes the current IDs. If both IDs
are present, explicitly configured fields under the current ID take precedence.
Historical findings keep their original IDs and remain readable; exceptions
match either ID. New analyses use the current IDs. As with other catalog changes,
run comparison requires matching saved analysis configurations.


### Short certificate role lifetime

`PKI-008` reports a low-severity review finding when an explicit, positive role
`ttl` or `max_ttl` is below the configurable `certificate_ttl_minimum` threshold
(default: `24h`). Zero and absent values are treated as inherited or unknown,
not as short lifetimes. Equality with the threshold does not produce a finding.

Short lifetimes can be intentional. Frequent issuance across active roles may
increase stored certificate records when storage is enabled and tidy does not
keep pace. The finding includes the observed `no_store` state; it does not claim
to measure database growth or check auto-tidy. Review renewal frequency, retention
and revocation requirements before increasing TTLs or changing certificate storage.
