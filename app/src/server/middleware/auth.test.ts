import test from 'node:test';
import assert from 'node:assert/strict';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../types/index.js';
import { authMiddleware } from './auth.js';
import { VaultClient, VaultError } from '../lib/vaultClient.js';

test('temporary Vault errors do not invalidate the session', async () => {
  const original = VaultClient.prototype.get;
  try {
    for (const [failure, expected] of [
      [new VaultError('throttled', 429), 429],
      [new VaultError('unavailable', 503), 503],
      [new VaultError('denied', 403), 401],
      [new Error('network'), 503],
    ] as const) {
      VaultClient.prototype.get = async () => { throw failure; };
      let status = 0;
      const res = { setHeader() {}, status(value: number) { status = value; return this; }, json() {} };
      await authMiddleware({ headers: { authorization: 'Bearer synthetic-test-token' } } as AuthenticatedRequest, res as unknown as Response, () => assert.fail('Unexpected authentication success'));
      assert.equal(status, expected);
    }
  } finally { VaultClient.prototype.get = original; }
});
