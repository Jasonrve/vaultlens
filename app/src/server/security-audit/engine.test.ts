import { canonicalCheckId } from '../../shared/auditCheckIds.js';
import { exceptionMatches } from './exceptions.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditStore } from './store.js';
import { analyze } from './engine.js';
import type { AuditSnapshot } from '../../shared/securityAudit.js';
const snapshot = (): AuditSnapshot => ({
  version: 1,
  target: 'http://example.invalid',
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  issues: [],
  policiesComplete: true,
  resources: [
    {
      kind: 'policy',
      path: 'sys/policies/acl/team%20read',
      data: { name: 'team read', hcl: '# not evaluated' },
    },
    {
      kind: 'role',
      path: 'auth/kubernetes/role/demo',
      data: {
        auth_type: 'kubernetes',
        token_policies: ['team read', 'missing'],
        bound_service_account_names: ['*'],
        bound_service_account_namespaces: ['*'],
      },
    },
  ],
});
test('missing policy and unbounded Kubernetes role, without parsing HCL', () => {
  const findings = analyze(snapshot());
  assert.deepEqual(
    findings.map((f) => f.ruleId),
    ['assignment.missing-policy', 'kubernetes.unbounded-subject'],
  );
  assert.match(findings[0].evidence, /missing/);
});
test('incomplete collection cannot establish a missing policy', () => {
  const s = snapshot();
  s.policiesComplete = false;
  assert.deepEqual(
    analyze(s).map((f) => f.ruleId),
    ['kubernetes.unbounded-subject'],
  );
});
test('AppRole bound and unbound controls', () => {
  const s = snapshot();
  s.resources = [
    {
      kind: 'role',
      path: 'auth/approle/role/demo',
      data: { auth_type: 'approle', bind_secret_id: false },
    },
  ];
  assert.equal(analyze(s)[0]?.ruleId, 'approle.unbound-login');
  s.resources[0].data.token_bound_cidrs = ['127.0.0.1/32'];
  assert.equal(analyze(s).length, 0);
  s.resources[0].data.token_bound_cidrs = [];
  s.resources[0].data.bind_secret_id = true;
  assert.equal(analyze(s).length, 0);
});
test('durable snapshot, target isolation, one running job and crash recovery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lens-audit-test-'));
  const db = join(dir, 'audit.sqlite');
  let store = new AuditStore(db);
  try {
    const s = snapshot();
    const id = store.create(s.target);
    assert.throws(() => store.create(s.target));
    store.finish(id, s, analyze(s));
    store.fail(id);
    assert.equal(store.get(id, s.target)?.run.status, 'completed');
    assert.equal(store.get(id, 'http://another.invalid'), null);
    const interrupted = store.create(s.target);
    store.close();
    store = new AuditStore(db);
    store.recover();
    assert.equal(store.get(interrupted, s.target)?.run.status, 'interrupted');
    assert.equal(store.get(id, s.target)?.findings.length, 2);
    assert.equal(
      readFileSync(db).subarray(0, 15).toString(),
      'SQLite format 3',
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

import { catalog, DEFAULT_SETTINGS, parseRule } from './catalog.js';
import { execute } from './engine.js';
const customRule = `version: 1
rule:
  id: CUSTOM-TTL
  status: stable
  severity: low
  finding_kind: risky_configuration
  title: Team TTL limit
  description: Team roles should use short-lived tokens.
  remediation: Reduce token_ttl.
  object_types: [kubernetes_role]
  detector: field_compare
  parameters: {field: token_ttl, operator: greater_than, value: 3600}
`;
test('catalog validates YAML, profiles, overrides and duplicate IDs without executing expressions', () => {
  const definitions = catalog(DEFAULT_SETTINGS);
  assert.equal(
    definitions.filter(
      (r) => r.source === 'builtin' && !r.id.startsWith('LOCAL-'),
    ).length,
    59,
  );
  assert.equal(definitions.find((r) => r.id === 'POL-008')?.active, false);
  const extended = catalog({
    ...DEFAULT_SETTINGS,
    configYaml:
      'version: 1\nprofile: extended\nrules:\n  POL-008: {severity: low}\n',
  });
  assert.equal(
    extended.find((r) => r.id === 'POL-008')?.effectiveSeverity,
    'low',
  );
  assert.equal(extended.find((r) => r.id === 'POL-008')?.active, true);
  assert.throws(
    () => parseRule(customRule.replace('field_compare', 'eval')),
    /Unregistered/,
  );
  assert.throws(() =>
    parseRule(customRule.replace('value: 3600', 'value: 3600, value: 10')),
  );
  assert.throws(
    () =>
      catalog({
        ...DEFAULT_SETTINGS,
        customRulesYaml: customRule + '\n---\n' + customRule,
      }),
    /Duplicate/,
  );
  assert.throws(
    () =>
      catalog({
        ...DEFAULT_SETTINGS,
        configYaml: 'version: 1\nrules: {TYPO: {enabled: true}}',
      }),
    /Unknown/,
  );
});
test('custom rule runs with scoped object types and severity overrides', () => {
  const s = snapshot();
  s.resources[1].data.token_ttl = 7200;
  const settings = {
    ...DEFAULT_SETTINGS,
    customRulesYaml: customRule,
    configYaml:
      'version: 1\nprofile: extended\nrules:\n  CUSTOM-TTL: {severity: critical}\n',
  };
  const result = execute(s, settings);
  assert.equal(
    result.findings.find((f) => f.ruleId === 'CUSTOM-TTL')?.severity,
    'critical',
  );
  assert.ok(
    !result.configuration.issues.some((i) => i.path.startsWith('rules/')),
  );
  assert.equal(result.configuration.fingerprint.length, 64);
  s.resources[1].data.auth_type = 'approle';
  assert.equal(
    execute(s, settings).findings.some((f) => f.ruleId === 'CUSTOM-TTL'),
    false,
  );
});
test('settings revisions reject lost updates and historical runs retain their own configuration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-settings-'));
  const store = new AuditStore(join(dir, 'db.sqlite'));
  try {
    const current = store.settings();
    const saved = store.saveSettings({
      ...current,
      customRulesYaml: customRule,
    });
    assert.equal(saved.revision, 1);
    assert.throws(() => store.saveSettings(current), /Settings changed/);
    const s = snapshot();
    const result = execute(s, saved);
    const id = store.create(s.target);
    store.finish(id, s, result.findings, result.configuration);
    store.saveSettings({ ...saved, customRulesYaml: '' });
    assert.equal(store.get(id, s.target)?.configuration?.revision, 1);
    assert.equal(
      store.get(id, s.target)?.configuration?.customRulesYaml,
      customRule,
    );
    assert.equal(store.get(id, s.target)?.run.status, 'completed');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

import authFixtures from './fixtures/auth-parity.json' with { type: 'json' };
import { AUTH_DETECTORS, evaluateAuth } from './authDetectors.js';
test('auth detectors match Python evidence and severity across synthetic controls and thresholds', () => {
  const definitions = catalog({
    ...DEFAULT_SETTINGS,
    configYaml: 'version: 1\nprofile: extended\n',
  }).filter((r) => AUTH_DETECTORS.includes(r.detector));
  const mismatches: unknown[] = [];
  for (const fixture of authFixtures) {
    const actual = definitions
      .flatMap((rule) =>
        evaluateAuth(rule, fixture.resource, { config: fixture.config }),
      )
      .map((f) => ({
        ruleId: f.ruleId,
        severity: f.severity,
        evidence: JSON.parse(f.evidence),
      }))
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
    try {
      assert.deepEqual(actual, fixture.expected.map(f => ({ ...f, ruleId: canonicalCheckId(f.ruleId) })));
    } catch {
      mismatches.push({
        name: fixture.name,
        actual,
        expected: fixture.expected,
      });
    }
  }
  assert.deepEqual(mismatches, []);
});
test('runtime severity is preserved unless an explicit configuration override changes it', () => {
  const s = snapshot();
  s.resources = [
    {
      kind: 'role',
      path: 'auth/approle/role/test',
      data: {
        auth_type: 'approle',
        bind_secret_id: false,
        secret_id_bound_cidrs: ['127.0.0.1/32'],
      },
    },
  ];
  const settings = {
    ...DEFAULT_SETTINGS,
    configYaml: 'version: 1\nrules:\n  APPROLE-004: {enabled: true}\n',
  };
  assert.equal(
    execute(s, settings).findings.find((f) => f.ruleId === 'APPROLE-004')
      ?.severity,
    'info',
  );
  settings.configYaml =
    'version: 1\nrules:\n  APPROLE-004: {enabled: true, severity: high}\n';
  assert.equal(
    execute(s, settings).findings.find((f) => f.ruleId === 'APPROLE-004')
      ?.severity,
    'high',
  );
});

import policyFixtures from './fixtures/policy-parity.json' with { type: 'json' };
import { parsePolicy, PolicyParseError } from './policyParser.js';
import {
  POLICY_DETECTORS,
  evaluatePolicy,
  vaultPatternMatches,
} from './policyDetectors.js';
test('policy detectors and lexical source information match the Python corpus', () => {
  const definitions = catalog({
    ...DEFAULT_SETTINGS,
    configYaml: 'version: 1\nprofile: extended\n',
  }).filter((r) => POLICY_DETECTORS.includes(r.detector));
  const mounts = [
    ['secret/', 'kv'],
    ['secret/nested/', 'kv'],
    ['cubbyhole/', 'cubbyhole'],
  ].map(([mount, type]) => ({
    kind: 'secret-mount',
    path: `sys/mounts/${mount}`,
    data: { mount_path: mount, type },
  }));
  const mismatches: unknown[] = [];
  for (const fixture of policyFixtures) {
    try {
      const blocks = parsePolicy(fixture.source);
      assert.deepEqual(
        JSON.parse(JSON.stringify(blocks.map(({ column, ...b }) => b))),
        fixture.blocks,
      );
      const resource = {
        kind: 'policy',
        path: 'sys/policies/acl/demo',
        data: { name: 'demo', hcl: fixture.source },
      };
      const actual = definitions
        .flatMap((rule) => evaluatePolicy(rule, resource, blocks, mounts))
        .map((f) => ({
          ruleId: f.ruleId,
          severity: f.severity,
          evidence: JSON.parse(f.evidence),
          line: f.line,
          matchedBlock: f.matchedBlock,
        }))
        .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
      assert.deepEqual(actual, fixture.expected.map(f => ({ ...f, ruleId: canonicalCheckId(f.ruleId) })));
    } catch (error) {
      mismatches.push({ name: fixture.name, error: String(error) });
    }
  }
  assert.deepEqual(mismatches, []);
});
test('malformed or unsupported policy syntax produces diagnostics instead of invented grants', () => {
  for (const source of [
    'path "*" {capabilities=["read"]',
    '/* never closed',
    'path "*" { capabilities=var.caps }',
    'path "*" { capabilities=["read"] capabilities=["sudo"] }',
    'path "*" {capabilities=["read",42]}',
  ])
    assert.throws(() => parsePolicy(source), PolicyParseError);
  assert.equal(parsePolicy('# path "*" {capabilities=["sudo"]}').length, 0);
  assert.equal(
    vaultPatternMatches('secret/+/data/*', 'secret/team/data/item'),
    true,
  );
  assert.equal(
    vaultPatternMatches('secret/+/data/*', 'secret/team/extra/data/item'),
    false,
  );
});
test('disabled policy findings still supply privilege signals to role checks', () => {
  const s = snapshot();
  s.resources = [
    {
      kind: 'policy',
      path: 'sys/policies/acl/danger',
      data: { name: 'danger', hcl: 'path "*" {capabilities=["update"]}' },
    },
    {
      kind: 'role',
      path: 'auth/approle/role/demo',
      data: {
        auth_type: 'approle',
        token_policies: ['danger'],
        bind_secret_id: false,
      },
    },
  ];
  const result = execute(s, {
    ...DEFAULT_SETTINGS,
    configYaml: 'version: 1\nrules:\n  POL-001: {enabled: false}\n',
  });
  assert.equal(
    result.findings.some((f) => f.ruleId === 'POL-001'),
    false,
  );
  const role = result.findings.find((f) => f.ruleId === 'APPROLE-008');
  assert.equal(role?.severity, 'critical');
  assert.deepEqual(JSON.parse(role!.evidence).privileged_policies, {
    danger: ['POL-001'],
  });
  assert.equal(result.configuration.issues.length, 0);
  s.resources[0].data.hcl = 'path "*" {capabilities = var.caps}';
  assert.ok(
    execute(s, DEFAULT_SETTINGS).configuration.issues.some(
      (i) => i.path === 'sys/policies/acl/danger',
    ),
  );
});

test('relationship chains combine assigned policies and honor implicit default', () => {
  const s = snapshot();
  s.resources = [
    {
      kind: 'policy',
      path: 'sys/policies/acl/role-admin',
      data: {
        name: 'role-admin',
        hcl: 'path "auth/approle/role/demo" { capabilities = ["update"] }',
      },
    },
    {
      kind: 'policy',
      path: 'sys/policies/acl/default',
      data: {
        name: 'default',
        hcl: 'path "sys/policies/acl/*" { capabilities = ["update"] }',
      },
    },
    {
      kind: 'role',
      path: 'auth/approle/role/demo',
      data: {
        auth_type: 'approle',
        token_policies: ['role-admin'],
      },
    },
  ];
  const settings = {
    ...DEFAULT_SETTINGS,
    configYaml: 'version: 1\nprofile: extended\n',
  };
  const selected = () =>
    execute(s, settings).findings.filter((f) =>
      ['POL-010', 'POL-011', 'POL-015'].includes(f.ruleId),
    );
  assert.deepEqual(
    selected()
      .map((f) => f.ruleId)
      .sort(),
    ['POL-010', 'POL-011', 'POL-015'],
  );
  const chain = selected().find((f) => f.ruleId === 'POL-015')!;
  assert.deepEqual(
    chain.relatedObjects?.map((o) => o.name),
    ['default', 'role-admin'],
  );
  assert.equal(
    JSON.parse(chain.evidence).role_administration_grants[0].policy,
    'role-admin',
  );
  s.resources[2].data.token_no_default_policy = true;
  assert.deepEqual(
    selected().map((f) => f.ruleId),
    ['POL-010'],
  );
  s.resources[0].data.hcl =
    'path "auth/approle/role/demo" { capabilities = ["deny", "update"] }';
  assert.equal(selected().length, 0);
  s.resources[0].data.hcl =
    'path "auth/approle/role/other" { capabilities = ["update"] }';
  assert.equal(selected().length, 0);
});

test('auth bootstrap requires both configuration and mount administration grants', () => {
  const s = snapshot();
  s.resources = [
    {
      kind: 'policy',
      path: 'sys/policies/acl/bootstrap',
      data: {
        name: 'bootstrap',
        hcl: 'path "sys/auth/*" { capabilities = ["update"] }\npath "auth/+/config" { capabilities = ["update"] }',
      },
    },
    {
      kind: 'role',
      path: 'auth/kubernetes/role/demo',
      data: {
        auth_type: 'kubernetes',
        token_policies: ['bootstrap'],
      },
    },
  ];
  const settings = {
    ...DEFAULT_SETTINGS,
    configYaml: 'version: 1\nprofile: extended\n',
  };
  const findings = () =>
    execute(s, settings).findings.filter((f) => f.ruleId === 'POL-014');
  assert.equal(findings().length, 1);
  assert.equal(
    JSON.parse(findings()[0].evidence).confidence,
    'proven_capabilities_inferred_configuration',
  );
  s.resources[0].data.hcl = 'path "sys/auth/*" { capabilities = ["update"] }';
  assert.equal(findings().length, 0);
  s.resources[0].data.hcl =
    'path "sys/auth/*" { capabilities = ["read"] }\npath "auth/+/config" { capabilities = ["update"] }';
  assert.equal(findings().length, 0);
});

import relationshipFixtures from './fixtures/relationship-parity.json' with { type: 'json' };
test('six relationship detectors match Python evidence and severity', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    configYaml: 'version: 1\nprofile: extended\n',
  };
  for (const fixture of relationshipFixtures) {
    const s = snapshot();
    s.resources = fixture.resources;
    const actual = execute(s, settings)
      .findings.filter(
        (f) =>
          f.path === fixture.path &&
          [
            'POL-010',
            'POL-011',
            'TOKEN-006',
            'POL-013',
            'POL-014',
            'POL-015',
          ].includes(f.ruleId),
      )
      .map((f) => ({
        ruleId: f.ruleId,
        severity: f.severity,
        evidence: JSON.parse(f.evidence),
      }))
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
    assert.deepEqual(actual, fixture.expected.map(f => ({ ...f, ruleId: canonicalCheckId(f.ruleId) })).sort((a, b) => a.ruleId.localeCompare(b.ruleId)), fixture.name);
  }
});

import { roleEntityIds } from './identity.js';
test('identity correlation requires the same AppRole accessor and RoleID hash', () => {
  const fixture = relationshipFixtures.find(
    (f) => f.name === 'cross-role-True-True-True',
  )!;
  const resources: AuditSnapshot['resources'] = structuredClone(
    fixture.resources,
  );
  assert.deepEqual(
    [...roleEntityIds(resources).get('auth/approle/role/source')!],
    ['entity-a'],
  );
  const alias = resources.find(
    (r) => r.path === 'identity/entity-alias/id/source',
  )!;
  alias.data = { ...alias.data, mount_accessor: 'different-mount' };
  assert.equal(roleEntityIds(resources).has('auth/approle/role/source'), false);
  alias.data = {
    ...alias.data,
    mount_accessor: 'test-accessor',
    name_sha256: 'different-role',
  };
  assert.equal(roleEntityIds(resources).has('auth/approle/role/source'), false);
});

import referenceFixtures from './fixtures/reference-parity.json' with { type: 'json' };
import { evaluateReference } from './referenceDetector.js';
test('missing policy references match Python, with explicit incomplete-inventory suppression', () => {
  const rule = catalog(DEFAULT_SETTINGS).find((r) => r.id === 'REF-001')!;
  for (const fixture of referenceFixtures) {
    const result = evaluateReference(
      rule,
      fixture.resource,
      new Set(fixture.known),
      true,
      { config: {} },
    );
    assert.deepEqual(
      result.map((f) => ({
        severity: f.severity,
        evidence: JSON.parse(f.evidence),
      })),
      fixture.expected,
      fixture.name,
    );
    assert.equal(
      evaluateReference(rule, fixture.resource, new Set(), false, {
        config: {},
      }).length,
      0,
    );
  }
  const s = snapshot();
  s.resources[1].data.token_policies = ['team-admin'];
  s.resources[1].data.token_no_default_policy = true;
  const result = execute(s, {
    ...DEFAULT_SETTINGS,
    configYaml:
      'version: 1\nprivileged_policies:\n  exact: []\n  patterns: ["team-*"]\n',
  });
  const missing = result.findings.find((f) => f.ruleId === 'REF-001')!;
  assert.equal(missing.severity, 'high');
  assert.deepEqual(JSON.parse(missing.evidence).configured_privileged_names, [
    'team-admin',
  ]);
});

test('implicit default policy participates in auth privilege checks', () => {
  const s = snapshot();
  s.resources = [
    {
      kind: 'policy',
      path: 'sys/policies/acl/default',
      data: { name: 'default', hcl: 'path "*" { capabilities = ["update"] }' },
    },
    {
      kind: 'role',
      path: 'auth/approle/role/demo',
      data: { auth_type: 'approle', token_policies: [] },
    },
  ];
  assert.ok(
    execute(s, DEFAULT_SETTINGS).findings.some(
      (f) => f.ruleId === 'APPROLE-001',
    ),
  );
  s.resources[1].data.token_no_default_policy = true;
  assert.ok(
    !execute(s, DEFAULT_SETTINGS).findings.some(
      (f) => f.ruleId === 'APPROLE-001',
    ),
  );
});

import { analyzeIdentity } from './identity.js';
test('nested Identity groups retain provenance without duplicate diamond assignments', () => {
  const s = snapshot();
  s.resources = [
    {
      kind: 'group',
      path: 'identity/group/id/top',
      data: { policies: ['admin'], member_group_ids: ['left', 'right'] },
    },
    {
      kind: 'group',
      path: 'identity/group/id/left',
      data: { policies: ['left'], member_group_ids: ['leaf'] },
    },
    {
      kind: 'group',
      path: 'identity/group/id/right',
      data: { policies: [], member_group_ids: ['leaf'] },
    },
    {
      kind: 'group',
      path: 'identity/group/id/leaf',
      data: { policies: ['read'], member_entity_ids: ['person'] },
    },
    {
      kind: 'entity',
      path: 'identity/entity/id/person',
      data: { policies: ['own'] },
    },
  ];
  const before = structuredClone(s.resources);
  const result = analyzeIdentity(s.resources);
  assert.equal(result.issues.length, 0);
  const effective = result.assignments.filter(
    (a) => a.subjectKind === 'entity',
  );
  assert.deepEqual(
    effective.map((a) => a.policy),
    ['admin', 'left', 'own', 'read'],
  );
  assert.equal(
    effective.find((a) => a.policy === 'admin')?.sourcePath,
    'identity/group/id/top',
  );
  assert.deepEqual(s.resources, before);
  s.resources[0].data.parent_group_ids = ['leaf', 'missing'];
  s.resources[3].data.member_entity_ids = ['absent'];
  const broken = execute(s, DEFAULT_SETTINGS);
  assert.ok(
    broken.configuration.issues.some((i) => i.reason.includes('cycle')),
  );
  assert.ok(
    broken.configuration.issues.some(
      (i) => i.path === 'identity/group/id/missing',
    ),
  );
  assert.ok(
    broken.configuration.issues.some(
      (i) => i.path === 'identity/entity/id/absent',
    ),
  );
  assert.ok(
    !broken.identity.assignments.some(
      (a) => a.relationship === 'inherited' && a.subjectPath === a.sourcePath,
    ),
  );
});

import identityFixtures from './fixtures/identity-parity.json' with { type: 'json' };
test('Identity inheritance matches Python for parent/child edges and diamond provenance', () => {
  const sorted = (items: unknown[]) =>
    items.map((item) => JSON.stringify(item)).sort();
  for (const fixture of identityFixtures) {
    const result = analyzeIdentity(fixture.resources);
    assert.deepEqual(
      sorted(result.assignments),
      sorted(fixture.expected),
      fixture.name,
    );
    assert.equal(result.issues.length > 0, fixture.partial, fixture.name);
  }
});

import { compareRuns } from './diff.js';
test('offline diff preserves duplicate finding identities, severity changes and coverage gaps', () => {
  const s = snapshot(),
    result = execute(s, DEFAULT_SETTINGS);
  const old: import('../../shared/securityAudit.js').AuditDetail = {
    run: {
      id: 'old',
      target: s.target,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      status: 'completed',
      resourceCount: s.resources.length,
      issueCount: 0,
      findingCount: 2,
    },
    snapshot: s,
    configuration: result.configuration,
    findings: [
      {
        ruleId: 'demo',
        path: 'auth/demo',
        severity: 'medium',
        title: 'Demo',
        recommendation: 'Review',
        evidence: '{"a":1,"b":2}',
      },
      {
        ruleId: 'demo',
        path: 'auth/demo',
        severity: 'high',
        title: 'Demo',
        recommendation: 'Review',
        evidence: '{"a":2}',
      },
    ],
  };
  const next = structuredClone(old);
  next.run.id = 'new';
  next.findings[0].evidence = '{"b":2,"a":1}';
  next.findings[1].severity = 'critical';
  next.snapshot!.resources[1].data.token_ttl = 3600;
  let diff = compareRuns(old, next);
  assert.equal(diff.statistics.findings.unchanged, 1);
  assert.equal(diff.statistics.findings.changed, 1);
  assert.equal(diff.statistics.resources.changed, 1);
  assert.deepEqual(diff.warnings, []);
  next.findings = [];
  next.snapshot!.issues.push({ path: 'auth/demo', reason: 'Vault HTTP 403' });
  diff = compareRuns(old, next);
  assert.equal(diff.statistics.findings.removed, 2);
  assert.equal(diff.warnings.length, 1);
  next.configuration!.engineVersion = 'different';
  assert.throws(() => compareRuns(old, next), /incomparable/);
  next.configuration = old.configuration;
  next.snapshot!.target = 'http://other.invalid';
  assert.throws(() => compareRuns(old, next), /incomparable/);
});

import {
  createBaseline,
  parseBaseline,
  applyBaseline,
  findingFingerprint,
} from './baseline.js';
test('baseline preserves findings and gates only new identities under the same configuration', () => {
  const s = snapshot(),
    result = execute(s, DEFAULT_SETTINGS);
  const detail: import('../../shared/securityAudit.js').AuditDetail = {
    snapshot: s,
    configuration: result.configuration,
    findings: result.findings,
    run: {
      id: 'base',
      target: s.target,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      status: 'completed',
      resourceCount: 2,
      issueCount: 0,
      findingCount: result.findings.length,
    },
  };
  const baseline = parseBaseline(JSON.stringify(createBaseline(detail)));
  const original = structuredClone(result.findings);
  const controls = applyBaseline(
    result.findings,
    result.configuration,
    s.target,
    baseline,
  );
  assert.ok(controls.states.every((state) => !state.gate));
  assert.deepEqual(result.findings, original);
  const changed = structuredClone(result.findings);
  changed[0].evidence = 'new evidence';
  assert.ok(
    applyBaseline(changed, result.configuration, s.target, baseline).states[0]
      .gate,
  );
  assert.throws(
    () =>
      applyBaseline(changed, result.configuration, 'http://other', baseline),
    /incompatible/,
  );
  assert.throws(
    () =>
      applyBaseline(
        changed,
        { ...result.configuration, engineVersion: 'other' },
        s.target,
        baseline,
      ),
    /incompatible/,
  );
  assert.throws(
    () => parseBaseline('version: 1\ntool: vaultlens\nfingerprints: [nope]'),
    /requires|Invalid/,
  );
  const a = { ...original[0], evidence: '{"a":1,"b":2}' };
  assert.equal(
    findingFingerprint(a),
    findingFingerprint({ ...a, evidence: '{"b":2,"a":1}' }),
  );
});

import { parseExceptions } from './exceptions.js';
test('expiring exceptions preserve findings, scope policy paths and report unused entries', () => {
  const s = snapshot(),
    configuration = execute(s, DEFAULT_SETTINGS).configuration;
  const finding = {
    ruleId: 'POL-001',
    path: 'sys/policies/acl/demo',
    policyPath: 'secret/team/*',
    severity: 'high' as const,
    title: 'Demo',
    recommendation: 'Review',
    evidence: '{}',
  };
  const entry = {
    id: 'approved',
    rule_id: 'POL-001',
    namespace: 'root',
    object_path: 'sys/policies/acl/demo',
    policy_path: 'secret/team/*',
    owner: 'security',
    reason: 'Migration deadline',
    expires: '2026-09-08',
  };
  const load = (entries: unknown[]) =>
    parseExceptions(
      JSON.stringify({ version: 1, exceptions: entries }),
      new Set(['POL-001']),
    );
  const entries = load([
    entry,
    { ...entry, id: 'unused', object_path: 'other' },
    { ...entry, id: 'expired', expires: '2026-09-07' },
  ]);
  let controls = applyBaseline(
    [finding],
    configuration,
    s.target,
    undefined,
    entries,
    '2026-09-08',
  );
  assert.equal(controls.states[0].gate, false);
  assert.equal(controls.states[0].exception?.owner, 'security');
  assert.deepEqual(
    controls.exceptions.unused.map((e) => e.id),
    ['unused'],
  );
  assert.deepEqual(
    controls.exceptions.expired.map((e) => e.id),
    ['expired'],
  );
  controls = applyBaseline(
    [finding],
    configuration,
    s.target,
    undefined,
    entries,
    '2026-09-09',
  );
  assert.equal(controls.states[0].gate, true);
  assert.equal(
    applyBaseline(
      [{ ...finding, policyPath: 'other' }],
      configuration,
      s.target,
      undefined,
      entries,
      '2026-09-08',
    ).states[0].gate,
    true,
  );
  assert.throws(() => load([entry, entry]), /Duplicate/);
  assert.throws(() => load([{ ...entry, expires: '2026-02-30' }]), /expires/);
  assert.throws(() => load([{ ...entry, owner: '' }]), /requires owner/);
  assert.throws(() => load([{ ...entry, rule_id: 'unknown' }]), /Unknown/);
});

import { parseAuditArguments, auditExitCode } from './cliOptions.js';
test('CI arguments reject ignored flags and gate severity independently of completeness', () => {
  assert.throws(
    () => parseAuditArguments(['scan', '--fial-on', 'none']),
    /Unsupported/,
  );
  assert.throws(
    () => parseAuditArguments(['diff', 'old', 'new', '--baseline', 'file']),
    /Unsupported/,
  );
  assert.throws(() => parseAuditArguments(['scan', '--fail-on']), /requires/);
  assert.throws(
    () =>
      parseAuditArguments(['scan', '--fail-on', 'high', '--fail-on', 'none']),
    /Duplicate/,
  );
  assert.throws(
    () =>
      parseAuditArguments(['scan', '--require-complete', '--allow-incomplete']),
    /Conflicting/,
  );
  assert.throws(() => parseAuditArguments(['analyze']), /positional/);
  const options = parseAuditArguments([
    'analyze',
    '--fail-on',
    'medium',
    'run-id',
    '--exceptions',
    'team.yml',
  ]);
  assert.equal(options.positionals[0], 'run-id');
  assert.equal(options.exceptions, 'team.yml');
  assert.equal(auditExitCode(['medium'], false, options), 1);
  assert.equal(auditExitCode(['low'], false, options), 0);
  assert.equal(auditExitCode([], true, options), 2);
  assert.equal(
    auditExitCode(['critical'], false, { ...options, failOn: 'none' }),
    0,
  );
  assert.equal(
    auditExitCode(
      [],
      true,
      parseAuditArguments(['scan', '--allow-incomplete']),
    ),
    0,
  );
});

import { exportAudit } from './exporter.js';
test('offline exports preserve evidence and protect CSV cells from formula execution', () => {
  const s = snapshot(),
    result = execute(s, DEFAULT_SETTINGS);
  const detail: import('../../shared/securityAudit.js').AuditDetail = {
    snapshot: s,
    configuration: result.configuration,
    findings: [
      {
        ruleId: 'DEMO',
        path: '=HYPERLINK("external")',
        severity: 'high',
        title: 'A, "quote"',
        evidence: 'first\nsecond',
        recommendation: 'Review',
      },
    ],
    run: {
      id: 'demo',
      target: s.target,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      status: 'completed',
      resourceCount: 2,
      issueCount: 0,
      findingCount: 1,
    },
  };
  assert.deepEqual(JSON.parse(exportAudit(detail, 'json')), detail);
  const lines = exportAudit(detail, 'jsonl')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(
    lines.filter((r) => r.type === 'finding')[0].finding.evidence,
    'first\nsecond',
  );
  assert.equal(
    lines.filter((r) => r.type === 'resource').length,
    s.resources.length,
  );
  const csv = exportAudit(detail, 'csv');
  assert.ok(csv.includes('"\'=HYPERLINK(""external"")"'));
  assert.ok(csv.includes('"A, ""quote"""'));
  assert.ok(exportAudit(detail, 'yaml').includes('ruleId: DEMO'));
  assert.equal(
    parseAuditArguments(['export', 'run', 'file', '--format', 'jsonl']).format,
    'jsonl',
  );
  assert.throws(
    () => parseAuditArguments(['export', 'run', 'file', '--format', 'unknown']),
    /format/,
  );
});

import { createRequestPolicy } from './requestPolicy.js';
import { VaultError } from '../lib/vaultClient.js';
test('collector request policy retries transient failures, spaces requests and rejects access failures', async () => {
  let time = 0;
  const policy = createRequestPolicy(
    { retries: 2, requestsPerSecond: 2, retryBackoffMs: 100 },
    {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
    },
  );
  let calls = 0;
  assert.equal(
    await policy.request(async () => {
      if (++calls < 3) throw new VaultError('unavailable', 503);
      return 'ok';
    }),
    'ok',
  );
  assert.equal(calls, 3);
  assert.equal(time, 1000);
  assert.equal(policy.metrics.retries, 2);
  let denied = 0;
  await assert.rejects(
    () =>
      policy.request(async () => {
        denied++;
        throw new VaultError('denied', 403);
      }),
    /denied/,
  );
  assert.equal(denied, 1);
  const limited = createRequestPolicy(
    { retries: 1, requestsPerSecond: 100, retryBackoffMs: 0 },
    {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
    },
  );
  let attempts = 0;
  await assert.rejects(
    () =>
      limited.request(async () => {
        attempts++;
        throw new VaultError('limited', 429);
      }),
    /limited/,
  );
  assert.equal(attempts, 2);
  assert.throws(
    () => parseAuditArguments(['scan', '--retries', 'NaN']),
    /retries/,
  );
  assert.equal(
    parseAuditArguments(['scan', '--retries', '0']).requestPolicy.retries,
    0,
  );
});

import { forEachConcurrent } from './concurrency.js';
test('collector pool bounds concurrency and drains active work after an error', async () => {
  let active = 0,
    peak = 0,
    finished = 0;
  await forEachConcurrent(
    Array.from({ length: 12 }, (_, i) => i),
    3,
    async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      finished++;
    },
  );
  assert.equal(peak, 3);
  assert.equal(finished, 12);
  active = 0;
  await assert.rejects(
    () =>
      forEachConcurrent([0, 1, 2, 3], 2, async (i) => {
        active++;
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        if (i === 0) throw new Error('stop');
      }),
    /stop/,
  );
  assert.equal(active, 0);
  assert.equal(
    parseAuditArguments(['scan', '--workers', '4']).requestPolicy.workers,
    4,
  );
  assert.throws(
    () => parseAuditArguments(['scan', '--workers', '0']),
    /workers/,
  );
});

import { parseCollectionOptions } from './requestPolicy.js';
test('web collection options validate types and reject unsupported settings before starting', () => {
  assert.equal(parseCollectionOptions(undefined).workers, 10);
  assert.deepEqual(parseCollectionOptions({ workers: 2, retries: 0 }), {
    workers: 2,
    retries: 0,
    requestsPerSecond: 10,
    retryBackoffMs: 500,
    timeoutMs: 30000,
    maxDurationMs: 7200000,
    maxObjects: 0,
    namespaceFilters: [],
    policyFilters: [],
    authMountFilters: [],
    authTypeFilters: [],
    skipIdentity: false,
    redactPolicySource: false,
    recursiveNamespaces: false,
    namespace: '',
    sources: [
      'auth_roles',
      'identity',
      'identity_aliases',
      'mounts',
      'policies',
    ],
  });
  assert.throws(() => parseCollectionOptions({ workers: '2' }), /numeric/);
  assert.throws(() => parseCollectionOptions({ workers: 33 }), /workers/);
  assert.throws(
    () => parseCollectionOptions({ requestsPerSecond: 0 }),
    /requestsPerSecond/,
  );
  assert.throws(() => parseCollectionOptions({ unexpected: 1 }), /Unknown/);
});

test('collection deadline cancels queued rate waits without starting more operations', async () => {
  const abort = new AbortController();
  const policy = createRequestPolicy(
    { retries: 3, requestsPerSecond: 0.01, retryBackoffMs: 500 },
    undefined,
    abort.signal,
  );
  let calls = 0;
  await policy.request(async () => {
    calls++;
  });
  const pending = policy.request(async () => {
    calls++;
  });
  abort.abort();
  await assert.rejects(() => pending);
  assert.equal(calls, 1);
  assert.equal(
    parseAuditArguments([
      'scan',
      '--timeout-ms',
      '100',
      '--max-duration-ms',
      '200',
    ]).requestPolicy.maxDurationMs,
    200,
  );
  assert.throws(() => parseCollectionOptions({ timeoutMs: 0 }), /timeoutMs/);
});

test('saved controls retain their application date and exception metadata across SQLite reads', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audit-controls-'));
  const store = new AuditStore(join(directory, 'audit.sqlite'));
  try {
    const s = snapshot(),
      result = execute(s, DEFAULT_SETTINGS);
    const exception = {
      id: 'temporary',
      rule_id: result.findings[0].ruleId,
      namespace: 'root',
      object_path: result.findings[0].path,
      owner: 'reviewer',
      reason: 'Migration',
      expires: '2026-09-08',
    };
    s.controls = applyBaseline(
      result.findings,
      result.configuration,
      s.target,
      undefined,
      [exception],
      '2026-09-08',
    );
    const id = store.create(s.target);
    store.finish(id, s, result.findings, result.configuration);
    exception.owner = 'changed later';
    const saved = store.get(id, s.target)!;
    assert.equal(saved.snapshot?.controls?.appliedOn, '2026-09-08');
    assert.equal(
      saved.snapshot?.controls?.exceptionDefinitions[0].owner,
      'reviewer',
    );
    assert.equal(saved.snapshot?.controls?.states[0].suppressed, true);
    assert.ok(exportAudit(saved, 'csv').includes('"temporary"'));
    assert.ok(exportAudit(saved, 'jsonl').includes('"appliedOn":"2026-09-08"'));
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('multiple CLI scope patterns are retained and normalized without allowing duplicate scalar options', () => {
  const options = parseAuditArguments([
    'collect',
    '--policy-filter',
    'team-*',
    '--policy-filter',
    'default',
    '--policy-filter',
    'team-*',
    '--auth-type-filter',
    'jwt',
    '--auth-type-filter',
    'approle',
    '--skip-identity',
  ]);
  assert.deepEqual(options.requestPolicy.policyFilters, ['default', 'team-*']);
  assert.deepEqual(options.requestPolicy.authTypeFilters, ['approle', 'jwt']);
  assert.equal(options.requestPolicy.skipIdentity, true);
  assert.throws(
    () => parseAuditArguments(['analyze', 'run', '--policy-filter', '*']),
    /Unsupported/,
  );
  assert.throws(
    () => parseAuditArguments(['scan', '--workers', '1', '--workers', '2']),
    /Duplicate/,
  );
  assert.throws(
    () => parseAuditArguments(['collect', '--policy-filter']),
    /requires/,
  );
});

test('namespace partitions isolate policy references, privilege signals and exceptions', () => {
  const s = snapshot();
  s.namespaces = ['team-a', 'team-b'];
  s.resources = [
    {
      namespace: 'team-a',
      kind: 'policy',
      path: 'sys/policies/acl/admin',
      data: { name: 'admin', hcl: 'path "*" {capabilities=["update"]}' },
    },
    ...['team-a', 'team-b'].map((namespace) => ({
      namespace,
      kind: 'role',
      path: 'auth/approle/role/demo',
      data: {
        auth_type: 'approle',
        token_policies: ['admin'],
        token_no_default_policy: true,
      },
    })),
  ];
  const result = execute(s, DEFAULT_SETTINGS);
  assert.ok(
    result.findings.some(
      (f) => f.namespace === 'team-a' && f.ruleId === 'APPROLE-001',
    ),
  );
  assert.ok(
    !result.findings.some(
      (f) => f.namespace === 'team-b' && f.ruleId === 'APPROLE-001',
    ),
  );
  assert.ok(
    result.findings.some(
      (f) => f.namespace === 'team-b' && f.ruleId === 'REF-001',
    ),
  );
  assert.ok(
    !result.findings.some(
      (f) => f.namespace === 'team-a' && f.ruleId === 'REF-001',
    ),
  );
  const finding = result.findings.find((f) => f.ruleId === 'REF-001')!;
  const exception = {
    id: 'scope',
    rule_id: 'REF-001',
    namespace: 'team-a',
    object_path: '*',
    owner: 'security',
    reason: 'Review',
    expires: '2099-01-01',
  };
  assert.equal(
    applyBaseline([finding], result.configuration, s.target, undefined, [
      exception,
    ]).states[0].gate,
    true,
  );
  assert.equal(
    applyBaseline([finding], result.configuration, s.target, undefined, [
      { ...exception, namespace: 'team-b' },
    ]).states[0].gate,
    false,
  );
  assert.notEqual(
    findingFingerprint({ ...finding, namespace: 'team-a' }),
    findingFingerprint(finding),
  );
});

test('namespace selection normalizes boundaries and rejects invalid header/path input', () => {
  assert.equal(
    parseCollectionOptions({ namespace: '/team/child/' }).namespace,
    'team/child',
  );
  assert.equal(
    parseAuditArguments(['collect', '--namespace', 'team/child']).requestPolicy
      .namespace,
    'team/child',
  );
  assert.throws(
    () => parseCollectionOptions({ namespace: 'team\r\nHeader: value' }),
    /namespace/,
  );
  assert.throws(
    () => parseCollectionOptions({ namespace: 'team/../other' }),
    /namespace/,
  );
  assert.throws(
    () => parseCollectionOptions({ namespace: 'team//child' }),
    /namespace/,
  );
});

test('alias reference gaps stay within their namespace and preserve raw inventory', () => {
  const s = snapshot();
  s.namespaces = ['team-a', 'team-b'];
  s.resources = [
    {
      namespace: 'team-a',
      kind: 'alias',
      path: 'identity/entity-alias/id/demo',
      data: { canonical_id: 'person', mount_accessor: 'shared' },
    },
    {
      namespace: 'team-b',
      kind: 'entity',
      path: 'identity/entity/id/person',
      data: { policies: [] },
    },
    {
      namespace: 'team-b',
      kind: 'auth-mount',
      path: 'auth/approle/',
      data: { type: 'approle', accessor: 'shared' },
    },
  ];
  const before = structuredClone(s.resources);
  const result = execute(s, DEFAULT_SETTINGS);
  assert.equal(result.identity.issues.length, 2);
  assert.ok(
    result.identity.issues.every((issue) => issue.namespace === 'team-a'),
  );
  assert.deepEqual(s.resources, before);
  const resolved = s.resources.map((resource) => ({
    ...resource,
    namespace: 'team-a',
  }));
  assert.deepEqual(analyzeIdentity(resolved).issues, []);
  resolved[0] = {
    ...resolved[0],
    data: { canonical_id: '', mount_accessor: '' },
  };
  assert.deepEqual(
    analyzeIdentity(resolved).issues.map((issue) => issue.reason),
    [
      'Alias is missing its canonical entity ID',
      'Alias is missing its auth mount accessor',
    ],
  );
});

import { sanitizeAlias } from './identity.js';
test('embedded alias reconciliation respects catalog coverage and retains no raw name', () => {
  const alias = sanitizeAlias({
    id: 'alias-a',
    canonical_id: 'person',
    mount_accessor: 'accessor',
    name: 'sensitive-role-id',
    metadata: { secret: 'discard' },
  });
  assert.equal(alias.name, undefined);
  assert.equal(alias.metadata, undefined);
  assert.equal(typeof alias.name_sha256, 'string');
  const resources: AuditSnapshot['resources'] = [
    {
      kind: 'entity',
      path: 'identity/entity/id/person',
      data: { aliases: [alias] },
    },
    {
      kind: 'auth-mount',
      path: 'auth/approle/',
      data: { accessor: 'accessor' },
    },
  ];
  assert.deepEqual(analyzeIdentity(resources, false).issues, []);
  assert.match(
    analyzeIdentity(resources, true).issues[0].reason,
    /absent from.*catalog/,
  );
  resources.push({
    kind: 'alias',
    path: 'identity/entity-alias/id/alias-a',
    data: alias,
  });
  assert.deepEqual(analyzeIdentity(resources, true).issues, []);
  resources[2].data = { ...alias, name_sha256: 'changed' };
  assert.match(
    analyzeIdentity(resources, true).issues[0].reason,
    /differs.*not atomic/,
  );
  resources[2].data = { ...alias, id: 'another-id' };
  resources[2].path = 'identity/entity-alias/id/another-id';
  assert.deepEqual(analyzeIdentity(resources, true).issues, []);
  const s = snapshot();
  s.namespaces = ['team-a', 'team-b'];
  s.namespaceAliasCompleteness = { 'team-a': true, 'team-b': false };
  s.resources = ['team-a', 'team-b'].flatMap((namespace) =>
    resources.slice(0, 2).map((resource) => ({ ...resource, namespace })),
  );
  const issues = execute(s, DEFAULT_SETTINGS).identity.issues;
  assert.equal(issues.length, 1);
  assert.equal(issues[0].namespace, 'team-a');
});

import { createServer as createRawServer } from 'node:net';
import { collect } from './collector.js';
test('collector rejects malformed catalogs and missing ACL source instead of proving absence', async () => {
  let mode: 'malformed' | 'source' | 'empty' = 'malformed';
  const server = createRawServer((socket) => {
    let request = '';
    socket.on('data', (chunk) => {
      request += chunk.toString();
      if (!request.includes('\r\n\r\n')) return;
      const [method, path] = request.split('\r\n')[0].split(' ');
      let status = 200;
      let body: unknown = { data: {} };
      if (method === 'LIST') {
        body = { data: { keys: [] } };
        if (path === '/v1/sys/policies/acl') {
          if (mode === 'malformed') body = { data: { keys: ['default', 123] } };
          if (mode === 'source') body = { data: { keys: ['default'] } };
          if (mode === 'empty') {
            status = 404;
            body = { errors: [] };
          }
        }
        if (path === '/v1/identity/entity-alias/id' && mode === 'malformed')
          body = { data: {} };
      }
      const payload = JSON.stringify(body);
      socket.end(
        `HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'Not Found'}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as import('node:net').AddressInfo;
    const target = `http://127.0.0.1:${address.port}`;
    const options = {
      retries: 0,
      requestsPerSecond: 1000,
      maxDurationMs: 5000,
    };
    const malformed = await collect(target, 'fixture-token', false, options);
    assert.equal(malformed.policiesComplete, false);
    assert.equal(malformed.namespaceAliasCompleteness?.[''], false);
    assert.equal(
      malformed.issues.filter((issue) => issue.reason.includes('invalid keys'))
        .length,
      2,
    );
    mode = 'source';
    const missingSource = await collect(
      target,
      'fixture-token',
      false,
      options,
    );
    assert.equal(missingSource.policiesComplete, false);
    assert.equal(
      missingSource.resources.some((resource) => resource.kind === 'policy'),
      false,
    );
    assert.match(missingSource.issues[0].reason, /missing its ACL source/);
    mode = 'empty';
    const empty = await collect(target, 'fixture-token', false, options);
    assert.equal(empty.policiesComplete, true);
    assert.equal(empty.namespaceAliasCompleteness?.[''], true);
    assert.deepEqual(empty.issues, []);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('collector inventories Python-supported cloud auth roles with allowlisted token settings', async () => {
  const types = ['aws', 'azure', 'alicloud', 'oci', 'gcp'];
  const requests: string[] = [];
  const server = createRawServer((socket) => {
    let request = '';
    socket.on('data', (chunk) => {
      request += chunk.toString();
      if (!request.includes('\r\n\r\n')) return;
      const [method, path] = request.split('\r\n')[0].split(' ');
      requests.push(`${method} ${path}`);
      let data: Record<string, unknown> = method === 'LIST' ? { keys: [] } : {};
      if (path === '/v1/sys/auth')
        data = Object.fromEntries(
          types.map((type) => [
            `${type}/`,
            { type, accessor: `${type}-accessor` },
          ]),
        );
      if (method === 'LIST' && path.startsWith('/v1/auth/'))
        data = { keys: ['workload'] };
      if (path.endsWith('/workload'))
        data = {
          token_policies: ['cloud-read'],
          token_ttl: 600,
          token_bound_cidrs: ['192.0.2.0/24'],
          secret_access_key: 'must-not-persist',
          client_secret: 'must-not-persist',
          private_key: 'must-not-persist',
        };
      const payload = JSON.stringify({ data });
      socket.end(
        `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as import('node:net').AddressInfo;
    const result = await collect(
      `http://127.0.0.1:${address.port}`,
      'fixture-token',
      false,
      { retries: 0, requestsPerSecond: 1000, maxDurationMs: 5000 },
    );
    assert.deepEqual(result.issues, []);
    const roles = result.resources.filter(
      (resource) => resource.kind === 'role',
    );
    assert.equal(roles.length, 5);
    assert.deepEqual(
      roles.map((role) => role.data.auth_type).sort(),
      [...types].sort(),
    );
    assert.ok(roles.every((role) => role.data.token_ttl === 600));
    assert.ok(!JSON.stringify(result).includes('must-not-persist'));
    assert.ok(requests.includes('LIST /v1/auth/gcp/roles'));
    assert.ok(requests.includes('GET /v1/auth/aws/role/workload'));
    assert.ok(requests.every((request) => !request.endsWith('/config')));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

import { policyUsage } from '../../shared/policyUsage.js';
test('policy usage separates namespace, inheritance and token issuance permissions', () => {
  const s = snapshot();
  s.resources = [
    {
      namespace: 'a',
      kind: 'policy',
      path: 'sys/policies/acl/read',
      data: { name: 'read' },
    },
    {
      namespace: 'b',
      kind: 'policy',
      path: 'sys/policies/acl/read',
      data: { name: 'read' },
    },
    {
      namespace: 'a',
      kind: 'role',
      path: 'auth/token/roles/demo',
      data: {
        auth_type: 'token',
        token_policies: ['read', 'read'],
        allowed_policies: ['admin'],
        allowed_policies_glob: ['team-*'],
      },
    },
  ];
  s.identity = {
    groupCount: 1,
    entityCount: 1,
    issues: [],
    assignments: [
      {
        namespace: 'a',
        subjectKind: 'entity',
        subjectPath: 'identity/entity/id/person',
        policy: 'read',
        relationship: 'inherited',
        sourcePath: 'identity/group/id/team',
      },
    ],
  };
  const before = structuredClone(s);
  const result = policyUsage(s);
  assert.equal(
    result.find((row) => row.namespace === 'b')?.references.length,
    0,
  );
  assert.equal(
    result.find((row) => row.name === 'read' && row.namespace === 'a')
      ?.references.length,
    2,
  );
  assert.equal(
    result.find((row) => row.name === 'admin')?.references[0].relationship,
    'allowed',
  );
  assert.equal(result.find((row) => row.name === 'default')?.collected, false);
  assert.ok(!result.some((row) => row.name === 'team-*'));
  assert.deepEqual(s, before);
});

test('report source redaction preserves evidence and leaves the saved snapshot unchanged', () => {
  const s = snapshot();
  const detail: import('../../shared/securityAudit.js').AuditDetail = {
    run: {
      id: 'redact',
      target: s.target,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      status: 'completed',
      resourceCount: 2,
      issueCount: 0,
      findingCount: 1,
    },
    snapshot: s,
    findings: [
      {
        ruleId: 'DEMO',
        severity: 'high',
        path: 'policy/demo',
        title: 'Example',
        evidence: 'evidence',
        matchedBlock: 'path "*" { capabilities = ["sudo"] }',
        recommendation: 'Review',
      },
    ],
  };
  const before = structuredClone(detail);
  const exported = JSON.parse(exportAudit(detail, 'json', true));
  assert.equal(exported.snapshot.resources[0].data.hcl, undefined);
  assert.equal(exported.snapshot.resources[0].data.source_redacted, true);
  assert.match(
    exported.snapshot.resources[0].data.source_sha256,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    exported.findings[0].matchedBlock,
    detail.findings[0].matchedBlock,
  );
  assert.ok(!exportAudit(detail, 'yaml', true).includes('# not evaluated'));
  assert.ok(!exportAudit(detail, 'jsonl', true).includes('# not evaluated'));
  assert.deepEqual(detail, before);
  assert.equal(
    parseAuditArguments(['export', 'run', 'file', '--redact-policy-source'])
      .redactPolicySource,
    true,
  );
  assert.throws(
    () => parseAuditArguments(['analyze', 'run', '--redact-policy-source']),
    /Unsupported/,
  );
});

test('source-free SQLite retains initial analysis but replay reports unavailable policy source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audit-source-free-'));
  const store = new AuditStore(join(directory, 'audit.sqlite'));
  try {
    const s = snapshot();
    s.resources[0].data.hcl =
      'path "*" { capabilities = ["create", "read", "update", "delete", "sudo"] }';
    s.collection = {
      requestPolicy: {
        retries: 0,
        requestsPerSecond: 10,
        retryBackoffMs: 0,
        redactPolicySource: true,
      },
      metrics: { requests: 0, retries: 0, rateWaitMs: 0, retryWaitMs: 0 },
    };
    const result = execute(s, DEFAULT_SETTINGS);
    assert.ok(
      result.findings.some((finding) => finding.ruleId.startsWith('POL-')),
    );
    const id = store.create(s.target);
    store.finish(id, s, result.findings, result.configuration);
    const saved = store.get(id, s.target)!;
    assert.equal(saved.snapshot!.resources[0].data.hcl, undefined);
    assert.equal(saved.snapshot!.resources[0].data.source_redacted, true);
    assert.deepEqual(
      saved.findings,
      JSON.parse(JSON.stringify(result.findings)),
    );
    assert.equal(typeof s.resources[0].data.hcl, 'string');
    assert.ok(
      execute(saved.snapshot!, DEFAULT_SETTINGS).configuration.issues.some(
        (issue) => issue.reason === 'Policy source is unavailable',
      ),
    );
    assert.equal(
      parseAuditArguments(['scan', '--redact-policy-source']).requestPolicy
        .redactPolicySource,
      true,
    );
    assert.equal(
      parseAuditArguments(['collect', '--redact-policy-source']).requestPolicy
        .redactPolicySource,
      true,
    );
    assert.throws(
      () => parseCollectionOptions({ redactPolicySource: 'true' }),
      /boolean/,
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('diff compares policy content across source retention modes and isolates namespace gaps', () => {
  const s = snapshot();
  const result = execute(s, DEFAULT_SETTINGS);
  const old: import('../../shared/securityAudit.js').AuditDetail = {
    run: {
      id: 'old',
      target: s.target,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      status: 'completed',
      resourceCount: s.resources.length,
      issueCount: 0,
      findingCount: 0,
    },
    snapshot: s,
    configuration: result.configuration,
    findings: [],
  };
  const next = JSON.parse(exportAudit(old, 'json', true)) as typeof old;
  next.run.id = 'next';
  assert.equal(compareRuns(old, next).statistics.resources.changed, 0);
  next.snapshot!.resources[0].data.source_sha256 = '0'.repeat(64);
  assert.equal(compareRuns(old, next).statistics.resources.changed, 1);
  delete next.snapshot!.resources[0].data.source_sha256;
  assert.equal(compareRuns(old, next).statistics.resources.changed, 1);
  old.snapshot!.issues = [
    { namespace: 'a', path: 'identity', reason: 'Unavailable' },
  ];
  next.snapshot!.issues = [
    { namespace: 'b', path: 'identity', reason: 'Unavailable' },
  ];
  const diff = compareRuns(old, next);
  assert.equal(diff.statistics.coverage.added, 1);
  assert.equal(diff.statistics.coverage.removed, 1);
  assert.equal(diff.statistics.coverage.changed, 0);
});

import { DatabaseSync } from 'node:sqlite';
import pythonImportFixture from './fixtures/python-import.json' with { type: 'json' };
import { importPythonSnapshot } from './pythonImport.js';
test('Python schema-3 import preserves assignments, aliases, namespace and source coverage', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audit-python-import-'));
  const path = join(directory, 'python.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec(pythonImportFixture.sql);
    const before = readFileSync(path);
    const imported = importPythonSnapshot(path, 'http://example.invalid');
    assert.deepEqual(readFileSync(path), before);
    assert.deepEqual(imported.namespaces, ['team']);
    assert.equal(imported.resources.length, 6);
    assert.equal(imported.policiesComplete, true);
    assert.equal(imported.namespaceAliasCompleteness?.team, true);
    assert.deepEqual(
      imported.resources.find((resource) => resource.kind === 'role')!.data
        .policies,
      ['admin'],
    );
    assert.ok(!JSON.stringify(imported).includes('sensitive-alias-name'));
    const result = execute(imported, DEFAULT_SETTINGS);
    assert.ok(
      result.identity.assignments.some(
        (assignment) =>
          assignment.subjectPath === 'identity/entity/id/person' &&
          assignment.policy === 'admin' &&
          assignment.relationship === 'inherited',
      ),
    );
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.ruleId === 'POL-001' && finding.namespace === 'team',
      ),
    );
    assert.throws(
      () => importPythonSnapshot(path, 'http://different.invalid'),
      /target/,
    );
    db.exec('UPDATE policies SET rules=NULL');
    assert.ok(
      execute(
        importPythonSnapshot(path, 'http://example.invalid'),
        DEFAULT_SETTINGS,
      ).configuration.issues.some(
        (issue) => issue.reason === 'Policy source is unavailable',
      ),
    );
    db.exec("UPDATE metadata SET value='99' WHERE key='schema_version'");
    assert.throws(
      () => importPythonSnapshot(path, 'http://example.invalid'),
      /schemas 2 and 3/,
    );
    assert.equal(
      parseAuditArguments(['import-python', path]).command,
      'import-python',
    );
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('imported collection scope and source coverage survive replay and protect diff compatibility', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audit-python-scope-'));
  const path = join(directory, 'python.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec(pythonImportFixture.sql);
    const config = {
      include_identity: false,
      recursive_namespaces: true,
      max_objects: 10,
      policy_filters: ['admin'],
      auth_mount_filters: ['auth/approle/'],
      auth_type_filters: ['approle'],
      namespace_filters: ['team*'],
      sources: ['policies', 'auth_roles'],
    };
    db.prepare("UPDATE metadata SET value=? WHERE key='collection_config'").run(
      JSON.stringify(config),
    );
    const s = importPythonSnapshot(path, 'http://example.invalid');
    assert.deepEqual(s.importedFrom!.collection!.scope.authMountFilters, [
      'approle',
    ]);
    assert.equal(s.importedFrom!.collection!.maxObjects, 10);
    assert.equal(s.importedCoverage![0].discovered, 1);
    assert.equal(s.importedFrom!.collection!.recursiveNamespaces, true);
    const result = execute(s, DEFAULT_SETTINGS);
    const old: import('../../shared/securityAudit.js').AuditDetail = {
      run: {
        id: 'old',
        target: s.target,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        status: 'completed',
        resourceCount: 6,
        issueCount: 0,
        findingCount: 0,
      },
      snapshot: s,
      configuration: result.configuration,
      findings: [],
    };
    const next = structuredClone(old);
    assert.equal(compareRuns(old, next).statistics.resources.changed, 0);
    next.snapshot!.importedFrom!.collection!.sources.push('identity');
    assert.throws(() => compareRuns(old, next), /scopes/);
    delete next.snapshot!.importedFrom!.collection;
    assert.throws(() => compareRuns(old, next), /unknown/);
    db.prepare("UPDATE metadata SET value=? WHERE key='collection_config'").run(
      JSON.stringify({ ...config, max_objects: -1 }),
    );
    assert.throws(
      () => importPythonSnapshot(path, 'http://example.invalid'),
      /object limit/,
    );
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

import { importFailureReason } from './failureReason.js';
test('worker failures retain safe reasons without leaking raw exception values or overwriting results', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audit-failure-reason-'));
  const store = new AuditStore(join(directory, 'audit.sqlite'));
  try {
    const id = store.create('http://example.invalid');
    const reason = importFailureReason(
      new Error('Python snapshot target must match VAULT_ADDR'),
    );
    store.fail(id, reason);
    store.fail(id);
    assert.equal(
      store.get(id, 'http://example.invalid')!.run.failureReason,
      reason,
    );
    assert.equal(store.list('http://example.invalid')[0].failureReason, reason);
    assert.ok(
      !importFailureReason(new Error('secret-token /private/path')).includes(
        'secret-token',
      ),
    );
    const success = store.create('http://example.invalid');
    store.finish(success, snapshot(), []);
    store.fail(success, reason);
    assert.equal(
      store.get(success, 'http://example.invalid')!.run.failureReason,
      null,
    );
    assert.equal(
      store.get(success, 'http://example.invalid')!.run.status,
      'completed',
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('recursive collection scopes headers and shares object limits across namespaces', async () => {
  const seen: string[] = [];
  const server = createRawServer((socket) => {
    let request = '';
    socket.on('data', (chunk) => {
      request += chunk.toString();
      if (!request.includes('\r\n\r\n')) return;
      const [method, path] = request.split('\r\n')[0].split(' ');
      const namespace =
        request.match(/x-vault-namespace:\s*([^\r\n]+)/i)?.[1] ?? '';
      seen.push(`${namespace}:${path}`);
      let status = 200;
      let data: Record<string, unknown> = method === 'LIST' ? { keys: [] } : {};
      if (path === '/v1/sys/namespaces') {
        if (namespace === '') data = { keys: ['team/'] };
        else if (namespace === 'team') data = { keys: ['child/', '../'] };
        else status = 403;
      }
      if (path === '/v1/sys/policies/acl') data = { keys: ['default'] };
      if (path === '/v1/sys/policies/acl/default')
        data = { policy: '# namespace ' + namespace };
      const payload = JSON.stringify({ data });
      socket.end(
        `HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'Forbidden'}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const target = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    const options = {
      recursiveNamespaces: true,
      retries: 0,
      requestsPerSecond: 1000,
      maxDurationMs: 5000,
    };
    const progress: import('../../shared/securityAudit.js').AuditProgress[] =
      [];
    const checkpoints: AuditSnapshot[] = [];
    const s = await collect(
      target,
      'fixture-token',
      false,
      options,
      (value) => progress.push(value),
      (value) => checkpoints.push(structuredClone(value)),
    );
    assert.ok(checkpoints.length > 3);
    assert.ok(
      checkpoints.every(
        (value) => value.finishedAt === '' && value.analysisPerformed === false,
      ),
    );
    assert.deepEqual(checkpoints.at(-1)?.checkpoint?.completedNamespaces, [
      '',
      'team',
      'team/child',
    ]);
    const policyCheckpoint = checkpoints.find(
      (value) =>
        !value.checkpoint?.completedNamespaces.length &&
        value.checkpoint?.completedStages?.some(
          (stage) => stage.namespace === '' && stage.stage === 'Policies',
        ),
    )!;
    seen.length = 0;
    const stageResumed = await collect(
      target,
      'fixture-token',
      false,
      options,
      undefined,
      undefined,
      { snapshot: policyCheckpoint, maxAgeMs: 86400000 },
    );
    assert.equal(stageResumed.resources.length, 3);
    assert.ok(!seen.includes(':/v1/sys/policies/acl'));
    assert.ok(seen.includes(':/v1/identity/entity/id'));
    assert.equal(stageResumed.namespacePolicyCompleteness?.[''], true);
    const checkpoint = checkpoints.find(
      (value) => value.checkpoint?.completedNamespaces.length === 1,
    )!;
    seen.length = 0;
    const resumed = await collect(
      target,
      'fixture-token',
      false,
      options,
      undefined,
      undefined,
      { snapshot: checkpoint, maxAgeMs: 86400000 },
    );
    assert.equal(resumed.resources.length, 3);
    assert.ok(!seen.includes(':/v1/sys/policies/acl'));
    assert.ok(seen.includes('team:/v1/sys/policies/acl'));
    assert.equal(resumed.startedAt, checkpoint.startedAt);
    await assert.rejects(
      () =>
        collect(
          target,
          'fixture-token',
          false,
          { ...options, workers: 1 },
          undefined,
          undefined,
          { snapshot: checkpoint, maxAgeMs: 86400000 },
        ),
      /options differ/,
    );
    assert.ok(
      progress.some(
        (value) =>
          value.phase === 'Policies' && value.namespace === 'team/child',
      ),
    );
    assert.equal(progress.at(-1)?.resources, 3);
    assert.equal(progress.at(-1)?.requests, s.collection?.metrics.requests);
    assert.deepEqual(s.namespaces, ['', 'team', 'team/child']);
    assert.deepEqual(
      s.resources.map((resource) => resource.namespace ?? ''),
      ['', 'team', 'team/child'],
    );
    assert.ok(
      s.issues.some(
        (issue) =>
          issue.namespace === 'team/child' && issue.reason === 'Vault HTTP 403',
      ),
    );
    assert.ok(
      s.issues.some(
        (issue) =>
          issue.namespace === 'team' &&
          issue.reason === 'Invalid child namespace path',
      ),
    );
    assert.deepEqual(s.namespacePolicyCompleteness, {
      '': true,
      team: true,
      'team/child': true,
    });
    assert.ok(seen.includes('team/child:/v1/sys/policies/acl/default'));
    const limited = await collect(target, 'fixture-token', false, {
      ...options,
      maxObjects: 1,
    });
    assert.equal(limited.resources.length, 1);
    assert.equal(limited.policiesComplete, false);
    assert.equal(
      limited.issues.filter((issue) => issue.path === 'collection/object-limit')
        .length,
      1,
    );
    assert.equal(
      parseAuditArguments(['collect', '--recursive-namespaces']).requestPolicy
        .recursiveNamespaces,
      true,
    );
    seen.length = 0;
    const filtered = await collect(target, 'fixture-token', false, {
      ...options,
      namespaceFilters: ['team/child'],
    });
    assert.deepEqual(filtered.namespaces, ['team/child']);
    assert.equal(filtered.resources.length, 1);
    assert.ok(seen.includes('team:/v1/sys/namespaces'));
    assert.ok(!seen.includes('team:/v1/sys/policies/acl'));
    const empty = await collect(target, 'fixture-token', false, {
      ...options,
      namespaceFilters: ['absent'],
    });
    assert.deepEqual(empty.resources, []);
    assert.equal(empty.policiesComplete, false);
    assert.ok(
      empty.issues.some((issue) => issue.path === 'collection/namespaces'),
    );
    assert.deepEqual(
      parseAuditArguments([
        'scan',
        '--namespace-filter',
        'team/*',
        '--namespace-filter',
        'root',
      ]).requestPolicy.namespaceFilters,
      ['root', 'team/*'],
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('saved progress is observable only while a run can still change', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audit-progress-'));
  const store = new AuditStore(join(directory, 'audit.sqlite'));
  try {
    const s = snapshot(),
      id = store.create(s.target);
    const progress = {
      namespace: 'team',
      phase: 'Policies',
      resources: 3,
      requests: 5,
      updatedAt: new Date().toISOString(),
    };
    store.updateProgress(id, progress);
    assert.deepEqual(store.get(id, s.target)!.run.progress, progress);
    store.finish(id, s, []);
    store.updateProgress(id, { ...progress, resources: 999 });
    assert.equal(
      store.get(id, s.target)!.run.resourceCount,
      s.resources.length,
    );
    assert.deepEqual(store.get(id, s.target)!.run.progress, progress);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('checkpoints survive recovery without becoming finished snapshots or retaining source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audit-checkpoint-'));
  const path = join(directory, 'audit.sqlite');
  let store = new AuditStore(path);
  try {
    const s = snapshot(),
      id = store.create(s.target);
    s.collection = {
      requestPolicy: {
        retries: 0,
        requestsPerSecond: 10,
        retryBackoffMs: 0,
        redactPolicySource: true,
      },
      metrics: { requests: 2, retries: 0, rateWaitMs: 0, retryWaitMs: 0 },
    };
    s.checkpoint = {
      savedAt: new Date().toISOString(),
      completedNamespaces: ['team'],
    };
    store.saveCheckpoint(id, s);
    store.close();
    store = new AuditStore(path);
    store.recover();
    const saved = store.get(id, s.target)!;
    assert.equal(saved.run.status, 'interrupted');
    assert.equal(saved.snapshot!.finishedAt, '');
    assert.equal(saved.snapshot!.analysisPerformed, false);
    assert.equal(saved.snapshot!.policiesComplete, false);
    assert.equal(saved.snapshot!.resources[0].data.hcl, undefined);
    assert.deepEqual(saved.snapshot!.checkpoint?.completedNamespaces, ['team']);
    store.saveCheckpoint(id, { ...s, resources: [] });
    assert.equal(store.get(id, s.target)!.snapshot!.resources.length, 2);
    assert.throws(() => exportAudit(saved, 'json'), /finished snapshot/);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

import { prepareResume } from './resume.js';
test('resume validates checkpoint age and recollects namespaces with missing source', () => {
  const s = snapshot();
  s.finishedAt = '';
  s.checkpoint = {
    savedAt: new Date().toISOString(),
    completedNamespaces: [''],
  };
  s.collection = {
    requestPolicy: parseCollectionOptions({}),
    metrics: { requests: 1, retries: 0, rateWaitMs: 0, retryWaitMs: 0 },
  };
  assert.ok(prepareResume(s, s.target).reusable.has(''));
  delete s.resources[0].data.hcl;
  assert.equal(prepareResume(s, s.target).reusable.size, 0);
  assert.throws(
    () => prepareResume(s, s.target, 1000, Date.now() + 2000),
    /too old/,
  );
  assert.throws(() => prepareResume(s, 'http://different.invalid'), /matching/);
  assert.equal(
    parseAuditArguments(['resume', 'run', '--checkpoint-max-age-ms', '1000'])
      .checkpointMaxAgeMs,
    1000,
  );
  assert.throws(
    () =>
      parseAuditArguments(['resume', 'run', '--checkpoint-max-age-ms', '0']),
    /max age/,
  );
});

import { mergeRefresh } from './refresh.js';
test('selective refresh preserves old objects on failed stages and removes them after complete reads', () => {
  const base = snapshot();
  const fresh = structuredClone(base);
  fresh.resources = [];
  fresh.collection = {
    requestPolicy: parseCollectionOptions({ sources: ['policies'] }),
    metrics: { requests: 1, retries: 0, rateWaitMs: 0, retryWaitMs: 0 },
    stageResults: [
      {
        namespace: '',
        stage: 'Policies',
        complete: false,
        finishedAt: fresh.finishedAt,
      },
    ],
  };
  fresh.namespacePolicyCompleteness = { '': false };
  fresh.issues = [{ path: 'sys/policies/acl', reason: 'Vault HTTP 403' }];
  const failed = mergeRefresh(base, fresh, ['policies']);
  assert.equal(failed.resources.length, 2);
  assert.equal(failed.policiesComplete, false);
  fresh.collection.stageResults![0].complete = true;
  fresh.namespacePolicyCompleteness[''] = true;
  fresh.issues = [];
  const success = mergeRefresh(base, fresh, ['policies']);
  assert.equal(success.resources.length, 1);
  assert.equal(success.resources[0].kind, 'role');
  assert.equal(success.refresh?.retainedResources, 1);
  assert.equal(base.resources.length, 2);
  assert.deepEqual(
    parseAuditArguments([
      'refresh',
      'run',
      '--source',
      'policies',
      '--source',
      'identity',
    ]).requestPolicy.sources,
    ['identity', 'policies'],
  );
});

test('refresh preserves original resource age across repeated updates without creating configuration changes', () => {
  const base = snapshot();
  base.finishedAt = '2026-09-01T00:00:00Z';
  base.resources[1].observedAt = '2026-09-01T00:00:00Z';
  const fresh = structuredClone(base);
  fresh.finishedAt = '2026-09-02T00:00:00Z';
  fresh.resources = [];
  const first = mergeRefresh(base, fresh, ['policies']);
  const nextFresh = { ...fresh, finishedAt: '2026-09-03T00:00:00Z' };
  const second = mergeRefresh(first, nextFresh, ['policies']);
  assert.equal(second.resources[1].observedAt, '2026-09-01T00:00:00Z');
  assert.equal(
    second.resources[0].retainedFromSnapshotAt,
    '2026-09-01T00:00:00Z',
  );
  const configuration = execute(base, DEFAULT_SETTINGS).configuration;
  const old: import('../../shared/securityAudit.js').AuditDetail = {
    run: {
      id: 'old',
      target: base.target,
      startedAt: base.startedAt,
      finishedAt: base.finishedAt,
      status: 'completed',
      resourceCount: 2,
      issueCount: 0,
      findingCount: 0,
    },
    snapshot: base,
    findings: [],
    configuration,
  };
  const next = structuredClone(old);
  next.snapshot = second;
  assert.equal(compareRuns(old, next).statistics.resources.changed, 0);
});

import { reportFiles, writeReportDirectory } from './reportDirectory.js';
import { existsSync, statSync } from 'node:fs';
import { parse as parseYamlReport } from 'yaml';
test('directory reports link resources and protect existing output and source redaction', () => {
  const s = snapshot();
  s.resources[0].path = '../../outside';
  const detail: import('../../shared/securityAudit.js').AuditDetail = {
    run: {
      id: 'report',
      target: s.target,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      status: 'completed',
      resourceCount: 2,
      issueCount: 0,
      findingCount: 1,
    },
    snapshot: s,
    findings: [
      {
        ruleId: 'DEMO',
        path: '../../outside',
        severity: 'high',
        title: 'Review',
        evidence: 'evidence',
        recommendation: 'Review',
      },
    ],
  };
  const files = reportFiles(detail, true);
  const overview = parseYamlReport(files.get('overview.yml')!);
  assert.equal(overview.objects.length, 2);
  for (const entry of overview.objects) {
    assert.match(entry.file, /^objects\/[a-f0-9]{64}\.yml$/);
    assert.ok(files.has(entry.file));
  }
  assert.equal(
    parseYamlReport(files.get('indexes/risky-policies.yml')!).policies.length,
    1,
  );
  assert.equal(
    parseYamlReport(files.get('indexes/unassigned-dangerous-policies.yml')!)
      .policies.length,
    0,
  );
  assert.ok(!files.get('snapshot.json')!.includes('# not evaluated'));
  const directory = mkdtempSync(join(tmpdir(), 'audit-directory-'));
  try {
    const destination = join(directory, 'report');
    writeReportDirectory(detail, destination, true);
    assert.ok(existsSync(join(destination, 'coverage.yml')));
    assert.equal(
      statSync(join(destination, 'snapshot.json')).mode & 0o777,
      0o600,
    );
    const before = readFileSync(join(destination, 'overview.yml'), 'utf8');
    assert.throws(() => writeReportDirectory(detail, destination), /EEXIST/);
    assert.equal(
      readFileSync(join(destination, 'overview.yml'), 'utf8'),
      before,
    );
    assert.equal(
      parseAuditArguments([
        'export-directory',
        'run',
        destination,
        '--redact-policy-source',
      ]).redactPolicySource,
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import { reportArchive } from './reportArchive.js';
import { unzipSync, strFromU8 } from 'fflate';
test('ZIP report contains linked indexes and respects source omission', () => {
  const s = snapshot();
  const detail: import('../../shared/securityAudit.js').AuditDetail = {
    run: {
      id: 'zip',
      target: s.target,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      status: 'completed',
      resourceCount: 2,
      issueCount: 0,
      findingCount: 0,
    },
    snapshot: s,
    findings: [],
  };
  const files = unzipSync(reportArchive(detail, true));
  assert.ok(files['overview.yml']);
  assert.ok(files['machine/report.jsonl']);
  assert.equal(
    JSON.parse(strFromU8(files['snapshot.json'])).snapshot.resources[0].data
      .hcl,
    undefined,
  );
  const overview = parseYamlReport(strFromU8(files['overview.yml']));
  assert.ok(
    overview.objects.every((entry: { file: string }) => files[entry.file]),
  );
  assert.equal(
    parseAuditArguments([
      'export-archive',
      'run',
      'report.zip',
      '--redact-policy-source',
    ]).redactPolicySource,
    true,
  );
});

test('legacy Python schema 2 imports without lifecycle metadata and preserves reanalysis', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audit-python-v2-'));
  const path = join(directory, 'legacy.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec(pythonImportFixture.sql);
    const current = importPythonSnapshot(path, 'http://example.invalid');
    db.exec("UPDATE metadata SET value='2' WHERE key='schema_version'");
    const remove = db.prepare('DELETE FROM metadata WHERE key=?');
    for (const key of [
      'analysis_config_hash',
      'collection_stages',
      'collection_config',
      'collection_metrics',
      'finding_states',
      'control_info',
    ])
      remove.run(key);
    const before = readFileSync(path);
    const legacy = importPythonSnapshot(path, 'http://example.invalid');
    assert.deepEqual(readFileSync(path), before);
    assert.equal(legacy.importedFrom?.schemaVersion, 2);
    assert.equal(legacy.importedFrom?.collection, undefined);
    assert.deepEqual(legacy.resources, current.resources);
    assert.deepEqual(legacy.importedCoverage, current.importedCoverage);
    assert.deepEqual(
      execute(legacy, DEFAULT_SETTINGS).findings,
      execute(current, DEFAULT_SETTINGS).findings,
    );
    const analysis = execute(legacy, DEFAULT_SETTINGS);
    const detail: import('../../shared/securityAudit.js').AuditDetail = {
      run: {
        id: 'legacy',
        target: legacy.target,
        startedAt: legacy.startedAt,
        finishedAt: legacy.finishedAt,
        status: 'completed',
        resourceCount: legacy.resources.length,
        issueCount: 0,
        findingCount: analysis.findings.length,
      },
      snapshot: legacy,
      configuration: analysis.configuration,
      findings: analysis.findings,
    };
    assert.throws(
      () => compareRuns(detail, detail),
      /collection scope is unknown/,
    );
    db.exec("DELETE FROM metadata WHERE key='namespaces'");
    assert.deepEqual(
      importPythonSnapshot(path, 'http://example.invalid').namespaces,
      ['team'],
    );
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Python coverage contradictions never establish policy or alias absence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audit-python-coverage-'));
  const path = join(directory, 'python.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec(pythonImportFixture.sql);
    db.exec(
      "UPDATE assignments SET policy_name='missing' WHERE subject_kind='approle'",
    );
    assert.ok(
      execute(
        importPythonSnapshot(path, 'http://example.invalid'),
        DEFAULT_SETTINGS,
      ).findings.some((f) => f.ruleId === 'REF-001'),
    );
    db.exec("UPDATE coverage SET discovered=2 WHERE source='policies'");
    let imported = importPythonSnapshot(path, 'http://example.invalid');
    assert.equal(imported.policiesComplete, false);
    assert.ok(
      imported.issues.some((issue) => issue.reason.includes('counts disagree')),
    );
    assert.ok(
      !execute(imported, DEFAULT_SETTINGS).findings.some(
        (f) => f.ruleId === 'REF-001',
      ),
    );
    db.exec(
      "UPDATE coverage SET discovered=2,scanned=2 WHERE source='policies'",
    );
    assert.equal(
      importPythonSnapshot(path, 'http://example.invalid').policiesComplete,
      false,
    );
    db.exec(
      "UPDATE coverage SET discovered=1,scanned=1 WHERE source='policies'",
    );
    db.exec(
      "INSERT INTO coverage VALUES('team/','policies','complete',1,1,NULL)",
    );
    imported = importPythonSnapshot(path, 'http://example.invalid');
    assert.equal(imported.policiesComplete, false);
    assert.ok(
      imported.issues.some((issue) => issue.reason.includes('Duplicate')),
    );
    db.exec("DELETE FROM subjects WHERE kind='identity_alias'");
    imported = importPythonSnapshot(path, 'http://example.invalid');
    assert.equal(imported.namespaceAliasCompleteness?.team, false);
    assert.equal(
      imported.importedCoverage!.find((row) => row.source === 'identity_alias')!
        .status,
      'complete',
    );
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('saved exact object exceptions survive reopen and never expand wildcard scope', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audit-object-exceptions-'));
  const path = join(directory, 'audit.sqlite');
  const entry = parseExceptions(
    JSON.stringify({
      version: 1,
      exceptions: [
        {
          id: 'saved',
          match: 'exact',
          rule_id: 'POL-001',
          namespace: '',
          object_path: 'sys/policies/acl/team*',
          owner: 'security',
          reason: 'Reviewed',
          expires: '2027-01-01',
        },
      ],
    }),
    new Set(['POL-001']),
  )[0];
  let store = new AuditStore(path);
  try {
    store.addException('vault-a', entry);
    assert.throws(
      () => store.addException('vault-a', { ...entry, id: 'another' }),
      /already exists/,
    );
    store.close();
    store = new AuditStore(path);
    assert.deepEqual(store.exceptions('vault-a').filter(e=>!e.builtin), [entry]);
    assert.deepEqual(store.exceptions('vault-b').filter(e=>!e.builtin), []);
    const finding = {
      ruleId: 'POL-001',
      namespace: '',
      path: entry.object_path,
      severity: 'high' as const,
      title: 'Example',
      evidence: '{}',
      recommendation: 'Review',
    };
    assert.equal(exceptionMatches(entry, finding), true);
    assert.equal(
      exceptionMatches(entry, {
        ...finding,
        path: 'sys/policies/acl/team-admin',
      }),
      false,
    );
    assert.equal(
      exceptionMatches(entry, { ...finding, namespace: 'root' }),
      false,
    );
    assert.equal(
      store.updateException('vault-b', { ...entry, reason: 'Wrong target' }),
      false,
    );
    assert.equal(
      store.updateException('vault-a', { ...entry, reason: 'Updated' }),
      true,
    );
    store.addException('vault-a', {
      ...entry,
      id: 'second',
      object_path: 'sys/policies/acl/second',
    });
    assert.throws(
      () =>
        store.updateException('vault-a', {
          ...entry,
          object_path: 'sys/policies/acl/second',
        }),
      /UNIQUE/,
    );
    store.close();
    store = new AuditStore(path);
    assert.equal(
      store.exceptions('vault-a').find((item) => item.id === entry.id)?.reason,
      'Updated',
    );
    assert.equal(
      store.exceptions('vault-a').find((item) => item.id === entry.id)
        ?.object_path,
      entry.object_path,
    );
    store.removeException('vault-a', 'second');
    assert.equal(store.removeException('vault-b', entry.id), false);
    assert.equal(store.removeException('vault-a', entry.id), true);
    assert.deepEqual(store.exceptions('vault-a').filter(e=>!e.builtin), []);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('bulk run deletion is atomic, target scoped and protects active work', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audit-delete-'));
  const store = new AuditStore(join(directory, 'audit.sqlite'));
  try {
    const a = store.create('vault-a');
    store.fail(a);
    const b = store.create('vault-a');
    store.fail(b);
    const foreign = store.create('vault-b');
    store.fail(foreign);
    assert.throws(
      () => store.deleteRuns('vault-a', [a, foreign]),
      /unavailable/,
    );
    assert.ok(store.get(a, 'vault-a'));
    const active = store.create('vault-a');
    assert.throws(() => store.deleteRuns('vault-a', [a, b]), /active audit/);
    store.fail(active);
    assert.equal(store.deleteRuns('vault-a', [a, b]), 2);
    assert.equal(store.get(a, 'vault-a'), null);
    assert.ok(store.get(active, 'vault-a'));
    assert.ok(store.get(foreign, 'vault-b'));
    assert.throws(
      () => store.deleteRuns('vault-a', [active, active]),
      /distinct/,
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('management checks use mount types, namespace and operation context', async () => {
  const { catalog, DEFAULT_SETTINGS } = await import('./catalog.js');
  const { evaluatePolicy } = await import('./policyDetectors.js');
  const { parsePolicy } = await import('./policyParser.js');
  const rules = catalog({
    ...DEFAULT_SETTINGS,
    configYaml: 'version: 1\nprofile: extended\n',
  });
  const resource = {
    kind: 'policy',
    path: 'sys/policies/acl/example',
    data: { name: 'example' },
  };
  const mounts = [
    {
      kind: 'secret-mount',
      path: 'sys/mounts/crypto',
      data: { type: 'transit', mount_path: 'crypto/' },
    },
    {
      kind: 'secret-mount',
      path: 'sys/mounts/store',
      data: { type: 'kv', mount_path: 'store/', options: { version: '2' } },
    },
  ];
  const check = (
    id: string,
    path: string,
    caps: string[],
    inventory = mounts,
  ) =>
    evaluatePolicy(
      rules.find((r) => r.id === id)!,
      resource,
      parsePolicy(`path "${path}" { capabilities = ${JSON.stringify(caps)} }`),
      inventory,
    );
  assert.equal(check('TRANSIT-006', 'crypto/keys/app', ['update']).length, 1);
  assert.equal(check('TRANSIT-006', 'crypto/encrypt/app', ['update']).length, 0);
  assert.equal(check('TRANSIT-006', 'transit/keys/app', ['update']).length, 0);
  assert.equal(check('TRANSIT-006', 'crypto/keys/app', ['read']).length, 0);
  assert.equal(
    check('TRANSIT-006', 'crypto/keys/app', ['deny', 'update']).length,
    0,
  );
  assert.equal(check('TRANSIT-006', 'crypto/*', ['update']).length, 1);
  assert.equal(
    check(
      'TRANSIT-006',
      'crypto/keys/app',
      ['update'],
      mounts.map((m) => ({ ...m, namespace: 'other' })),
    ).length,
    0,
  );
  assert.equal(
    check('IDENTITY-004', 'identity/group/id/example', ['update']).length,
    1,
  );
  assert.equal(
    check('IDENTITY-004', 'identity/lookup/entity', ['update']).length,
    0,
  );
  assert.equal(check('POL-020', 'store/metadata/app', ['update']).length, 0);
  assert.equal(check('POL-020', 'store/metadata/app', ['delete']).length, 1);
  assert.equal(check('POL-020', 'store/destroy/app', ['update']).length, 1);
  assert.equal(
    check(
      'POL-020',
      'store/destroy/app',
      ['update'],
      mounts.map((m) => ({
        ...m,
        data: { ...m.data, options: { version: '1' } },
      })),
    ).length,
    0,
  );
  for (const [id, type, path] of [
    ['POL-018', 'database', 'custom/roles/app'],
    ['PKI-007', 'pki', 'custom/sign/app'],
  ]) {
    assert.equal(
      check(
        id,
        path,
        ['update'],
        [
          {
            kind: 'secret-mount',
            path: 'sys/mounts/custom',
            data: { type, mount_path: 'custom/' },
          },
        ],
      ).length,
      1,
    );
  }
});

test('domain configuration checks distinguish risky and bounded fixtures', async () => {
  const { evaluateDomain } = await import('./domainChecks.js');
  const s = snapshot();
  s.finishedAt = '2026-09-10T00:00:00Z';
  const role = (name: string, data: Record<string, unknown>) => ({
    kind: 'role',
    path: `auth/token/roles/${name}`,
    data: { auth_type: 'token', ...data },
  });
  s.resources = [
    role('risky', {
      allowed_policies: ['root'],
      allowed_policies_glob: ['*'],
      orphan: true,
      token_period: 86400,
      token_explicit_max_ttl: 0,
    }),
    role('safe', {
      allowed_policies: ['reader'],
      token_period: 3600,
      token_explicit_max_ttl: 3600,
    }),
    {
      kind: 'pki-role',
      path: 'ca/roles/risky',
      data: {
        allow_any_name: true,
        allowed_domains: ['*'],
        max_ttl: 31536000,
        key_type: 'rsa',
        key_bits: 1024,
      },
    },
    {
      kind: 'pki-role',
      path: 'ca/roles/safe',
      data: {
        allow_any_name: false,
        allowed_domains: ['app.example'],
        max_ttl: 3600,
        key_type: 'rsa',
        key_bits: 2048,
      },
    },
    {
      kind: 'pki-issuer',
      path: 'ca/issuer/expiring',
      data: { not_after: Date.parse('2026-09-11T00:00:00Z') },
    },
    {
      kind: 'transit-key',
      path: 'crypto/keys/risky',
      data: {
        exportable: true,
        allow_plaintext_backup: true,
        deletion_allowed: true,
        latest_version: 1,
        latest_version_created_at: 1,
      },
    },
    {
      kind: 'transit-key',
      path: 'crypto/keys/safe',
      data: {
        exportable: false,
        allow_plaintext_backup: false,
        deletion_allowed: false,
        latest_version_created_at: Date.parse(s.finishedAt) / 1000,
      },
    },
  ];
  const context = {
    config: { privileged_policies: { exact: ['root'] } },
    privilegeReasons: new Map<string, string[]>(),
  };
  for (const id of [
    'TOKEN-001',
    'TOKEN-002',
    'TOKEN-003',
    'TOKEN-004',
    'PKI-001',
    'PKI-002',
    'PKI-003',
    'PKI-004',
    'PKI-005',
    'TRANSIT-001',
    'TRANSIT-002',
    'TRANSIT-003',
  ]) {
    const rule = catalog({
      ...DEFAULT_SETTINGS,
      configYaml: 'version: 1\nprofile: extended\n',
    }).find((r) => r.id === id)!;
    const findings = evaluateDomain(
      rule,
      s,
      { assignments: [], issues: [], groupCount: 0, entityCount: 0 },
      context,
    );
    assert.equal(findings.length, 1, id);
    assert.ok(!findings[0].path.endsWith('safe'), id);
  }
});

test('Identity review uses assignments and requires complete mount inventory for stale aliases', async () => {
  const { evaluateDomain } = await import('./domainChecks.js');
  const s = snapshot();
  s.issues = [];
  s.resources = [
    {
      kind: 'entity',
      path: 'identity/entity/id/member',
      data: { id: 'member' },
    },
    {
      kind: 'policy',
      path: 'sys/policies/acl/admin',
      data: {
        name: 'admin',
        hcl: 'path "identity/group/id/team" { capabilities=["update"] }',
      },
    },
    {
      kind: 'alias',
      path: 'identity/entity-alias/id/old',
      data: { mount_accessor: 'absent' },
    },
  ];
  const identity = {
    assignments: [
      {
        subjectPath: 'identity/entity/id/member',
        subjectKind: 'entity',
        policy: 'admin',
        relationship: 'inherited' as const,
        sourcePath: 'identity/group/id/team',
      },
    ],
    issues: [],
    groupCount: 1,
    entityCount: 1,
  };
  const context = {
    config: { privileged_policies: { exact: ['admin'] } },
    privilegeReasons: new Map<string, string[]>(),
  };
  const run = (id: string) =>
    evaluateDomain(
      catalog(DEFAULT_SETTINGS).find((r) => r.id === id)!,
      s,
      identity,
      context,
    );
  assert.equal(run('IDENTITY-001').length, 1);
  assert.equal(run('IDENTITY-002').length, 1);
  assert.equal(run('IDENTITY-003').length, 0);
  s.checkpoint = {
    savedAt: s.finishedAt,
    completedNamespaces: [''],
    completedStages: [{ namespace: '', stage: 'Auth mounts and roles' }],
  };
  assert.equal(run('IDENTITY-003').length, 1);
  s.issues = [{ path: 'sys/auth', reason: 'denied' }];
  assert.equal(run('IDENTITY-003').length, 0);
});

test('domain checks support custom IDs and reject missing or invalid thresholds', async () => {
  const { parseRule } = await import('./catalog.js');
  const builtin = catalog(DEFAULT_SETTINGS).find(rule => rule.id === 'TRANSIT-003')!;
  const definition = JSON.parse(JSON.stringify(parseRule(builtin.yaml)));
  const ruleYaml = (parameters: Record<string, unknown>) => JSON.stringify({version:1,rule:{...definition,id:'CUSTOM-ROTATION',parameters}});
  assert.throws(()=>parseRule(ruleYaml({check:'TRANSIT-003'})),/positive days/);
  assert.throws(()=>parseRule(ruleYaml({check:'TRANSIT-003',days:-1})),/positive days/);
  assert.throws(()=>parseRule(ruleYaml({check:'not-implemented',days:90})),/Unknown domain/);
  const settings={...DEFAULT_SETTINGS,configYaml:'version: 1\nprofile: extended\n',customRulesYaml:ruleYaml({check:'TRANSIT-003',days:10})};
  const s=snapshot();s.finishedAt='2026-09-10T00:00:00Z';s.resources=[{kind:'transit-key',path:'crypto/keys/example',data:{latest_version_created_at:Date.parse('2026-08-20T00:00:00Z')/1000}}];
  assert.equal(execute(s,settings).findings.filter(f=>f.ruleId==='CUSTOM-ROTATION').length,1);
});

test('finding groups separate severity before pagination without changing original finding indices', async () => {
  const {groupAuditFindings}=await import('../../shared/auditFindingGroups.js');
  const findings=['high','critical','high','critical'].map(severity=>({ruleId:'POL-001',title:'Global wildcard',path:'sys/policies/acl/example',severity,evidence:'{}',recommendation:'Review'})) as import('../../shared/securityAudit.js').AuditFinding[];
  const groups=groupAuditFindings(findings,'check');
  assert.deepEqual(groups.map(group=>[group.severity,group.findings.length]),[['critical',2],['high',2]]);
  assert.equal(new Set(groups.map(group=>group.key)).size,2);
  assert.equal(findings.indexOf(groups[0].findings[0]),1);
});

test('JSON ACL policies preserve HCL semantics, attributes and evidence locations', () => {
  const json =
    '{\n  "path": {\n    "secret/data/app/*": {"capabilities":["read","list"],"allowed_parameters":{"env":["dev"]}},\n    "sys/*": {"capabilities":["sudo","update"]}\n  }\n}';
  const hcl =
    'path "secret/data/app/*" { capabilities=["read","list"] allowed_parameters={env=["dev"]} }\npath "sys/*" { capabilities=["sudo","update"] }';
  const normalize = (source: string) =>
    parsePolicy(source).map(({ path, capabilities, attributes }) => ({
      path,
      capabilities,
      attributes,
    }));
  assert.deepEqual(normalize(json), normalize(hcl));
  const first = parsePolicy(json)[0];
  assert.equal(first.line, 3);
  assert.equal(first.column, 5);
  assert.equal(
    first.source,
    '"secret/data/app/*": {"capabilities":["read","list"],"allowed_parameters":{"env":["dev"]}}',
  );
  assert.equal(
    parsePolicy('{"path":[{"sys/*":{"capabilities":["read"]}}]}')[0].path,
    'sys/*',
  );
  assert.equal(
    parsePolicy(
      String.raw`{"path":{"secret\/app":{"capabilities":["read"]}}}`,
    )[0].path,
    'secret/app',
  );
  for (const source of [
    '{"path":{"*":{"capabilities":["read"],"capabilities":["deny"]}}}',
    '{"path":{"*":{"capabilities":["read"]},"*":{"capabilities":["deny"]}}}',
    '{"path":{},"path":{}}',
    '{"path":{"*":{"capabilities":[42]}}}',
    '{"path":{"*":null}}',
    '{"path":{},}',
    '{"unexpected":{}}',
  ])
    assert.throws(() => parsePolicy(source), PolicyParseError);
});

test('collector normalizes Transit epoch and RFC3339 dates while retaining unknown-date gaps', async () => {
  const entries: Record<string, unknown> = {
    symmetric: 1789035362,
    asymmetric: {
      creation_time: '2026-09-10T13:16:02.840223+03:00',
      public_key: 'not-collected',
    },
    invalid: { creation_time: 'not-a-date' },
  };
  const server = createRawServer((socket) => {
    let request = '';
    socket.on('data', (chunk) => {
      request += chunk.toString();
      if (!request.includes('\r\n\r\n')) return;
      const url = request.split(' ')[1];
      let data: unknown = {};
      if (url === '/v1/sys/mounts') data = { 'crypto/': { type: 'transit' } };
      else if (url === '/v1/crypto/keys') data = { keys: Object.keys(entries) };
      else if (url?.startsWith('/v1/crypto/keys/')) {
        const name = url.split('/').at(-1)!;
        data = {
          type: name === 'symmetric' ? 'aes256-gcm96' : 'rsa-2048',
          latest_version: 1,
          keys: { '1': entries[name] },
        };
      }
      const payload = JSON.stringify({ data });
      socket.end(
        `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as import('node:net').AddressInfo;
    const s = await collect(
      `http://127.0.0.1:${port}`,
      'fixture-token',
      false,
      { sources: ['mounts'], retries: 0, requestsPerSecond: 1000 },
    );
    const dates = new Map(
      s.resources
        .filter((r) => r.kind === 'transit-key')
        .map((r) => [r.path, r.data.latest_version_created_at]),
    );
    assert.equal(dates.get('crypto/keys/symmetric'), 1789035362);
    assert.equal(
      dates.get('crypto/keys/asymmetric'),
      Date.parse('2026-09-10T10:16:02.840Z') / 1000,
    );
    assert.equal(dates.get('crypto/keys/invalid'), undefined);
    assert.deepEqual(
      s.issues
        .filter((i) => i.reason.includes('rotation age'))
        .map((i) => i.path),
      ['crypto/keys/invalid'],
    );
    assert.equal(JSON.stringify(s.resources).includes('not-collected'), false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('inventory refresh removes only policies inside a completed filter and retains failed reads', () => {
  const base = snapshot();
  base.resources = ['atlas-read', 'atlas-old', 'cedar-read'].map((name) => ({ kind: 'policy', path: `sys/policies/acl/${name}`, data: { name, hcl: 'old' }, observedAt: '2026-09-01T00:00:00Z' }));
  const fresh = snapshot();
  fresh.resources = [{ ...base.resources[0], data: { name: 'atlas-read', hcl: 'new' }, observedAt: fresh.finishedAt }];
  fresh.issues = [];
  fresh.collection = { requestPolicy: parseCollectionOptions({ policyFilters: ['atlas-*'], sources: ['policies'] }), scope: { policyFilters: ['atlas-*'], authMountFilters: [], authTypeFilters: [], skipIdentity: false }, metrics: { requests: 2, retries: 0, rateWaitMs: 0, retryWaitMs: 0 }, stageResults: [{ namespace: '', stage: 'Policies', complete: true, finishedAt: fresh.finishedAt }] };
  fresh.namespacePolicyCompleteness = { '': false };
  const merged = mergeRefresh(base, fresh, ['policies']);
  assert.deepEqual(merged.resources.map((r) => r.data.name).sort(), ['atlas-read', 'cedar-read']);
  assert.equal(merged.resources.find((r) => r.data.name === 'cedar-read')?.observedAt, '2026-09-01T00:00:00Z');
  assert.equal(merged.policiesComplete, false);
  fresh.collection.stageResults![0].complete = false;
  fresh.issues = [{ path: 'sys/policies/acl/atlas-old', reason: 'Vault HTTP 403' }];
  assert.equal(mergeRefresh(base, fresh, ['policies']).resources.length, 3);
  assert.equal(base.resources.length, 3);
});

test('filtered auth refresh retains roles outside the selected mount and type', () => {
  const base = snapshot();
  base.resources = [
    { kind: 'auth-mount', path: 'auth/team/approle/', data: { type: 'approle' } },
    { kind: 'auth-mount', path: 'auth/kubernetes/', data: { type: 'kubernetes' } },
    { kind: 'role', path: 'auth/team/approle/role/old', data: { auth_type: 'approle' } },
    { kind: 'role', path: 'auth/kubernetes/role/keep', data: { auth_type: 'kubernetes' } },
  ];
  const fresh = snapshot();
  fresh.resources = base.resources.filter((r) => r.kind === 'auth-mount');
  fresh.collection = { requestPolicy: parseCollectionOptions({ authMountFilters: ['team/*'], authTypeFilters: ['approle'] }), scope: { policyFilters: [], authMountFilters: ['team/*'], authTypeFilters: ['approle'], skipIdentity: false }, metrics: { requests: 2, retries: 0, rateWaitMs: 0, retryWaitMs: 0 }, stageResults: [{ namespace: '', stage: 'Auth mounts and roles', complete: true, finishedAt: fresh.finishedAt }] };
  const result = mergeRefresh(base, fresh, ['auth_roles']);
  assert.ok(result.resources.some((r) => r.path === 'auth/kubernetes/role/keep'));
  assert.ok(!result.resources.some((r) => r.path === 'auth/team/approle/role/old'));
});

test('saved snapshots survive run deletion and reanalysis does not advance inventory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-inventory-'));
  const db = new AuditStore(join(dir, 'audit.sqlite'));
  try {
    const s = snapshot();
    const firstJob = db.create(s.target, 'collect');
    const first = db.saveSnapshot(firstJob, s, true);
    db.finish(firstJob, s, []);
    const next = structuredClone(s);
    next.resources[0].data.hcl = 'changed';
    const secondJob = db.create(s.target, 'collect');
    const second = db.saveSnapshot(secondJob, next, true, first);
    db.finish(secondJob, next, []);
    assert.equal(db.currentSnapshot(s.target)?.id, second);
    assert.equal(db.savedSnapshot(second, s.target)?.info.changes.changed, 1);
    assert.equal(db.savedSnapshot(first, s.target)?.snapshot.resources[0].data.hcl, '# not evaluated');
    const analysis = db.create(s.target, 'analyze');
    db.linkSnapshot(analysis, first);
    db.finish(analysis, s, []);
    assert.equal(db.currentSnapshot(s.target)?.id, second);
    db.deleteRuns(s.target, [firstJob, secondJob]);
    assert.equal(db.currentSnapshot(s.target)?.id, second);
    assert.ok(db.savedSnapshot(first, s.target));
    assert.equal(db.savedSnapshot(first, 'https://other.invalid'), null);
    const imported = db.create(s.target, 'import');
    db.saveSnapshot(imported, { ...s, importedFrom: { tool: 'vault-security-audit', schemaVersion: 3, scanId: 'test' } }, false);
    db.finish(imported, s, []);
    assert.equal(db.currentSnapshot(s.target)?.id, second);
    const stale = db.create(s.target, 'collect');
    assert.throws(() => db.saveSnapshot(stale, s, true, first), /Inventory changed/);
    assert.equal(db.currentSnapshot(s.target)?.id, second);
    db.fail(stale);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('legacy migration preserves run payloads and does not promote a later reanalysis or import', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-legacy-inventory-'));
  const path = join(dir, 'audit.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec("CREATE TABLE audit_runs (id TEXT PRIMARY KEY,target TEXT NOT NULL,startedAt TEXT NOT NULL,finishedAt TEXT,status TEXT NOT NULL,resourceCount INTEGER NOT NULL DEFAULT 0,issueCount INTEGER NOT NULL DEFAULT 0,findingCount INTEGER NOT NULL DEFAULT 0,snapshot TEXT,findings TEXT NOT NULL DEFAULT '[]')");
  const original = snapshot();
  original.collection = { requestPolicy: parseCollectionOptions({}), metrics: { requests: 2, retries: 0, rateWaitMs: 0, retryWaitMs: 0 } };
  const insert = legacy.prepare("INSERT INTO audit_runs(id,target,startedAt,status,snapshot) VALUES (?,?,?,'completed',?)");
  insert.run('native', original.target, '2026-09-01', JSON.stringify(original));
  insert.run('reanalyzed', original.target, '2026-09-02', JSON.stringify({ ...original, sourceRunId: 'native' }));
  insert.run('imported', original.target, '2026-09-03', JSON.stringify({ ...original, collection: undefined, importedFrom: { tool: 'vault-security-audit', schemaVersion: 3, scanId: 'old' } }));
  legacy.close();
  const db = new AuditStore(path);
  const current = db.currentSnapshot(original.target)!;
  assert.equal(current.sourceJobId, 'native');
  assert.equal(db.snapshots(original.target).length, 3);
  assert.deepEqual(db.get('native', original.target)?.snapshot, original);
  db.close();
  const reopened = new AuditStore(path);
  try { assert.equal(reopened.currentSnapshot(original.target)?.id, current.id); assert.equal(reopened.snapshots(original.target).length, 3); }
  finally { reopened.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('run retention is target-scoped, persistent and preserves active jobs and snapshots', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audit-retention-'));
  const file = join(directory, 'audit.sqlite');
  let db = new AuditStore(file);
  try {
    const s = snapshot();
    const first = db.create(s.target);
    const saved = db.saveSnapshot(first, s, true);
    db.finish(first, s, []);
    const other = db.create('http://other.invalid');
    db.finish(other, {...s, target: 'http://other.invalid'}, []);
    for (let i = 0; i < 101; i++) {
      const id = db.create(s.target);
      db.finish(id, s, []);
    }
    assert.ok(db.get(first, s.target));
    const active = db.create(s.target);
    assert.equal(db.setRetention(s.target, true).deleted, 2);
    assert.equal(db.get(first, s.target), null);
    assert.ok(db.get(other, 'http://other.invalid'));
    assert.equal(db.get(active, s.target)?.run.status, 'running');
    assert.equal(db.currentSnapshot(s.target)?.id, saved);
    assert.ok(db.savedSnapshot(saved, s.target));
    db.fail(active);
    const inspection = new DatabaseSync(file);
    const count = () => Number(inspection.prepare('SELECT count(*) AS n FROM audit_runs WHERE target=?').get(s.target)?.n);
    assert.equal(count(), 100);
    db.close(); db = new AuditStore(file);
    assert.equal(db.retention(s.target).enabled, true);
    db.setRetention(s.target, false);
    db.finish(db.create(s.target), s, []);
    assert.equal(count(), 101);
    const interrupted = db.create(s.target);
    db.setRetention(s.target, true);
    db.recover();
    assert.equal(count(), 100);
    assert.equal(db.get(interrupted, s.target)?.run.status, 'interrupted');
    inspection.close();
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});


test('exception presets are disabled, persistent, scoped and support type-limited all checks', () => {
  const dir=mkdtempSync(join(tmpdir(),'exception-presets-'));
  let store=new AuditStore(join(dir,'db.sqlite'));
  try {
    const presets=store.exceptions('a');
    assert.equal(presets.length,3);
    assert.ok(presets.every(e=>e.enabled===false));
    const policy=presets.find(e=>e.id==='preset-default-policy')!;
    const finding={ruleId:'POL-001',path:policy.object_path,namespace:'',severity:'critical',title:'Test',evidence:'{}',recommendation:'Test'} as import('../../shared/securityAudit.js').AuditFinding;
    assert.equal(exceptionMatches(policy,finding),false);
    const enabled={...policy,enabled:true};
    const parsed=parseExceptions(JSON.stringify({version:1,exceptions:[enabled]}),new Set(['POL-001']));
    assert.equal(exceptionMatches(parsed[0],finding),true);
    assert.equal(exceptionMatches(enabled,{...finding,path:'auth/approle/role/admin'}),false);
    assert.equal(exceptionMatches(enabled,{...finding,namespace:'child'}),false);
    const scoped={...enabled,match:'glob' as const,namespace:'root',object_path:'*'};
    assert.equal(exceptionMatches(scoped,{...finding,path:'identity/group/id/admin'}),false);
    const token=presets.find(e=>e.object_type==='token')!;
    assert.throws(()=>parseExceptions(JSON.stringify({version:1,exceptions:[{...token,enabled:true}]}),new Set()),/not supported/);
    store.updateException('a',enabled);store.close();store=new AuditStore(join(dir,'db.sqlite'));
    assert.equal(store.exceptions('a').find(e=>e.id===policy.id)?.enabled,true);
    assert.equal(store.exceptions('b').find(e=>e.id===policy.id)?.enabled,false);
    const result=execute(snapshot(),DEFAULT_SETTINGS);
    const controls=applyBaseline([finding],result.configuration,snapshot().target,undefined,[policy], '2026-09-10');
    assert.equal(controls.states[0].suppressed,false);
  }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});


test('renamed check IDs preserve old overrides and exception matching', () => {
  const configYaml = `version: 1\nprofile: default\nrules:\n  POL-005: { enabled: false, severity: critical }\n`;
  const rule = catalog({ ...DEFAULT_SETTINGS, configYaml }).find(r => r.id === 'TOKEN-005')!;
  assert.equal(rule.active, false);
  assert.equal(rule.effectiveSeverity, 'critical');
  assert.ok(!catalog(DEFAULT_SETTINGS).some(r => r.id === 'POL-005'));
  const finding = { ruleId: 'TOKEN-005', namespace: '', path: 'sys/policies/acl/test' } as Parameters<typeof exceptionMatches>[1];
  const entry = { rule_id: 'POL-005', namespace: '', object_path: finding.path, match: 'exact' } as Parameters<typeof exceptionMatches>[0];
  assert.equal(exceptionMatches(entry, finding), true);
  assert.equal(exceptionMatches({ ...entry, rule_id: 'TOKEN-005' }, { ...finding, ruleId: 'POL-005' }), true);
});


test('stored legacy configuration is exposed and saved with canonical IDs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-rename-'));
  const store = new AuditStore(join(dir, 'audit.sqlite'));
  try {
    const saved = store.saveSettings({ ...DEFAULT_SETTINGS, configYaml: 'version: 1\nrules:\n  POL-005: { enabled: false, severity: critical }\n  TOKEN-005: { severity: low }\n' });
    assert.doesNotMatch(saved.configYaml, /POL-005/);
    const rule = catalog(store.settings()).find(r => r.id === 'TOKEN-005')!;
    assert.equal(rule.active, false);
    assert.equal(rule.effectiveSeverity, 'low');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});


test('short PKI role lifetime checks positive TTLs against a configurable minimum', () => {
  const check = (data: Record<string, unknown>, minimum = '24h') => {
    const s = snapshot();
    s.resources = [{ kind: 'pki-role', path: 'pki/roles/web', data }];
    return execute(s, { ...DEFAULT_SETTINGS, configYaml: `version: 1\nthresholds:\n  certificate_ttl_minimum: ${minimum}\n` }).findings.filter(f => f.ruleId === 'PKI-008');
  };
  assert.equal(check({ ttl: 3600, max_ttl: 172800 })[0].severity, 'low');
  assert.equal(check({ ttl: '1h', no_store: true }).length, 1);
  assert.equal(check({ max_ttl: '12h', no_store: false }).length, 1);
  assert.equal(check({ ttl: '24h', max_ttl: '48h' }).length, 0);
  assert.equal(check({ ttl: 0, max_ttl: 0 }).length, 0);
  assert.equal(check({}).length, 0);
  assert.equal(check({ ttl: '12h' }, '8h').length, 0);
  assert.equal(JSON.parse(check({ ttl: '1h', no_store: false })[0].evidence).certificate_storage, 'enabled');
});
