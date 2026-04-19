import { Request, Response, NextFunction } from 'express';
import { httpRequestsTotal, httpRequestDurationSeconds } from '../lib/metrics.js';

/**
 * Normalise an Express request path into a low-cardinality route label.
 * Replaces UUIDs, numeric IDs, and path segments that look like dynamic tokens
 * with a placeholder so Prometheus doesn't accumulate unbounded series.
 */
function normaliseRoute(req: Request): string {
  // If express matched a route, use its path pattern which already has :param notation
  const routePath: string | undefined = (req.route as { path?: string } | undefined)?.path;
  if (routePath && typeof routePath === 'string') {
    const base = (req.baseUrl || '');
    return `${base}${routePath}`;
  }
  // Fallback: redact dynamic segments from the raw URL
  const raw = req.path || '/';
  return raw
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
    .replace(/\/\d+/g, '/:id')
    // Redact anything that looks like a Vault token (hvs.something)
    .replace(/\/hvs\.[^/]+/g, '/:token');
}

export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Only instrument API routes.  Static assets (Vite source files, built JS/CSS,
  // images, etc.) would create unbounded label cardinality — one series per file.
  if (!req.path.startsWith('/api/') && req.path !== '/api' && req.path !== '/metrics') {
    return next();
  }

  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const durationSec = Number(process.hrtime.bigint() - startTime) / 1e9;
    const route = normaliseRoute(req);
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSec);
  });

  next();
}
