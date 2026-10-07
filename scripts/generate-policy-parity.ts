import { capabilities, runGenerator, type Scenario } from './parity-fixtures.js';

export function policyScenarios(): Scenario[] {
  const cases: Scenario[] = [];
  const paths = ['*', '+', 'secret/*', 'secret/data/*', 'secret/metadata/*',
    'secret/nested/*', 'secret/team/*', 'cubbyhole/*', '+/data/*', '+/metadata/*',
    '+/data/team', 'sys/*', 'auth/+/role/*', 'sys/policies/acl/*',
    'sys/policies/acl/demo', 'sys/policies/acl/other', 'sys/policy/default',
    'sys/auth', 'sys/auth/kubernetes', 'sys/auth/*', 'auth/token/create',
    'auth/token/create-orphan', 'auth/token/create/demo', 'auth/token/roles/demo',
    'sys/audit', 'sys/audit/file', 'sys/audit-hash/file', 'sys/mounts',
    'sys/mounts/secret', 'other/path'];
  for (const path of paths) for (const caps of [['read'], ['list'], ['update'],
    ['read', 'sudo'], ['deny'], ['deny', 'update', 'sudo']]) {
    cases.push({ name: `policy-${cases.length}`,
      source: `# review this block\npath ${JSON.stringify(path)} {\n capabilities = ${capabilities(caps)}\n}` });
  }
  cases.push({ name: 'comments-and-restrictions', source: `# path "*" {capabilities=["sudo"]}
/* path "*" {capabilities=["update"]} */
// real policy follows
path "secret/data/demo" {
 capabilities = [
 # read only
 "read",
 ]
 allowed_parameters = {"name"=["a","b"], "nested"=[{"key"="value"}]}
 required_parameters = ["name"]
 min_wrapping_ttl = "1m"
 max_wrapping_ttl = "1h"
}
` });
  cases.push({ name: 'template-and-inline-blocks', source: 'path "secret/{{identity.entity.id}}/*" {capabilities=["read"]}, path "sys/audit" {capabilities=["update"]}' });
  cases.push({ name: 'escaped-label', source: 'path "secret/a\\"b" {capabilities=["read"]}' });
  cases.push({ name: 'duplicate-paths', source: 'path "*" {capabilities=["read"]}\npath "*" {capabilities=["deny"]}' });
  cases.push({ name: 'empty-policy', source: '# empty policy\n' });
  cases.push({ name: 'heredoc', source: `path "secret/*" {
 capabilities=["read"]
 description=<<TEXT
literal path "*" { capabilities = ["sudo"] }
TEXT
}
` });
  return cases;
}

runGenerator(import.meta.url, 'policy', policyScenarios);
