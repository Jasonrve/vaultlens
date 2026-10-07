# Security Audit development and CLI

The web workflow is documented in [Security Audit](../features/security-audit.md).
See [architecture](../architecture/security-audit.md) for module boundaries,
[coverage](audit-parity.md) for validation limits, and [the lab](audit-lab.md) for
repeatable synthetic data. Upstream proposal: [issue #17](https://github.com/Jasonrve/vaultlens/issues/17).

## Build and test

```sh
cd app
npm ci
npm run lint
npm run build
npm run test:security-audit
```

Node.js 22.13+ supplies built-in SQLite; no database server is needed. The test
suite exercises native detectors, Python-derived synthetic reference corpora,
coverage, namespace isolation, persistence, exports, refresh and import. The
Python generators under `scripts/` are optional development oracles; the shipped
runtime does not import or execute Python.

## CLI

Use a separate SQLite database from the running web application. Offline commands
need no token; `VAULT_ADDR` selects the stored target. Collection uses `VAULT_TOKEN`
from the environment and never reads or writes `~/.vault-token`.

```sh
# From app/, after build. Supply credentials through your normal environment.
export VAULTLENS_AUDIT_DB=/tmp/vaultlens-cli.sqlite
node dist/server/security-audit/cli.js --help
node dist/server/security-audit/cli.js scan
node dist/server/security-audit/cli.js list
node dist/server/security-audit/cli.js analyze RUN_ID --current-rules --save
node dist/server/security-audit/cli.js export RUN_ID report.json
node dist/server/security-audit/cli.js export-archive RUN_ID report.zip
```

Run `--help` for collection filters, import, refresh, checkpoint resume,
configuration, baseline and exception options. `analyze` defaults to pinned
settings; `--current-rules` opts into saved current settings. Native code always
comes from the installed engine. Without `--save`, analysis does not create a run.

Exit status: 0 means no high/critical findings within complete implemented
coverage; 1 means high/critical findings; 2 means incomplete coverage, failed
execution or invalid input. Incomplete coverage takes precedence. This CLI can be
used by CI, but manifest application/planning is not implemented by this PR.

## API

All routes below are under `/api/security-audit` and require existing VaultLens
administrator authorization. Mutations use the application's CSRF middleware.

| Method/path | Purpose |
| --- | --- |
| GET/PUT `/rules` | Catalog and optimistic configuration revision |
| GET/POST/DELETE `/runs` | Recent history, asynchronous job, atomic batch deletion |
| GET `/runs/:id` | Snapshot, findings, configuration and control annotations |
| GET `/runs/:id/export` | JSON, JSONL, YAML, CSV or ZIP |
| GET `/runs/:id/baseline` | Native baseline definition |
| GET `/diff?old=…&new=…` | Strictly compatible run comparison |
| GET/POST `/exceptions` | List/create typed exact/glob object exceptions |
| PUT/DELETE `/exceptions/:id` | Edit/delete an exception |
| PATCH `/exceptions/:id/enabled` | Enable/disable an exception; reject unsupported token presets or expired entries |
| GET `/inventory` | Current inventory, storage location and recent snapshots |
| GET `/snapshots/:id` | Immutable source snapshot |
| GET/PUT `/retention` | Read/update per-target cleanup with boolean `enabled` |
| POST `/imports/python` | Bounded SQLite import, schemas 2/3 |

POST `/runs` accepts collectionOptions for a fresh collection, or exactly one of
sourceRunId or sourceSnapshotId (reanalyze), resumeRunId, refreshRunId.
Set collectOnly to store a source snapshot without analysis. Refresh reuses saved scope and
accepts refreshSources. The response is 202 with `{id}`. Concurrent runs receive
409. The web UI no longer exposes legacy Python import; the endpoint and CLI
compatibility remain. Imported observations are analyzed with native rules; historical Python
findings are not presented as native findings.
