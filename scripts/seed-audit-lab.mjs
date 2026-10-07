/** Repeatable, deliberately risky fixtures for the loopback development Vault. */
import { generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const address = process.env.VAULT_ADDR;
const token = process.env.VAULT_TOKEN;
if (
  address !== 'http://127.0.0.1:18200' ||
  !token ||
  process.env.VAULT_NAMESPACE
)
  throw new Error(
    'Set VAULT_ADDR=http://127.0.0.1:18200 and VAULT_TOKEN for the local root namespace.',
  );
const revision = '43163570bc8e23cfe3986b1369dbfc59a08be6bf';
const upstream = 'manjula-aw/hashicorp-vault-policy-auditor';
const prefix = 'audit-lab-';
const report = { upstream, revision, policies: [], rejected: [], objects: [] };
async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${address}/v1/${path}`, {
    method,
    headers: { 'X-Vault-Token': token, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${method} ${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text).data : undefined;
}
async function put(path, body) {
  const result = await api(path, body);
  report.objects.push(path);
  return result;
}
await api('sys/health'); // Require an initialized, unsealed local Vault.
const currentPolicies = (await api('sys/policies/acl', undefined, 'LIST')).keys;
const existingAuth = await api('sys/auth');
const owner = `VaultLens audit lab ${revision}`;
for (const [mount, config] of Object.entries(existingAuth)) {
  if (mount.startsWith(prefix) && config.description !== owner)
    throw new Error(`Refusing to modify unowned mount ${mount}`);
}
const files = [
  'advanced_syntax_plus',
  'audit_log_tampering',
  'auth_backend_admin',
  'concrete_paths',
  'critical_sudo_grant',
  'database_secrets_admin',
  'kv_v2_metadata_abuse',
  'lazy_admin_wildcard',
  'mixed_capability_star',
  'pki_ca_operations',
  'root_path_exposure',
  'root_wildcard_exposure',
  'segment_wildcard_plus',
  'system_control_plane',
  'system_write_risk',
  'token_and_identity_control',
  'transit_engine_risk',
];
const policyNames = new Map();
for (const file of files) {
  const response = await fetch(
    `https://raw.githubusercontent.com/${upstream}/${revision}/test_policies/${file}.hcl`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok)
    throw new Error(`Unable to fetch ${file}: ${response.status}`);
  const policy = await response.text();
  const name = prefix + file.replaceAll('_', '-');
  // Our marker protects pre-existing policies with coincidentally matching names.
  const marker = `# ${owner}\n`;
  if (
    currentPolicies.includes(name) &&
    !(await api(`sys/policies/acl/${name}`)).policy.startsWith(marker)
  )
    throw new Error(`Refusing to overwrite unowned policy ${name}`);
  try {
    await api(`sys/policies/acl/${name}`, { policy: marker + policy });
    policyNames.set(file, name);
    report.policies.push({ file, name, adapted: false });
  } catch (error) {
    if (
      !policy.includes('["*"]') ||
      !String(error).includes('invalid capability')
    )
      throw error;
    report.rejected.push({ file, reason: String(error) });
    const adaptedName = name + '-expanded';
    if (
      currentPolicies.includes(adaptedName) &&
      !(await api(`sys/policies/acl/${adaptedName}`)).policy.startsWith(marker)
    )
      throw new Error(`Refusing to overwrite unowned policy ${adaptedName}`);
    await api(`sys/policies/acl/${adaptedName}`, {
      policy:
        marker +
        '# Adapted: Vault rejects capability "*".\n' +
        policy.replaceAll(
          '["*"]',
          '["create", "read", "update", "delete", "list", "sudo", "patch"]',
        ),
    });
    policyNames.set(file, adaptedName);
    report.policies.push({ file, name: adaptedName, adapted: true });
  }
}
const policies = (...files) => files.map((file) => policyNames.get(file));
for (const type of ['approle', 'kubernetes', 'jwt']) {
  const mount = prefix + type;
  if (!existingAuth[mount + '/'])
    await put(`sys/auth/${mount}`, { type, description: owner });
}
const approle = async (name, config) =>
  put(`auth/${prefix}approle/role/${name}`, config);
await approle('weak-admin', {
  token_policies: policies('root_path_exposure', 'auth_backend_admin'),
  secret_id_ttl: 0,
  secret_id_num_uses: 0,
  token_ttl: '48h',
  token_max_ttl: '168h',
});
await approle('cidr-only-admin', {
  token_policies: policies('system_write_risk'),
  bind_secret_id: false,
  token_bound_cidrs: ['127.0.0.1/32'],
  token_ttl: '1h',
});
await approle('bounded-reader', {
  token_policies: policies('concrete_paths'),
  secret_id_ttl: '15m',
  secret_id_num_uses: 1,
  token_ttl: '15m',
  token_max_ttl: '1h',
  token_bound_cidrs: ['127.0.0.1/32'],
});
await approle('missing-policy', {
  token_policies: [prefix + 'does-not-exist'],
  secret_id_ttl: '15m',
  secret_id_num_uses: 1,
  token_ttl: '15m',
});
await put(`auth/${prefix}kubernetes/role/wildcard-admin`, {
  bound_service_account_names: ['*'],
  bound_service_account_namespaces: ['*'],
  token_policies: policies('root_wildcard_exposure'),
  token_ttl: '48h',
});
await put(`auth/${prefix}kubernetes/role/bounded-reader`, {
  bound_service_account_names: ['audit-reader'],
  bound_service_account_namespaces: ['audit-lab'],
  token_policies: policies('concrete_paths'),
  token_ttl: '15m',
  token_max_ttl: '1h',
});
// Only a public verification key is stored; no usable signing key or login tokens are retained.
if (!existingAuth[prefix + 'jwt/']) {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await put(`auth/${prefix}jwt/config`, {
    jwt_validation_pubkeys: [publicKey.export({ type: 'spki', format: 'pem' })],
    bound_issuer: 'https://audit-lab.invalid',
  });
}
await put(`auth/${prefix}jwt/role/broad-admin`, {
  role_type: 'jwt',
  user_claim: 'sub',
  bound_claims_type: 'glob',
  bound_claims: { project_path: '*' },
  token_policies: policies(
    'token_and_identity_control',
    'system_control_plane',
  ),
  token_ttl: '48h',
});
await put(`auth/${prefix}jwt/role/bounded-reader`, {
  role_type: 'jwt',
  user_claim: 'sub',
  bound_audiences: ['audit-lab'],
  bound_claims: { project_path: 'audit-lab/reader' },
  token_policies: policies('concrete_paths'),
  token_ttl: '15m',
  token_max_ttl: '1h',
});
await put(`auth/token/roles/${prefix}issuer`, {
  allowed_policies: policies(
    'critical_sudo_grant',
    'token_and_identity_control',
  ),
  orphan: true,
  renewable: true,
  token_period: '24h',
});
await put(`auth/token/roles/${prefix}bounded-issuer`, {
  allowed_policies: policies('concrete_paths'),
  token_explicit_max_ttl: '1h',
  renewable: false,
});
const entity = async (name, policyList, disabled = false) => {
  const result = await put(`identity/entity/name/${prefix}${name}`, {
    policies: policyList,
    disabled,
    metadata: { fixture: owner },
  });
  return result?.id ?? (await api(`identity/entity/name/${prefix}${name}`)).id;
};
const admin = await entity(
  'operator',
  policies('audit_log_tampering', 'auth_backend_admin'),
);
const reader = await entity('reader', policies('concrete_paths'));
const inherited = await entity('inherited-admin', []);
const disabled = await entity(
  'disabled-operator',
  policies('transit_engine_risk'),
  true,
);
await entity('dangling-reference', [prefix + 'does-not-exist']);
const group = async (name, config) => {
  const result = await put(`identity/group/name/${prefix}${name}`, {
    type: 'internal',
    metadata: { fixture: owner },
    ...config,
  });
  return result?.id ?? (await api(`identity/group/name/${prefix}${name}`)).id;
};
const child = await group('team', {
  policies: policies('database_secrets_admin'),
  member_entity_ids: [inherited, reader],
});
await group('platform-admins', {
  policies: policies(
    'system_control_plane',
    'token_and_identity_control',
    'pki_ca_operations',
  ),
  member_group_ids: [child],
  member_entity_ids: [admin],
});
await group('key-operators', {
  policies: policies('transit_engine_risk', 'kv_v2_metadata_abuse'),
  member_entity_ids: [disabled],
});
await group('policy-catalog', {
  policies: [...policyNames.values()],
  member_entity_ids: [],
});
const external = await group('external-team', {
  type: 'external',
  policies: policies('segment_wildcard_plus'),
});
const auth = await api('sys/auth');
// Avoid duplicate aliases on repeat seeding.
async function alias(kind, name, canonicalId) {
  let keys = [];
  try {
    keys = (await api(`identity/${kind}-alias/id`, undefined, 'LIST')).keys;
  } catch (error) {
    if (!String(error).includes(': 404 ')) throw error;
  }
  const accessor = auth[prefix + 'jwt/'].accessor;
  for (const id of keys) {
    const existing = await api(`identity/${kind}-alias/id/${id}`);
    if (existing.name === name && existing.mount_accessor === accessor) return;
  }
  await put(`identity/${kind}-alias`, {
    name,
    canonical_id: canonicalId,
    mount_accessor: accessor,
  });
}
await alias('entity', prefix + 'operator-subject', admin);
await alias('group', prefix + 'external-team', external);
// Custom mount names exercise type-aware management checks.
const secretMounts = await api('sys/mounts');
for (const type of ['transit', 'database', 'pki', 'kv']) {
  const name = prefix + type;
  if (!secretMounts[name + '/'])
    await put('sys/mounts/' + name, {
      type,
      description: 'VaultLens audit lab management fixtures',
      ...(type === 'kv' ? { options: { version: '2' } } : {}),
    });
  else if (secretMounts[name + '/'].type !== type)
    throw new Error(`Unexpected mount type at ${name}`);
}
const managementPolicy = [
  ['audit-lab-transit/keys/demo', 'update'],
  ['audit-lab-database/roles/demo', 'update'],
  ['audit-lab-pki/sign/demo', 'update'],
  ['audit-lab-kv/destroy/demo', 'update'],
  ['identity/group/id/demo', 'update'],
]
  .map(([path, cap]) => `path "${path}" { capabilities = ["${cap}"] }`)
  .join('\n');
await put('sys/policies/acl/' + prefix + 'engine-management', {
  policy: managementPolicy,
});
const operator = await api('identity/entity/id/' + admin);
await put('identity/entity/id/' + admin, {
  policies: [...new Set([...operator.policies, prefix + 'engine-management'])],
});
await writeFile(
  '/tmp/vaultlens-audit-lab-manifest.json',
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    policies: report.policies.length,
    adaptedPolicies: report.rejected.length,
    objectsWritten: report.objects.length,
    manifest: '/tmp/vaultlens-audit-lab-manifest.json',
  }),
);
