import { Router, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { VaultClient, VaultError } from '../lib/vaultClient.js';
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

const NODE_SPACING_X = 260;
const NODE_SPACING_Y = 80;

function createNode(
  id: string,
  type: string,
  label: string,
  x: number,
  y: number,
  extra: Record<string, unknown> = {}
): GraphNode {
  return {
    id,
    type,
    data: { label, ...extra },
    position: { x, y },
  };
}

function createEdge(source: string, target: string): GraphEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
  };
}

// Auth method → roles → policies graph
router.get(
  '/auth-policy-map',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      // Fetch auth methods
      const authResponse = await vaultClient.get<{
        data: Record<string, { type: string; description: string; accessor: string }>;
      }>('/sys/auth', token);

      const authMethods = Object.entries(authResponse.data);
      let methodY = 0;

      for (const [path, info] of authMethods) {
        const methodId = `auth-${path.replace(/\/$/, '')}`;
        nodes.push(
          createNode(methodId, 'authMethod', `${info.type} (${path})`, 0, methodY, {
            authType: info.type,
          })
        );

        // Try to fetch roles for this auth method
        try {
          const normalizedPath = path.replace(/\/$/, '');
          const rolesResponse = await vaultClient.list<{
            data: { keys: string[] };
          }>(`/auth/${normalizedPath}/role`, token);

          const roles = rolesResponse.data.keys;
          let roleY = methodY;

          for (const roleName of roles) {
            const roleId = `role-${normalizedPath}-${roleName}`;
            nodes.push(
              createNode(roleId, 'role', roleName, NODE_SPACING_X, roleY)
            );
            edges.push(createEdge(methodId, roleId));

            // Try to get role details to find attached policies
            let slotsTaken = 1; // at minimum this role occupies one slot
            try {
              const roleDetail = await vaultClient.get<{
                data: {
                  token_policies?: string[];
                  policies?: string[];
                };
              }>(`/auth/${normalizedPath}/role/${roleName}`, token);

              const policies = [
                ...(roleDetail.data.token_policies || []),
                ...(roleDetail.data.policies || []),
              ];
              const uniquePolicies = [...new Set(policies)];

              let policyY = roleY;
              for (const policyName of uniquePolicies) {
                const policyId = `policy-${policyName}`;
                // Only add node if not already added
                if (!nodes.some((n) => n.id === policyId)) {
                  nodes.push(
                    createNode(
                      policyId,
                      'policy',
                      policyName,
                      NODE_SPACING_X * 2,
                      policyY
                    )
                  );
                }
                edges.push(createEdge(roleId, policyId));
                policyY += NODE_SPACING_Y;
              }
              // This role needs as many vertical slots as it has policies
              slotsTaken = Math.max(uniquePolicies.length, 1);
            } catch (e) {
              console.warn(`[graph] Could not read role '${roleName}' detail:`, e instanceof Error ? e.message : e);
            }

            roleY += slotsTaken * NODE_SPACING_Y;
          }

          // Advance methodY past all roles used by this method, plus a gap row
          methodY = roleY + NODE_SPACING_Y;
        } catch (e) {
          console.warn(`[graph] Could not list roles for auth method '${path}':`, e instanceof Error ? e.message : e);
          methodY += NODE_SPACING_Y * 2;
        }
      }

      res.json({ nodes, edges });
    } catch (error) {
      next(error);
    }
  }
);

// Policy → secret paths graph
router.get(
  '/policy-secret-map',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      // Fetch all policies
      const policiesResponse = await vaultClient.list<{
        data: { keys: string[] };
      }>('/sys/policies/acl', token);

      const policyNames = policiesResponse.data.keys;
      let policyY = 0;

      for (const policyName of policyNames) {
        const policyId = `policy-${policyName}`;
        nodes.push(
          createNode(policyId, 'policy', policyName, 0, policyY)
        );

        try {
          const policyResponse = await vaultClient.get<{
            data: { rules?: string; policy?: string };
          }>(`/sys/policies/acl/${encodeURIComponent(policyName)}`, token);

          const rules = policyResponse.data.rules ?? policyResponse.data.policy ?? '';
          const paths = parsePolicyHCL(rules);
          let pathY = policyY;

          for (const pathInfo of paths) {
            const pathId = `path-${policyName}-${pathInfo.path}`;
            nodes.push(
              createNode(pathId, 'secretPath', pathInfo.path, NODE_SPACING_X, pathY, {
                capabilities: pathInfo.capabilities,
              })
            );
            edges.push(createEdge(policyId, pathId));
            pathY += NODE_SPACING_Y;
          }

          // Advance policyY past all paths this policy used, plus a gap row
          policyY = pathY + NODE_SPACING_Y;
        } catch (e) {
          console.warn(`[graph] Could not read policy '${policyName}':`, e instanceof Error ? e.message : e);
          policyY += NODE_SPACING_Y * 2;
        }
      }

      res.json({ nodes, edges });
    } catch (error) {
      next(error);
    }
  }
);

// Entity → groups → policies graph
router.get(
  '/identity-map',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      // Fetch entities
      let entityIds: string[] = [];
      try {
        const entitiesResponse = await vaultClient.list<{
          data: { keys: string[] };
        }>('/identity/entity/id', token);
        entityIds = entitiesResponse.data.keys;
      } catch (error) {
        if (error instanceof VaultError && error.statusCode === 404) {
          entityIds = [];
        } else {
          throw error;
        }
      }

      let entityY = 0;
      const addedGroupIds = new Set<string>();
      const addedPolicyIds = new Set<string>();

      for (const entityId of entityIds) {
        try {
          const entityResponse = await vaultClient.get<{
            data: {
              id: string;
              name: string;
              policies: string[];
              group_ids: string[];
              direct_policies: string[];
            };
          }>(`/identity/entity/id/${entityId}`, token);

          const entity = entityResponse.data;
          const entityNodeId = `entity-${entity.id}`;
          nodes.push(
            createNode(entityNodeId, 'entity', entity.name, 0, entityY)
          );

          let rowY = entityY;

          // Direct policies
          for (const policyName of entity.direct_policies || []) {
            const policyNodeId = `policy-${policyName}`;
            if (!addedPolicyIds.has(policyNodeId)) {
              nodes.push(
                createNode(policyNodeId, 'policy', policyName, NODE_SPACING_X * 2, rowY)
              );
              addedPolicyIds.add(policyNodeId);
              rowY += NODE_SPACING_Y;
            }
            edges.push(createEdge(entityNodeId, policyNodeId));
          }

          // Groups
          for (const groupId of entity.group_ids || []) {
            const groupNodeId = `group-${groupId}`;
            const groupRow = rowY;

            if (!addedGroupIds.has(groupNodeId)) {
              try {
                const groupResponse = await vaultClient.get<{
                  data: { id: string; name: string; policies: string[] };
                }>(`/identity/group/id/${groupId}`, token);

                const group = groupResponse.data;
                nodes.push(
                  createNode(groupNodeId, 'group', group.name, NODE_SPACING_X, groupRow)
                );
                addedGroupIds.add(groupNodeId);

                // Group policies
                let gpolicyY = groupRow;
                for (const policyName of group.policies || []) {
                  const policyNodeId = `policy-${policyName}`;
                  if (!addedPolicyIds.has(policyNodeId)) {
                    nodes.push(
                      createNode(policyNodeId, 'policy', policyName, NODE_SPACING_X * 2, gpolicyY)
                    );
                    addedPolicyIds.add(policyNodeId);
                  }
                  edges.push(createEdge(groupNodeId, policyNodeId));
                  gpolicyY += NODE_SPACING_Y;
                }
                // Advance rowY past however many policies this group had
                rowY = Math.max(rowY, gpolicyY) + NODE_SPACING_Y;
              } catch {
                rowY += NODE_SPACING_Y;
              }
            } else {
              rowY += NODE_SPACING_Y;
            }

            edges.push(createEdge(entityNodeId, groupNodeId));
          }

          // Advance entityY past all rows used by this entity, plus a gap
          entityY = Math.max(rowY, entityY + NODE_SPACING_Y) + NODE_SPACING_Y;
        } catch {
          // Entity might not be accessible
          entityY += NODE_SPACING_Y * 2;
        }
      }

      res.json({ nodes, edges });
    } catch (error) {
      next(error);
    }
  }
);

// ── User identity chain: Me → Groups → Policies → Secret Paths ──────────────
router.get(
  '/user-identity-map',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      const entityName = req.query['entityName'] as string | undefined;
      const entityId = req.query['entityId'] as string | undefined;
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      let entityData: Record<string, unknown> | null = null;
      let meLabel = 'Me';
      let directPolicies: string[] = [];
      let groupIds: string[] = [];
      let tokenMeta: Record<string, unknown> | null = null;

      if (entityId) {
        // Direct lookup by entity ID (used when selecting from alias suggestions)
        try {
          const entityResp = await vaultClient.get<{ data: Record<string, unknown> }>(
            `/identity/entity/id/${encodeURIComponent(entityId)}`,
            token
          );
          entityData = entityResp.data;
          const aliases = (entityData.aliases as Array<{ name: string; mount_type: string }>) || [];
          const primaryAlias = aliases.find((a) => a.name) ?? aliases[0];
          meLabel = primaryAlias?.name ?? (entityData.name as string) ?? 'Unknown';
          directPolicies = ((entityData.policies as string[]) || []);
          groupIds = ((entityData.group_ids as string[]) || []);
        } catch {
          return res.status(404).json({ error: `Entity ID '${entityId}' not found` });
        }
      } else if (entityName) {
        // Look up entity by internal name
        try {
          const entityResp = await vaultClient.get<{ data: Record<string, unknown> }>(
            `/identity/entity/name/${encodeURIComponent(entityName)}`,
            token
          );
          entityData = entityResp.data;
          const aliases = (entityData.aliases as Array<{ name: string; mount_type: string }>) || [];
          const primaryAlias = aliases.find((a) => a.name) ?? aliases[0];
          meLabel = primaryAlias?.name ?? entityName;
          directPolicies = ((entityData.policies as string[]) || []);
          groupIds = ((entityData.group_ids as string[]) || []);
        } catch {
          return res.status(404).json({ error: `Entity '${entityName}' not found` });
        }
      } else {
        // Resolve current user from token
        const tokenLookup = await vaultClient.get<{ data: Record<string, unknown> }>(
          '/auth/token/lookup-self',
          token
        );
        tokenMeta = {
          display_name: tokenLookup.data.display_name,
          accessor: tokenLookup.data.accessor,
          entity_id: tokenLookup.data.entity_id,
          ttl: tokenLookup.data.ttl,
          expire_time: tokenLookup.data.expire_time,
          creation_ttl: tokenLookup.data.creation_ttl,
          type: tokenLookup.data.type,
          policies: tokenLookup.data.policies,
          orphan: tokenLookup.data.orphan,
          path: tokenLookup.data.path,
        };
        meLabel = (tokenLookup.data.display_name as string) || 'Me';
        const entityId = tokenLookup.data.entity_id as string | undefined;

        if (entityId) {
          try {
            const entityResp = await vaultClient.get<{ data: Record<string, unknown> }>(
              `/identity/entity/id/${entityId}`,
              token
            );
            entityData = entityResp.data;
            // Prefer alias name (friendly credential/username) over internal entity name
            const aliases = (entityData.aliases as Array<{ name: string; mount_type: string }>) || [];
            const primaryAlias = aliases.find((a) => a.name) ?? aliases[0];
            meLabel = primaryAlias?.name ?? (entityData.name as string) ?? meLabel;
            directPolicies = ((entityData.policies as string[]) || []);
            groupIds = ((entityData.group_ids as string[]) || []);
          } catch {
            // Entity not accessible — fall back to token policies
            directPolicies = ((tokenLookup.data.policies as string[]) || []).filter(
              (p) => p !== 'root'
            );
          }
        } else {
          // No entity (root token etc.) — use token policies directly
          directPolicies = ((tokenLookup.data.policies as string[]) || []).filter(
            (p) => p !== 'root'
          );
        }
      }

      const meId = 'me';
      nodes.push(
        createNode(meId, 'me', meLabel, 0, 0, {
          displayName: meLabel,
          entityId: entityData?.id ?? null,
          entityName: entityData?.name ?? null,
          policies: directPolicies,
          groupIds,
          tokenMeta,
        })
      );

      // ── Groups ──────────────────────────────────────────────────────────────
      const groupPolicyMap = new Map<string, string[]>(); // gNodeId → policies
      let groupY = 0;

      for (const groupId of groupIds) {
        try {
          const groupResp = await vaultClient.get<{ data: Record<string, unknown> }>(
            `/identity/group/id/${groupId}`,
            token
          );
          const group = groupResp.data;
          const gNodeId = `group-${groupId}`;
          nodes.push(
            createNode(gNodeId, 'group', (group.name as string) || groupId, 220, groupY, {
              groupId,
              groupName: group.name,
              policies: group.policies || [],
            })
          );
          edges.push(createEdge(meId, gNodeId));
          const gPolicies = (group.policies as string[]) || [];
          groupPolicyMap.set(gNodeId, gPolicies);
          groupY += 65;
        } catch (e) {
          console.warn(
            `[graph] Could not read group '${groupId}':`,
            e instanceof Error ? e.message : e
          );
        }
      }

      // ── Collect all unique policies ─────────────────────────────────────────
      const allPolicies = new Set<string>(directPolicies);
      for (const gPolicies of groupPolicyMap.values()) {
        for (const p of gPolicies) allPolicies.add(p);
      }

      // ── Policies + Paths ────────────────────────────────────────────────────
      let policyY = 0;
      let pathY = 0;

      for (const policyName of allPolicies) {
        const policyId = `policy-${policyName}`;
        nodes.push(createNode(policyId, 'policy', policyName, 450, policyY));

        if (directPolicies.includes(policyName)) {
          edges.push(createEdge(meId, policyId));
        }
        for (const [gNodeId, gPolicies] of groupPolicyMap) {
          if (gPolicies.includes(policyName)) {
            edges.push(createEdge(gNodeId, policyId));
          }
        }

        // Fetch and attach secret paths from this policy
        try {
          const policyResp = await vaultClient.get<{
            data: { rules?: string; policy?: string };
          }>(`/sys/policies/acl/${encodeURIComponent(policyName)}`, token);
          const rules = policyResp.data.rules ?? policyResp.data.policy ?? '';
          const paths = parsePolicyHCL(rules);

          for (const pathInfo of paths) {
            const pathId = `path-${policyName}-${pathInfo.path}`;
            if (!nodes.some((n) => n.id === pathId)) {
              nodes.push(
                createNode(pathId, 'secretPath', pathInfo.path, 690, pathY, {
                  path: pathInfo.path,
                  capabilities: pathInfo.capabilities,
                })
              );
            }
            edges.push(createEdge(policyId, pathId));
            pathY += 55;
          }
        } catch (e) {
          console.warn(
            `[graph] Could not read policy '${policyName}':`,
            e instanceof Error ? e.message : e
          );
        }

        policyY += 65;
      }

      return res.json({ nodes, edges });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
