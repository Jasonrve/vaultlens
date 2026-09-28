import { Router, Response, NextFunction } from 'express';
import os from 'node:os';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from '../config/index.js';
import { VaultClient } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getSystemToken, isSystemTokenConfigured, CREDS_SECTION } from '../lib/systemToken.js';
import { getConfigStorage } from '../lib/config-storage/index.js';
import { getCallerIdentity } from '../lib/eksAuth.js';
import { getAuditSocketStats } from '../lib/auditSocket.js';
import { getGraphCacheSize } from './graph.js';
import type { AuthenticatedRequest, VaultTokenInfo } from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

// Resolve paths relative to this compiled file so it works in both dev and prod
const __thisDir = dirname(fileURLToPath(import.meta.url));

let _appVersion: string | null = null;
function getAppVersion(): string {
  if (_appVersion === null) {
    try {
      const pkg = JSON.parse(readFileSync(join(__thisDir, '../../../package.json'), 'utf-8')) as { version?: string };
      _appVersion = pkg.version || 'unknown';
    } catch {
      _appVersion = 'unknown';
    }
  }
  return _appVersion;
}

async function getVaultAuthIdentity(): Promise<Record<string, unknown>> {
  const hasK8sAuth = !!config.vaultK8sAuthRole;
  const hasStaticToken = !!config.vaultSystemToken;
  let hasApprole = false;
  try {
    const creds = await getConfigStorage().get(CREDS_SECTION);
    hasApprole = !!(creds && creds['role_id']);
  } catch {
    // Storage unavailable — treat as no credentials configured
  }
  const source = hasK8sAuth ? 'kubernetes' : hasStaticToken ? 'static' : hasApprole ? 'approle' : 'none';

  const identity: Record<string, unknown> = {
    source,
    configured: isSystemTokenConfigured(),
    kubernetesAuthRole: hasK8sAuth ? config.vaultK8sAuthRole : undefined,
    kubernetesAuthMount: hasK8sAuth ? config.vaultK8sAuthMount : undefined,
  };

  try {
    const token = await getSystemToken();
    if (token) {
      const lookup = await vaultClient.get<{ data: VaultTokenInfo }>('/auth/token/lookup-self', token);
      identity['token'] = {
        displayName: lookup.data.display_name,
        entityId: lookup.data.entity_id,
        policies: lookup.data.policies,
        identityPolicies: lookup.data.identity_policies,
        ttl: lookup.data.ttl,
        type: lookup.data.type,
      };
    }
  } catch (e) {
    identity['tokenError'] = e instanceof Error ? e.message : String(e);
  }

  return identity;
}

async function getAwsIdentity(): Promise<Record<string, unknown> | null> {
  const region = process.env['AWS_REGION'] || process.env['AWS_DEFAULT_REGION'];
  if (!region) return null;

  const callerIdentity = await getCallerIdentity(region);
  return {
    region,
    manuallyConfiguredRole: process.env['K8S_IAM_ROLE_NAME'] || undefined,
    callerIdentity,
  };
}

// GET /api/admin/health
router.get(
  '/',
  authMiddleware,
  requireAdmin,
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const [vaultAuthIdentity, awsIdentity] = await Promise.all([
        getVaultAuthIdentity(),
        getAwsIdentity(),
      ]);

      res.json({
        app: {
          version: getAppVersion(),
          nodeEnv: config.nodeEnv,
          uptimeSeconds: process.uptime(),
          pid: process.pid,
          nodeVersion: process.version,
        },
        resources: {
          memory: process.memoryUsage(),
          loadAvg: os.loadavg(),
          cpuCount: os.cpus().length,
          totalMemBytes: os.totalmem(),
          freeMemBytes: os.freemem(),
        },
        config: {
          ...config,
          vaultSystemToken: undefined,
          vaultSystemTokenConfigured: !!config.vaultSystemToken,
        },
        vaultAuthIdentity,
        awsIdentity,
        backgroundJobs: {
          auditSocket: getAuditSocketStats(),
          graphCacheSize: getGraphCacheSize(),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
