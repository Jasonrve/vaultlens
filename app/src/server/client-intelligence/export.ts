import type { CoverageInfo, TopResponse, VaultClientIdentity } from '../../shared/clientIntelligence.js';

/** Escapes a CSV cell and neutralises spreadsheet formula injection (=, +, -, @, tab, CR). */
export function csvCell(v: unknown): string {
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = [
  'client_id', 'display_name', 'client_type', 'category', 'auth_backend', 'auth_mount', 'mount_accessor', 'auth_role',
  'vault_namespace', 'primary_identifier', 'backend_fields', 'source_ips', 'requests_window', 'requests_24h', 'requests_7d',
  'requests_30d', 'observed_errors', 'first_observed', 'last_observed', 'confidence', 'in_vault_activity', 'data_sources',
];

export function csvRow(c: VaultClientIdentity): string {
  return [
    c.id, c.displayName, c.clientType, c.category, c.auth.type, c.auth.mountPath, c.auth.mountAccessor, c.auth.role,
    c.vaultNamespace, c.source.primaryIdentifier.replace(/\n/g, ' '),
    c.source.fields.map((f) => `${f.label}=${f.value} [${f.source}]`).join('; '),
    c.network.observedIps.join(' '), c.activity.requests, c.activity.requests24h, c.activity.requests7d, c.activity.requests30d,
    c.activity.observedErrors, c.activity.firstObservedAt, c.activity.lastObservedAt, c.source.confidence,
    c.activity.inVaultActivity, c.origins.join(' '),
  ].map(csvCell).join(',');
}

/** Yields CSV in chunks so large inventories never need one big string. */
export function* csvChunks(clients: Iterable<VaultClientIdentity>): Generator<string> {
  yield CSV_HEADER.join(',') + '\n';
  for (const c of clients) yield csvRow(c) + '\n';
}

/** Yields a JSON document {meta, clients:[...]} in chunks. */
export function* jsonChunks(clients: Iterable<VaultClientIdentity>, meta: { days: number; coverage: CoverageInfo; exportedAt: string }): Generator<string> {
  yield `{"meta":${JSON.stringify({ ...meta, note: 'Request counts are audit-observed within coverage; Vault activity is deduplicated client usage, not request volume.' })},"clients":[`;
  let first = true;
  for (const c of clients) {
    yield (first ? '' : ',') + JSON.stringify(c);
    first = false;
  }
  yield ']}';
}

/** Top callers followed by per-auth-method totals, as two CSV sections. */
export function topCsv(t: TopResponse): string {
  const row = (cells: unknown[]) => cells.map(csvCell).join(',') + '\n';
  const pct = (n: number) => Math.round(n * 1000) / 10;
  return row(['rank', 'client_id', 'display_name', 'auth_backend', 'auth_role', 'requests', 'share_pct', 'errors', 'last_seen'])
    + t.clients.map((c, k) => row([k + 1, c.id, c.displayName, c.backend, c.role, c.requests, pct(c.share), c.errors, c.lastSeen])).join('')
    + '\n' + row(['auth_backend', 'clients', 'requests', 'share_pct'])
    + t.backends.map((b) => row([b.type, b.clients, b.requests, pct(b.share)])).join('');
}
