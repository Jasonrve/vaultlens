import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { readAuditEntries, listAuditDates } from '../lib/vaultlensAudit.js';
import { getConfigStorage } from '../lib/config-storage/index.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();

const SHARING_CONFIG_SECTION = 'sharing';

export interface SharingConfig {
  enableOneTime: boolean;
  enableOtp: boolean;
  enableAuthLogin: boolean;
  allowCustomViewCount: boolean;
}

const DEFAULT_SHARING_CONFIG: SharingConfig = {
  enableOneTime: true,
  enableOtp: true,
  enableAuthLogin: true,
  allowCustomViewCount: false,
};

export async function readSharingConfig(): Promise<SharingConfig> {
  try {
    const storage = getConfigStorage();
    const data = await storage.get(SHARING_CONFIG_SECTION);
    if (data) {
      return {
        enableOneTime: data['enableOneTime'] !== 'false',
        enableOtp: data['enableOtp'] !== 'false',
        enableAuthLogin: data['enableAuthLogin'] !== 'false',
        allowCustomViewCount: data['allowCustomViewCount'] === 'true',
      };
    }
  } catch {
    // Fall back to defaults
  }
  return { ...DEFAULT_SHARING_CONFIG };
}

// ── Sharing Config ────────────────────────────────────────

// GET /api/vaultlens-audit/sharing-config — read current sharing config (public for share page)
router.get(
  '/sharing-config',
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const cfg = await readSharingConfig();
      res.json(cfg);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/vaultlens-audit/sharing-config — update sharing config (admin only)
router.put(
  '/sharing-config',
  authMiddleware,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { enableOneTime, enableOtp, enableAuthLogin, allowCustomViewCount } = req.body as Partial<SharingConfig>;

      const storage = getConfigStorage();
      await storage.set(SHARING_CONFIG_SECTION, {
        enableOneTime: String(enableOneTime !== false),
        enableOtp: String(enableOtp !== false),
        enableAuthLogin: String(enableAuthLogin !== false),
        allowCustomViewCount: String(allowCustomViewCount === true),
      });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// ── Auth Methods Config ───────────────────────────────────

const AUTH_METHODS_CONFIG_SECTION = 'auth_methods';

export interface AuthMethodsConfig {
  enableDevIntegrationGuides: boolean;
}

const DEFAULT_AUTH_METHODS_CONFIG: AuthMethodsConfig = {
  enableDevIntegrationGuides: true,
};

export async function readAuthMethodsConfig(): Promise<AuthMethodsConfig> {
  try {
    const storage = getConfigStorage();
    const data = await storage.get(AUTH_METHODS_CONFIG_SECTION);
    if (data) {
      return {
        enableDevIntegrationGuides: data['enableDevIntegrationGuides'] !== 'false',
      };
    }
  } catch {
    // Fall back to defaults
  }
  return { ...DEFAULT_AUTH_METHODS_CONFIG };
}

// GET /api/vaultlens-audit/auth-methods-config — read current auth methods config (admin only)
router.get(
  '/auth-methods-config',
  authMiddleware,
  requireAdmin,
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const cfg = await readAuthMethodsConfig();
      res.json(cfg);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/vaultlens-audit/auth-methods-config — update auth methods config (admin only)
router.put(
  '/auth-methods-config',
  authMiddleware,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { enableDevIntegrationGuides } = req.body as Partial<AuthMethodsConfig>;

      const storage = getConfigStorage();
      await storage.set(AUTH_METHODS_CONFIG_SECTION, {
        enableDevIntegrationGuides: String(enableDevIntegrationGuides !== false),
      });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// ── Policies Config ──────────────────────────────────────

const POLICIES_CONFIG_SECTION = 'policies';

export interface PoliciesConfig {
  allowIdentityPolicyFallback: boolean;
}

const DEFAULT_POLICIES_CONFIG: PoliciesConfig = {
  allowIdentityPolicyFallback: false,
};

export async function readPoliciesConfig(): Promise<PoliciesConfig> {
  try {
    const storage = getConfigStorage();
    const data = await storage.get(POLICIES_CONFIG_SECTION);
    if (data) {
      return {
        allowIdentityPolicyFallback: data['allowIdentityPolicyFallback'] === 'true',
      };
    }
  } catch {
    // Fall back to defaults
  }
  return { ...DEFAULT_POLICIES_CONFIG };
}

// GET /api/vaultlens-audit/policies-config — read current policies config (admin only)
router.get(
  '/policies-config',
  authMiddleware,
  requireAdmin,
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const cfg = await readPoliciesConfig();
      res.json(cfg);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/vaultlens-audit/policies-config — update policies config (admin only)
router.put(
  '/policies-config',
  authMiddleware,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { allowIdentityPolicyFallback } = req.body as Partial<PoliciesConfig>;

      const storage = getConfigStorage();
      await storage.set(POLICIES_CONFIG_SECTION, {
        allowIdentityPolicyFallback: String(allowIdentityPolicyFallback === true),
      });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// ── VaultLens Audit Logs ──────────────────────────────────

// GET /api/vaultlens-audit/logs — retrieve audit entries (admin only)
router.get(
  '/logs',
  authMiddleware,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const from = typeof req.query['from'] === 'string' ? req.query['from'] : undefined;
      const to = typeof req.query['to'] === 'string' ? req.query['to'] : undefined;
      const limit = parseInt(String(req.query['limit'] || '100'), 10);
      const offset = parseInt(String(req.query['offset'] || '0'), 10);

      const result = readAuditEntries({ from, to, limit, offset });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/vaultlens-audit/dates — list available audit log dates (admin only)
router.get(
  '/dates',
  authMiddleware,
  requireAdmin,
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const dates = listAuditDates();
      res.json({ dates });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
