import { Router, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { VaultClient, VaultError } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import { getConfigStorage } from '../lib/config-storage/index.js';
import { encryptConfigValue, tryDecryptConfigValue } from '../lib/configEncryption.js';
import { seedSystemTokenCache } from '../lib/systemToken.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

const APPROLE_ROLE_NAME = 'vaultlens-system-token';
const APPROLE_POLICY_NAME = 'vaultlens-system-token';
const CREDS_SECTION = 'sys_token_approle';

// The minimal policy for the system token
const SYSTEM_TOKEN_POLICY_HCL = `
# VaultLens system token policy
# Grants permissions required for rotation, backup, webhook audit monitoring, and secure merge

# Read/write access to ALL KV secret engines (required for secure merge across all engines)
path "+/data/*" {
  capabilities = ["read", "create", "update"]
}

path "+/metadata/*" {
  capabilities = ["read", "list"]
}

# Legacy mounts using root path
path "secret/data/*" {
  capabilities = ["read", "create", "update"]
}

path "secret/metadata/*" {
  capabilities = ["read", "list"]
}

path "sys/audit" {
  capabilities = ["read", "sudo"]
}

path "sys/audit/*" {
  capabilities = ["read", "sudo"]
}

path "sys/policies/acl/*" {
  capabilities = ["read", "list"]
}

# Required for engine version detection (KV v1 vs v2) when user token lacks sys access
path "sys/mounts" {
  capabilities = ["read"]
}

path "sys/mounts/*" {
  capabilities = ["read"]
}

# Required to discover available auth methods (OIDC, JWT) for login page auto-detection
path "sys/auth" {
  capabilities = ["read", "list"]
}

path "sys/auth/*" {
  capabilities = ["read"]
}

path "auth/token/lookup-self" {
  capabilities = ["read"]
}
`.trim();

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

      // 2. Create the policy
      await vaultClient.put(
        `/sys/policies/acl/${APPROLE_POLICY_NAME}`,
        req.vaultToken!,
        { policy: SYSTEM_TOKEN_POLICY_HCL }
      );

      // 3. Create the AppRole role
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

      // 4. Read the role-id
      const roleIdResponse = await vaultClient.get<{ data: { role_id: string } }>(
        `/auth/approle/role/${APPROLE_ROLE_NAME}/role-id`,
        req.vaultToken!
      );
      const roleId = roleIdResponse.data.role_id;

      // 5. Generate and store a persistent secret-id for long-term use
      // This secret-id will be used by background services indefinitely
      // after the setup wizard completes.
      const secretIdResponse = await vaultClient.post<{ data: { secret_id: string } }>(
        `/auth/approle/role/${APPROLE_ROLE_NAME}/secret-id`,
        req.vaultToken!,
        {}
      );
      const secretId = secretIdResponse.data.secret_id;

      // 6. Encrypt both role-id and secret-id before storing
      // The encryption key is derived from VAULT_ADDR, so all containers
      // pointing to the same Vault instance can decrypt these credentials.
      const encryptedRoleId = encryptConfigValue(roleId);
      const encryptedSecretId = encryptConfigValue(secretId);

      // 7. Bootstrap the system token cache BEFORE the config storage write.
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

      // 8. Store encrypted credentials in config storage
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
