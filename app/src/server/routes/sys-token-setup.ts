import { Router, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { VaultClient, VaultError } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import { getConfigStorage } from '../lib/config-storage/index.js';
import { encryptConfigValue, tryDecryptConfigValue } from '../lib/configEncryption.js';
import { getSystemToken, seedSystemTokenCache } from '../lib/systemToken.js';
import { SYSTEM_TOKEN_POLICY_HCL, ADMIN_POLICY_HCL } from '../lib/policyLoader.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

const APPROLE_ROLE_NAME = 'vaultlens-system-token';
const APPROLE_POLICY_NAME = 'vaultlens-system-policy';
const ADMIN_POLICY_NAME = 'vaultlens-admin';
const CREDS_SECTION = 'sys_token_approle';

// Helper: strip comments and blank lines so two logically-identical policies
// can be compared regardless of formatting differences.
// Also normalizes CRLF→LF since Vault may return \r\n in policy content.
function normalizeHcl(hcl: string): string {
  return hcl
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .join('\n');
}

// ── GET /api/sys-token-setup/status ─────────────────────────────────────────
router.get(
  '/status',
  authMiddleware,
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const hasK8sAuth = !!config.vaultK8sAuthRole;
      const hasStaticToken = !!config.vaultSystemToken;

      // Check if AppRole creds are stored.
      // Wrap in try/catch: if vault config storage is in use and the system token
      // isn't yet available (first-time setup), the storage read returns null rather
      // than throwing (see VaultConfigStorage.get), but guard here too in case of
      // unexpected storage errors — the setup wizard must always be reachable.
      let hasApprole = false;
      try {
        const creds = await getConfigStorage().get(CREDS_SECTION);
        hasApprole = !!(creds && creds['role_id']);
      } catch {
        // Storage unavailable — treat as no credentials configured
      }

      res.json({
        hasSystemToken: hasK8sAuth || hasStaticToken || hasApprole,
        source: hasK8sAuth ? 'kubernetes' : hasStaticToken ? 'static' : hasApprole ? 'approle' : 'none',
        approleConfigured: hasApprole,
        servicesEnabled: hasK8sAuth || hasStaticToken || hasApprole,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ── POST /api/sys-token-setup/check-permissions ──────────────────────────────
router.post(
  '/check-permissions',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const missingCapabilities: string[] = [];

      /**
       * Vault returns ["root"] for root tokens instead of individual capabilities.
       * We must check for "root" as well as "create"/"update".
       */
      const hasWriteAccess = (caps: string[]) =>
        caps.includes('root') || caps.includes('create') || caps.includes('update');

      // Check if user can write policies
      try {
        const capsResponse = await vaultClient.post<{ data: { capabilities: string[] } }>(
          '/sys/capabilities-self',
          req.vaultToken!,
          { path: `/sys/policies/acl/${APPROLE_POLICY_NAME}` }
        );

        if (!hasWriteAccess(capsResponse.data.capabilities)) {
          missingCapabilities.push('sys/policies/acl/* (create/update)');
        }
      } catch (e) {
        if (e instanceof VaultError && e.statusCode === 403) {
          missingCapabilities.push('sys/policies/acl/* (create/update)');
        } else {
          throw e;
        }
      }

      // Check if user can manage approle roles
      try {
        const capsResponse = await vaultClient.post<{ data: { capabilities: string[] } }>(
          '/sys/capabilities-self',
          req.vaultToken!,
          { path: `/auth/approle/role/${APPROLE_ROLE_NAME}` }
        );

        if (!hasWriteAccess(capsResponse.data.capabilities)) {
          missingCapabilities.push('auth/approle/role/* (create/update)');
        }
      } catch (e) {
        if (e instanceof VaultError && e.statusCode === 403) {
          missingCapabilities.push('auth/approle/role/* (create/update)');
        } else {
          throw e;
        }
      }

      // Check if AppRole auth method is enabled
      let approleEnabled = false;
      try {
        const authMounts = await vaultClient.get<{ data: Record<string, { type: string }> }>(
          '/sys/auth',
          req.vaultToken!
        );
        approleEnabled = Object.values(authMounts.data).some((m) => m.type === 'approle');
      } catch (e) {
        if (e instanceof VaultError && e.statusCode === 403) {
          missingCapabilities.push('sys/auth/* (create/update)');
        } else if (!(e instanceof VaultError && e.statusCode === 404)) {
          throw e;
        }
      }

      res.json({
        canCreate: missingCapabilities.length === 0,
        approleEnabled,
        missingCapabilities,
        willCreate: {
          policy: APPROLE_POLICY_NAME,
          approleRole: APPROLE_ROLE_NAME,
          approleMount: 'approle',
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ── GET /api/sys-token-setup/preview ─────────────────────────────────────────
router.get(
  '/preview',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // Check if AppRole is enabled
      let approleEnabled = false;
      try {
        const authMounts = await vaultClient.get<{ data: Record<string, { type: string }> }>(
          '/sys/auth',
          req.vaultToken!
        );
        approleEnabled = Object.values(authMounts.data).some((m) => m.type === 'approle');
      } catch (e) {
        if (!(e instanceof VaultError && (e.statusCode === 403 || e.statusCode === 404))) {
          throw e;
        }
      }

      res.json({
        approleNeedsEnabled: !approleEnabled,
        policy: {
          name: APPROLE_POLICY_NAME,
          hcl: SYSTEM_TOKEN_POLICY_HCL,
        },
        approleRole: {
          name: APPROLE_ROLE_NAME,
          mount: 'approle',
          tokenTtl: '1h',
          tokenMaxTtl: '24h',
          policies: [APPROLE_POLICY_NAME],
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ── POST /api/sys-token-setup/create-approle ─────────────────────────────────
router.post(
  '/create-approle',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // 1. Check if AppRole is enabled, if not enable it
      let approleEnabled = false;
      try {
        const authMounts = await vaultClient.get<{ data: Record<string, { type: string }> }>(
          '/sys/auth',
          req.vaultToken!
        );
        approleEnabled = Object.values(authMounts.data).some((m) => m.type === 'approle');
      } catch (e) {
        if (!(e instanceof VaultError && (e.statusCode === 403 || e.statusCode === 404))) {
          throw e;
        }
      }

      if (!approleEnabled) {
        // Enable AppRole auth method at /approle
        await vaultClient.post(
          '/sys/auth/approle',
          req.vaultToken!,
          { type: 'approle', description: 'AppRole auth method for VaultLens system token' }
        );
      }

      // 2. Create the system token policy
      await vaultClient.put(
        `/sys/policies/acl/${APPROLE_POLICY_NAME}`,
        req.vaultToken!,
        { policy: SYSTEM_TOKEN_POLICY_HCL }
      );

      // 2.5. Create the vaultlens-admin policy for admin users
      await vaultClient.put(
        `/sys/policies/acl/${ADMIN_POLICY_NAME}`,
        req.vaultToken!,
        { policy: ADMIN_POLICY_HCL }
      );

      // 4. Create the AppRole role
      await vaultClient.post(
        `/auth/approle/role/${APPROLE_ROLE_NAME}`,
        req.vaultToken!,
        {
          token_policies: [APPROLE_POLICY_NAME],
          token_ttl: '1h',
          token_max_ttl: '24h',
          secret_id_ttl: '0', // never expire
          secret_id_num_uses: 0,
        }
      );

      // 5. Read the role-id
      const roleIdResponse = await vaultClient.get<{ data: { role_id: string } }>(
        `/auth/approle/role/${APPROLE_ROLE_NAME}/role-id`,
        req.vaultToken!
      );
      const roleId = roleIdResponse.data.role_id;

      // 6. Generate and store a persistent secret-id for long-term use
      // This secret-id will be used by background services indefinitely
      // after the setup wizard completes.
      const secretIdResponse = await vaultClient.post<{ data: { secret_id: string } }>(
        `/auth/approle/role/${APPROLE_ROLE_NAME}/secret-id`,
        req.vaultToken!,
        {}
      );
      const secretId = secretIdResponse.data.secret_id;

      // 7. Encrypt both role-id and secret-id before storing
      // The encryption key is derived from VAULT_ADDR, so all containers
      // pointing to the same Vault instance can decrypt these credentials.
      const encryptedRoleId = encryptConfigValue(roleId);
      const encryptedSecretId = encryptConfigValue(secretId);

      // 8. Bootstrap the system token cache BEFORE the config storage write.
      //    When VAULTLENS_CONFIG_STORAGE=vault, writing to config storage requires
      //    a working system token (chicken-and-egg).  Performing an AppRole login
      //    now populates the cache so that getSystemToken() returns a valid token
      //    for the subsequent set() call.
      try {
        const bootstrapLogin = await vaultClient.post<{
          auth: { client_token: string; lease_duration: number };
        }>('/auth/approle/login', '', { role_id: roleId, secret_id: secretId });
        seedSystemTokenCache(
          bootstrapLogin.auth.client_token,
          bootstrapLogin.auth.lease_duration,
        );
      } catch {
        // Non-critical for file storage mode — config write will still succeed.
        // For vault storage mode the set() call below will throw if this fails,
        // which is the correct behaviour (setup cannot complete without a working token).
      }

      // 9. Store encrypted credentials in config storage
      // After this, the system token can authenticate without needing a bootstrap token.
      await getConfigStorage().set(CREDS_SECTION, {
        role_id: encryptedRoleId,
        secret_id: encryptedSecretId,
        stored_at: new Date().toISOString(),
      });

      res.json({
        success: true,
        message: 'AppRole infrastructure created. Use "Test AppRole" to verify.',
      });
    } catch (error) {
      next(error);
    }
  }
);


// ── POST /api/sys-token-setup/test-approle ────────────────────────────────────
router.post(
  '/test-approle',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const creds = await getConfigStorage().get(CREDS_SECTION);
      if (!creds || !creds['role_id'] || !creds['secret_id']) {
        res.status(400).json({ error: 'AppRole credentials not found. Run create-approle first.' });
        return;
      }

      // Decrypt the stored credentials
      const roleId = tryDecryptConfigValue(creds['role_id']);
      const secretId = tryDecryptConfigValue(creds['secret_id']);

      if (!roleId || !secretId) {
        res.status(400).json({ error: 'Failed to decrypt AppRole credentials.' });
        return;
      }

      // Test the AppRole login using the stored credentials
      const loginResponse = await vaultClient.post<{
        auth: { client_token: string; policies: string[]; lease_duration: number };
      }>(
        '/auth/approle/login',
        '', // unauthenticated
        { role_id: roleId, secret_id: secretId }
      );

      const { policies, lease_duration } = loginResponse.auth;

      // Revoke the test token immediately
      try {
        await vaultClient.post(
          '/auth/token/revoke-self',
          loginResponse.auth.client_token,
          {}
        );
      } catch {
        // Non-critical — best effort revocation
      }

      res.json({
        success: true,
        message: 'AppRole authentication successful. System services are now enabled.',
        policies,
        tokenTtl: lease_duration,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ── GET /api/sys-token-setup/health-check ────────────────────────────────────
// Checks whether the two VaultLens policies and (if AppRole creds are stored)
// the AppRole role are present in Vault and match the expected content.
// Uses the system token as the primary read token.
// Falls back to the logged-in user's token when the system token gets 403 —
// this handles the bootstrap case where vaultlens-system-policy is missing so
// the AppRole-derived system token has no sys/policies/acl/* read permissions.
router.get(
  '/health-check',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // Resolve the system token.  On first-run or after Vault re-init the
      // system policy may be absent, so the AppRole token will have no read
      // access to sys/policies/acl/*.  In that scenario we fall back to the
      // logged-in user's token so the health-check still produces useful output.
      let systemToken: string;
      try {
        systemToken = await getSystemToken();
      } catch {
        // Cannot obtain system token — fall back to the user's token for reads.
        systemToken = req.vaultToken!;
      }

      // Helper: read a policy with system token, falling back to user token on 403.
      const readPolicy = async (name: string): Promise<string | null> => {
        for (const token of [systemToken, req.vaultToken!]) {
          try {
            const res = await vaultClient.get<{ data: { policy: string } }>(`/sys/policies/acl/${name}`, token);
            return res.data?.policy ?? null;
          } catch (e) {
            if (e instanceof VaultError && e.statusCode === 403) {
              // Try next token
              continue;
            }
            if (e instanceof VaultError && e.statusCode === 404) {
              return null; // definitively missing
            }
            throw e;
          }
        }
        // Both tokens got 403 — cannot verify; treat as missing so repair is offered.
        return null;
      };

      const issues: Array<{
        type: 'missing' | 'outdated';
        item: 'system-policy' | 'admin-policy' | 'approle-role';
        name: string;
        description: string;
        expectedHcl?: string;
      }> = [];

      // Determine whether AppRole credentials are stored (AppRole role check is gated on this).
      let approleConfigured = false;
      try {
        const creds = await getConfigStorage().get(CREDS_SECTION);
        approleConfigured = !!(creds && creds['role_id']);
      } catch { /* storage unavailable — treat as not configured */ }

      // ── Check system-token policy (always — required regardless of auth source) ──
      const systemPolicyContent = await readPolicy(APPROLE_POLICY_NAME);
      if (systemPolicyContent === null) {
        issues.push({
          type: 'missing',
          item: 'system-policy',
          name: APPROLE_POLICY_NAME,
          description: `Policy "${APPROLE_POLICY_NAME}" is missing from Vault.`,
          expectedHcl: SYSTEM_TOKEN_POLICY_HCL,
        });
      } else if (normalizeHcl(systemPolicyContent) !== normalizeHcl(SYSTEM_TOKEN_POLICY_HCL)) {
        issues.push({
          type: 'outdated',
          item: 'system-policy',
          name: APPROLE_POLICY_NAME,
          description: `Policy "${APPROLE_POLICY_NAME}" exists but its content differs from what VaultLens expects.`,
          expectedHcl: SYSTEM_TOKEN_POLICY_HCL,
        });
      }

      // ── Check admin policy (always) ────────────────────────────────────────
      const adminPolicyContent = await readPolicy(ADMIN_POLICY_NAME);
      if (adminPolicyContent === null) {
        issues.push({
          type: 'missing',
          item: 'admin-policy',
          name: ADMIN_POLICY_NAME,
          description: `Policy "${ADMIN_POLICY_NAME}" is missing from Vault.`,
          expectedHcl: ADMIN_POLICY_HCL,
        });
      } else if (normalizeHcl(adminPolicyContent) !== normalizeHcl(ADMIN_POLICY_HCL)) {
        issues.push({
          type: 'outdated',
          item: 'admin-policy',
          name: ADMIN_POLICY_NAME,
          description: `Policy "${ADMIN_POLICY_NAME}" exists but its content differs from what VaultLens expects.`,
          expectedHcl: ADMIN_POLICY_HCL,
        });
      }

      // ── Check AppRole role (AppRole mode only) ─────────────────────────────
      if (approleConfigured) {
        try {
          await vaultClient.get(
            `/auth/approle/role/${APPROLE_ROLE_NAME}`,
            systemToken
          );
        } catch (e) {
          if (e instanceof VaultError && e.statusCode === 404) {
            issues.push({
              type: 'missing',
              item: 'approle-role',
              name: APPROLE_ROLE_NAME,
              description: `AppRole role "${APPROLE_ROLE_NAME}" is missing from Vault. Background services cannot authenticate.`,
            });
          } else if (!(e instanceof VaultError && e.statusCode === 403)) {
            // 403 = system token can't read AppRole — skip silently (non-critical for this check)
            throw e;
          }
        }
      }

      res.json({ healthy: issues.length === 0, issues });
    } catch (error) {
      next(error);
    }
  }
);

// ── POST /api/sys-token-setup/repair ─────────────────────────────────────────
// Re-applies any missing or outdated policies and/or re-creates the AppRole
// role using the provided issue list. Uses the logged-in user's token.
router.post(
  '/repair',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { issues } = req.body as {
        issues: Array<{ item: string }>;
      };

      const needsSystemPolicy = issues.some((i) => i.item === 'system-policy');
      const needsAdminPolicy = issues.some((i) => i.item === 'admin-policy');
      const needsApprole = issues.some((i) => i.item === 'approle-role');

      // ── Re-apply policies ──────────────────────────────────────────────────
      if (needsSystemPolicy) {
        await vaultClient.put(
          `/sys/policies/acl/${APPROLE_POLICY_NAME}`,
          req.vaultToken!,
          { policy: SYSTEM_TOKEN_POLICY_HCL }
        );
      }

      if (needsAdminPolicy) {
        await vaultClient.put(
          `/sys/policies/acl/${ADMIN_POLICY_NAME}`,
          req.vaultToken!,
          { policy: ADMIN_POLICY_HCL }
        );
      }

      // ── Re-create AppRole role (if missing) ───────────────────────────────
      if (needsApprole) {
        // Ensure the system-token policy exists first (role depends on it)
        await vaultClient.put(
          `/sys/policies/acl/${APPROLE_POLICY_NAME}`,
          req.vaultToken!,
          { policy: SYSTEM_TOKEN_POLICY_HCL }
        );

        // Enable AppRole if not already active
        let approleEnabled = false;
        try {
          const authMounts = await vaultClient.get<{ data: Record<string, { type: string }> }>(
            '/sys/auth',
            req.vaultToken!
          );
          approleEnabled = Object.values(authMounts.data).some((m) => m.type === 'approle');
        } catch (e) {
          if (!(e instanceof VaultError && (e.statusCode === 403 || e.statusCode === 404))) {
            throw e;
          }
        }

        if (!approleEnabled) {
          await vaultClient.post('/sys/auth/approle', req.vaultToken!, {
            type: 'approle',
            description: 'AppRole auth method for VaultLens system token',
          });
        }

        // Create the role
        await vaultClient.post(
          `/auth/approle/role/${APPROLE_ROLE_NAME}`,
          req.vaultToken!,
          {
            token_policies: [APPROLE_POLICY_NAME],
            token_ttl: '1h',
            token_max_ttl: '24h',
            secret_id_ttl: '0',
            secret_id_num_uses: 0,
          }
        );

        // Fetch new role-id
        const roleIdRes = await vaultClient.get<{ data: { role_id: string } }>(
          `/auth/approle/role/${APPROLE_ROLE_NAME}/role-id`,
          req.vaultToken!
        );
        const roleId = roleIdRes.data.role_id;

        // Generate a new secret-id
        const secretIdRes = await vaultClient.post<{ data: { secret_id: string } }>(
          `/auth/approle/role/${APPROLE_ROLE_NAME}/secret-id`,
          req.vaultToken!,
          {}
        );
        const secretId = secretIdRes.data.secret_id;

        // Encrypt and bootstrap before storing
        const encryptedRoleId = encryptConfigValue(roleId);
        const encryptedSecretId = encryptConfigValue(secretId);

        try {
          const bootstrapLogin = await vaultClient.post<{
            auth: { client_token: string; lease_duration: number };
          }>('/auth/approle/login', '', { role_id: roleId, secret_id: secretId });
          seedSystemTokenCache(
            bootstrapLogin.auth.client_token,
            bootstrapLogin.auth.lease_duration
          );
        } catch { /* non-critical */ }

        await getConfigStorage().set(CREDS_SECTION, {
          role_id: encryptedRoleId,
          secret_id: encryptedSecretId,
          stored_at: new Date().toISOString(),
        });
      }

      res.json({ success: true, message: 'Repair completed successfully.' });
    } catch (error) {
      next(error);
    }
  }
);

// ── DELETE /api/sys-token-setup/approle ──────────────────────────────────────
router.delete(
  '/approle',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // Delete role from Vault
      try {
        await vaultClient.delete(
          `/auth/approle/role/${APPROLE_ROLE_NAME}`,
          req.vaultToken!
        );
      } catch (e) {
        if (!(e instanceof VaultError && e.statusCode === 404)) throw e;
      }

      // Delete policy from Vault
      try {
        await vaultClient.delete(
          `/sys/policies/acl/${APPROLE_POLICY_NAME}`,
          req.vaultToken!
        );
      } catch (e) {
        if (!(e instanceof VaultError && e.statusCode === 404)) throw e;
      }

      // Delete stored credentials
      await getConfigStorage().delete(CREDS_SECTION);

      res.json({ success: true, message: 'AppRole infrastructure removed.' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
