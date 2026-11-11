// Dev-only: creates real Kubernetes and AWS IAM clients in a local Vault, with no cloud account.
// Both backends call out at login (Kubernetes: TokenReview against the cluster; AWS: STS GetCallerIdentity),
// so this script runs a tiny local stand-in for those two endpoints while it logs in. Vault then creates genuine
// entities, aliases and audit events. Mounts used: auth/kubernetes-demo and auth/aws-demo.
//   node vault/scripts/client-intelligence-seed-cloud.mjs   (VAULT_ADDR / VAULT_TOKEN / FAKE_HOST / FAKE_PORT override)
import http from 'node:http';
import { generateKeyPairSync, createSign } from 'node:crypto';

const ADDR = process.env.VAULT_ADDR || 'http://127.0.0.1:8200';
const ROOT = process.env.VAULT_TOKEN || 'root';
const PORT = Number(process.env.FAKE_PORT || 8765);
const FAKE = `http://${process.env.FAKE_HOST || 'host.docker.internal'}:${PORT}`; // how Vault reaches this machine

async function v(method, path, token = ROOT, body) {
  const res = await fetch(`${ADDR}/v1/${path}`, { method, headers: { 'X-Vault-Token': token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : {} };
}
const must = async (p) => { const r = await p; if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const read = (token, n) => Promise.all(Array.from({ length: n }, () => v('GET', 'kv/data/demo/app', token)));

// ── stand-in for the Kubernetes API (TokenReview) and AWS STS (GetCallerIdentity) ─────────────────────────────
const AWS_IDENTITIES = {
  AKIABILLING: { arn: 'arn:aws:sts::123456789012:assumed-role/billing-lambda-prod/i-0a1b2c', userId: 'AROABILLING0000000000:i-0a1b2c', account: '123456789012' },
  AKIAREPORT: { arn: 'arn:aws:sts::210987654321:assumed-role/reporting-ec2/i-0d4e5f', userId: 'AROAREPORT00000000000:i-0d4e5f', account: '210987654321' },
  AKIAETL: { arn: 'arn:aws:sts::123456789012:assumed-role/data-etl/etl-session', userId: 'AROAETL0000000000000:etl-session', account: '123456789012' },
};
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url?.includes('/tokenreviews')) {
      const spec = JSON.parse(body || '{}').spec ?? {};
      const claims = JSON.parse(Buffer.from(String(spec.token).split('.')[1] ?? '', 'base64url').toString() || '{}');
      const sa = claims['kubernetes.io']?.serviceaccount ?? {};
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        apiVersion: 'authentication.k8s.io/v1', kind: 'TokenReview',
        status: { authenticated: true, audiences: spec.audiences, user: { username: `system:serviceaccount:${claims['kubernetes.io']?.namespace}:${sa.name}`, uid: sa.uid, groups: ['system:serviceaccounts', 'system:authenticated'] } },
      }));
      return;
    }
    const key = /Credential=([A-Z]+)\//.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
    res.setHeader('Content-Type', 'text/xml');
    const form = new URLSearchParams(body);
    if (form.get('Action') === 'GetRole') {
      // Vault qualifies the role ARN (path) through IAM; answer for the demo roles
      const name = form.get('RoleName') ?? '';
      const account = Object.values(AWS_IDENTITIES).find((i) => i.arn.includes(`/${name}/`))?.account ?? '123456789012';
      res.end(`<GetRoleResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><GetRoleResult><Role><Path>/</Path><RoleName>${name}</RoleName><RoleId>AROA${name.replace(/[^a-z]/gi, '').toUpperCase().padEnd(16, '0').slice(0, 16)}</RoleId><Arn>arn:aws:iam::${account}:role/${name}</Arn></Role></GetRoleResult><ResponseMetadata><RequestId>demo</RequestId></ResponseMetadata></GetRoleResponse>`);
      return;
    }
    const id = key === 'AKIADEMOVAULT'
      ? { arn: 'arn:aws:iam::123456789012:user/vault-demo', userId: 'AIDAVAULTDEMO000000', account: '123456789012' } // Vault's own configured credentials
      : AWS_IDENTITIES[key];
    res.statusCode = id ? 200 : 403;
    res.end(id
      ? `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>${id.arn}</Arn><UserId>${id.userId}</UserId><Account>${id.account}</Account></GetCallerIdentityResult><ResponseMetadata><RequestId>demo</RequestId></ResponseMetadata></GetCallerIdentityResponse>`
      : '<ErrorResponse><Error><Code>InvalidClientTokenId</Code></Error></ErrorResponse>');
  });
});
await new Promise((r) => server.listen(PORT, '0.0.0.0', r));
console.log(`→ local TokenReview/STS stand-in listening on :${PORT} (Vault reaches it at ${FAKE})`);

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sign = (claims) => {
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const body = b64(claims);
  return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url')}`;
};

try {
  // Kubernetes ───────────────────────────────────────────────────────────────────────────────────────────────
  await v('POST', 'sys/auth/kubernetes-demo', ROOT, { type: 'kubernetes', description: 'Client Intelligence demo cluster (stand-in TokenReview)' });
  await must(v('POST', 'auth/kubernetes-demo/config', ROOT, { kubernetes_host: FAKE, token_reviewer_jwt: 'demo-reviewer', disable_iss_validation: true, disable_local_ca_jwt: true }));
  const sas = [['payments', 'payments-api', 150], ['vault', 'vault-operator', 70], ['shop', 'checkout-worker', 35], ['shop', 'cart-service', 12]];
  for (const [ns, sa, n] of sas) {
    await must(v('POST', `auth/kubernetes-demo/role/${sa}`, ROOT, { bound_service_account_names: [sa], bound_service_account_namespaces: [ns], token_policies: ['ci-demo-reader'], audience: '' }));
    const uid = `${sa}-0000-4000-8000-${Buffer.from(sa).toString('hex').slice(0, 12).padEnd(12, '0')}`;
    const jwt = sign({ iss: 'kubernetes/serviceaccount', sub: `system:serviceaccount:${ns}:${sa}`, 'kubernetes.io': { namespace: ns, serviceaccount: { name: sa, uid } }, iat: Math.floor(Date.now() / 1000) - 7200, nbf: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) + 7200 }); // wide window: container clocks drift
    const d = await must(v('POST', 'auth/kubernetes-demo/login', '', { role: sa, jwt }));
    await read(d.auth.client_token, n);
    console.log(`  kubernetes ${ns}/${sa}: ${n} requests`);
  }

  // AWS IAM ──────────────────────────────────────────────────────────────────────────────────────────────────
  await v('POST', 'sys/auth/aws-demo', ROOT, { type: 'aws', description: 'Client Intelligence demo AWS mount (stand-in STS)' });
  await must(v('POST', 'auth/aws-demo/config/client', ROOT, { sts_endpoint: FAKE, iam_endpoint: FAKE, access_key: 'AKIADEMOVAULT', secret_key: 'demo-not-used' }));
  await must(v('POST', 'auth/aws-demo/config/identity', ROOT, { iam_alias: 'full_arn', iam_metadata: ['account_id', 'auth_type', 'canonical_arn', 'client_arn', 'client_user_id'] }));
  const roles = [['billing-lambda-prod', 'AKIABILLING', '123456789012', 90], ['reporting-ec2', 'AKIAREPORT', '210987654321', 28], ['data-etl', 'AKIAETL', '123456789012', 55]];
  for (const [role, keyId, account, n] of roles) {
    await must(v('POST', `auth/aws-demo/role/${role}`, ROOT, { auth_type: 'iam', bound_iam_principal_arn: [`arn:aws:iam::${account}:role/*`], resolve_aws_unique_ids: false, token_policies: ['ci-demo-reader'] }));
    const reqBody = 'Action=GetCallerIdentity&Version=2011-06-15';
    const headers = { 'Content-Type': ['application/x-www-form-urlencoded; charset=utf-8'], Host: ['sts.amazonaws.com'], 'X-Amz-Date': ['20261031T000000Z'],
      Authorization: [`AWS4-HMAC-SHA256 Credential=${keyId}/20261031/us-east-1/sts/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=${'0'.repeat(64)}`] };
    const d = await must(v('POST', 'auth/aws-demo/login', '', {
      role, iam_http_request_method: 'POST', iam_request_url: Buffer.from('https://sts.amazonaws.com/').toString('base64'),
      iam_request_body: Buffer.from(reqBody).toString('base64'), iam_request_headers: Buffer.from(JSON.stringify(headers)).toString('base64'),
    }));
    await read(d.auth.client_token, n);
    console.log(`  aws ${role} (${account}): ${n} requests`);
  }
  console.log('✓ Kubernetes and AWS demo clients created — reload Client Intelligence in ~1 minute');
} catch (e) {
  console.error('✗ failed:', e.message);
  process.exitCode = 1;
} finally {
  server.close();
}
