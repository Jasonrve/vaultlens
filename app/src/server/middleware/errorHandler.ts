import { Request, Response, NextFunction } from 'express';
import { VaultError } from '../lib/vaultClient.js';
import { applicationErrorsTotal } from '../lib/metrics.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof VaultError) {
    console.error(`[VaultError] ${req.method} ${req.path} → ${err.statusCode}: ${err.message}`);
    applicationErrorsTotal.inc({ status_code: String(err.statusCode), error_type: 'vault_error' });

    // Never leak Vault error arrays to clients — they may contain token info
    res.status(err.statusCode).json({
      error: err.statusCode === 403
        ? 'Permission denied'
        : err.statusCode === 404
          ? 'Not found'
          : 'Vault request failed',
    });
    return;
  }

  console.error(`[Error] ${req.method} ${req.path}:`, err);
  applicationErrorsTotal.inc({ status_code: '500', error_type: 'application_error' });

  res.status(500).json({ error: 'Internal server error' });
}
