import { Router, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { VaultClient } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import { getSystemToken, clearSystemTokenCache } from '../lib/systemToken.js';
import { authLoginsTotal, activeSessions } from '../lib/metrics.js';
import type { AuthenticatedRequest, VaultTokenInfo } from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

// ── Public: available auth method types (for login page) ─────────────────────
// Uses the system token so Vault's /sys/auth can be queried without a user session.
// Results are cached to avoid hitting Vault on every login page load.
// Only available after system token is configured (first-time setup returns token-only).

const authMethodsRateLimit = rateLimit({
  windowMs: 60_000, // 1 minute
  max: config.authMethodsRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

interface CachedAuthMethods {
  methods: { path: string; type: string; defaultRole: string }[];
  cachedAt: number;
}
let authMethodsCache: CachedAuthMethods | null = null;
const AUTH_METHODS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

router.get(
  '/methods',
  authMethodsRateLimit,
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // Serve from cache if still fresh
      if (authMethodsCache && Date.now() - authMethodsCache.cachedAt < AUTH_METHODS_CACHE_TTL_MS) {
        res.json({ methods: authMethodsCache.methods });
        return;
      }

      const token = await getSystemToken();
      if (!token) {
        // No system token available — return empty list for token-only login mode
        res.json({ methods: [] });
        return;
      }

      const response = await vaultClient.get<{
        data: Record<string, { type: string; config?: Record<string, unknown> }>;
      }>('/sys/auth', token);

      // Only expose OIDC methods — JWT is a different auth type that doesn't support OIDC login flow
      const methods = Object.entries(response.data)
        .filter(([, info]) => info.type === 'oidc')
        .map(([path, info]) => ({
          path: path.replace(/\/$/, ''),
          type: info.type,
          defaultRole: (info.config?.['default_role'] as string) || '',
        }));

      authMethodsCache = { methods, cachedAt: Date.now() };
      res.json({ methods });
    } catch (error) {
      // Always return an empty list on any failure — this is a public convenience
      // endpoint used by the login page. Errors (e.g. invalid/stale system token,
      // permission denied) must not block the login page or reveal internals.
      // The user will fall back to token-only login and can configure the system
      // token via /setup.
      // Clear stale cached token so the next request re-authenticates
      clearSystemTokenCache();
      console.warn('[auth/methods] Failed to fetch auth methods (returning empty list):', error instanceof Error ? error.message : error);
      res.json({ methods: [] });
    }
  }
);

router.post(
  '/login',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { token } = req.body as { token?: string };

      if (!token || typeof token !== 'string') {
        res.status(400).json({ error: 'Token is required' });
        return;
      }

      const response = await vaultClient.get<{ data: VaultTokenInfo }>(
        '/auth/token/lookup-self',
        token
      );

      const tokenInfo = response.data;

      res.cookie('vault_token', token, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'lax',
        maxAge: tokenInfo.ttl > 0 ? tokenInfo.ttl * 1000 : 24 * 60 * 60 * 1000,
        path: '/',
      });

      res.json({
        success: true,
        tokenInfo: {
          display_name: tokenInfo.display_name,
          policies: tokenInfo.policies,
          identity_policies: tokenInfo.identity_policies ?? [],
          ttl: tokenInfo.ttl,
          expire_time: tokenInfo.expire_time,
          entity_id: tokenInfo.entity_id,
          type: tokenInfo.type,
        },
      });
      authLoginsTotal.inc({ method: 'token', result: 'success' });
      activeSessions.inc();
    } catch (error) {
      authLoginsTotal.inc({ method: 'token', result: 'failure' });
      next(error);
    }
  }
);

// ── OIDC: get authorization URL (unauthenticated — Vault validates redirect_uri) ──────────
router.post(
  '/oidc/auth-url',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { mountPath, role, redirectUri } = req.body as {
        mountPath?: string;
        role?: string;
        redirectUri: string;
      };

      const mount = (mountPath || 'oidc').replace(/^\/+|\/+$/g, '');

      if (!redirectUri || typeof redirectUri !== 'string' || !redirectUri.startsWith('http')) {
        res.status(400).json({ error: 'A valid redirectUri is required' });
        return;
      }

      const payload: Record<string, string> = { redirect_uri: redirectUri };
      if (role?.trim()) payload.role = role.trim();

      console.log(`[OIDC] Requesting auth_url — mount="${mount}", role="${role ?? '(none, using default_role)'}", redirect_uri="${redirectUri}"`);

      // Probe the mount config so we can report useful diagnostics
      let mountConfig: { data?: { default_role?: string; oidc_discovery_url?: string } } = {};
      try {
        mountConfig = await vaultClient.get<typeof mountConfig>(
          `/auth/${encodeURIComponent(mount)}/config`,
          ''
        );
      } catch {
        // non-fatal — we still attempt the auth_url call
      }

      const response = await vaultClient.post<{ data: { auth_url: string } }>(
        `/auth/${encodeURIComponent(mount)}/oidc/auth_url`,
        '',
        payload
      );

      const authUrl = response?.data?.auth_url;
      if (!authUrl) {
        // Vault returns auth_url="" (HTTP 200) for several reasons — build a diagnostic message.
        const defaultRole = mountConfig?.data?.default_role;
        const discoveryUrl = mountConfig?.data?.oidc_discovery_url;
        const effectiveRole = role?.trim() || defaultRole || null;

        const lines: string[] = [
          `Vault returned an empty auth_url for mount "${mount}". Common causes:`,
          '',
          `  1. No role resolved — you ${role?.trim() ? `sent role="${role.trim()}"` : 'did not send a role'} and the mount's default_role is "${defaultRole ?? '(not set)'}".\n     Fix: enter a role name in the login form, or set default_role on the Vault OIDC mount.`,
          '',
          `  2. redirect_uri mismatch — ensure exactly this URI is in the role's allowed_redirect_uris:\n     ${redirectUri}`,
          '',
          `  3. OIDC provider not configured — discovery_url on this mount is: "${discoveryUrl ?? '(unknown)'}"`,
        ];

        if (effectiveRole) {
          lines.push('', `  Role that would be used: "${effectiveRole}"`);
        }

        console.warn(`[OIDC] Empty auth_url returned. Diagnostics:\n${lines.join('\n')}`);
        res.status(502).json({ error: lines.join('\n') });
        return;
      }

      res.json({ authUrl });
    } catch (error) {
      next(error);
    }
  }
);

// ── OIDC: exchange code + state for Vault token ───────────────────────────────────────────
router.post(
  '/oidc/callback',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { mountPath, code, state } = req.body as {
        mountPath?: string;
        code: string;
        state: string;
      };

      const mount = (mountPath || 'oidc').replace(/^\/+|\/+$/g, '');

      if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
        res.status(400).json({ error: 'code and state are required' });
        return;
      }

      // Exchange code for Vault client_token (unauthenticated endpoint)
      const callbackResp = await vaultClient.get<{
        auth: {
          client_token: string;
          lease_duration: number;
          policies: string[];
          display_name: string;
          entity_id: string;
          token_type: string;
          accessor: string;
        };
      }>(
        `/auth/${encodeURIComponent(mount)}/oidc/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
        ''
      );

      const clientToken = callbackResp.auth.client_token;

      // Look up full token info
      const tokenInfoResp = await vaultClient.get<{ data: VaultTokenInfo }>(
        '/auth/token/lookup-self',
        clientToken
      );
      const tokenInfo = tokenInfoResp.data;

      res.cookie('vault_token', clientToken, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'lax',
        maxAge: tokenInfo.ttl > 0 ? tokenInfo.ttl * 1000 : 24 * 60 * 60 * 1000,
        path: '/',
      });

      res.json({
        success: true,
        tokenInfo: {
          display_name: tokenInfo.display_name,
          policies: tokenInfo.policies,
          identity_policies: tokenInfo.identity_policies ?? [],
          ttl: tokenInfo.ttl,
          expire_time: tokenInfo.expire_time,
          entity_id: tokenInfo.entity_id,
          type: tokenInfo.type,
        },
      });
      authLoginsTotal.inc({ method: 'oidc', result: 'success' });
      activeSessions.inc();
    } catch (error) {
      authLoginsTotal.inc({ method: 'oidc', result: 'failure' });
      next(error);
    }
  }
);

router.post('/logout', (_req: AuthenticatedRequest, res: Response) => {
  res.clearCookie('vault_token', {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
  });
  activeSessions.dec();
  res.json({ success: true });
});

router.get(
  '/me',
  authMiddleware,
  (req: AuthenticatedRequest, res: Response) => {
    if (!req.tokenInfo) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    res.json({
      tokenInfo: {
        display_name: req.tokenInfo.display_name,
        policies: req.tokenInfo.policies,
        identity_policies: req.tokenInfo.identity_policies ?? [],
        ttl: req.tokenInfo.ttl,
        expire_time: req.tokenInfo.expire_time,
        entity_id: req.tokenInfo.entity_id,
        type: req.tokenInfo.type,
        accessor: req.tokenInfo.accessor,
      },
    });
  }
);

export default router;
