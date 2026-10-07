import { runGenerator, type Metadata, type Scenario } from './parity-fixtures.js';

/** Rebuild synthetic inputs and retain the independent checked-in answers.
 * Run with app/node_modules/.bin/tsx scripts/generate-auth-parity.ts OUTPUT.json.
 * No Python installation, Vault connection or credentials are required.
 */
export function authScenarios(): Scenario[] {
  const cases: Scenario[] = [];
  function add(name: string, auth: string, metadata: Metadata, config: Metadata = {}) {
    cases.push({ name, resource: { kind: 'role', path: `auth/${auth}/role/demo`,
      data: { auth_type: auth, ...metadata } }, config: { version: 1, ...config } });
  }
  let index = 0;
  for (const privileged of [false, true]) for (const bind of [false, true])
    for (const uses of [0, 100, 101]) for (const ttl of [0, 86400, 86401])
      add(`approle-controls-${index++}`, 'approle', {
        token_policies: [privileged ? 'root' : 'reader'], bind_secret_id: bind,
        secret_id_num_uses: uses, secret_id_ttl: ttl,
      });
  index = 0;
  for (const period of [0, '1h']) for (const explicit of [0, '72h'])
    for (const cidrs of [[], ['127.0.0.1/32']])
      add(`approle-period-${index++}`, 'approle', {
        token_policies: ['vault-admins'], token_period: period,
        token_explicit_max_ttl: explicit, token_bound_cidrs: cidrs,
        secret_id_bound_cidrs: cidrs, bind_secret_id: false,
      });
  index = 0;
  for (const name of [['demo'], ['*']]) for (const namespace of [['demo'], ['*'], []])
    for (const selector of [null, '{}', '{"matchLabels":{"team":"demo"}}'])
      for (const privileged of [false, true])
        add(`kubernetes-scope-${index++}`, 'kubernetes', {
          token_policies: [privileged ? 'root' : 'reader'],
          bound_service_account_names: name, bound_service_account_namespaces: namespace,
          bound_service_account_namespace_selector: selector,
        });
  add('approved-namespace', 'kubernetes', {
    bound_service_account_names: ['*'], bound_service_account_namespaces: ['approved'],
  }, { kubernetes: { allowed_wildcard_namespaces: ['approved'] } });
  for (const auth of ['approle', 'jwt', 'kubernetes']) {
    for (const ttl of [0, 28800, 28801, 86400, 86401, '1d1h'])
      add(`${auth}-ttl-${ttl}`, auth, { token_ttl: ttl, token_max_ttl: 0 });
    add(`${auth}-custom-threshold`, auth, { token_ttl: 3601, token_max_ttl: 14400 },
      { thresholds: { token_ttl_warning: '1h', token_ttl_high: '4h' } });
  }
  index = 0;
  for (const roleType of ['jwt', 'oidc']) for (const privileged of [false, true])
    for (const claims of [{}, { ref_protected: '*', project: 'demo' }, { project: '*' },
      { project: ['demo', '*'] }, { ref_protected: '*' }])
      add(`jwt-claims-${index++}`, 'jwt', {
        role_type: roleType, token_policies: [privileged ? 'root' : 'reader'],
        bound_claims_type: 'glob', bound_claims: claims,
      });
  add('jwt-required-claims', 'jwt', { bound_claims: { project: 'demo' } },
    { jwt: { required_bound_claims_by_mount: { jwt: ['project', 'environment'] } } });
  add('jwt-bounded-subject', 'jwt', { token_policies: ['root'], bound_subject: 'service:demo',
    role_type: 'jwt', bound_audiences: ['vault'] });
  add('pattern-privilege', 'approle', { token_policies: ['team-a-admin'] },
    { privileged_policies: { exact: [], patterns: ['team-[ab]-*'] } });
  add('configured-cidr-exemption', 'approle', { token_policies: ['root'] },
    { approle: { require_cidr_for_privileged_roles: false } });
  add('jwt-custom-boolean-glob', 'jwt', { bound_claims_type: 'glob', bound_claims: { enabled: false } },
    { jwt: { broad_globs: ['False'] } });
  add('jwt-normalized-mount-config', 'jwt', { bound_claims: {} },
    { jwt: { required_bound_claims_by_mount: { '/jwt/': ['project', 'environment'] } } });
  return cases;
}

runGenerator(import.meta.url, 'auth', authScenarios);
