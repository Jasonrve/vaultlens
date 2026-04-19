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
