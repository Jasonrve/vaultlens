import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { VaultClient } from '../lib/vaultClient.js';
import { getSystemToken, isSystemTokenConfigured } from '../lib/systemToken.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/index.js';
import { config } from '../config/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

// Maximum number of shared secrets stored at once
const MAX_STORED_SECRETS = 1000;

// Stricter rate limit for public shared secret retrieval (Finding #4)
const sharingRetrieveLimit = rateLimit({
  windowMs: 60 * 1000,
  max: config.sharingRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

interface StoredSecret {
  encrypted: string;
  createdAt: string;
  expiresAt: string;
  oneTime: boolean;
  retrieved: boolean;
}

/** Best-effort cleanup of expired shared secrets and enforcement of MAX_STORED_SECRETS */
async function cleanupExpiredSecrets(sysToken: string): Promise<void> {
  try {
    const list = await vaultClient.list<{ data: { keys: string[] } }>(
      '/cubbyhole/shared-secrets',
      sysToken,
    );
    const keys = list?.data?.keys ?? [];

    // Delete expired secrets (batch-limited to avoid blocking the event loop)
    const CLEANUP_BATCH_SIZE = 50;
    const now = new Date();
    let remaining = keys.length;
    const batch = keys.slice(0, CLEANUP_BATCH_SIZE);
    for (const key of batch) {
      try {
        const resp = await vaultClient.get<{ data: StoredSecret }>(
          `/cubbyhole/shared-secrets/${key}`,
          sysToken,
        );
        const expired = new Date(resp.data.expiresAt) < now;
        const consumed = resp.data.oneTime && resp.data.retrieved;
        if (expired || consumed) {
          await vaultClient.delete(`/cubbyhole/shared-secrets/${key}`, sysToken);
          remaining--;
        }
      } catch {
        // Skip individual failures
      }
    }

    // If still over limit after cleanup, reject further creates
    if (remaining >= MAX_STORED_SECRETS) {
      throw new Error('LIMIT_REACHED');
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'LIMIT_REACHED') throw err;
    // If listing fails (e.g. no secrets yet), that's fine
  }
}

// POST /api/sharing — store an encrypted secret (requires auth)
router.post(
  '/',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!isSystemTokenConfigured()) {
        res.status(503).json({ error: 'Sharing requires a system token. Set VAULT_SYSTEM_TOKEN in your .env file (use the value "root" for local development).' });
        return;
      }

      const { encrypted, expiration, oneTime } = req.body as {
        encrypted?: string;
        expiration?: number;  // seconds
        oneTime?: boolean;
      };

      if (!encrypted || typeof encrypted !== 'string') {
        res.status(400).json({ error: 'Encrypted payload is required' });
        return;
      }

      if (encrypted.length > 100_000) {
        res.status(400).json({ error: 'Encrypted payload too large (max 100KB)' });
        return;
      }

      const maxExpiration = 7 * 24 * 60 * 60; // 7 days
      const expirationSecs = Math.min(
        Math.max(expiration ?? 3600, 60),
        maxExpiration
      );

      // Clean up expired secrets and check storage limits
      const sysToken = await getSystemToken();
      try {
        await cleanupExpiredSecrets(sysToken);
      } catch (err) {
        if (err instanceof Error && err.message === 'LIMIT_REACHED') {
          res.status(507).json({ error: 'Maximum number of shared secrets reached. Please wait for existing secrets to expire.' });
          return;
        }
      }

      const secretId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + expirationSecs * 1000);

      const storedData: StoredSecret = {
        encrypted,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        oneTime: oneTime !== false,
        retrieved: false,
      };

      // Store using system token so it's retrievable by anyone with the link
      await vaultClient.post(
        `/cubbyhole/shared-secrets/${secretId}`,
        sysToken,
        storedData
      );

      res.json({
        id: secretId,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/sharing/:id — retrieve an encrypted secret (public, no auth required)
router.get(
  '/:id',
  sharingRetrieveLimit,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const secretId = String(req.params['id']);

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(secretId)) {
        res.status(400).json({ error: 'Invalid secret ID' });
        return;
      }

      const sysToken = await getSystemToken();
      let stored: StoredSecret;
      try {
        const response = await vaultClient.get<{ data: StoredSecret }>(
          `/cubbyhole/shared-secrets/${secretId}`,
          sysToken
        );
        stored = response.data;
      } catch {
        res.status(404).json({ error: 'Secret not found or expired' });
        return;
      }

      // Check expiration
      if (new Date(stored.expiresAt) < new Date()) {
        // Expired — delete from cubbyhole
        try {
          await vaultClient.delete(
            `/cubbyhole/shared-secrets/${secretId}`,
            sysToken
          );
        } catch {
          // Best effort cleanup
        }
        res.status(404).json({ error: 'Secret has expired' });
        return;
      }

      // Check if already retrieved (one-time secrets)
      if (stored.oneTime && stored.retrieved) {
        // Already retrieved — delete and deny
        try {
          await vaultClient.delete(
            `/cubbyhole/shared-secrets/${secretId}`,
            sysToken
          );
        } catch {
          // Best effort cleanup
        }
        res.status(404).json({ error: 'Secret has already been retrieved' });
        return;
      }

      // Mark as retrieved for one-time secrets
      if (stored.oneTime) {
        stored.retrieved = true;
        try {
          await vaultClient.post(
            `/cubbyhole/shared-secrets/${secretId}`,
            sysToken,
            stored
          );
        } catch {
          // Non-fatal — we still return the secret
        }
      }

      res.json({
        encrypted: stored.encrypted,
        createdAt: stored.createdAt,
        expiresAt: stored.expiresAt,
        oneTime: stored.oneTime,
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/sharing/:id — manually delete a shared secret (requires auth)
router.delete(
  '/:id',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const secretId = String(req.params['id']);

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(secretId)) {
        res.status(400).json({ error: 'Invalid secret ID' });
        return;
      }

      const delToken = await getSystemToken();
      await vaultClient.delete(
        `/cubbyhole/shared-secrets/${secretId}`,
        delToken
      );

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
