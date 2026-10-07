import { runGenerator, type Metadata, type Scenario } from './parity-fixtures.js';

export function referenceScenarios(): Scenario[] {
  const cases: Scenario[] = [];
  for (const auth of ['approle', 'token']) for (const defaultPolicy of [false, true])
    for (const known of [['root'], ['root', 'default', 'reader']])
      for (const assigned of [['reader', 'reader', 'missing'], ['root', 'vault-admins']]) {
        const data: Metadata = { auth_type: auth, token_policies: assigned,
          token_no_default_policy: !defaultPolicy };
        if (auth === 'token') Object.assign(data, { allowed_policies: ['allowed-missing'],
          allowed_policies_glob: ['glob-*'], disallowed_policies: ['denied'] });
        cases.push({ name: `reference-${cases.length}`, resource: { kind: 'role',
          path: `auth/${auth}/${auth === 'token' ? 'roles' : 'role'}/demo`, data }, known });
      }
  return cases;
}

runGenerator(import.meta.url, 'reference', referenceScenarios);
