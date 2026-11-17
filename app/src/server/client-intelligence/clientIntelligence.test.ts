import test from 'node:test';
import assert from 'node:assert/strict';
import { VaultError } from '../lib/vaultClient.js';
import { classifyActivityError, countingDisabled, parseActivityExport, parseActivitySummary } from './activity.js';
import { parseAwsArn, resetClaimMap, resolveIdentity, sanitizeMetadata } from './resolvers.js';
import { ClientIntelStore, GRACE_MS, MAX_UNATTRIBUTED_KEYS, pairAuditEntries, type RawAudit } from './store.js';
import { ClientIntelService, coverageFor, ipMatches, type Ctx, type Deps } from './service.js';
import { csvCell, csvChunks, jsonChunks } from './export.js';

const ctx: Ctx = { token: 't', principal: 'p' };
const NOW = Date.parse('2026-06-15T12:00:00Z');
const rec = (o: Record<string, unknown>) => ({ client_id: 'c1', client_type: 'entity', mount_accessor: 'auth_k8s_1', mount_path: 'auth/kubernetes/', mount_type: 'kubernetes', timestamp: '2026-06-01T00:00:00Z', ...o });

test('export parser: NDJSON, multi-line array, CSV; dedupes months per client+mount', async () => {
  const nd = await parseActivityExport([JSON.stringify(rec({})), JSON.stringify(rec({ timestamp: '2026-05-01T00:00:00Z' })), JSON.stringify(rec({ client_id: 'c2' }))]);
  assert.equal(nd.length, 2);
  assert.equal(nd.find((c) => c.clientId === 'c1')!.months, 2);
  assert.equal(nd.find((c) => c.clientId === 'c1')!.timestamp, '2026-06-01T00:00:00Z');
  const arr = await parseActivityExport(['[', JSON.stringify(rec({})) + ',', JSON.stringify(rec({ client_id: 'c2' })), ']']);
  assert.equal(arr.length, 2);
  const one = await parseActivityExport([JSON.stringify([rec({}), rec({ client_id: 'c3' })])]);
  assert.equal(one.length, 2);
  const csv = await parseActivityExport(['client_id,client_type,mount_type,mount_accessor,entity_alias_name', 'a1,entity,userpass,auth_up_1,"smith, al"', 'bad,,']);
  assert.equal(csv[0]!.aliasName, 'smith, al');
  assert.equal((await parseActivityExport(['{not json'])).length, 0);
});

test('same client on two mounts of the same type stays two clients', async () => {
  const r = await parseActivityExport([JSON.stringify(rec({})), JSON.stringify(rec({ mount_accessor: 'auth_k8s_2', mount_path: 'auth/k8s-prod/' }))]);
  assert.equal(r.length, 2);
});

test('activity summary parsing and version/permission classification', () => {
  const s = parseActivitySummary({ data: { start_time: 'a', end_time: 'b', total: { clients: 9 }, months: [{ timestamp: '2026-05-01T00:00:00Z', counts: { distinct_entities: 2, non_entity_tokens: 3 } }] } });
  assert.deepEqual([s.total, s.months], [9, [{ month: '2026-05', clients: 5 }]]);
  assert.equal(parseActivitySummary({}).total, null);
  assert.equal(classifyActivityError(new VaultError('denied', 403)).reason, 'forbidden');
  assert.equal(classifyActivityError(new VaultError('nope', 404)).reason, 'unsupported');
  assert.equal(classifyActivityError(new VaultError('client counting is disabled', 400)).reason, 'disabled');
  // Real Vault 1.17 response when nothing has been recorded yet
  assert.equal(classifyActivityError(new VaultError('1 error occurred: * no data to export in provided time range', 500)).reason, 'no_data');
  assert.equal(countingDisabled({ data: { enabled: 'default-disabled' } }), true);
  assert.equal(countingDisabled({ data: { enabled: 'default-enabled' } }), false);
  assert.equal(countingDisabled(undefined), false);
  // Real Vault 1.17 empty summary: zeros, no months
  const empty = parseActivitySummary({ data: { start_time: 'a', end_time: 'b', months: [], total: { distinct_entities: 0, entity_clients: 0, non_entity_tokens: 0, non_entity_clients: 0, clients: 0 } } });
  assert.deepEqual([empty.total, empty.months.length], [0, 0]);
});

test('kubernetes: namespace/SA/role; partial metadata lowers confidence', () => {
  const full = resolveIdentity({ mountType: 'kubernetes', aliasName: 'uid-1', role: 'payments', metadata: { service_account_namespace: 'payments', service_account_name: 'payments-api' } });
  assert.equal(full.confidence, 'high');
  assert.match(full.primaryIdentifier, /namespace: payments\nsa: payments-api/);
  assert.equal(full.fields.find((f) => f.key === 'cluster'), undefined); // never guessed
  assert.equal(resolveIdentity({ mountType: 'kubernetes', aliasName: 'uid', metadata: {} }).confidence, 'low');
});

test('aws: account and ARN parsing, unresolvable ARN not invented', () => {
  assert.deepEqual(parseAwsArn('arn:aws:sts::123456789012:assumed-role/billing/i-0abc'), { account: '123456789012', type: 'role', name: 'billing' });
  assert.equal(parseAwsArn('arn:aws:iam::12:role/x'), undefined);
  const r = resolveIdentity({ mountType: 'aws', aliasName: 'AROAXXXX', metadata: { canonical_arn: 'arn:aws:iam::123456789012:role/billing' } });
  assert.equal(r.fields.find((f) => f.key === 'account')!.value, '123456789012');
  const u = resolveIdentity({ mountType: 'aws', aliasName: 'AROAXXXX', metadata: {} });
  assert.equal(u.fields.find((f) => f.key === 'account'), undefined);
  assert.equal(u.confidence, 'medium');
});

test('github repository only from mapped claims; approle exposes role id but not secrets', () => {
  const user = resolveIdentity({ mountType: 'github', aliasName: 'octocat', metadata: { org: 'acme' } });
  assert.equal(user.fields.find((f) => f.key === 'repository'), undefined);
  assert.match(user.primaryIdentifier, /user: octocat/);
  const jwt = resolveIdentity({ mountType: 'jwt', aliasName: 'repo:acme/app:ref:main', metadata: { repository: 'acme/app', workflow: 'deploy' } });
  assert.equal(jwt.category, 'Automation');
  assert.match(jwt.primaryIdentifier, /repo: acme\/app/);
  const ar = resolveIdentity({ mountType: 'approle', aliasName: 'role-id-1', role: 'ci', metadata: { secret_id: 'S3CR3T' } });
  assert.ok(!JSON.stringify(ar).includes('S3CR3T'));
  assert.ok(ar.fields.some((f) => f.key === 'roleId'));
});

test('oidc custom claim mapping, cert, ldap, token, and unknown backends', () => {
  process.env['VAULTLENS_CLIENT_INTEL_CLAIM_MAP'] = JSON.stringify({ Department: ['dept'] });
  resetClaimMap();
  const o = resolveIdentity({ mountType: 'oidc', aliasName: 'sub-1', metadata: { email: 'a@x.io', dept: 'eng' } });
  assert.equal(o.fields.find((f) => f.label === 'Department')!.value, 'eng');
  assert.equal(o.primaryIdentifier, 'a@x.io');
  delete process.env['VAULTLENS_CLIENT_INTEL_CLAIM_MAP'];
  resetClaimMap();
  assert.match(resolveIdentity({ mountType: 'cert', aliasName: 'svc.example.com', metadata: {} }).primaryIdentifier, /CN: svc/);
  assert.equal(resolveIdentity({ mountType: 'ldap', aliasName: 'jdoe', metadata: {} }).category, 'Human');
  assert.equal(resolveIdentity({ mountType: 'token', metadata: {} }).confidence, 'low');
  const g = resolveIdentity({ mountType: 'fancy-plugin', aliasName: 'x', metadata: { a: 'b' } });
  assert.equal(g.platform, 'fancy-plugin');
  assert.equal(g.confidence, 'medium');
  assert.equal(resolveIdentity({ mountType: '', metadata: {} }).confidence, 'unknown');
});

test('sanitizeMetadata drops secret-like keys, control chars and nested values', () => {
  const m = sanitizeMetadata({ secret_id: 'x', client_token: 'y', ok: 'a\u0000b\nc', nested: { a: 1 }, n: null, big: 'z'.repeat(2000) });
  assert.deepEqual(Object.keys(m).sort(), ['big', 'ok']);
  assert.equal(m['ok'], 'a b c');
  assert.equal(m['big']!.length, 512);
});

const aud = (id: string, time: string, o: Partial<RawAudit> & { ip?: string; err?: string; entity?: string; acc?: string; resp?: boolean } = {}): RawAudit[] => {
  const auth = o.entity || o.acc ? { entity_id: o.entity, accessor: o.acc, display_name: 'dn' } : undefined;
  const out: RawAudit[] = [{ type: 'request', time, auth, request: { id, operation: 'read', path: 'secret/x', remote_address: o.ip ?? '10.0.0.1' } }];
  if (o.resp !== false) out.push({ type: 'response', time, error: o.err, request: { id }, auth });
  return out;
};

test('audit pairing counts each logical request once; login identity comes from response auth', () => {
  const login: RawAudit[] = [
    { type: 'request', time: '2026-06-15T11:00:00Z', request: { id: 'L', remote_address: '1.1.1.1', path: 'auth/k/login' } },
    { type: 'response', time: '2026-06-15T11:00:00Z', request: { id: 'L' }, response: { auth: { entity_id: 'ent-1' } } },
  ];
  const all = [...aud('a', '2026-06-15T11:00:00Z', { entity: 'e1' }), ...aud('a', '2026-06-15T11:00:00Z', { entity: 'e1' }), ...login];
  const r = pairAuditEntries(all, 0, NOW);
  assert.equal(r.length, 2);
  assert.equal(r.find((x) => x.id === 'L')!.key, 'ent-1');
});

test('ingest is idempotent, applies grace window, counts errors and groups anonymous by IP', () => {
  const s = new ClientIntelStore(':memory:', 90);
  const entries = [
    ...aud('1', '2026-06-15T11:00:00Z', { entity: 'e1', ip: '10.0.0.1' }),
    ...aud('2', '2026-06-15T11:30:00Z', { entity: 'e1', ip: '10.0.0.2', err: 'permission denied' }),
    ...aud('3', '2026-06-15T11:40:00Z', { ip: '9.9.9.9' }),
    ...aud('4', new Date(NOW - 2000).toISOString(), { entity: 'e1' }), // inside the grace window
  ];
  assert.equal(s.ingest(entries, NOW), 3);
  assert.equal(s.ingest(entries, NOW), 0);
  assert.equal(s.ingest(entries, NOW + 60_000), 1); // request 4 now past grace, counted once
  assert.equal(s.ingest(entries, NOW + 120_000), 0);
  const agg = s.aggregate(30, NOW + 120_000);
  const e1 = agg.find((a) => a.key === 'e1')!;
  assert.equal(e1.requests, 3);
  assert.equal(e1.errors, 1);
  assert.deepEqual(e1.ips.map((i) => i.ip).sort(), ['10.0.0.1', '10.0.0.2']);
  assert.ok(agg.some((a) => a.key === 'anon:9.9.9.9'));
  assert.equal(GRACE_MS, 10_000);
});

test('request windows (24h/7d/30d) and retention', () => {
  const s = new ClientIntelStore(':memory:', 30);
  const day = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
  s.ingest([...aud('a', day(0.5), { entity: 'e' }), ...aud('b', day(3), { entity: 'e' }), ...aud('c', day(20), { entity: 'e' }), ...aud('old', day(40), { entity: 'e' })], NOW + GRACE_MS);
  const a = s.aggregate(30, NOW + GRACE_MS).find((x) => x.key === 'e')!;
  assert.deepEqual([a.r24h, a.r7d, a.r30d], [1, 2, 3]); // 40-day-old request fell outside 30-day retention
  assert.equal(s.aggregate(1, NOW + GRACE_MS)[0]!.requests, 1);
});

test('coverage: partial when collection started recently, unavailable when nothing ingested', () => {
  const s = new ClientIntelStore(':memory:', 90);
  assert.equal(coverageFor(s, 30, NOW, 90).auditAvailable, false);
  s.ingest(aud('a', new Date(NOW - 2 * 86_400_000).toISOString(), { entity: 'e' }), NOW);
  const c = coverageFor(s, 30, NOW, 90);
  assert.equal(c.partial, true);
  assert.ok(c.coveredDays >= 1.9 && c.coveredDays <= 2.1);
  assert.equal(coverageFor(s, 1, NOW, 90).partial, false);
});

async function svc(over: Partial<Deps> = {}, entries: RawAudit[] = []) {
  const store = new ClientIntelStore(':memory:', 90);
  const act = await parseActivityExport([
    JSON.stringify(rec({ client_id: 'e-k8s', entity_alias_name: 'uid-1', entity_alias_metadata: { service_account_namespace: 'payments', service_account_name: 'payments-api' } })),
    JSON.stringify(rec({ client_id: 'e-aws', mount_accessor: 'auth_aws_1', mount_path: 'auth/aws-prod/', mount_type: 'aws', entity_alias_name: 'AROA1', entity_alias_metadata: { canonical_arn: 'arn:aws:iam::123456789012:role/billing' } })),
    JSON.stringify(rec({ client_id: 'e-aws2', mount_accessor: 'auth_aws_2', mount_path: 'auth/aws-dev/', mount_type: 'aws', entity_alias_name: 'AROA1', entity_alias_metadata: { canonical_arn: 'arn:aws:iam::999999999999:role/billing' } })),
    JSON.stringify(rec({ client_id: 'tok1', client_type: 'non-entity-token', mount_accessor: 'auth_token_1', mount_path: 'auth/token/', mount_type: 'token' })),
    JSON.stringify(rec({ client_id: 'weird', mount_accessor: 'auth_x', mount_path: 'auth/x/', mount_type: '' })),
  ]);
  const service = new ClientIntelService({
    store, retentionDays: 90, now: () => NOW + GRACE_MS,
    loadActivity: async () => ({ status: { available: true, exportAvailable: true }, clients: act, total: 5, months: [] }),
    loadMounts: async () => ({}), rawAudit: async () => entries, ...over,
  });
  return { service, store };
}

test('service joins audit to activity by entity id; identical alias names on different mounts stay separate', async () => {
  const entries = [...aud('1', '2026-06-15T11:00:00Z', { entity: 'e-k8s', ip: '10.42.18.21' }), ...aud('2', '2026-06-15T11:01:00Z', { entity: 'e-k8s', ip: '10.42.19.14' }), ...aud('3', '2026-06-15T11:02:00Z', { ip: '203.0.113.42' })];
  const { service } = await svc({}, entries);
  await service.ingest();
  const { clients, total } = await service.list(ctx, { days: 30, sort: 'requests', dir: 'desc', limit: 50 });
  assert.equal(total, 6); // 5 activity + 1 anonymous audit-only
  const k = clients.find((c) => c.id === 'e-k8s')!;
  assert.equal(k.activity.requests, 2);
  assert.deepEqual(k.network.observedIps.sort(), ['10.42.18.21', '10.42.19.14']);
  assert.ok(k.origins.includes('audit') && k.origins.includes('vault-activity'));
  assert.notEqual(clients.find((c) => c.id === 'e-aws')!.auth.mountPath, clients.find((c) => c.id === 'e-aws2')!.auth.mountPath);
  const anon = clients.find((c) => c.id === 'anon:203.0.113.42')!;
  assert.equal(anon.source.confidence, 'unknown');
  assert.equal(anon.clientType, 'unauthenticated');
  const s = await service.summary(ctx, 30);
  assert.equal(s.uniqueClients, 5);
  assert.equal(s.activeClients, 2);
  assert.equal(s.uniqueIps, 3);
  assert.ok(s.unattributed! >= 3); // token, weird, anonymous
});

test('filters: backend, mount, namespace search, ARN/account search, CIDR, unidentified, confidence', async () => {
  const entries = [...aud('1', '2026-06-15T11:00:00Z', { entity: 'e-k8s', ip: '10.42.18.21' })];
  const { service } = await svc({}, entries);
  await service.ingest();
  const q = (o: object) => service.list(ctx, { days: 30, limit: 50, ...o });
  assert.deepEqual((await q({ backend: 'aws' })).clients.map((c) => c.id).sort(), ['e-aws', 'e-aws2']);
  assert.deepEqual((await q({ mount: 'auth/aws-dev/' })).clients.map((c) => c.id), ['e-aws2']);
  assert.deepEqual((await q({ search: 'payments' })).clients.map((c) => c.id), ['e-k8s']);
  assert.deepEqual((await q({ search: '123456789012' })).clients.map((c) => c.id), ['e-aws']);
  assert.deepEqual((await q({ ip: '10.42.0.0/16' })).clients.map((c) => c.id), ['e-k8s']);
  assert.equal((await q({ ip: '10.43.0.0/16' })).total, 0);
  assert.ok((await q({ unidentified: true })).clients.every((c) => ['low', 'unknown'].includes(c.source.confidence)));
  assert.equal((await q({ confidence: 'high' })).total, 3);
  assert.equal((await service.backends(ctx, 30)).backends.find((b) => b.type === 'aws')!.count, 2);
});

test('pagination and sorting are server-side and stable', async () => {
  const { service } = await svc();
  const p1 = await service.list(ctx, { days: 30, sort: 'client', dir: 'asc', limit: 2, offset: 0 });
  const p2 = await service.list(ctx, { days: 30, sort: 'client', dir: 'asc', limit: 2, offset: 2 });
  assert.equal(p1.total, 5);
  assert.equal(p1.clients.length, 2);
  assert.notEqual(p1.clients[0]!.id, p2.clients[0]!.id);
  const names = [...p1.clients, ...p2.clients].map((c) => c.displayName.toLowerCase());
  assert.deepEqual(names, [...names].sort());
});

test('activity API unavailable: no fabricated clients or counts; audit-only data still served', async () => {
  const forbidden = classifyActivityError(new VaultError('denied', 403));
  const entries = aud('1', '2026-06-15T11:00:00Z', { entity: 'ent-only', ip: '10.0.0.5' });
  const { service } = await svc({ loadActivity: async () => ({ status: forbidden, clients: [], total: null, months: [] }) }, entries);
  await service.ingest();
  const s = await service.summary(ctx, 30);
  assert.equal(s.uniqueClients, null);
  assert.equal(s.activity.reason, 'forbidden');
  assert.equal(s.activeClients, 1);
  const { clients } = await service.list(ctx, { days: 30 });
  assert.equal(clients.length, 1);
  assert.equal(clients[0]!.activity.inVaultActivity, false);
});

test('no audit data: request metrics are unknown rather than zero', async () => {
  const { service } = await svc();
  const s = await service.summary(ctx, 30);
  assert.equal(s.activeClients, null);
  assert.equal(s.uniqueIps, null);
  assert.equal(s.coverage.auditAvailable, false);
  assert.equal((await service.list(ctx, { days: 30 })).clients[0]!.activity.requests, undefined);
});

test('activity cache is per principal; audit-only clients are still addressable', async () => {
  let loads = 0;
  const entries = aud('r-1', '2026-06-15T11:00:00Z', { entity: 'e-k8s', ip: '10.0.0.9' });
  const { service } = await svc({ loadActivity: async (_d, c) => { loads++; return { status: { available: true, exportAvailable: true }, clients: [], total: c.principal === 'p' ? 1 : 2, months: [] }; } }, entries);
  await service.ingest();
  await service.summary(ctx, 30);
  await service.summary(ctx, 30);
  assert.equal(loads, 1);
  await service.summary({ token: 'x', principal: 'other' }, 30);
  assert.equal(loads, 2);
  const audOnly = (await service.detail(ctx, 'e-k8s', 30))!; // not in activity: served as an audit-only client
  assert.equal(audOnly.client.activity.inVaultActivity, false);
});

test('detail for an activity client includes audit evidence', async () => {
  const entries = aud('r-1', '2026-06-15T11:00:00Z', { entity: 'e-k8s', ip: '10.0.0.9' });
  const { service } = await svc({}, entries);
  await service.ingest();
  const d = (await service.detail(ctx, 'e-k8s', 30))!;
  assert.equal(d.evidence[0]!.requestId, 'r-1');
  assert.equal(d.evidence[0]!.ip, '10.0.0.9');
  assert.equal(d.history.length, 1);
  assert.equal(await service.detail(ctx, 'nope', 30), undefined);
});

test('ipMatches handles exact, CIDR and invalid input', () => {
  assert.ok(ipMatches('10.1.2.3', '10.1.2.3'));
  assert.ok(ipMatches('10.1.2.3', '10.1.0.0/16'));
  assert.ok(!ipMatches('10.2.2.3', '10.1.0.0/16'));
  assert.ok(!ipMatches('10.1.2.3', '10.1.0.0/40'));
  assert.ok(ipMatches('1.2.3.4', '0.0.0.0/0'));
});

test('exports: formula injection neutralised, CSV quoting, JSON is valid and carries window metadata', async () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell(undefined), '');
  const { service } = await svc();
  const { clients, coverage } = await service.all(ctx, { days: 30, backend: 'aws' });
  const csv = [...csvChunks(clients)].join('');
  assert.equal(csv.trim().split('\n').length, 3);
  const json = JSON.parse([...jsonChunks(clients, { days: 30, coverage, exportedAt: 'now' })].join(''));
  assert.equal(json.clients.length, 2);
  assert.equal(json.meta.days, 30);
  assert.ok(!JSON.stringify(json).includes('client_token'));
  const evil = (await service.all(ctx, { days: 30 })).clients[0]!;
  evil.displayName = '=cmd|calc';
  assert.ok([...csvChunks([evil])].join('').includes(`'=cmd|calc`));
});

test('audit-only entities are enriched via the identity API when the export is unavailable', async () => {
  const entries = aud('1', '2026-06-15T11:00:00Z', { entity: 'ent-ar', ip: '10.1.1.1' });
  const noExport = async () => ({ status: { available: true, exportAvailable: false }, clients: [], total: 1, months: [] });
  const { service } = await svc({
    loadActivity: noExport,
    loadMounts: async () => ({ acc_ar: { path: 'auth/approle/', type: 'approle' } }),
    loadEntities: async () => new Map([['ent-ar', { name: 'entity_x', aliases: [{ mountAccessor: 'acc_ar', name: 'role-id-123', metadata: { role_name: 'app-backend' } }] }]]),
  }, entries);
  await service.ingest();
  const c = (await service.list(ctx, { days: 30 })).clients[0]!;
  assert.equal(c.auth.type, 'approle');
  assert.equal(c.auth.mountPath, 'auth/approle/');
  assert.equal(c.displayName, 'app-backend');
  assert.equal(c.source.confidence, 'high');
  assert.ok(c.origins.includes('identity-api'));
  assert.equal(c.activity.inVaultActivity, false);
  // a failing identity lookup degrades to an unresolved client rather than failing the list
  const { service: s2 } = await svc({ loadActivity: noExport, loadEntities: async () => { throw new Error('403'); } }, entries);
  await s2.ingest();
  assert.equal((await s2.list(ctx, { days: 30 })).clients[0]!.source.confidence, 'low');
});

test('activity-export clients without alias data are completed from the identity API by mount accessor', async () => {
  const act = await parseActivityExport([JSON.stringify(rec({ client_id: 'ent-u', mount_accessor: 'acc_up', mount_path: 'auth/userpass/', mount_type: 'userpass' }))]);
  const { service } = await svc({
    loadActivity: async () => ({ status: { available: true, exportAvailable: true }, clients: act, total: 1, months: [] }),
    loadEntities: async () => new Map([['ent-u', { name: 'e', aliases: [{ mountAccessor: 'other', name: 'wrong', metadata: {} }, { mountAccessor: 'acc_up', name: 'alice', metadata: {} }] }]]),
  });
  const c = (await service.list(ctx, { days: 30 })).clients[0]!;
  assert.equal(c.identity.aliasName, 'alice');
  assert.equal(c.displayName, 'alice');
  assert.equal(c.source.confidence, 'high');
  assert.ok(c.origins.includes('vault-activity') && c.origins.includes('identity-api'));
});

test('activity can be bucketed hourly for freshly started collection', async () => {
  const entries = [...aud('h1', new Date(NOW - 3 * 3_600_000).toISOString(), { entity: 'e-k8s' }), ...aud('h2', new Date(NOW - 3_600_000).toISOString(), { entity: 'e-k8s' })];
  const { service } = await svc({}, entries);
  await service.ingest();
  const h = await service.activity(ctx, 1, undefined, 'hour');
  assert.equal(h.bucket, 'hour');
  assert.equal(h.points.length, 2);
  assert.match(h.points[0]!.day, /^\d{4}-\d{2}-\d{2}T\d{2}$/);
  assert.equal((await service.activity(ctx, 1)).points.length, 1); // same requests, one UTC day bucket
});

test('friendly titles: Kubernetes shows the service account, AWS the role name (not UID / full ARN)', () => {
  const k = resolveIdentity({ mountType: 'kubernetes', aliasName: 'sa-uid-123', metadata: { service_account_namespace: 'shop', service_account_name: 'cart-service' } });
  assert.equal(k.title, 'cart-service');
  const a = resolveIdentity({ mountType: 'aws', aliasName: 'arn:aws:iam::123456789012:role/data-etl', metadata: {} });
  assert.equal(a.title, 'data-etl');
  assert.equal(resolveIdentity({ mountType: 'aws', aliasName: 'AROA1', metadata: {} }).title, undefined);
});

test('role: captured from audit token metadata (k8s), IAM role fallback for AWS, existing alias role wins', async () => {
  const withRole = (id: string, role: string, entity: string): RawAudit[] => [
    { type: 'request', time: '2026-06-15T11:00:00Z', auth: { entity_id: entity, accessor: 'acc', metadata: { role } }, request: { id, remote_address: '10.0.0.1' } },
    { type: 'response', time: '2026-06-15T11:00:00Z', request: { id } },
  ];
  const entries = [...withRole('r1', 'payments-role', 'e-k8s'), ...withRole('r2', 'ignored-for-approle', 'e-aws')];
  const { service, store } = await svc({}, entries);
  await service.ingest();
  assert.equal(store.aggregate(30, NOW + 60_000).find((a) => a.key === 'e-k8s')!.role, 'payments-role');
  const { clients } = await service.list(ctx, { days: 30, limit: 50 });
  const k = clients.find((c) => c.id === 'e-k8s')!;
  assert.equal(k.auth.role, 'payments-role');
  assert.ok(k.source.evidence.some((e) => e.includes('audit token metadata')));
  // AWS client whose ARN is known gets the IAM role as a labelled fallback only when no auth role was observed
  const aws2 = clients.find((c) => c.id === 'e-aws2')!;
  assert.equal(aws2.auth.role, 'billing');
  assert.ok(aws2.source.evidence.some((e) => e.includes('IAM role parsed from the ARN')));
  // role stored on first sight survives later requests without metadata
  const s2 = new ClientIntelStore(':memory:', 90);
  s2.ingest(withRole('a', 'keep-me', 'ent'), NOW);
  s2.ingest(aud('b', '2026-06-15T11:30:00Z', { entity: 'ent' }), NOW + 60_000);
  assert.equal(s2.aggregate(30, NOW + 60_000).find((a) => a.key === 'ent')!.role, 'keep-me');
});

test('top ranks clients by requests and totals requests per auth method', async () => {
  const entries = [...aud('1', '2026-06-15T11:00:00Z', { entity: 'e-k8s', ip: '10.0.0.1' }), ...aud('2', '2026-06-15T11:01:00Z', { entity: 'e-k8s', ip: '10.0.0.1' }), ...aud('3', '2026-06-15T11:02:00Z', { entity: 'e-aws', ip: '10.0.0.2' })];
  const { service } = await svc({}, entries);
  await service.ingest();
  const t = await service.top(ctx, 30);
  assert.equal(t.totalRequests, 3);
  assert.deepEqual(t.clients.map((c) => [c.id, c.requests]), [['e-k8s', 2], ['e-aws', 1]]);
  assert.deepEqual(t.backends.map((b) => [b.type, b.requests, b.clients]), [['kubernetes', 2, 1], ['aws', 1, 1]]);
  assert.ok(Math.abs(t.clients[0]!.share - 2 / 3) < 1e-9);
});

const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

test('old hourly rows roll into daily rows without changing window totals, history or the 90-day retention', () => {
  const s = new ClientIntelStore(':memory:', 90);
  const e = [...aud('a', ago(0.5), { entity: 'e' }), ...aud('b', ago(20), { entity: 'e', ip: '10.0.0.9' }), ...aud('c', ago(60), { entity: 'e' }), ...aud('old', ago(100), { entity: 'e' })];
  s.ingest(e, NOW + GRACE_MS);
  const hourly = (s.db.prepare('SELECT COUNT(*) n FROM buckets').get() as { n: number }).n;
  const daily = (s.db.prepare('SELECT COUNT(*) n FROM buckets_daily').get() as { n: number }).n;
  assert.equal(hourly, 1); // only the request inside the hourly window stays hourly
  assert.equal(daily, 2); // 20d and 60d rolled up; the 100d one is past retention
  const a = s.aggregate(90, NOW + GRACE_MS).find((x) => x.key === 'e')!;
  assert.equal(a.requests, 3);
  assert.deepEqual(a.ips.map((i) => i.ip).sort(), ['10.0.0.1', '10.0.0.9']);
  assert.equal(s.daily(90, NOW + GRACE_MS).reduce((n, r) => n + r.requests, 0), 3);
  // maintenance is idempotent: running it again must not move or double count anything
  s.db.prepare('DELETE FROM meta WHERE k=?').run('maintained_hour');
  s.ingest([], NOW + 2 * GRACE_MS);
  assert.equal(s.aggregate(90, NOW + 2 * GRACE_MS).find((x) => x.key === 'e')!.requests, 3);
});

test('clients with no rows left are forgotten, and anonymous/token clients are capped', () => {
  const s = new ClientIntelStore(':memory:', 90);
  s.ingest(aud('x', ago(100), { entity: 'gone' }), NOW + GRACE_MS);
  s.ingest(aud('y', new Date(NOW + 1000).toISOString(), { entity: 'kept' }), NOW + 2 * GRACE_MS);
  s.db.prepare('DELETE FROM meta WHERE k=?').run('maintained_hour');
  s.ingest([], NOW + 3 * GRACE_MS);
  const keys = (s.db.prepare('SELECT client_key k FROM clients').all() as { k: string }[]).map((r) => r.k);
  assert.deepEqual(keys, ['kept']);

  const s2 = new ClientIntelStore(':memory:', 90);
  const many = Array.from({ length: MAX_UNATTRIBUTED_KEYS + 5 }, (_, i) => aud(`r${i}`, ago(0.5), { ip: `10.1.${Math.floor(i / 250)}.${i % 250}` })).flat();
  s2.ingest(many, NOW + GRACE_MS);
  const anon = (s2.db.prepare("SELECT COUNT(DISTINCT client_key) n FROM buckets WHERE client_key LIKE 'anon:%'").get() as { n: number }).n;
  assert.equal(anon, MAX_UNATTRIBUTED_KEYS + 1); // + the overflow bucket
  const total = s2.aggregate(30, NOW + GRACE_MS).reduce((n, a) => n + a.requests, 0);
  assert.equal(total, MAX_UNATTRIBUTED_KEYS + 5); // nothing is dropped, only merged
});

test('a full audit buffer that starts after the watermark is reported as a data gap', () => {
  const s = new ClientIntelStore(':memory:', 90);
  s.ingest(aud('a', ago(0.1), { entity: 'e' }), NOW);
  const later = Array.from({ length: 10 }, (_, i) => aud(`b${i}`, new Date(NOW + 60_000 + i).toISOString(), { entity: 'e' })).flat();
  s.ingest(later, NOW + 2 * 60_000, 20); // 20 entries == capacity, oldest is after the watermark: older entries were overwritten
  assert.ok(s.coverage().gapAt);
  const s2 = new ClientIntelStore(':memory:', 90);
  s2.ingest(aud('a', ago(0.1), { entity: 'e' }), NOW);
  s2.ingest(later.slice(0, 4), NOW + 2 * 60_000, 20); // buffer far from full: just a quiet period
  assert.equal(s2.coverage().gapAt, undefined);
});
