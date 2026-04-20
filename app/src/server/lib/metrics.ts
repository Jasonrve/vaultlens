import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from 'prom-client';

// Central Prometheus registry for VaultLens
export const register = new Registry();

// ── Default process/Node.js metrics (CPU, memory, event-loop lag, etc.) ──────
collectDefaultMetrics({ register });

// ── Incoming HTTP requests ────────────────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests received',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// ── Outgoing Vault API calls ──────────────────────────────────────────────────

export const vaultApiCallsTotal = new Counter({
  name: 'vault_api_calls_total',
  help: 'Total outgoing Vault API calls',
  labelNames: ['method', 'path_category', 'status'] as const,
  registers: [register],
});

export const vaultApiCallDurationSeconds = new Histogram({
  name: 'vault_api_call_duration_seconds',
  help: 'Outgoing Vault API call duration in seconds',
  labelNames: ['method', 'path_category'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// ── Authentication events ─────────────────────────────────────────────────────

export const authLoginsTotal = new Counter({
  name: 'vaultlens_auth_logins_total',
  help: 'Total login attempts',
  labelNames: ['method', 'result'] as const, // method: token|oidc, result: success|failure
  registers: [register],
});

export const activeSessions = new Gauge({
  name: 'vaultlens_active_sessions',
  help: 'Currently active authenticated sessions',
  registers: [register],
});

// ── Secret operations ─────────────────────────────────────────────────────────

export const secretOperationsTotal = new Counter({
  name: 'vaultlens_secrets_operations_total',
  help: 'Total secret CRUD operations',
  labelNames: ['operation'] as const, // read|write|delete|list
  registers: [register],
});

// ── Shared secrets ────────────────────────────────────────────────────────────

export const sharedSecretsCreatedTotal = new Counter({
  name: 'vaultlens_shared_secrets_created_total',
  help: 'Total encrypted shared secrets created',
  registers: [register],
});

export const sharedSecretsRetrievedTotal = new Counter({
  name: 'vaultlens_shared_secrets_retrieved_total',
  help: 'Total encrypted shared secrets retrieved',
  registers: [register],
});

// ── Backup operations ─────────────────────────────────────────────────────────

export const backupsTotal = new Counter({
  name: 'vaultlens_backups_total',
  help: 'Total backup operations',
  labelNames: ['result'] as const, // success|failure
  registers: [register],
});

// ── Secret rotation ───────────────────────────────────────────────────────────

export const rotationRunsTotal = new Counter({
  name: 'vaultlens_rotation_runs_total',
  help: 'Total secret rotation scheduler runs',
  labelNames: ['result'] as const, // success|failure
  registers: [register],
});

export const rotationSecretsRotated = new Counter({
  name: 'vaultlens_rotation_secrets_rotated_total',
  help: 'Total individual secrets rotated',
  registers: [register],
});

// ── Webhook firings ───────────────────────────────────────────────────────────

export const webhookFiresTotal = new Counter({
  name: 'vaultlens_webhook_fires_total',
  help: 'Total webhook HTTP deliveries',
  labelNames: ['result'] as const, // success|failure
  registers: [register],
});

export const webhookDeliveryDurationSeconds = new Histogram({
  name: 'vaultlens_webhook_delivery_duration_seconds',
  help: 'Outgoing webhook HTTP delivery duration in seconds',
  labelNames: ['result'] as const, // success|failure
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// ── Policy init ───────────────────────────────────────────────────────────────

export const policyInitTotal = new Counter({
  name: 'vaultlens_policy_init_total',
  help: 'Total policy initialisation attempts on startup',
  labelNames: ['result'] as const,
  registers: [register],
});

// ── Token validation (auth middleware) ────────────────────────────────────────

export const tokenValidationsTotal = new Counter({
  name: 'vaultlens_token_validations_total',
  help: 'Total Vault token validation attempts in auth middleware',
  labelNames: ['result'] as const, // success|failure
  registers: [register],
});

// ── Policy route operations ───────────────────────────────────────────────────

export const policyOperationsTotal = new Counter({
  name: 'vaultlens_policy_operations_total',
  help: 'Total ACL policy operations',
  labelNames: ['operation'] as const, // list|read
  registers: [register],
});

// ── Permission test operations ────────────────────────────────────────────────

export const permissionTestsTotal = new Counter({
  name: 'vaultlens_permission_tests_total',
  help: 'Total permission/capability test requests',
  labelNames: ['test_type'] as const, // self|entity
  registers: [register],
});

// ── Identity route operations ─────────────────────────────────────────────────

export const identityOperationsTotal = new Counter({
  name: 'vaultlens_identity_operations_total',
  help: 'Total identity/entity/group operations',
  labelNames: ['entity_type', 'operation'] as const, // entity|group, list|read
  registers: [register],
});

// ── Graph route operations ────────────────────────────────────────────────────

export const graphQueriesTotal = new Counter({
  name: 'vaultlens_graph_queries_total',
  help: 'Total relationship graph queries',
  labelNames: ['graph_type', 'cache_hit'] as const, // auth-policy|policy-secret|identity|entity-permissions, true|false
  registers: [register],
});

export const graphComputationDurationSeconds = new Histogram({
  name: 'vaultlens_graph_computation_duration_seconds',
  help: 'Time to compute a relationship graph (cache misses only)',
  labelNames: ['graph_type'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const graphNodeCount = new Gauge({
  name: 'vaultlens_graph_node_count',
  help: 'Number of nodes in the last computed graph',
  labelNames: ['graph_type'] as const,
  registers: [register],
});

export const graphEdgeCount = new Gauge({
  name: 'vaultlens_graph_edge_count',
  help: 'Number of edges in the last computed graph',
  labelNames: ['graph_type'] as const,
  registers: [register],
});

// ── Auth method route operations ──────────────────────────────────────────────

export const authMethodOperationsTotal = new Counter({
  name: 'vaultlens_auth_method_operations_total',
  help: 'Total auth method management operations',
  labelNames: ['operation'] as const, // list|read|configure|tune|roles_list|roles_read
  registers: [register],
});

// ── Audit watcher metrics ─────────────────────────────────────────────────────

export const auditEventsProcessedTotal = new Counter({
  name: 'vaultlens_audit_events_processed_total',
  help: 'Total audit log entries processed by the watcher',
  registers: [register],
});

export const auditWatcherLagSeconds = new Gauge({
  name: 'vaultlens_audit_watcher_lag_seconds',
  help: 'Estimated lag between Vault audit log write time and webhook delivery',
  registers: [register],
});

// ── Branding / config route operations ───────────────────────────────────────

export const brandingUpdatesTotal = new Counter({
  name: 'vaultlens_branding_updates_total',
  help: 'Total branding configuration updates',
  registers: [register],
});

// ── Config storage backend operations ────────────────────────────────────────

export const configStorageOpsTotal = new Counter({
  name: 'vaultlens_config_storage_ops_total',
  help: 'Total config storage backend operations',
  labelNames: ['operation', 'backend'] as const, // get|set|delete|list, file|vault
  registers: [register],
});

export const configStorageDurationSeconds = new Histogram({
  name: 'vaultlens_config_storage_duration_seconds',
  help: 'Config storage operation duration in seconds',
  labelNames: ['operation', 'backend'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

// ── Error tracking ────────────────────────────────────────────────────────────

export const applicationErrorsTotal = new Counter({
  name: 'vaultlens_application_errors_total',
  help: 'Total application errors handled by the error handler',
  labelNames: ['status_code', 'error_type'] as const, // vault_error|application_error
  registers: [register],
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

export const rateLimitHitsTotal = new Counter({
  name: 'vaultlens_rate_limit_hits_total',
  help: 'Total requests that hit the rate limiter (accepted + rejected)',
  registers: [register],
});

export const rateLimitRejectedTotal = new Counter({
  name: 'vaultlens_rate_limit_rejected_total',
  help: 'Total requests rejected by the rate limiter (429 responses)',
  registers: [register],
});

// ── Response sizes ────────────────────────────────────────────────────────────

export const httpResponseSizeBytes = new Histogram({
  name: 'http_response_size_bytes',
  help: 'HTTP response body size in bytes',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [register],
});

// ── Backup extended metrics ───────────────────────────────────────────────────

export const backupDurationSeconds = new Histogram({
  name: 'vaultlens_backup_duration_seconds',
  help: 'Duration of backup operations in seconds',
  labelNames: ['result'] as const,
  buckets: [0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

export const lastBackupTimestamp = new Gauge({
  name: 'vaultlens_last_backup_timestamp_seconds',
  help: 'Unix timestamp of the last successful backup',
  registers: [register],
});

export const lastBackupSecretsCount = new Gauge({
  name: 'vaultlens_last_backup_secrets_count',
  help: 'Number of secrets in the last successful backup',
  registers: [register],
});

export const lastBackupSizeBytes = new Gauge({
  name: 'vaultlens_last_backup_size_bytes',
  help: 'Size in bytes of the last successful backup',
  registers: [register],
});

// ── Rotation extended metrics ─────────────────────────────────────────────────

export const rotationDurationSeconds = new Histogram({
  name: 'vaultlens_rotation_duration_seconds',
  help: 'Duration of a full rotation scheduler run in seconds',
  labelNames: ['result'] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
});

export const rotationScheduledCount = new Gauge({
  name: 'vaultlens_rotation_scheduled_count',
  help: 'Number of secrets currently configured for auto-rotation',
  registers: [register],
});

// ── Shared secrets active count ───────────────────────────────────────────────

export const sharedSecretsActiveCount = new Gauge({
  name: 'vaultlens_shared_secrets_active',
  help: 'Current number of active (non-expired) shared secrets',
  registers: [register],
});

// ── Helper to normalise Vault paths into low-cardinality category labels ──────
// e.g. /auth/token/lookup-self -> auth/token, /secret/data/foo/bar -> kv/data
export function categoriseVaultPath(path: string): string {
  const p = path.replace(/^\//, '');
  if (p.startsWith('auth/token')) return 'auth/token';
  if (p.startsWith('auth/approle')) return 'auth/approle';
  if (p.startsWith('auth/oidc')) return 'auth/oidc';
  if (p.startsWith('auth/')) return 'auth/other';
  if (p.startsWith('sys/auth')) return 'sys/auth';
  if (p.startsWith('sys/policies')) return 'sys/policies';
  if (p.startsWith('sys/policy')) return 'sys/policy';
  if (p.startsWith('sys/mounts')) return 'sys/mounts';
  if (p.startsWith('sys/audit')) return 'sys/audit';
  if (p.startsWith('sys/health')) return 'sys/health';
  if (p.startsWith('sys/seal')) return 'sys/seal';
  if (p.startsWith('sys/storage/raft')) return 'sys/raft';
  if (p.startsWith('sys/internal/counters')) return 'sys/counters';
  if (p.startsWith('sys/')) return 'sys/other';
  if (p.startsWith('cubbyhole/')) return 'cubbyhole';
  if (p.startsWith('identity/')) return 'identity';
  // KV v2 paths: <mount>/data/... or <mount>/metadata/...
  if (/^[^/]+\/data\//.test(p)) return 'kv/data';
  if (/^[^/]+\/metadata\//.test(p)) return 'kv/metadata';
  if (/^[^/]+\/delete\//.test(p)) return 'kv/delete';
  if (/^[^/]+\/destroy\//.test(p)) return 'kv/destroy';
  if (/^[^/]+\/undelete\//.test(p)) return 'kv/undelete';
  return 'other';
}
