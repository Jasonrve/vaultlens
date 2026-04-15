import { Router, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { VaultClient, VaultError } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

router.use(authMiddleware);

interface AuthMountsResponse {
  data: Record<string, {
    type: string;
    description: string;
    accessor: string;
    config: Record<string, unknown>;
  }>;
}

function getRoleListPath(authType: string, mountPath: string): string {
  const normalizedMount = mountPath.replace(/\/$/, '');

  // Most auth methods use /role for listing roles
  switch (authType) {
    case 'approle':
    case 'kubernetes':
    case 'oidc':
    case 'jwt':
    case 'aws':
    case 'azure':
    case 'gcp':
    case 'ldap':
    case 'cert':
    case 'token':
      return `/auth/${normalizedMount}/role`;
    default:
      return `/auth/${normalizedMount}/role`;
  }
}

// List auth methods
router.get(
  '/',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const response = await vaultClient.get<AuthMountsResponse>(
        '/sys/auth',
        req.vaultToken!
      );

      const methods = Object.entries(response.data).map(([path, info]) => ({
        path,
        type: info.type,
        description: info.description,
        accessor: info.accessor,
        config: info.config,
      }));

      res.json({ authMethods: methods });
    } catch (error) {
      next(error);
    }
  }
);

// List roles for a given auth method
router.get(
  '/:method/roles',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const method = String(req.params['method']);

      // First get the auth method type
      const authResponse = await vaultClient.get<AuthMountsResponse>(
        '/sys/auth',
        req.vaultToken!
      );

      const methodKey = `${method}/`;
      const authInfo = authResponse.data[methodKey];
      const authType = authInfo?.type || method;

      const rolePath = getRoleListPath(authType, method);

      try {
        const response = await vaultClient.list<{
          data: { keys: string[] };
        }>(rolePath, req.vaultToken!);

        res.json({
          method,
          type: authType,
          roles: response.data.keys,
        });
      } catch (innerError) {
        // Vault returns 404 when no roles exist or the auth method doesn't support role listing
        if (innerError instanceof VaultError && innerError.statusCode === 404) {
          res.json({ method, type: authType, roles: [] });
          return;
        }
        throw innerError;
      }
    } catch (error) {
      next(error);
    }
  }
);

// Get a specific role's details
router.get(
  '/:method/roles/:role',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const method = String(req.params['method']);
      const role = String(req.params['role']);
      const normalizedMount = method.replace(/\/$/, '');

      const response = await vaultClient.get<{ data: Record<string, unknown> }>(
        `/auth/${normalizedMount}/role/${encodeURIComponent(role)}`,
        req.vaultToken!
      );

      res.json({
        method,
        role,
        data: response.data,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ── Auth method config (type-specific, e.g. /auth/oidc/config) ──────────────
router.get(
  '/:method/config',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const mount = String(req.params['method']).replace(/\/$/, '');
      const response = await vaultClient.get<{ data: Record<string, unknown> }>(
        `/auth/${encodeURIComponent(mount)}/config`,
        req.vaultToken!
      );
      return res.json({ config: response.data ?? {} });
    } catch (error) {
      // Vault returns 404 when config hasn't been set up yet — treat as empty config
      if (error instanceof VaultError && error.statusCode === 404) {
        return res.json({ config: {} });
      }
      return next(error);
    }
  }
);

router.post(
  '/:method/config',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const mount = String(req.params['method']).replace(/\/$/, '');
      const body = req.body as Record<string, unknown>;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'Request body must be a JSON object' });
      }
      if (Object.keys(body).length > 50) {
        return res.status(400).json({ error: 'Too many configuration keys' });
      }
      await vaultClient.post(
        `/auth/${encodeURIComponent(mount)}/config`,
        req.vaultToken!,
        body
      );
      return res.json({ success: true });
    } catch (error) {
      return next(error);
    }
  }
);

// ── Method options (sys/auth/:mount/tune) ────────────────────────────────────
router.get(
  '/:method/tune',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const mount = String(req.params['method']).replace(/\/$/, '');
      // /sys/auth/:mount/tune returns data at the root level (no .data wrapper)
      const response = await vaultClient.get<Record<string, unknown>>(
        `/sys/auth/${encodeURIComponent(mount)}/tune`,
        req.vaultToken!
      );
      return res.json({ tune: response });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/:method/tune',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const mount = String(req.params['method']).replace(/\/$/, '');
      const body = req.body as Record<string, unknown>;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'Request body must be a JSON object' });
      }
      if (Object.keys(body).length > 50) {
        return res.status(400).json({ error: 'Too many tune parameters' });
      }
      await vaultClient.post(
        `/sys/auth/${encodeURIComponent(mount)}/tune`,
        req.vaultToken!,
        body
      );
      return res.json({ success: true });
    } catch (error) {
      return next(error);
    }
  }
);

// ── Role CRUD ─────────────────────────────────────────────────────────────────

// Create or update a role
router.post(
  '/:method/roles/:role',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const mount = String(req.params['method']).replace(/\/$/, '');
      const role = String(req.params['role']);
      if (!role || !/^[\w\-]+$/.test(role)) {
        return res.status(400).json({ error: 'Invalid role name' });
      }
      const body = req.body as Record<string, unknown>;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'Request body must be a JSON object' });
      }
      if (Object.keys(body).length > 100) {
        return res.status(400).json({ error: 'Too many role parameters' });
      }
      await vaultClient.post(
        `/auth/${encodeURIComponent(mount)}/role/${encodeURIComponent(role)}`,
        req.vaultToken!,
        body
      );
      return res.json({ success: true, method: mount, role });
    } catch (error) {
      return next(error);
    }
  }
);

// Delete a role
router.delete(
  '/:method/roles/:role',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const mount = String(req.params['method']).replace(/\/$/, '');
      const role = String(req.params['role']);
      if (!role || !/^[\w\-]+$/.test(role)) {
        return res.status(400).json({ error: 'Invalid role name' });
      }
      await vaultClient.delete(
        `/auth/${encodeURIComponent(mount)}/role/${encodeURIComponent(role)}`,
        req.vaultToken!
      );
      return res.json({ success: true });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
