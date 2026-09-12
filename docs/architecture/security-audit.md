# Security Audit architecture

The module shares VaultLens authentication, Express, React and the Vault HTTP
client. Collection, analysis and persistence are independent of the UI so the CLI
can use the same implementation. No additional service is required.

```text
React workspace ── authenticated /api/security-audit routes
                         │ validate request, pin settings, reserve run
                         ▼
                  Node worker thread
                         │
                GET/LIST Vault configuration
                         │
                  versioned snapshot
                         │
              native detectors + Identity graph
                         │
               exceptions / baseline evaluation
                         │
                  SQLite run + findings
                         │
               history / comparison / exports
```

## Boundaries

| Module | Responsibility |
| --- | --- |
| `routes/securityAudit.ts` | Existing auth/admin boundary, input validation, single worker admission, settings and exception CRUD, report endpoints |
| `security-audit/worker.ts` | Collection/import/reanalysis job lifecycle and progress updates |
| `collector.ts`, `requestPolicy.ts`, `concurrency.ts` | Read-only bounded requests, retry/rate policy, namespaces, allowlisted fields, checkpoints and coverage |
| `catalog.ts`, `builtinCatalog.ts` | Declarative definitions, supported detectors, profile/override validation, configuration fingerprints |
| `engine.ts` | Namespace-scoped analysis, coverage, classification and detector orchestration |
| `policyParser.ts`, `policyDetectors.ts` | Literal ACL blocks with line/source evidence and path/capability checks |
| `authDetectors.ts`, `domainChecks.ts`, `relationshipDetectors.ts` | Role settings, engine metadata and potential privilege chains |
| `identity.ts`, `assignments.ts` | Observed direct/inherited policy relationships and alias consistency |
| `store.ts` | SQLite schema, atomic run lifecycle, optimistic settings revisions and exact exceptions |
| `diff.ts`, `refresh.ts`, `resume.ts` | Compatibility checks, retained-resource merging and checkpoint reuse |
| `pythonImport.ts`, `exporter.ts`, `reportDirectory.ts`, `reportArchive.ts` | Bounded import and native output formats |
| `src/shared` | Serializable contracts and grouping/assignment helpers shared with React |

The worker receives the initiating token in memory through workerData. Tokens
are not written into snapshots, progress, SQLite or reports. Collection reads
configuration through the existing VaultClient with per-run timeout, abort signal
and namespace options. Request methods available elsewhere in VaultLens are not
used for audit remediation.

The HTTP handler returns 202 and a run ID before collection completes. A process
worker reference and SQLite's unique running-state index reject concurrent jobs.
The worker has its own SQLite connection, writes throttled progress and stores
checkpoints. Completion and failure update only running records, preventing exit
callbacks from overwriting completed runs. Interrupted jobs can be resumed with
new credentials; checkpoints do not contain credentials.

## Data model and persistence

SQLite stores immutable source payloads in `audit_snapshots`, the per-target
current snapshot pointer in `audit_inventory`, and analysis results/configuration
in `audit_runs`. Existing run payloads are migrated without rewriting history.
Settings are immutable revisions in `audit_settings`; typed exceptions and their
enabled states are target-scoped in `audit_object_exceptions`. `audit_retention`
stores the per-connection opt-in cleanup setting.
A run records its target, timestamps, state, counts, configuration, fingerprint,
engine version and coverage. Snapshot resources carry namespace and observation
time; refresh may add retained-from metadata.

Configuration is captured at dispatch. The worker uses that revision rather than
rereading mutable settings mid-run. Settings writes compare revisions in an
immediate transaction. Run deletion validates every selected target-scoped ID
before deleting any. Run deletion never cascades to snapshots or current inventory.
Enabled retention keeps the latest 100 terminal runs, preserving running jobs;
snapshot retention is unlimited. Snapshot publication and inventory advancement
use an atomic transaction with a parent-pointer concurrency check. Partial reads
retain previous observations; deletion is inferred only within completed selected
stages and filters. The database is local storage, not a distributed job queue.

Target isolation currently uses the configured Vault URL, not a cluster ID or
credential profile. Deploy separate databases for distinct security boundaries.
Manual workers can continue after a browser closes, but scheduled collection and
persistent unattended credentials are not implemented.

## Coverage and evidence

Namespace analysis is isolated before detector execution. A complete policy
inventory is required for missing-policy conclusions. LIST 404 means an empty
collection under Vault's API convention; permission/transport failures produce
gaps. Unsupported HCL expressions are not evaluated. Detectors skip deny blocks,
but this does not make them an effective ACL evaluator.

Identity inheritance reports source groups and does not establish that an entity
can currently authenticate. Sensitive management checks resolve observed mount
types and namespace boundaries instead of assuming paths named `pki/` or
`transit/`. Domain configuration collection retains only necessary fields and CA
expiry, never private key material. Stale-alias conclusions require a completed
auth mount inventory. Older snapshots missing engine metadata generate coverage
issues instead of a clean result.

Analysis produces findings first; exceptions annotate/suppress them for reporting
without deleting the original evidence. A baseline is a CLI/API compatibility
feature; the web workflow supports typed exact/glob object exceptions. Historical findings
remain unchanged after editing settings or exceptions.

## Adding a check

1. Add a declarative definition: stable ID, status, title, remediation, object
   types, default severity, native detector and parameters.
2. Reuse a registered detector where possible. `field_compare` supports direct
   allowlisted fields. `domain_configuration` uses an explicit `parameters.check`
   selector, so custom rule IDs can reuse the implementation. Validate required
   thresholds; unknown checks are rejected.
3. For a new detector, register it in the catalog and engine. Keep Vault access
   in collection, not in analysis. Define required coverage and negative cases.
4. If new data is needed, allowlist only necessary fields, assign its collection
   stage and preserve refresh/resume behavior. Do not infer absence from an old
   snapshot lacking the field or stage.
5. Add positive/negative tests, update the Checks group and documentation, and
   increment the engine version for changed analysis semantics.

Built-in YAML is packaged TypeScript data. No dynamic code loading, `eval` or
arbitrary executable plugins are involved. The current web editor manages
built-ins; custom YAML/API/CLI compatibility remains available for advanced use.

## Operational limitations

The API loads a whole run for client-side findings pagination, and exports execute
in the request process with explicit archive size limits. This needs profiling
before large-inventory deployments; server-side finding pagination and dedicated
export jobs are natural follow-ups. One server owns each database. Report access
is shared among existing VaultLens administrators, not scoped to the collecting
user. Keep this boundary explicit when deploying across namespaces.

## Temporary authentication failures

The client preserves session state for throttling and temporary failures and
respects Retry-After. Audit polling uses slower idle intervals and shares a
cooldown rather than immediately repeating requests. Backend Vault authorization
failures still invalidate the session; Vault throttling and outages retain their
transient HTTP status. This does not extend an expired Vault token.
