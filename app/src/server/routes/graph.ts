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
            nodes.push(createNode(roleId, 'role', roleName, NODE_SPACING_X, roleY, { method: normalizedPath }));
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
            // Detect auth backend paths (e.g. auth/token/..., auth/oidc/...)
            const isAuthPath = pathInfo.path.startsWith('auth/') || pathInfo.path === 'auth';
            const authType = isAuthPath
              ? (pathInfo.path.split('/')[1] ?? 'auth')
              : undefined;
            nodes.push(createNode(pathId, 'secretPath', pathInfo.path, NODE_SPACING_X, nodes.length * NODE_SPACING_Y, {
              capabilities: pathInfo.capabilities,
              isAuthPath,
              authType,
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
      const groupId = req.query['groupId'] as string | undefined;

      // ── Group-centric view: group → member entities + policies → secret paths
      if (groupId) {
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];

        let groupData: Record<string, unknown>;
        try {
          const groupResp = await vaultClient.get<{ data: Record<string, unknown> }>(
            `/identity/group/id/${encodeURIComponent(groupId)}`, token,
          );
          groupData = groupResp.data;
        } catch {
          return res.status(404).json({ error: `Group '${groupId}' not found` });
        }

        const groupName = (groupData.name as string) ?? groupId;
        const gPolicies = (groupData.policies as string[]) ?? [];
        const memberEntityIds = (groupData.member_entity_ids as string[]) ?? [];
        const gNodeId = `group-${groupId}`;
        nodes.push(createNode(gNodeId, 'group', groupName, 0, 0, { groupId, groupName, policies: gPolicies }));

        // Member entities (capped to avoid oversize graphs)
        let eY = 0;
        await concurrentMap(memberEntityIds.slice(0, 25), CONCURRENT_LIMIT, async (eId) => {
          try {
            const eResp = await vaultClient.get<{ data: Record<string, unknown> }>(
              `/identity/entity/id/${eId}`, token,
            );
            const eName = (eResp.data.name as string) ?? eId;
            const eNodeId = `entity-${eId}`;
            nodes.push(createNode(eNodeId, 'entity', eName, 220, eY, { entityId: eId }));
            edges.push(createEdge(gNodeId, eNodeId));
            eY += 55;
          } catch { /* skip inaccessible */ }
        });

        // Policies → paths
        let pY = 0;
        let pathY = 0;
        for (const policyName of gPolicies) {
          const pId = `policy-${policyName}`;
          nodes.push(createNode(pId, 'policy', policyName, 450, pY));
          edges.push(createEdge(gNodeId, pId));
          try {
            const pResp = await vaultClient.get<{ data: { rules?: string; policy?: string } }>(
              `/sys/policies/acl/${encodeURIComponent(policyName)}`, token,
            );
            const rules = pResp.data.rules ?? pResp.data.policy ?? '';
            const paths = parsePolicyHCL(rules);
            for (const pathInfo of paths) {
              const pathId = `path-${policyName}-${pathInfo.path}`;
              if (!nodes.some((n) => n.id === pathId)) {
                nodes.push(createNode(pathId, 'secretPath', pathInfo.path, 690, pathY, {
                  path: pathInfo.path, capabilities: pathInfo.capabilities,
                }));
              }
              edges.push(createEdge(pId, pathId));
              pathY += 55;
            }
          } catch { /* skip */ }
          pY += 65;
        }

        return res.json({ nodes, edges });
      }
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

// Policy → relationships graph (paths, groups that use the policy, auth method roles that use the policy)
router.get(
  '/policy-relationships',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const isRefresh = req.query.refresh === 'true';
      if (!isRefresh) {
        const cached = getFromGraphCache('policy-relationships');
        if (cached) { res.json(cached); return; }
      }

      const token = req.vaultToken!;
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      // 1. List all policies
      const policiesResponse = await vaultClient.list<{ data: { keys: string[] } }>(
        '/sys/policies/acl', token,
      );
      const policyNames = policiesResponse.data.keys;

      policyNames.forEach((policyName, i) => {
        nodes.push(createNode(`policy-${policyName}`, 'policy', policyName, 0, i * NODE_SPACING_Y));
      });

      // 2. Collect all groups (for reverse-lookup: which policies does each group use?)
      interface GroupInfo { id: string; name: string; policies: string[] }
      const groups: GroupInfo[] = [];
      try {
        const groupsResp = await vaultClient.list<{ data: { keys: string[] } }>(
          '/identity/group/id', token,
        );
        await concurrentMap(groupsResp.data.keys, CONCURRENT_LIMIT, async (gId) => {
          try {
            const gResp = await vaultClient.get<{ data: { id: string; name: string; policies: string[] } }>(
              `/identity/group/id/${gId}`, token,
            );
            groups.push({ id: gResp.data.id, name: gResp.data.name, policies: gResp.data.policies ?? [] });
          } catch { /* skip inaccessible group */ }
        });
      } catch { /* groups endpoint not accessible */ }

      // 3. Collect all auth method roles (for reverse-lookup: which policies does each role use?)
      interface RoleInfo { mountPath: string; mountType: string; roleName: string; policies: string[] }
      const roles: RoleInfo[] = [];
      try {
        const authResponse = await vaultClient.get<{
          data: Record<string, { type: string }>;
        }>('/sys/auth', token);

        for (const [path, info] of Object.entries(authResponse.data)) {
          const normalizedPath = path.replace(/\/$/, '');
          try {
            const rolesResponse = await vaultClient.list<{ data: { keys: string[] } }>(
              `/auth/${normalizedPath}/role`, token,
            );
            await concurrentMap(rolesResponse.data.keys, CONCURRENT_LIMIT, async (roleName) => {
              try {
                const roleDetail = await vaultClient.get<{
                  data: { token_policies?: string[]; policies?: string[] };
                }>(`/auth/${normalizedPath}/role/${roleName}`, token);
                const rPolicies = [...new Set([
                  ...(roleDetail.data.token_policies ?? []),
                  ...(roleDetail.data.policies ?? []),
                ])];
                roles.push({ mountPath: normalizedPath, mountType: info.type, roleName, policies: rPolicies });
              } catch { /* skip */ }
            });
          } catch { /* no roles for this mount */ }
        }
      } catch { /* /sys/auth not accessible */ }

      // 4. For each policy: attach paths + groups + roles
      await concurrentMap(policyNames, CONCURRENT_LIMIT, async (policyName) => {
        const policyId = `policy-${policyName}`;

        // Paths from HCL rules
        try {
          const policyResponse = await vaultClient.get<{
            data: { rules?: string; policy?: string };
          }>(`/sys/policies/acl/${encodeURIComponent(policyName)}`, token);
          const rules = policyResponse.data.rules ?? policyResponse.data.policy ?? '';
          const paths = parsePolicyHCL(rules);

          for (const pathInfo of paths) {
            const pathId = `path-${policyName}-${pathInfo.path}`;
            const isAuthPath = pathInfo.path.startsWith('auth/') || pathInfo.path === 'auth';
            const authType = isAuthPath ? (pathInfo.path.split('/')[1] ?? 'auth') : undefined;
            nodes.push(createNode(pathId, 'secretPath', pathInfo.path, NODE_SPACING_X, nodes.length * NODE_SPACING_Y, {
              capabilities: pathInfo.capabilities, isAuthPath, authType,
            }));
            edges.push(createEdge(policyId, pathId));
          }
        } catch { /* skip */ }

        // Groups that include this policy
        for (const g of groups) {
          if ((g.policies ?? []).includes(policyName)) {
            const gNodeId = `grprel-${policyName}-${g.id}`;
            nodes.push(createNode(gNodeId, 'group', g.name, NODE_SPACING_X * 2, nodes.length * NODE_SPACING_Y, {
              groupId: g.id,
            }));
            edges.push(createEdge(policyId, gNodeId));
          }
        }

        // Auth method roles that include this policy
        const addedAuthNodes = new Set<string>();
        for (const r of roles) {
          if ((r.policies ?? []).includes(policyName)) {
            const roleNodeId = `rolerel-${policyName}-${r.mountPath}-${r.roleName}`;
            const amNodeId = `amrel-${policyName}-${r.mountPath}`;
            nodes.push(createNode(roleNodeId, 'role', r.roleName, NODE_SPACING_X * 3, nodes.length * NODE_SPACING_Y));
            if (!addedAuthNodes.has(amNodeId)) {
              nodes.push(createNode(amNodeId, 'authMethod', `${r.mountType} (${r.mountPath})`, NODE_SPACING_X * 4, nodes.length * NODE_SPACING_Y, {
                authType: r.mountType,
              }));
              addedAuthNodes.add(amNodeId);
            }
            edges.push(createEdge(policyId, roleNodeId));
            edges.push(createEdge(roleNodeId, amNodeId));
          }
        }
      });

      res.json(setInGraphCache('policy-relationships', nodes, edges));
    } catch (error) {
      next(error);
    }
  }
);

// ── Secret path relationship graph ──────────────────────────────────────────
// Returns a graph: secretPath → policies → (groups → entities) and (auth method roles)
// Query: ?path=kv/data/myapp/secret
router.get(
  '/secret-path-relationships',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const rawPath = typeof req.query['path'] === 'string' ? req.query['path'] : '';
      if (!rawPath) {
        res.status(400).json({ error: 'path query parameter is required' });
        return;
      }

      const token = req.vaultToken!;
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      /** Convert a Vault HCL path pattern to a RegExp for matching */
      function vaultPatternToRegex(pattern: string): RegExp {
        const escaped = pattern
          .split(/(\*|\+)/g)
          .map((part) => {
            if (part === '*') return '.*';
            if (part === '+') return '[^/]+';
            return part.replace(/[.^${}()|[\]\\]/g, '\\$&');
          })
          .join('');
        return new RegExp('^' + escaped + '$');
      }

      // Root node: the queried secret path
      const rootId = 'secret-root';
      nodes.push(createNode(rootId, 'secretPath', rawPath, 0, 0, { path: rawPath }));

      // 1. List all policies
      let policyNames: string[] = [];
      try {
        const resp = await vaultClient.list<{ data: { keys: string[] } }>('/sys/policies/acl', token);
        policyNames = resp.data.keys;
      } catch { /* no access to policy list */ }

      // 2. Find policies that cover this path
      const matchingPolicies: string[] = [];
      await concurrentMap(policyNames, CONCURRENT_LIMIT, async (policyName) => {
        try {
          const pr = await vaultClient.get<{ data: { rules?: string; policy?: string } }>(
            `/sys/policies/acl/${encodeURIComponent(policyName)}`, token,
          );
          const rules = pr.data.rules ?? pr.data.policy ?? '';
          const paths = parsePolicyHCL(rules);
          for (const p of paths) {
            try {
              if (vaultPatternToRegex(p.path).test(rawPath)) {
                matchingPolicies.push(policyName);
                break;
              }
            } catch { /* invalid pattern — skip */ }
          }
        } catch { /* skip inaccessible policy */ }
      });

      if (matchingPolicies.length === 0) {
        res.json({ nodes, edges });
        return;
      }

      // Add policy nodes
      matchingPolicies.forEach((policyName, i) => {
        const pId = `policy-${policyName}`;
        nodes.push(createNode(pId, 'policy', policyName, NODE_SPACING_X, i * NODE_SPACING_Y));
        edges.push(createEdge(rootId, pId));
      });

      // 3. Collect groups that include matching policies
      interface GroupInfo { id: string; name: string; policies: string[] }
      const groups: GroupInfo[] = [];
      try {
        const gr = await vaultClient.list<{ data: { keys: string[] } }>('/identity/group/id', token);
        await concurrentMap(gr.data.keys, CONCURRENT_LIMIT, async (gId) => {
          try {
            const gResp = await vaultClient.get<{
              data: { id: string; name: string; policies: string[]; member_entity_ids?: string[] };
            }>(`/identity/group/id/${gId}`, token);
            const groupPolicies = gResp.data.policies ?? [];
            if (matchingPolicies.some((p) => groupPolicies.includes(p))) {
              groups.push({
                id: gResp.data.id,
                name: gResp.data.name,
                policies: groupPolicies,
              });
            }
          } catch { /* skip */ }
        });
      } catch { /* groups not accessible */ }

      let groupY = 0;
      const addedGroupIds = new Set<string>();
      for (const g of groups) {
        const gNodeId = `group-${g.id}`;
        if (!addedGroupIds.has(gNodeId)) {
          nodes.push(createNode(gNodeId, 'group', g.name || g.id, NODE_SPACING_X * 2, groupY));
          addedGroupIds.add(gNodeId);
          groupY += NODE_SPACING_Y;
        }
        for (const pName of matchingPolicies) {
          if (g.policies.includes(pName)) {
            edges.push(createEdge(`policy-${pName}`, gNodeId));
          }
        }
      }

      // 4. Collect entities in matching groups
      let entityY = 0;
      const addedEntityIds = new Set<string>();
      await concurrentMap(groups, CONCURRENT_LIMIT, async (g) => {
        try {
          const gResp = await vaultClient.get<{
            data: { member_entity_ids?: string[] };
          }>(`/identity/group/id/${g.id}`, token);
          const entityIds = gResp.data.member_entity_ids ?? [];
          await concurrentMap(entityIds, CONCURRENT_LIMIT, async (eId) => {
            try {
              const eResp = await vaultClient.get<{
                data: { id: string; name: string };
              }>(`/identity/entity/id/${eId}`, token);
              const eNodeId = `entity-${eId}`;
              if (!addedEntityIds.has(eNodeId)) {
                nodes.push(createNode(eNodeId, 'entity', eResp.data.name || eId, NODE_SPACING_X * 3, entityY));
                addedEntityIds.add(eNodeId);
                entityY += NODE_SPACING_Y;
              }
              edges.push(createEdge(`group-${g.id}`, eNodeId));
            } catch { /* skip */ }
          });
        } catch { /* skip */ }
      });

      // 5. Collect auth method roles that include matching policies
      interface RoleInfo { mountPath: string; mountType: string; roleName: string; policies: string[] }
      const roles: RoleInfo[] = [];
      try {
        const authResp = await vaultClient.get<{
          data: Record<string, { type: string }>;
        }>('/sys/auth', token);
        for (const [path, info] of Object.entries(authResp.data)) {
          const normalizedPath = path.replace(/\/$/, '');
          try {
            const rolesResp = await vaultClient.list<{ data: { keys: string[] } }>(
              `/auth/${normalizedPath}/role`, token,
            );
            await concurrentMap(rolesResp.data.keys, CONCURRENT_LIMIT, async (roleName) => {
              try {
                const rd = await vaultClient.get<{
                  data: { token_policies?: string[]; policies?: string[] };
                }>(`/auth/${normalizedPath}/role/${roleName}`, token);
                const rPolicies = [...new Set([...(rd.data.token_policies ?? []), ...(rd.data.policies ?? [])])];
                if (matchingPolicies.some((p) => rPolicies.includes(p))) {
                  roles.push({ mountPath: normalizedPath, mountType: info.type, roleName, policies: rPolicies });
                }
              } catch { /* skip */ }
            });
          } catch { /* no roles */ }
        }
      } catch { /* /sys/auth not accessible */ }

      let roleY = 0;
      const addedAuthIds = new Set<string>();
      for (const r of roles) {
        const roleNodeId = `role-${r.mountPath}-${r.roleName}`;
        nodes.push(createNode(roleNodeId, 'role', r.roleName, NODE_SPACING_X * 2, groupY + roleY));
        roleY += NODE_SPACING_Y;
        for (const pName of matchingPolicies) {
          if (r.policies.includes(pName)) {
            edges.push(createEdge(`policy-${pName}`, roleNodeId));
          }
        }
        // Auth method node
        const amNodeId = `auth-${r.mountPath}`;
        if (!addedAuthIds.has(amNodeId)) {
          nodes.push(createNode(amNodeId, 'authMethod', `${r.mountType} (${r.mountPath}/)`, NODE_SPACING_X * 3, groupY + entityY + roleY, {
            authType: r.mountType,
          }));
          addedAuthIds.add(amNodeId);
        }
        edges.push(createEdge(roleNodeId, amNodeId));
      }

      res.json({ nodes, edges });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
