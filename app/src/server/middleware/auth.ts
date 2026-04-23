import { Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { VaultClient, VaultError } from '../lib/vaultClient.js';
import { tokenValidationsTotal } from '../lib/metrics.js';
import type { AuthenticatedRequest, VaultTokenInfo } from '../types/index.js';

const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

function extractToken(req: AuthenticatedRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  const cookieToken = req.cookies?.vault_token as string | undefined;
  if (cookieToken) {
    return cookieToken;
  }

  return null;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const response = await vaultClient.get<{ data: VaultTokenInfo }>(
      '/auth/token/lookup-self',
      token
    );

    req.vaultToken = token;
    req.tokenInfo = response.data;
    tokenValidationsTotal.inc({ result: 'success' });
    next();
  } catch (error) {
    tokenValidationsTotal.inc({ result: 'failure' });
    if (error instanceof VaultError) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    res.status(401).json({ error: 'Authentication failed' });
  }
}
