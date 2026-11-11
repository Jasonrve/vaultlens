// Dev-only: generates real Vault client activity for the Client Intelligence page.
// Enables activity counting, then performs genuine logins/requests (userpass, AppRole, JWT with
// GitHub-Actions-style claims, non-entity tokens, failed logins). Run after bootstrap.sh:
//   node vault/scripts/client-intelligence-seed.mjs   (VAULT_ADDR / VAULT_TOKEN override defaults)
import { generateKeyPairSync, createSign } from 'node:crypto';

const ADDR = process.env.VAULT_ADDR || 'http://127.0.0.1:8200';
const ROOT = process.env.VAULT_TOKEN || 'root';

async function v(method, path, token = ROOT, body) {
  const res = await fetch(`${ADDR}/v1/${path}`, {
    method, headers: { 'X-Vault-Token': token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : {} };
}
const must = async (p) => { const r = await p; if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

console.log('→ enabling client activity counting');
await must(v('PUT', 'sys/internal/counters/config', ROOT, { enabled: 'enable' }));
await v('PUT', 'sys/policies/acl/ci-demo-reader', ROOT, { policy: 'path "kv/data/*" { capabilities = ["read","list"] }\npath "sys/health" { capabilities = ["read"] }' });
await v('PUT', 'kv/data/demo/app', ROOT, { data: { hello: 'world' } });
const read = (token, n) => Promise.all(Array.from({ length: n }, () => v('GET', 'kv/data/demo/app', token)));

// userpass
for (const [u, n] of [['alice', 40], ['bob', 15], ['charlie', 6]]) {
  const d = await must(v('POST', `auth/userpass/login/${u}`, '', { password: 'example-password' }));
  await read(d.auth.client_token, n);
  console.log(`  userpass ${u}: ${n} requests`);
}

// AppRole (three roles from bootstrap.sh)
for (const [role, n] of [['app-backend', 60], ['deploy-pipeline', 12], ['readonly-service', 25]]) {
  const roleId = (await must(v('GET', `auth/approle/role/${role}/role-id`))).data.role_id;
  const secretId = (await must(v('POST', `auth/approle/role/${role}/secret-id`))).data.secret_id;
  const d = await must(v('POST', 'auth/approle/login', '', { role_id: roleId, secret_id: secretId }));
  await read(d.auth.client_token, n);
  console.log(`  approle ${role}: ${n} requests`);
}

// JWT with GitHub-Actions-style claims mapped into alias metadata (local keypair; nothing external)
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
await must(v('POST', 'auth/jwt/config', ROOT, { jwt_validation_pubkeys: publicKey.export({ type: 'spki', format: 'pem' }) }));
await must(v('POST', 'auth/jwt/role/gha-deploy', ROOT, {
  role_type: 'jwt', user_claim: 'sub', bound_audiences: ['vault'], token_policies: ['ci-demo-reader'],
  claim_mappings: { repository: 'repository', workflow: 'workflow', repository_owner: 'repository_owner' },
}));
for (const [repo, wf, n] of [['org/platform-infra', 'deploy', 45], ['org/iac', 'terraform', 20]]) {
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const body = b64({ iss: 'https://token.actions.githubusercontent.com', aud: 'vault', sub: `repo:${repo}:ref:refs/heads/main`, repository: repo, workflow: wf, repository_owner: repo.split('/')[0], iat: Math.floor(Date.now() / 1000) - 7200, nbf: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) + 7200 }); // wide window: container clocks drift
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
  const d = await must(v('POST', 'auth/jwt/login', '', { role: 'gha-deploy', jwt: `${head}.${body}.${sig}` }));
  await read(d.auth.client_token, n);
  console.log(`  jwt ${repo}: ${n} requests`);
}

// Non-entity tokens
for (const [name, n] of [['legacy-token-sync', 30], ['ad-hoc-debug', 4]]) {
  const d = await must(v('POST', 'auth/token/create', ROOT, { display_name: name, policies: ['ci-demo-reader'], no_parent: true }));
  await read(d.auth.client_token, n);
  console.log(`  token ${name}: ${n} requests`);
}

// Rejected logins (no stable client identity)
for (let i = 0; i < 4; i++) {
  await v('POST', 'auth/userpass/login/alice', '', { password: 'wrong' });
  await v('POST', 'auth/kubernetes/login', '', { role: 'app-role', jwt: 'invalid.demo.jwt' });
}
console.log('✓ done — audit ingestion runs every 60s; open Client Intelligence (or reload) in ~1 minute');
