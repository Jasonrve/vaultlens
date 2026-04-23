import { Router, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { VaultClient } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthenticatedRequest, PolicyPath } from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

router.use(authMiddleware);

/**
 * Parse Vault HCL policy format to extract paths and capabilities.
 * Handles common patterns including nested braces and multi-line blocks:
 *   path "secret/data/*" { capabilities = ["read", "list"] }
 *   path "secret/+/config" {
 *     capabilities = ["read"]
 *     allowed_parameters { "key" = [] }
 *   }
 */
export function parsePolicyHCL(hcl: string): PolicyPath[] {
  const paths: PolicyPath[] = [];

  // Use a stateful approach to correctly match path blocks with nested braces
  const pathStartRegex = /path\s+"([^"\\]*(?:\\.[^"\\]*)*)"\s*\{/g;
  let startMatch: RegExpExecArray | null;

  while ((startMatch = pathStartRegex.exec(hcl)) !== null) {
    const pathValue = startMatch[1];
    if (!pathValue) continue;

    // Find the matching closing brace, accounting for nested braces
    let braceDepth = 1;
    let pos = pathStartRegex.lastIndex;
    while (pos < hcl.length && braceDepth > 0) {
      if (hcl[pos] === '{') braceDepth++;
      else if (hcl[pos] === '}') braceDepth--;
      pos++;
    }

    const blockContent = hcl.slice(pathStartRegex.lastIndex, pos - 1);

    // Extract capabilities array from the block
    const capRegex = /capabilities\s*=\s*\[([^\]]*)\]/;
    const capMatch = capRegex.exec(blockContent);

    if (capMatch?.[1]) {
      const capabilities = capMatch[1]
        .split(',')
        .map((c) => c.trim().replace(/"/g, ''))
        .filter((c) => c.length > 0);

      paths.push({ path: pathValue, capabilities });
    }
  }

  return paths;
}

// List all ACL policies
router.get(
  '/',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const response = await vaultClient.list<{
        data: { keys: string[] };
      }>('/sys/policies/acl', req.vaultToken!);

      res.json({ policies: response.data.keys });
    } catch (error) {
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

      res.json({
        name: response.data.name ?? name,
        rules: response.data.rules ?? response.data.policy ?? '',
      });
    } catch (error) {
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

      res.json({ name: response.data.name ?? name, paths });
    } catch (error) {
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
