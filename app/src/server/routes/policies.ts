import { Router, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { VaultClient, VaultError } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import { policyOperationsTotal } from '../lib/metrics.js';
import { parsePolicyHCL as sharedParsePolicyHCL } from '../../shared/policyEvaluator.js';
import { readPoliciesConfig } from './vaultlens-audit.js';
import { getSystemToken } from '../lib/systemToken.js';
import type { AuthenticatedRequest, PolicyPath } from '../types/index.js';

const router = Router();

/**
 * Returns true if `policyName` is attached directly to the requesting token
 * or via identity (i.e. the user legitimately has this policy applied to them).
 */
function isUsersOwnPolicy(req: AuthenticatedRequest, policyName: string): boolean {
  const tokenPolicies = req.tokenInfo?.policies ?? [];
  const identityPolicies = req.tokenInfo?.identity_policies ?? [];
  return tokenPolicies.includes(policyName) || identityPolicies.includes(policyName);
}
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

router.use(authMiddleware);

/**
 * Parse Vault HCL policy format to extract paths and capabilities.
 * Delegates to the shared policy evaluator module.
 */
export function parsePolicyHCL(hcl: string): PolicyPath[] {
  return sharedParsePolicyHCL(hcl);
}

// List all ACL policies
router.get(
  '/',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const response = await vaultClient.list<{
        data: { keys: string[] };
      }>('/sys/policies/acl', req.vaultToken!);

      policyOperationsTotal.inc({ operation: 'list' });
      res.json({ policies: response.data.keys });
    } catch (error) {
      // When the user lacks permission to list all policies, fall back to the
      // policies attached to their own token — but only if the admin has
      // explicitly enabled this feature, to prevent unexpected information
      // disclosure in environments where it is not desired.
      if (error instanceof VaultError && error.statusCode === 403) {
        try {
          const policiesCfg = await readPoliciesConfig();
          if (policiesCfg.allowIdentityPolicyFallback) {
            const tokenPolicies = req.tokenInfo?.policies ?? [];
            const identityPolicies = req.tokenInfo?.identity_policies ?? [];
            const unique = [...new Set([...tokenPolicies, ...identityPolicies])];
            policyOperationsTotal.inc({ operation: 'list_identity_fallback' });
            res.json({ policies: unique, restricted: true });
            return;
          }
        } catch {
          // Config read failed — fall through to original error
        }
      }
      next(error);
    }
  }
);

// Get a specific policy's content
router.get(
  '/:name',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const name = String(req.params['name']);
      const response = await vaultClient.get<{
        data: { name: string; rules?: string; policy?: string };
      }>(`/sys/policies/acl/${encodeURIComponent(name)}`, req.vaultToken!);

      policyOperationsTotal.inc({ operation: 'read' });
      res.json({
        name: response.data.name ?? name,
        rules: response.data.rules ?? response.data.policy ?? '',
      });
    } catch (error) {
      // If user lacks read permission, fall back to reading via system token —
      // but only when the feature is enabled AND the policy is one of theirs,
      // so we never expose arbitrary policy content to unauthorised users.
      if (error instanceof VaultError && error.statusCode === 403) {
        try {
          const [policiesCfg, systemToken] = await Promise.all([
            readPoliciesConfig(),
            getSystemToken(),
          ]);
          if (policiesCfg.allowIdentityPolicyFallback && systemToken && isUsersOwnPolicy(req, String(req.params['name']))) {
            const name = String(req.params['name']);
            const response = await vaultClient.get<{
              data: { name: string; rules?: string; policy?: string };
            }>(`/sys/policies/acl/${encodeURIComponent(name)}`, systemToken);
            policyOperationsTotal.inc({ operation: 'read_identity_fallback' });
            res.json({
              name: response.data.name ?? name,
              rules: response.data.rules ?? response.data.policy ?? '',
            });
            return;
          }
        } catch {
          // Fall through to original error
        }
      }
      next(error);
    }
  }
);

// Parse a policy and return paths with capabilities
router.get(
  '/:name/paths',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const name = String(req.params['name']);
      const response = await vaultClient.get<{
        data: { name: string; rules?: string; policy?: string };
      }>(`/sys/policies/acl/${encodeURIComponent(name)}`, req.vaultToken!);

      const hcl = response.data.rules ?? response.data.policy ?? '';
      const paths = parsePolicyHCL(hcl);

      policyOperationsTotal.inc({ operation: 'parse' });
      res.json({ name: response.data.name ?? name, paths });
    } catch (error) {
      // Same system-token fallback as above, scoped to the user's own policies.
      if (error instanceof VaultError && error.statusCode === 403) {
        try {
          const [policiesCfg, systemToken] = await Promise.all([
            readPoliciesConfig(),
            getSystemToken(),
          ]);
          if (policiesCfg.allowIdentityPolicyFallback && systemToken && isUsersOwnPolicy(req, String(req.params['name']))) {
            const name = String(req.params['name']);
            const response = await vaultClient.get<{
              data: { name: string; rules?: string; policy?: string };
            }>(`/sys/policies/acl/${encodeURIComponent(name)}`, systemToken);
            const hcl = response.data.rules ?? response.data.policy ?? '';
            const paths = parsePolicyHCL(hcl);
            policyOperationsTotal.inc({ operation: 'parse_identity_fallback' });
            res.json({ name: response.data.name ?? name, paths });
            return;
          }
        } catch {
          // Fall through to original error
        }
      }
      next(error);
    }
  }
);

// PUT /:name — create or update a policy's HCL content
router.put(
  '/:name',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const name = String(req.params['name']);

      // Protect built-in Vault policies
      if (name === 'root' || name === 'default') {
        res.status(403).json({ error: 'Cannot modify built-in Vault policies (root, default)' });
        return;
      }

      const { policy } = req.body as { policy?: string };
      if (!policy || typeof policy !== 'string') {
        res.status(400).json({ error: 'Policy HCL content is required' });
        return;
      }

      await vaultClient.put(
        `/sys/policies/acl/${encodeURIComponent(name)}`,
        req.vaultToken!,
        { policy }
      );

      res.json({ success: true, name });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:name — delete a policy
router.delete(
  '/:name',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const name = String(req.params['name']);

      if (name === 'root' || name === 'default') {
        res.status(403).json({ error: 'Cannot delete built-in Vault policies (root, default)' });
        return;
      }

      await vaultClient.delete(
        `/sys/policies/acl/${encodeURIComponent(name)}`,
        req.vaultToken!,
      );

      res.json({ success: true, name });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
