import { Router, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { VaultClient } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import { parsePolicyHCL } from './policies.js';
import type {
  AuthenticatedRequest,
  GraphNode,
  GraphEdge,
} from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

router.use(authMiddleware);

// ── Test capabilities for the current token ─────────────────────────────────
router.post(
  '/test',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { paths } = req.body as { paths?: string[] };

      if (!paths || !Array.isArray(paths) || paths.length === 0) {
        res.status(400).json({ error: 'paths array is required' });
        return;
      }

      if (paths.length > 50) {
        res.status(400).json({ error: 'Maximum 50 paths allowed per request' });
        return;
      }

      const results: Record<string, string[]> = {};

      for (const secretPath of paths) {
        if (typeof secretPath !== 'string' || !secretPath.trim()) continue;
        try {
          const response = await vaultClient.post<{
            capabilities: string[];
          }>(
            '/sys/capabilities-self',
            req.vaultToken!,
            { paths: [secretPath] }
          );

          // Vault returns { <path>: [capabilities] } or { capabilities: [...] }
          const caps = response.capabilities ??
            (response as unknown as Record<string, string[]>)[secretPath] ??
            [];
          results[secretPath] = Array.isArray(caps) ? caps : [];
        } catch {
          results[secretPath] = ['deny'];
        }
      }

      res.json({ results });
    } catch (error) {
      next(error);
    }
  }
);

// ── Test capabilities for a specific entity — builds a visualization graph ──
router.post(
  '/test-entity',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { entityId, path: testPath, operation } = req.body as {
        entityId?: string;
        path?: string;
        operation?: string;
      };

      if (!testPath || typeof testPath !== 'string') {
        res.status(400).json({ error: 'path is required' });
        return;
      }
      if (!operation || typeof operation !== 'string') {
        res.status(400).json({ error: 'operation is required' });
        return;
      }

      const token = req.vaultToken!;
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      // ── Resolve entity ──────────────────────────────────────────────────
      let entityData: Record<string, unknown> | null = null;
      let entityLabel = 'Current User';
      let directPolicies: string[] = [];
      let groupIds: string[] = [];

      if (entityId) {
        try {
          const entityResp = await vaultClient.get<{ data: Record<string, unknown> }>(
            `/identity/entity/id/${encodeURIComponent(entityId)}`,
            token
          );
          entityData = entityResp.data;
          const aliases = (entityData.aliases as Array<{ name: string }>) || [];
          entityLabel = aliases.find((a) => a.name)?.name ?? (entityData.name as string) ?? entityId;
          directPolicies = (entityData.policies as string[]) || [];
          groupIds = (entityData.group_ids as string[]) || [];
        } catch {
          res.status(404).json({ error: `Entity '${entityId}' not found` });
          return;
        }
      } else {
        // Resolve from current token
        const tokenLookup = await vaultClient.get<{ data: Record<string, unknown> }>(
          '/auth/token/lookup-self',
          token
        );
        entityLabel = (tokenLookup.data.display_name as string) || 'Current User';
        const resolvedEntityId = tokenLookup.data.entity_id as string | undefined;

        if (resolvedEntityId) {
          try {
            const entityResp = await vaultClient.get<{ data: Record<string, unknown> }>(
              `/identity/entity/id/${resolvedEntityId}`,
              token
            );
            entityData = entityResp.data;
            const aliases = (entityData.aliases as Array<{ name: string }>) || [];
            entityLabel = aliases.find((a) => a.name)?.name ?? (entityData.name as string) ?? entityLabel;
            directPolicies = (entityData.policies as string[]) || [];
            groupIds = (entityData.group_ids as string[]) || [];
          } catch {
            directPolicies = ((tokenLookup.data.policies as string[]) || []).filter((p) => p !== 'root');
          }
        } else {
          directPolicies = ((tokenLookup.data.policies as string[]) || []).filter((p) => p !== 'root');
        }
      }

      // ── Check capabilities for current token (used when no entity is selected) ──
      let capabilities: string[] = [];
      try {
        const capResp = await vaultClient.post<Record<string, unknown>>(
          '/sys/capabilities-self',
          token,
          { paths: [testPath] }
        );
        const caps = capResp.capabilities ??
          (capResp as Record<string, unknown>)[testPath];
        capabilities = Array.isArray(caps) ? caps as string[] : [];
      } catch {
        capabilities = ['deny'];
      }

      // operationAllowed will be finalised after policy traversal for entity tests.
      // For current-user tests (no entityId) we use capabilities-self from above.
      const capabilityAllowed = capabilities.includes('root') ||
        (operation === 'read' && capabilities.includes('read')) ||
        (operation === 'create' && (capabilities.includes('create') || capabilities.includes('update'))) ||
        (operation === 'update' && capabilities.includes('update')) ||
        (operation === 'delete' && capabilities.includes('delete')) ||
        (operation === 'list' && capabilities.includes('list'));

      // ── Build graph nodes ───────────────────────────────────────────────
      const NODE_X_ENTITY = 0;
      const NODE_X_GROUP = 220;
      const NODE_X_POLICY = 440;
      const NODE_X_PATH = 680;

      // Entity node will be inserted AFTER policy traversal so we know the correct status

      // ── Group nodes ─────────────────────────────────────────────────────
      const groupPolicyMap = new Map<string, string[]>();
      let groupY = 0;

      for (const gid of groupIds) {
        try {
          const groupResp = await vaultClient.get<{ data: Record<string, unknown> }>(
            `/identity/group/id/${gid}`,
            token
          );
          const group = groupResp.data;
          const gNodeId = `group-${gid}`;
          const gPolicies = (group.policies as string[]) || [];
          groupPolicyMap.set(gNodeId, gPolicies);

          nodes.push({
            id: gNodeId,
            type: 'group',
            data: {
              label: (group.name as string) || gid,
              policies: gPolicies,
              status: 'neutral',
            },
            position: { x: NODE_X_GROUP, y: groupY },
          });
          edges.push({ id: `entity->${gNodeId}`, source: 'entity', target: gNodeId });
          groupY += 70;
        } catch {
          // skip inaccessible groups
        }
      }

      // ── Collect all policies ────────────────────────────────────────────
      const allPolicies = new Set<string>(directPolicies);
      for (const gPolicies of groupPolicyMap.values()) {
        for (const p of gPolicies) allPolicies.add(p);
      }

      // ── Policy nodes — check which policies grant access to the path ───
      let policyY = 0;
      let pathY = 0;
      const matchingPolicies = new Set<string>();

      for (const policyName of allPolicies) {
        const policyId = `policy-${policyName}`;
        let policyGrantsAccess = false;
        let policyPaths: { path: string; capabilities: string[] }[] = [];

        try {
          const policyResp = await vaultClient.get<{
            data: { rules?: string; policy?: string };
          }>(`/sys/policies/acl/${encodeURIComponent(policyName)}`, token);
          const rules = policyResp.data.rules ?? policyResp.data.policy ?? '';
          policyPaths = parsePolicyHCL(rules);

          for (const pp of policyPaths) {
            if (pathMatchesPolicy(testPath, pp.path)) {
              const hasCap = pp.capabilities.includes('root') ||
                (operation === 'read' && pp.capabilities.includes('read')) ||
                (operation === 'create' && (pp.capabilities.includes('create') || pp.capabilities.includes('update'))) ||
                (operation === 'update' && pp.capabilities.includes('update')) ||
                (operation === 'delete' && pp.capabilities.includes('delete')) ||
                (operation === 'list' && pp.capabilities.includes('list'));
              if (hasCap) {
                policyGrantsAccess = true;
                matchingPolicies.add(policyName);
              }
            }
          }
        } catch {
          // Policy not accessible
        }

        nodes.push({
          id: policyId,
          type: 'policy',
          data: {
            label: policyName,
            status: policyGrantsAccess ? 'success' : 'neutral',
            capabilities: policyPaths.map((p) => `${p.path}: [${p.capabilities.join(', ')}]`),
          },
          position: { x: NODE_X_POLICY, y: policyY },
        });

        // Connect policy to entity or groups
        if (directPolicies.includes(policyName)) {
          edges.push({ id: `entity->${policyId}`, source: 'entity', target: policyId });
        }
        for (const [gNodeId, gPolicies] of groupPolicyMap) {
          if (gPolicies.includes(policyName)) {
            edges.push({ id: `${gNodeId}->${policyId}`, source: gNodeId, target: policyId });
          }
        }

        // Add relevant secret path nodes from this policy
        for (const pp of policyPaths) {
          if (pathMatchesPolicy(testPath, pp.path)) {
            const pathId = `path-${policyName}-${pp.path}`;
            const pathGrantsAccess = pp.capabilities.includes('root') ||
              (operation === 'read' && pp.capabilities.includes('read')) ||
              (operation === 'create' && (pp.capabilities.includes('create') || pp.capabilities.includes('update'))) ||
              (operation === 'update' && pp.capabilities.includes('update')) ||
              (operation === 'delete' && pp.capabilities.includes('delete')) ||
              (operation === 'list' && pp.capabilities.includes('list'));

            nodes.push({
              id: pathId,
              type: 'secretPath',
              data: {
                label: pp.path,
                capabilities: pp.capabilities,
                status: pathGrantsAccess ? 'success' : 'failure',
                testedOperation: operation,
              },
              position: { x: NODE_X_PATH, y: pathY },
            });
            edges.push({ id: `${policyId}->${pathId}`, source: policyId, target: pathId });
            pathY += 60;
          }
        }

        policyY += 70;
      }

      // Update group node status
      for (const node of nodes) {
        if (node.type === 'group') {
          const gPolicies = groupPolicyMap.get(node.id) || [];
          const hasMatch = gPolicies.some((p) => matchingPolicies.has(p));
          node.data.status = hasMatch ? 'success' : 'neutral';
        }
      }

      // ── Resolve final allowed status ────────────────────────────────────
      // When testing a specific entity, derive the result from its actual policies
      // (capabilities-self reflects the LOGGED-IN token, not the entity under test).
      // When testing the current user (no entityId), trust capabilities-self.
      const operationAllowed = entityId
        ? matchingPolicies.size > 0
        : capabilityAllowed;

      // ── Entity node (inserted now so status is accurate) ────────────────
      nodes.unshift({
        id: 'entity',
        type: 'entity',
        data: {
          label: entityLabel,
          status: operationAllowed ? 'success' : 'failure',
          entityId: entityData?.id ?? null,
        },
        position: { x: NODE_X_ENTITY, y: 0 },
      });

      // ── Result path node ────────────────────────────────────────────────
      nodes.push({
        id: 'result',
        type: 'result',
        data: {
          label: operationAllowed
            ? `✓ ${operation.toUpperCase()} allowed`
            : `✗ ${operation.toUpperCase()} denied`,
          status: operationAllowed ? 'success' : 'failure',
          capabilities,
          path: testPath,
          operation,
        },
        position: { x: NODE_X_PATH + 240, y: 0 },
      });

      res.json({
        allowed: operationAllowed,
        capabilities,
        path: testPath,
        operation,
        nodes,
        edges,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Check if a given path matches a Vault policy path pattern.
 * Supports `*` (glob) and `+` (single-segment wildcard).
 */
function pathMatchesPolicy(testPath: string, policyPath: string): boolean {
  // Normalize
  const tp = testPath.replace(/^\//, '').replace(/\/$/, '');
  const pp = policyPath.replace(/^\//, '').replace(/\/$/, '');

  // Exact match
  if (tp === pp) return true;

  // Glob suffix: "secret/data/*" matches "secret/data/foo/bar"
  if (pp.endsWith('*')) {
    const prefix = pp.slice(0, -1);
    if (tp.startsWith(prefix)) return true;
  }

  // Single-segment wildcard: + matches exactly one segment
  const tpParts = tp.split('/');
  const ppParts = pp.split('/');

  if (tpParts.length !== ppParts.length) return false;

  for (let i = 0; i < ppParts.length; i++) {
    if (ppParts[i] === '+') continue;
    if (ppParts[i] !== tpParts[i]) return false;
  }

  return true;
}

export default router;
