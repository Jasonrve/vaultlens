// Self-check for attributeAuditError — run with: npx tsx src/server/lib/auditErrorAttribution.selfcheck.ts
import assert from 'node:assert';
import { attributeAuditError } from './auditErrorAttribution.js';

// Different mount — ignored regardless of path
assert.deepStrictEqual(
  attributeAuditError('kubernetes', { mountPoint: 'auth/github/', path: 'auth/github/login', requestData: null }),
  { inMount: false, role: null },
);

// Role admin operation — role extracted from path
assert.deepStrictEqual(
  attributeAuditError('kubernetes', {
    mountPoint: 'auth/kubernetes/',
    path: 'auth/kubernetes/role/app-role',
    requestData: null,
  }),
  { inMount: true, role: 'app-role' },
);

// Login attempt — role extracted from request body
assert.deepStrictEqual(
  attributeAuditError('kubernetes', {
    mountPoint: 'auth/kubernetes/',
    path: 'auth/kubernetes/login',
    requestData: { role: 'argo-deployer', jwt: 'hmac-sha256:...' },
  }),
  { inMount: true, role: 'argo-deployer' },
);

// In-mount but no role reference — counts toward mount total only
assert.deepStrictEqual(
  attributeAuditError('kubernetes', {
    mountPoint: 'auth/kubernetes/',
    path: 'auth/kubernetes/login',
    requestData: {},
  }),
  { inMount: true, role: null },
);

// Role field HMAC'd by Vault (mount not tuned) — treated as unknown, not a garbage key
assert.deepStrictEqual(
  attributeAuditError('kubernetes', {
    mountPoint: 'auth/kubernetes/',
    path: 'auth/kubernetes/login',
    requestData: { role: 'hmac-sha256:abc123', jwt: 'hmac-sha256:...' },
  }),
  { inMount: true, role: null },
);

console.log('auditErrorAttribution self-check passed');
