import { Router, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { VaultClient, VaultError } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

router.use(authMiddleware);

// GET /api/sys/health
router.get(
  '/health',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const response = await vaultClient.get<Record<string, unknown>>(
        '/sys/health',
        req.vaultToken!
      );
      return res.json(response);
    } catch (error) {
      if (error instanceof VaultError) {
        // Vault health returns non-200 for standby/sealed but still has data
        return res.json({ error: error.message, statusCode: error.statusCode });
      }
      return next(error);
    }
  }
);

// GET /api/sys/seal-status
router.get(
  '/seal-status',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const response = await vaultClient.get<Record<string, unknown>>(
        '/sys/seal-status',
        req.vaultToken!
      );
      return res.json(response);
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/sys/leader
router.get(
  '/leader',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const response = await vaultClient.get<Record<string, unknown>>(
        '/sys/leader',
        req.vaultToken!
      );
      return res.json(response);
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/sys/host-info
router.get(
  '/host-info',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const response = await vaultClient.get<Record<string, unknown>>(
        '/sys/host-info',
        req.vaultToken!
      );
      return res.json(response);
    } catch (error) {
      if (error instanceof VaultError && error.statusCode === 404) {
        return res.json({});
      }
      return next(error);
    }
  }
);

// GET /api/sys/metrics — Vault telemetry metrics (requires telemetry to be enabled)
router.get(
  '/metrics',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const response = await vaultClient.get<Record<string, unknown>>(
        '/sys/metrics',
        req.vaultToken!
      );
      return res.json(response);
    } catch (error) {
      if (error instanceof VaultError && (error.statusCode === 404 || error.statusCode === 403)) {
        return res.json({});
      }
      return next(error);
    }
  }
);

// GET /api/sys/internal-counters — token, entity, and request counters
router.get(
  '/internal-counters',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const results: Record<string, unknown> = {};

      // Fetch each counter type independently so partial failures don't block
      const counterTypes = ['tokens', 'entities', 'requests'];
      await Promise.all(
        counterTypes.map(async (type) => {
          try {
            const response = await vaultClient.get<{ data: Record<string, unknown> }>(
              `/sys/internal/counters/${type}`,
              req.vaultToken!
            );
            results[type] = response.data ?? {};
          } catch {
            results[type] = {};
          }
        })
      );

      return res.json(results);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
