// Run seed-audit-lab.mjs first. Local synthetic configuration fixtures only.
const addr = process.env.VAULT_ADDR,
  token = process.env.VAULT_TOKEN;
if (addr !== 'http://127.0.0.1:18200' || !token || process.env.VAULT_NAMESPACE)
  throw new Error('Set the local development VAULT_ADDR and VAULT_TOKEN.');
async function api(path, body) {
  const r = await fetch(addr + '/v1/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Vault-Token': token, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 404 && body === undefined) return null;
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t).data : null;
}
for (const name of ['risky', 'bounded']) {
  const path = 'audit-lab-transit/keys/' + name;
  if (!(await api(path)))
    await api(path, {
      type: 'aes256-gcm96',
      exportable: name === 'risky',
      allow_plaintext_backup: name === 'risky',
    });
  await api(path + '/config', {
    deletion_allowed: name === 'risky',
    auto_rotate_period: name === 'risky' ? 0 : '720h',
  });
}
await api('audit-lab-pki/roles/risky', {
  allow_any_name: true,
  allowed_domains: ['*'],
  allow_glob_domains: true,
  allow_subdomains: true,
  max_ttl: '8760h',
  key_type: 'rsa',
  key_bits: 2048,
});
await api('audit-lab-pki/roles/bounded', {
  allow_any_name: false,
  allowed_domains: ['app.audit-lab.invalid'],
  allow_subdomains: false,
  max_ttl: '24h',
  key_type: 'rsa',
  key_bits: 2048,
});
// Internal generation returns the public certificate; the private key stays in Vault.
if (!(await api('audit-lab-pki/config/issuers'))?.default)
  await api('audit-lab-pki/root/generate/internal', {
    common_name: 'Audit Lab Temporary CA',
    ttl: '48h',
  });
await api('auth/token/roles/audit-lab-broad', {
  allowed_policies_glob: ['audit-lab-*'],
  orphan: true,
  token_period: '24h',
  token_explicit_max_ttl: 0,
});
const group = await api('identity/group/name/audit-lab-team');
await api('sys/policies/acl/audit-lab-self-group', {
  policy: `path "identity/group/id/${group.id}" { capabilities=["update"] }\npath "audit-lab-transit/export/*" { capabilities=["read"] }\npath "audit-lab-transit/keys/+/config" { capabilities=["update"] }\npath "audit-lab-pki/sign-verbatim/*" { capabilities=["update"] }`,
});
const entity = await api('identity/entity/name/audit-lab-inherited-admin');
await api('identity/entity/id/' + entity.id, {
  policies: [...new Set([...(entity.policies ?? []), 'audit-lab-self-group'])],
});
console.log(
  'Created risky and bounded domain fixtures; no secret values or private keys exported.',
);
