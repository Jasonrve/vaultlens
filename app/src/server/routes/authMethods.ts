import { Router, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { VaultClient, VaultError } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getConfigStorage } from '../lib/config-storage/index.js';
import {
  getTemplate,
  saveTemplateOverride as saveTemplateToDisk,
  substituteTemplate,
  saveTemplateOverride,
  deleteTemplateOverride,
} from '../lib/devIntegrationLoader.js';
import { defaultTemplates } from '../lib/devIntegrationTemplates.js';
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

// ── Developer Integration Template ───────────────────────────────────────────

// Helper: resolve auth type for a given mount
async function getAuthTypeForMount(mount: string, token: string): Promise<string> {
  try {
    const authResponse = await vaultClient.get<AuthMountsResponse>('/sys/auth', token);
    const methodKey = `${mount.replace(/\/$/, '')}/`;
    return authResponse.data[methodKey]?.type ?? mount;
  } catch {
    return mount;
  }
}

// Helper: build substitution variables from Vault config + role data
function buildTemplateVars(
  mount: string,
  role: string,
  authType: string,
  roleData: Record<string, unknown>,
): Record<string, string> {
  const arr = (v: unknown): string =>
    Array.isArray(v) ? (v as string[]).join(', ') : String(v ?? '—');
  const first = (v: unknown): string =>
    Array.isArray(v) && v.length > 0 ? String(v[0]) : String(v ?? '<value>');

  return {
    VAULT_ADDR: config.vaultAddr,
    MOUNT_PATH: mount.replace(/\/$/, ''),
    ROLE_NAME: role,
    AUTH_TYPE: authType,
    // Common
    TOKEN_POLICIES: arr(roleData['token_policies'] ?? roleData['policies']),
    // Kubernetes
    SA_NAMES: arr(roleData['bound_service_account_names']),
    SA_NAMESPACES: arr(roleData['bound_service_account_namespaces']),
    SA_NAME_0: first(roleData['bound_service_account_names']),
    SA_NAMESPACE_0: first(roleData['bound_service_account_namespaces']),
    // AWS
    BOUND_IAM_ROLE_ARNS: arr(roleData['bound_iam_role_arns'] ?? roleData['bound_iam_principal_arns']),
    // Azure
    BOUND_SUBSCRIPTION_IDS: arr(roleData['bound_subscription_ids']),
    BOUND_RESOURCE_GROUPS: arr(roleData['bound_resource_groups']),
    // GCP
    BOUND_SERVICE_ACCOUNTS: arr(roleData['bound_service_accounts']),
    BOUND_PROJECTS: arr(roleData['bound_projects']),
    // JWT / OIDC
    BOUND_AUDIENCES: arr(roleData['bound_audiences']),
    ALLOWED_REDIRECT_URIS: arr(roleData['allowed_redirect_uris']),
  };
}

/**
 * GET /api/auth-methods/:method/developer-template?role=<name>
 * Returns the developer integration guide for the given auth mount+role.
 */
router.get(
  '/:method/developer-template',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const mount = String(req.params['method']).replace(/\/$/, '');
      const role = String(req.query['role'] ?? '');

      if (!mount || !/^[\w\-]+$/.test(mount)) {
        return res.status(400).json({ error: 'Invalid mount name' });
      }
      if (role && !/^[\w\-]+$/.test(role)) {
        return res.status(400).json({ error: 'Invalid role name' });
      }

      const authType = await getAuthTypeForMount(mount, req.vaultToken!);
      const authTypeKey = authType.toLowerCase();

      // Fetch role data for template substitution (ignore errors — role may not exist yet)
      let roleData: Record<string, unknown> = {};
      if (role) {
        try {
          const roleResp = await vaultClient.get<{ data: Record<string, unknown> }>(
            `/auth/${encodeURIComponent(mount)}/role/${encodeURIComponent(role)}`,
            req.vaultToken!,
          );
          roleData = roleResp.data ?? {};
        } catch {
          // ignore — use empty role data, placeholders stay as-is
        }
      }

      // Get template from disk cache (disk file = admin has customized it)
      const fileTemplate = getTemplate(authTypeKey);
      // isCustomized = true only when an admin has saved a custom override on disk
      const isCustomized = fileTemplate !== undefined;
      // Fall back to built-in default template if no disk override exists
      const rawTemplate = fileTemplate ?? defaultTemplates[authTypeKey] ?? '';

      // Admin capability check (re-use same logic as requireAdmin without middleware)
      const policies = req.tokenInfo?.policies ?? [];
      const canCustomize = policies.includes('root') || policies.includes('vaultlens-admin');

      const vars = buildTemplateVars(mount, role, authType, roleData);
      const content = substituteTemplate(rawTemplate, vars);

      return res.json({ content, rawTemplate, authType, isCustomized, canCustomize, templateVars: vars });
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * PUT /api/auth-methods/:method/developer-template
 * Admin-only: override the template for this auth type.
 * Body: { content: string }
 */
router.put(
  '/:method/developer-template',
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const mount = String(req.params['method']).replace(/\/$/, '');
      if (!mount || !/^[\w\-]+$/.test(mount)) {
        return res.status(400).json({ error: 'Invalid mount name' });
      }

      const body = req.body as { content?: unknown };
      if (typeof body?.content !== 'string' || body.content.trim().length === 0) {
        return res.status(400).json({ error: 'content must be a non-empty string' });
      }
      if (body.content.length > 50_000) {
        return res.status(400).json({ error: 'Template content too large (max 50 KB)' });
      }

      const authType = await getAuthTypeForMount(mount, req.vaultToken!);
      const authTypeKey = authType.toLowerCase();

      // Save override to disk
      await saveTemplateToDisk(authTypeKey, body.content);

      return res.json({ success: true, authType });
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * DELETE /api/auth-methods/:method/developer-template
 * Admin-only: reset the template for this auth type to the built-in default.
 */
router.delete(
  '/:method/developer-template',
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const mount = String(req.params['method']).replace(/\/$/, '');
      if (!mount || !/^[\w\-]+$/.test(mount)) {
        return res.status(400).json({ error: 'Invalid mount name' });
      }

      const authType = await getAuthTypeForMount(mount, req.vaultToken!);
      const authTypeKey = authType.toLowerCase();

      // Delete disk override so built-in default is restored
      await deleteTemplateOverride(authTypeKey);

      return res.json({ success: true, authType });

      return res.json({ success: true, authType });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
