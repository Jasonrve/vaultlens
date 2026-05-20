import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { VaultClient } from '../lib/vaultClient.js';
import { getSystemToken, isSystemTokenConfigured } from '../lib/systemToken.js';
import { authMiddleware } from '../middleware/auth.js';
import { sharedSecretsCreatedTotal, sharedSecretsRetrievedTotal } from '../lib/metrics.js';
import { writeAuditEntry } from '../lib/vaultlensAudit.js';
import { readSharingConfig } from './vaultlens-audit.js';
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

type ShareMode = 'one-time' | 'otp' | 'auth-login';

interface StoredSecret {
  encrypted: string;
  createdAt: string;
  expiresAt: string;
  oneTime: boolean;
  retrieved: boolean;
  /** Sharing mode: one-time | otp | auth-login */
  shareMode: ShareMode;
  /** SHA-256 hash of OTP code (only for 'otp' mode) */
  otpHash?: string;
  /** Display name of the creator */
  creatorName: string;
}

/** Hash an OTP code for storage (SHA-256, not reversible) */
function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/** Verify an OTP code against its hash using constant-time comparison */
function verifyOtpHash(code: string, hash: string): boolean {
  const inputHash = hashOtp(code);
  const a = Buffer.from(inputHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getClientIp(req: AuthenticatedRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]!.trim();
  return req.ip || req.socket.remoteAddress || 'unknown';
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

      const { encrypted, expiration, oneTime, shareMode, otpCode } = req.body as {
        encrypted?: string;
        expiration?: number;  // seconds
        oneTime?: boolean;
        shareMode?: ShareMode;
        otpCode?: string;
      };

      const mode: ShareMode = shareMode || 'one-time';

      // Validate share mode is enabled
      const sharingConfig = await readSharingConfig();
      if (mode === 'one-time' && !sharingConfig.enableOneTime) {
        res.status(400).json({ error: 'One-time sharing is disabled by administrator' });
        return;
      }
      if (mode === 'otp' && !sharingConfig.enableOtp) {
        res.status(400).json({ error: 'OTP sharing is disabled by administrator' });
        return;
      }
      if (mode === 'auth-login' && !sharingConfig.enableAuthLogin) {
        res.status(400).json({ error: 'Auth-login sharing is disabled by administrator' });
        return;
      }

      // Validate OTP code for OTP mode
      if (mode === 'otp') {
        if (!otpCode || typeof otpCode !== 'string' || otpCode.length < 4 || otpCode.length > 64) {
          res.status(400).json({ error: 'OTP code is required (4-64 characters)' });
          return;
        }
      }

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

      const creatorName = req.tokenInfo?.display_name || req.tokenInfo?.entity_id || 'unknown';

      const storedData: StoredSecret = {
        encrypted,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        oneTime: mode === 'one-time' ? (oneTime !== false) : false,
        retrieved: false,
        shareMode: mode,
        creatorName,
        ...(mode === 'otp' && otpCode ? { otpHash: hashOtp(otpCode) } : {}),
      };

      // Store using system token so it's retrievable by anyone with the link
      await vaultClient.post(
        `/cubbyhole/shared-secrets/${secretId}`,
        sysToken,
        storedData
      );

      // Build share URL for audit
      const shareUrl = `/shared/${secretId}`;

      // Audit: share created
      writeAuditEntry({
        timestamp: now.toISOString(),
        action: 'share_created',
        shareId: secretId,
        shareMode: mode,
        url: shareUrl,
        creator: creatorName,
        clientIp: getClientIp(req),
      });

      res.json({
        id: secretId,
        expiresAt: expiresAt.toISOString(),
        shareMode: mode,
      });
      sharedSecretsCreatedTotal.inc();
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/sharing/:id — retrieve secret metadata (public, rate-limited)
// For one-time mode: returns encrypted payload immediately.
// For OTP / auth-login: returns metadata only; client must POST to /unlock.
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
        try {
          await vaultClient.delete(`/cubbyhole/shared-secrets/${secretId}`, sysToken);
        } catch { /* best effort */ }
        res.status(404).json({ error: 'Secret has expired' });
        return;
      }

      // Check if already retrieved (one-time secrets)
      if (stored.oneTime && stored.retrieved) {
        try {
          await vaultClient.delete(`/cubbyhole/shared-secrets/${secretId}`, sysToken);
        } catch { /* best effort */ }
        res.status(404).json({ error: 'Secret has already been retrieved' });
        return;
      }

      const shareMode: ShareMode = stored.shareMode || 'one-time';

      // For one-time mode: return encrypted payload immediately
      if (shareMode === 'one-time') {
        if (stored.oneTime) {
          stored.retrieved = true;
          try {
            await vaultClient.post(`/cubbyhole/shared-secrets/${secretId}`, sysToken, stored);
          } catch { /* non-fatal */ }
        }

        // Audit: share viewed
        writeAuditEntry({
          timestamp: new Date().toISOString(),
          action: 'share_viewed',
          shareId: secretId,
          shareMode: 'one-time',
          url: `/shared/${secretId}`,
          creator: stored.creatorName,
          viewer: 'anonymous',
          clientIp: getClientIp(req),
        });

        res.json({
          encrypted: stored.encrypted,
          createdAt: stored.createdAt,
          expiresAt: stored.expiresAt,
          oneTime: stored.oneTime,
          shareMode,
        });
        sharedSecretsRetrievedTotal.inc();
        return;
      }

      // For OTP and auth-login: return metadata only (no encrypted payload)
      res.json({
        createdAt: stored.createdAt,
        expiresAt: stored.expiresAt,
        shareMode,
        requiresAuth: shareMode === 'auth-login',
        requiresOtp: shareMode === 'otp',
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/sharing/:id/unlock — unlock a secret with OTP or auth token
router.post(
  '/:id/unlock',
  sharingRetrieveLimit,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const secretId = String(req.params['id']);

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
        try {
          await vaultClient.delete(`/cubbyhole/shared-secrets/${secretId}`, sysToken);
        } catch { /* best effort */ }
        res.status(404).json({ error: 'Secret has expired' });
        return;
      }

      const shareMode: ShareMode = stored.shareMode || 'one-time';

      // Handle OTP unlock
      if (shareMode === 'otp') {
        const { otpCode } = req.body as { otpCode?: string };
        if (!otpCode || typeof otpCode !== 'string') {
          res.status(400).json({ error: 'OTP code is required' });
          return;
        }

        if (!stored.otpHash || !verifyOtpHash(otpCode, stored.otpHash)) {
          res.status(403).json({ error: 'Invalid OTP code' });
          return;
        }

        writeAuditEntry({
          timestamp: new Date().toISOString(),
          action: 'share_viewed',
          shareId: secretId,
          shareMode: 'otp',
          url: `/shared/${secretId}`,
          creator: stored.creatorName,
          viewer: 'otp-verified',
          clientIp: getClientIp(req),
        });

        res.json({
          encrypted: stored.encrypted,
          createdAt: stored.createdAt,
          expiresAt: stored.expiresAt,
          oneTime: false,
          shareMode,
        });
        sharedSecretsRetrievedTotal.inc();
        return;
      }

      // Handle auth-login unlock
      if (shareMode === 'auth-login') {
        // Prefer session cookie / Authorization header; body authToken is a fallback
        const cookieToken = req.cookies?.vault_token as string | undefined;
        const headerToken = req.headers.authorization?.startsWith('Bearer ')
          ? req.headers.authorization.slice(7)
          : undefined;
        const { authToken: bodyToken } = req.body as { authToken?: string };
        const token = cookieToken || headerToken || bodyToken;

        if (!token || typeof token !== 'string') {
          res.status(401).json({ error: 'Authentication required. Please log in to view this secret.' });
          return;
        }

        // Verify token against Vault
        let viewerName = 'unknown';
        try {
          const vClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);
          const lookup = await vClient.get<{ data: { display_name: string; entity_id: string } }>(
            '/auth/token/lookup-self',
            token
          );
          viewerName = lookup.data.display_name || lookup.data.entity_id || 'authenticated';
        } catch {
          res.status(401).json({ error: 'Invalid or expired authentication token' });
          return;
        }

        writeAuditEntry({
          timestamp: new Date().toISOString(),
          action: 'share_viewed',
          shareId: secretId,
          shareMode: 'auth-login',
          url: `/shared/${secretId}`,
          creator: stored.creatorName,
          viewer: viewerName,
          clientIp: getClientIp(req),
        });

        res.json({
          encrypted: stored.encrypted,
          createdAt: stored.createdAt,
          expiresAt: stored.expiresAt,
          oneTime: false,
          shareMode,
        });
        sharedSecretsRetrievedTotal.inc();
        return;
      }

      // Fallback: one-time mode shouldn't use unlock endpoint
      res.status(400).json({ error: 'This secret does not require unlocking' });
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
