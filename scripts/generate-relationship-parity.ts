import { createHash } from 'node:crypto';
import { capabilities, runGenerator, type Resource, type Scenario } from './parity-fixtures.js';

export function relationshipScenarios(): Scenario[] {
  const cases: Scenario[] = [];
  for (const caps of [['update'], ['read'], ['deny', 'update'], ['create', 'update']])
    for (const includeDefault of [false, true])
      for (const allowed of [[], ['reader'], ['root'], ['vault-admins']]) {
        const path = 'auth/approle/role/demo';
        const tokenPath = 'auth/token/roles/issuer';
        const hcl = (paths: string[], grants: string[]) => paths.map((p) =>
          `path ${JSON.stringify(p)} { capabilities = ${capabilities(grants)} }`).join('\n');
        cases.push({ name: `relationship-${cases.length}`, resources: [
          { kind: 'policy', path: 'sys/policies/acl/source', data: { name: 'source',
            hcl: hcl([path, tokenPath, 'sys/auth/*', 'sys/policies/acl/source'], caps) } },
          { kind: 'policy', path: 'sys/policies/acl/default', data: { name: 'default',
            hcl: hcl(['auth/token/create/issuer', 'sys/policies/acl/*', 'auth/+/config'], ['update']) } },
          { kind: 'role', path, data: { auth_type: 'approle', token_policies: ['source'],
            token_no_default_policy: !includeDefault } },
          { kind: 'role', path: tokenPath, data: { auth_type: 'token',
            allowed_policies: allowed, allowed_policies_glob: ['team-*'] } },
        ], path });
      }
  // Keep the historical scenario names stable, including Python's bool spelling.
  const bool = (value: boolean) => value ? 'True' : 'False';
  for (const shared of [false, true]) for (const privileged of [false, true])
    for (const canWrite of [false, true]) {
      const sourcePath = 'auth/approle/role/source';
      const targetPath = 'auth/approle/role/target';
      const resources: Resource[] = [
        { kind: 'policy', path: 'sys/policies/acl/source', data: { name: 'source',
          hcl: `path "${targetPath}" { capabilities = ${capabilities([canWrite ? 'update' : 'read'])} }` } },
        { kind: 'auth-mount', path: 'auth/approle/', data: { type: 'approle', accessor: 'test-accessor' } },
      ];
      const roles: [string, string, string[], string][] = [
        ['source', sourcePath, ['source'], 'entity-a'],
        ['target', targetPath, [privileged ? 'root' : 'reader'], shared ? 'entity-a' : 'entity-b'],
      ];
      for (const [name, path, policies, entity] of roles) {
        const digest = createHash('sha256').update(name).digest('hex');
        resources.push(
          { kind: 'role', path, data: { auth_type: 'approle', token_policies: policies,
            token_no_default_policy: true, role_id_sha256: digest } },
          { kind: 'alias', path: `identity/entity-alias/id/${name}`, data: {
            canonical_id: entity, mount_accessor: 'test-accessor', name_sha256: digest } },
        );
      }
      cases.push({ name: `cross-role-${bool(shared)}-${bool(privileged)}-${bool(canWrite)}`,
        resources, path: sourcePath });
    }
  return cases;
}

runGenerator(import.meta.url, 'relationship', relationshipScenarios);
