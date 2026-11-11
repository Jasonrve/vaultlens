import type { Page, Route } from '@playwright/test';
import type { ClientSummary, VaultClientIdentity, Confidence, ClientDetailResponse } from '../src/shared/clientIntelligence';

// MOCK DATA ONLY — synthetic clients for UI tests. Never shown as live Vault data.
const NOW = Date.now();
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

type Seed = {
  id: string; name: string; type: string; mount: string; cat: VaultClientIdentity['category']; conf: Confidence;
  primary: string; ips: string[]; req?: number; fields?: [string, string, string][]; clientType?: string; role?: string;
};

const seeds: Seed[] = [
  { id: 'k1', name: 'payments-api', type: 'kubernetes', mount: 'auth/kubernetes/', cat: 'Workload', conf: 'high', primary: 'namespace: payments\nsa: payments-api', ips: ['10.42.18.21', '10.42.19.14', '10.42.20.33'], req: 184392, role: 'payments',
    fields: [['namespace', 'Kubernetes namespace', 'payments'], ['serviceAccount', 'Service account', 'payments-api'], ['role', 'Auth role', 'payments']] },
  { id: 'k2', name: 'vault-operator', type: 'kubernetes', mount: 'auth/kubernetes/', cat: 'Workload', conf: 'high', primary: 'namespace: vault\nsa: vault-operator', ips: ['10.42.0.12'], req: 12441,
    fields: [['namespace', 'Kubernetes namespace', 'vault'], ['serviceAccount', 'Service account', 'vault-operator']] },
  { id: 'g1', name: 'github-actions-prod', type: 'github', mount: 'auth/github/', cat: 'Automation', conf: 'high', primary: 'repo: org/platform-infra', ips: ['20.201.28.151'], req: 22413,
    fields: [['repository', 'Repository', 'org/platform-infra'], ['org', 'Organization', 'org']] },
  { id: 'g2', name: 'terraform-ci', type: 'github', mount: 'auth/github/', cat: 'Automation', conf: 'high', primary: 'repo: org/iac\nworkflow: terraform', ips: ['20.201.12.44'], req: 19220,
    fields: [['repository', 'Repository', 'org/iac'], ['workflow', 'Workflow', 'terraform']] },
  { id: 'a1', name: 'billing-lambda-prod', type: 'aws', mount: 'auth/aws/', cat: 'Workload', conf: 'high', primary: 'arn:aws:iam::123456789012:role/billing-lambda-prod', ips: ['52.95.110.4'], req: 71104, role: 'billing-lambda-prod',
    fields: [['account', 'AWS account ID', '123456789012'], ['arn', 'IAM principal ARN', 'arn:aws:iam::123456789012:role/billing-lambda-prod'], ['principalType', 'Principal type', 'role']] },
  { id: 'a2', name: 'reporting-ec2', type: 'aws', mount: 'auth/aws-dev/', cat: 'Workload', conf: 'medium', primary: 'alias: AROAEXAMPLE', ips: ['52.95.110.9'], req: 310, fields: [], role: 'reporting-ec2' },
  { id: 'r1', name: 'ci-approle', type: 'approle', mount: 'auth/approle/', cat: 'Automation', conf: 'medium', primary: 'role: ci-approle\nrole_id: a1b2c3…', ips: ['172.18.4.12'], req: 8109, role: 'ci-approle',
    fields: [['role', 'AppRole role name', 'ci-approle'], ['roleId', 'Role ID', 'a1b2c3d4']] },
  { id: 'o1', name: 'alice.smith', type: 'oidc', mount: 'auth/oidc/', cat: 'Human', conf: 'high', primary: 'alice.smith@example.com', ips: ['196.30.55.18'], req: 391, fields: [['Email', 'Email', 'alice.smith@example.com']] },
  { id: 't1', name: 'legacy-token-sync', type: 'token', mount: 'auth/token/', cat: 'Service', conf: 'low', primary: 'display: legacy-token-sync', ips: ['10.0.6.55'], req: 3991, clientType: 'non-entity-token' },
  { id: 'l1', name: 'jdoe', type: 'ldap', mount: 'auth/ldap/', cat: 'Human', conf: 'high', primary: 'username: jdoe', ips: ['10.20.1.88'], req: 1210 },
  { id: 'anon:203.0.113.42', name: 'Unauthenticated (203.0.113.42)', type: 'unknown', mount: '', cat: 'Unknown', conf: 'unknown', primary: 'unresolved (see audit logs)', ips: ['203.0.113.42'], req: 88, clientType: 'unauthenticated' },
];
// Pad the inventory so pagination (25/page) has a second page.
for (let i = 0; i < 20; i++) seeds.push({ id: `u${i}`, name: `batch-user-${String(i).padStart(2, '0')}`, type: 'userpass', mount: 'auth/userpass/', cat: 'Human', conf: 'high', primary: `username: batch-user-${i}`, ips: [`192.168.1.${i + 10}`], req: 5 + i });

export function client(s: Seed, audit = true): VaultClientIdentity {
  return {
    id: s.id, vaultClientId: s.id.startsWith('anon:') ? undefined : s.id, displayName: s.name, clientType: s.clientType ?? 'entity', category: s.cat,
    auth: { type: s.type, mountPath: s.mount || undefined, mountAccessor: s.mount ? `auth_${s.type}_1` : undefined, role: s.role },
    identity: { entityId: s.id, aliasName: s.name, metadata: {} },
    source: {
      platform: s.type, primaryIdentifier: s.primary, confidence: s.conf,
      fields: (s.fields ?? []).map(([key, label, value]) => ({ key, label, value, source: 'identity-api' as const })),
      evidence: [s.conf === 'unknown' ? 'requests with no authenticated identity; grouped by source IP only' : `resolved by ${s.type} resolver`, 'listed in Vault client activity'],
    },
    network: { observedIps: audit ? s.ips : [], lastObservedIp: s.ips[0], ips: audit ? s.ips.map((ip, i) => ({ ip, requests: Math.round((s.req ?? 0) / (i + 2)), firstSeen: iso(5000), lastSeen: iso(10 + i) })) : [] },
    activity: audit
      ? { inVaultActivity: !s.id.startsWith('anon:'), requests: s.req, requests24h: Math.round((s.req ?? 0) / 20), requests7d: Math.round((s.req ?? 0) / 4), requests30d: s.req, observedErrors: 3, firstObservedAt: iso(5000), lastObservedAt: iso(12) }
      : { inVaultActivity: true },
    origins: audit ? ['vault-activity', 'identity-api', 'audit'] : ['vault-activity', 'identity-api'],
  };
}

export interface MockOptions { audit?: boolean; activityUnavailable?: boolean; failExport?: boolean; partialCoverage?: boolean; slowClients?: number }

export function summary(o: MockOptions, days = 30): ClientSummary {
  const audit = o.audit !== false;
  return {
    uniqueClients: o.activityUnavailable ? null : 306, activeClients: audit ? 138 : null, unattributed: 8, uniqueIps: audit ? 412 : null, windowDays: days,
    coverage: { auditAvailable: audit, collectionStartedAt: audit ? iso(o.partialCoverage ? 3 * 1440 : 40 * 1440) : undefined, lastIngestedAt: iso(1), requestedDays: days, coveredDays: o.partialCoverage ? 3 : days, partial: !!o.partialCoverage },
    activity: o.activityUnavailable ? { available: false, exportAvailable: false, reason: 'forbidden', message: 'Your token cannot read sys/internal/counters/activity.' } : { available: true, exportAvailable: true },
    retentionDays: 90,
  };
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Installs a fake VaultLens API (auth, layout calls and Client Intelligence) on the page. */
export async function mockApi(page: Page, o: MockOptions = {}) {
  const audit = o.audit !== false;
  const all = seeds.map((s) => client(s, audit));
  const calls: { url: string }[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api/, '');
    const q = url.searchParams;
    calls.push({ url: route.request().url() });
    if (p === '/auth/me') return json(route, { tokenInfo: { display_name: 'admin', policies: ['vaultlens-admin'], identity_policies: [], ttl: 0 } });
    if (p === '/sys-token-setup/status') return json(route, { hasSystemToken: true, source: 'static', approleConfigured: true, servicesEnabled: true });
    if (p === '/sys-token-setup/health-check') return json(route, { healthy: true, issues: [] });
    if (p === '/client-intelligence/summary') return json(route, summary(o, Number(q.get('days') ?? 30)));
    if (p === '/client-intelligence/backends') {
      const m = new Map<string, number>();
      for (const c of all) m.set(c.auth.type, (m.get(c.auth.type) ?? 0) + 1);
      return json(route, { backends: [...m].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count), mounts: [...new Set(all.map((c) => c.auth.mountPath).filter(Boolean))].sort() });
    }
    if (p === '/client-intelligence/activity') {
      const backend = q.get('backend');
      const days = Math.max(Number(q.get('days') ?? 30), 2);
      const points = !audit ? [] : Array.from({ length: Math.min(days, o.partialCoverage ? 3 : days) }, (_, i) => {
        const day = new Date(NOW - (Math.min(days, o.partialCoverage ? 3 : days) - 1 - i) * 86_400_000).toISOString().slice(0, 10);
        const byBackend: Record<string, number> = { kubernetes: 4000 + i * 50, aws: 1500, github: 900, approle: 400, oidc: 120 };
        const filtered = backend ? Object.fromEntries(Object.entries(byBackend).filter(([k]) => k === backend)) : byBackend;
        return { day, total: Object.values(filtered).reduce((a, b) => a + b, 0), byBackend: filtered };
      });
      return json(route, { points, coverage: summary(o).coverage, vaultMonthly: [{ month: '2026-05', clients: 280 }, { month: '2026-06', clients: 306 }] });
    }
    if (p === '/client-intelligence/export') {
      if (o.failExport) return json(route, { error: 'Vault unreachable' }, 502);
      const rows = ['client_id,display_name', ...all.map((c) => `${c.id},${c.displayName}`)].join('\n');
      return route.fulfill({ status: 200, contentType: 'text/csv', headers: { 'content-disposition': 'attachment; filename="x.csv"', ...(o.activityUnavailable ? { 'x-export-partial': 'true' } : {}) }, body: rows });
    }
    const detail = /^\/client-intelligence\/clients\/(.+)$/.exec(p);
    if (detail) {
      const c = all.find((x) => x.id === decodeURIComponent(detail[1]!));
      if (!c) return json(route, { error: 'Client not found' }, 404);
      const body: ClientDetailResponse = {
        client: c, coverage: summary(o).coverage,
        history: audit ? Array.from({ length: 14 }, (_, i) => ({ day: `2026-06-${String(i + 1).padStart(2, '0')}`, requests: 50 + ((i * 37) % 90) })) : [],
        evidence: audit ? Array.from({ length: c.id === 'a1' ? 12 : 1 }, (_, i) => ({ time: iso(12 + i), requestId: i === 0 ? 'b7d1c2e0-aaaa-bbbb-cccc-1234567890ab' : `b7d1c2e${i}-aaaa-bbbb-cccc-1234567890ab`, operation: 'read', path: 'secret/data/payments', ip: c.network.observedIps[0] ?? '', error: false })) : [],
      };
      return json(route, body);
    }
    if (p === '/client-intelligence/clients') {
      if (o.slowClients) await new Promise((r) => setTimeout(r, o.slowClients));
      let list = all;
      const s = q.get('search')?.toLowerCase();
      if (q.get('backend')) list = list.filter((c) => c.auth.type === q.get('backend'));
      if (q.get('mount')) list = list.filter((c) => c.auth.mountPath === q.get('mount'));
      if (q.get('clientType')) list = list.filter((c) => c.category === q.get('clientType'));
      if (q.get('confidence')) list = list.filter((c) => c.source.confidence === q.get('confidence'));
      if (q.get('unidentified') === 'true') list = list.filter((c) => ['low', 'unknown'].includes(c.source.confidence));
      if (q.get('ip')) list = list.filter((c) => c.network.observedIps.some((ip) => ip.startsWith(q.get('ip')!.replace(/\/\d+$/, '').replace(/(\.0)+$/, ''))));
      if (s) list = list.filter((c) => JSON.stringify([c.displayName, c.source, c.network.observedIps, c.auth]).toLowerCase().includes(s));
      const dir = q.get('dir') === 'asc' ? 1 : -1;
      const key = q.get('sort') ?? 'requests';
      list = [...list].sort((a, b) => {
        const va = key === 'client' ? a.displayName.toLowerCase() : (a.activity.requests ?? -1);
        const vb = key === 'client' ? b.displayName.toLowerCase() : (b.activity.requests ?? -1);
        return va < vb ? -dir : va > vb ? dir : 0;
      });
      const offset = Number(q.get('offset') ?? 0);
      const limit = Number(q.get('limit') ?? 25);
      return json(route, { clients: list.slice(offset, offset + limit), total: list.length, offset, limit, coverage: summary(o).coverage });
    }
    return json(route, { error: 'not mocked' }, 404);
  });
  return { calls };
}
