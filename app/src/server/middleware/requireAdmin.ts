import { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/index.js';

/**
 * Require the authenticated user to have a root or vaultlens-admin policy.
 * Must be used after authMiddleware.
 */
export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const policies = req.tokenInfo?.policies ?? [];
  const isAdmin = policies.includes('root') || policies.includes('vaultlens-admin');

  if (!isAdmin) {
    res.status(403).json({ error: 'Admin privileges required' });
    return;
  }

  next();
}
