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

// ── In-memory graph cache ────────────────────────────────────────────────────
const GRAPH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface GraphCacheEntry {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cachedAt: number;
  fromCache: boolean;
}

const graphCache = new Map<string, GraphCacheEntry>();

function getFromGraphCache(key: string): GraphCacheEntry | null {
  const entry = graphCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > GRAPH_CACHE_TTL_MS) {
    graphCache.delete(key);
    return null;
  }
  return { ...entry, fromCache: true };
}

function setInGraphCache(key: string, nodes: GraphNode[], edges: GraphEdge[]): GraphCacheEntry {
  const entry: GraphCacheEntry = { nodes, edges, cachedAt: Date.now(), fromCache: false };
  graphCache.set(key, entry);
  return entry;
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Concurrency helper ────────────────────────────────────────────────────────
// Runs `fn` over every item with at most `limit` calls in-flight at once.
// JavaScript's single-threaded event loop keeps Set/array mutations safe.
async function concurrentMap<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

const CONCURRENT_LIMIT = 20;
const NODE_SPACING_X = 180;
const NODE_SPACING_Y = 60;

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
      const isRefresh = req.query.refresh === 'true';
      if (!isRefresh) {
        const cached = getFromGraphCache('auth-policy-map');
        if (cached) { res.json(cached); return; }
      }

      const token = req.vaultToken!;
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      const addedPolicyIds = new Set<string>();

      const authResponse = await vaultClient.get<{
        data: Record<string, { type: string; description: string; accessor: string }>;
      }>('/sys/auth', token);

      const authMethods = Object.entries(authResponse.data);
      let methodY = 0;

      for (const [path, info] of authMethods) {
        const normalizedPath = path.replace(/\/$/, '');
        const methodId = `auth-${normalizedPath}`;
        nodes.push(createNode(methodId, 'authMethod', `${info.type} (${path})`, 0, methodY, { authType: info.type }));

        try {
          const rolesResponse = await vaultClient.list<{ data: { keys: string[] } }>(
            `/auth/${normalizedPath}/role`, token,
          );
          const roleNames = rolesResponse.data.keys;

          // Add all role nodes up-front (positions are overridden by frontend layout)
          let roleY = methodY;
          for (const roleName of roleNames) {
            const roleId = `role-${normalizedPath}-${roleName}`;
            nodes.push(createNode(roleId, 'role', roleName, NODE_SPACING_X, roleY));
            edges.push(createEdge(methodId, roleId));
            roleY += NODE_SPACING_Y;
          }
          methodY = roleY + NODE_SPACING_Y;

          // Concurrently fetch role details to obtain attached policies
          await concurrentMap(roleNames, CONCURRENT_LIMIT, async (roleName) => {
            const roleId = `role-${normalizedPath}-${roleName}`;
            try {
              const roleDetail = await vaultClient.get<{
                data: { token_policies?: string[]; policies?: string[] };
              }>(`/auth/${normalizedPath}/role/${roleName}`, token);

              const all = [
                ...(roleDetail.data.token_policies ?? []),
                ...(roleDetail.data.policies ?? []),
              ];
              for (const policyName of [...new Set(all)]) {
                const policyId = `policy-${policyName}`;
                if (!addedPolicyIds.has(policyId)) {
                  nodes.push(createNode(policyId, 'policy', policyName, NODE_SPACING_X * 2, nodes.length * NODE_SPACING_Y));
                  addedPolicyIds.add(policyId);
                }
                edges.push(createEdge(roleId, policyId));
              }
            } catch (e) {
              console.warn(`[graph] role '${roleName}' detail failed:`, e instanceof Error ? e.message : e);
            }
          });
        } catch (e) {
          console.warn(`[graph] listing roles for '${path}' failed:`, e instanceof Error ? e.message : e);
          methodY += NODE_SPACING_Y * 2;
        }
      }

      res.json(setInGraphCache('auth-policy-map', nodes, edges));
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
      const isRefresh = req.query.refresh === 'true';
      if (!isRefresh) {
        const cached = getFromGraphCache('policy-secret-map');
        if (cached) { res.json(cached); return; }
      }

      const token = req.vaultToken!;
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      const policiesResponse = await vaultClient.list<{ data: { keys: string[] } }>(
        '/sys/policies/acl', token,
      );
      const policyNames = policiesResponse.data.keys;

      // Add all policy nodes up-front so edge targets are always resolvable
      policyNames.forEach((policyName, i) => {
        nodes.push(createNode(`policy-${policyName}`, 'policy', policyName, 0, i * NODE_SPACING_Y));
      });

      // Concurrently fetch each policy's rules and build secret-path nodes
      await concurrentMap(policyNames, CONCURRENT_LIMIT, async (policyName) => {
        const policyId = `policy-${policyName}`;
        try {
          const policyResponse = await vaultClient.get<{
            data: { rules?: string; policy?: string };
          }>(`/sys/policies/acl/${encodeURIComponent(policyName)}`, token);

          const rules = policyResponse.data.rules ?? policyResponse.data.policy ?? '';
          const paths = parsePolicyHCL(rules);

          for (const pathInfo of paths) {
            const pathId = `path-${policyName}-${pathInfo.path}`;
            nodes.push(createNode(pathId, 'secretPath', pathInfo.path, NODE_SPACING_X, nodes.length * NODE_SPACING_Y, {
              capabilities: pathInfo.capabilities,
            }));
            edges.push(createEdge(policyId, pathId));
          }
        } catch (e) {
          console.warn(`[graph] policy '${policyName}' fetch failed:`, e instanceof Error ? e.message : e);
        }
      });

      res.json(setInGraphCache('policy-secret-map', nodes, edges));
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
      const isRefresh = req.query.refresh === 'true';
      if (!isRefresh) {
        const cached = getFromGraphCache('identity-map');
        if (cached) { res.json(cached); return; }
      }

      const token = req.vaultToken!;
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      const addedGroupIds = new Set<string>();
      const addedPolicyIds = new Set<string>();

      let entityIds: string[] = [];
      try {
        const entitiesResponse = await vaultClient.list<{ data: { keys: string[] } }>(
          '/identity/entity/id', token,
        );
        entityIds = entitiesResponse.data.keys;
      } catch (error) {
        if (error instanceof VaultError && error.statusCode === 404) {
          entityIds = [];
        } else {
          throw error;
        }
      }

      // Intermediate store for entity data (keyed by entityId)
      interface EntityPayload {
        id: string;
        name: string;
        direct_policies: string[];
        group_ids: string[];
      }
      const entityPayloads: EntityPayload[] = [];

      // Concurrently fetch all entity details
      await concurrentMap(entityIds, CONCURRENT_LIMIT, async (entityId) => {
        try {
          const entityResponse = await vaultClient.get<{
            data: { id: string; name: string; policies: string[]; group_ids: string[]; direct_policies: string[] };
          }>(`/identity/entity/id/${entityId}`, token);
          entityPayloads.push(entityResponse.data);
        } catch {
          // entity may not be accessible; skip
        }
      });

      // Build entity nodes and collect unique group IDs
      const allGroupIds = new Set<string>();
      for (const entity of entityPayloads) {
        const entityNodeId = `entity-${entity.id}`;
        nodes.push(createNode(entityNodeId, 'entity', entity.name, 0, nodes.length * NODE_SPACING_Y));

        for (const policyName of entity.direct_policies ?? []) {
          const policyId = `policy-${policyName}`;
          if (!addedPolicyIds.has(policyId)) {
            nodes.push(createNode(policyId, 'policy', policyName, NODE_SPACING_X * 2, nodes.length * NODE_SPACING_Y));
            addedPolicyIds.add(policyId);
          }
          edges.push(createEdge(entityNodeId, policyId));
        }

        for (const groupId of entity.group_ids ?? []) {
          allGroupIds.add(groupId);
          edges.push(createEdge(entityNodeId, `group-${groupId}`));
        }
      }

      // Concurrently fetch all unique group details
      interface GroupPayload { id: string; name: string; policies: string[] }
      const groupPayloads: GroupPayload[] = [];

      await concurrentMap([...allGroupIds], CONCURRENT_LIMIT, async (groupId) => {
        try {
          const groupResponse = await vaultClient.get<{
            data: { id: string; name: string; policies: string[] };
          }>(`/identity/group/id/${groupId}`, token);
          groupPayloads.push(groupResponse.data);
        } catch {
          // group may not be accessible; skip
        }
      });

      for (const group of groupPayloads) {
        const groupNodeId = `group-${group.id}`;
        if (!addedGroupIds.has(groupNodeId)) {
          nodes.push(createNode(groupNodeId, 'group', group.name, NODE_SPACING_X, nodes.length * NODE_SPACING_Y));
          addedGroupIds.add(groupNodeId);
        }

        for (const policyName of group.policies ?? []) {
          const policyId = `policy-${policyName}`;
          if (!addedPolicyIds.has(policyId)) {
            nodes.push(createNode(policyId, 'policy', policyName, NODE_SPACING_X * 2, nodes.length * NODE_SPACING_Y));
            addedPolicyIds.add(policyId);
          }
          edges.push(createEdge(groupNodeId, policyId));
        }
      }

      res.json(setInGraphCache('identity-map', nodes, edges));
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
