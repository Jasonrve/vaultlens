export const AUDIT_HELP = `VaultLens security audit
Usage: npm run audit -- COMMAND [OPTIONS]

Commands:
  collect                              Save configuration without analysis
  scan                                 Collect and analyze configuration
  analyze RUN_ID [--save] [--current-rules]
                                       Analyze offline; defaults to pinned rules
  resume RUN_ID [--checkpoint-max-age-ms N]
                                       Continue an interrupted/failed checkpoint
  refresh RUN_ID [--source SOURCE ...]  Refresh selected sources into a new run
  import-python FILE                   Import Python SQLite schema 2 or 3
  list                                 List runs for VAULT_ADDR
  diff OLD_RUN_ID NEW_RUN_ID            Compare compatible analyzed snapshots
  rules                                Print the configured rule catalog
  configure CONFIG_YAML [CUSTOM_RULES_YAML]
                                       Validate and save a rule revision
  baseline-create RUN_ID FILE          Write a native baseline
  export RUN_ID FILE [--format json|jsonl|yaml|csv]
  export-directory RUN_ID DIRECTORY    Write linked reports and resource files
  export-archive RUN_ID FILE           Write the complete report as ZIP
  help, --help, -h                      Show this help without opening a database

Collection options (collect and scan):
  --namespace PATH                     Defaults to VAULT_NAMESPACE or root
  --recursive-namespaces               Discover child namespaces
  --namespace-filter GLOB              Select after discovery; root matches root
  --policy-filter GLOB                 Select policy names
  --auth-mount-filter GLOB             Select auth mount paths
  --auth-type-filter GLOB              Select auth types
  --source SOURCE                     policies, identity, identity_aliases,
                                      mounts, auth_roles (default: all)
  Filters and --source may be repeated. Auth mounts and roles share a stage.
  --skip-identity                       Skip Identity collection
  --workers N                          Concurrent readers (default 10, max 32)
  --requests-per-second N              Shared request rate (default 10)
  --retries N                          Retry count (default 3)
  --retry-backoff-ms N                 Initial retry delay (default 500)
  --timeout-ms N                       Per-request timeout (default 30000)
  --max-duration-ms N                  Overall deadline (default 7200000)
  --max-objects N                      Object limit (default 0: unlimited)

Analysis controls (scan, analyze, resume and refresh):
  --baseline FILE                     Suppress known native fingerprints
  --exceptions FILE                   Load owned, expiring YAML exceptions
  Resume defaults to a 24-hour checkpoint age and restores collection options.
  Refresh restores source scope; omitted --source means all sources.

CI gates (scan, analyze, resume, refresh and diff):
  --fail-on none|critical|high|medium|low|info  Default: high
  --require-complete                  Default: incomplete analysis fails
  --allow-incomplete                  Explicitly allow coverage gaps
  collect also accepts completeness options.
  Exit 0: gates passed; 1: severity gate failed; 2: incomplete or error.

Source retention:
  --redact-policy-source              Available on collect, scan and exports
  Removes full policy HCL from storage/output; matched finding evidence remains.
  Offline reanalysis of omitted policy source reports a coverage gap.
  Exports refuse existing destinations. ZIP: 5000 resources / 64 MiB entry data.

Environment:
  VAULT_ADDR                          Target Vault (default http://127.0.0.1:8200)
  VAULT_TOKEN                         Required for collect/scan/resume/refresh
  VAULT_NAMESPACE                     Default namespace for collect/scan
  VAULTLENS_AUDIT_DB                   SQLite path (default data/security-audit.sqlite)
  Use a separate database from a running web server for CLI writes.
  Offline commands require no Vault token; VAULT_ADDR selects the stored target.
`;
