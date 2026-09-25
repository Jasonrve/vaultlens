import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { VaultClient, VaultError } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import { concurrentMap } from '../lib/concurrency.js';
import { getOrFetch } from '../lib/resourceCache.js';
import { parsePolicyHCL } from './policies.js';
import {
  graphQueriesTotal,
  graphComputationDurationSeconds,
  graphNodeCount,
  graphEdgeCount,
} from '../lib/metrics.js';
import type {
  AuthenticatedRequest,
  GraphNode,
  GraphEdge,
} from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

router.use(authMiddleware);

// ── In-memory graph cache (per-caller — see graphCacheKey) ──────────────────
// Only used by endpoints that are already scoped to a single item
// (secret-path-relationships, user-identity-map). The other four graph
// endpoints below are summary/one-hop-expand endpoints backed by the shared
// resourceCache instead, since they're cheap enough per-call that a second,
// coarser per-token cache on top would only add complexity.
const GRAPH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface GraphCacheEntry {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cachedAt: number;
  fromCache: boolean;
}

const graphCache = new Map<string, GraphCacheEntry>();

// Graphs are built with the caller's own Vault token, so the cache must be scoped
// per-caller — otherwise one user's response (built from their ACLs) would be served
// to every other user regardless of what that user is actually allowed to see.
function graphCacheKey(graphType: string, token: string): string {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return `${graphType}:${tokenHash}`;
}

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

const CONCURRENT_LIMIT = 20;
const NODE_SPACING_X = 180;
const NODE_SPACING_Y = 60;
const MAX_EXPANDED_MEMBERS = 25;
// getAllGroupPolicies/getAllRolePolicies below do a full-org scan (every
// group, every role on every auth mount) since Vault has no reverse lookup
// from policy -> the groups/roles that reference it. Each item they touch is
// cached individually (same keys used by the identity-map/auth-policy-map
// routes below), so a "scan" is really N cache lookups that only cost a
// Vault call for whatever's still cold. This is the freshness tolerance
// those lookups request — group/role policy attachments rarely change
// minute-to-minute, so it's longer than the default 5-minute resourceCache
// TTL those same keys get from their other (single-item) call sites; see
// resourceCache.ts's getOrFetch — ttlMs is evaluated per call against one
// shared cachedAt, so different callers safely disagree about freshness.
const REVERSE_INDEX_TTL_MS = 30 * 60 * 1000;

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

// ── Shared helper: one policy's HCL → secret-path nodes/edges ───────────────
// Used by policy-secret-map, policy-relationships and user-identity-map — all
// three otherwise re-implemented this exact "fetch a policy, parse its HCL,
// turn matched paths into nodes" step independently. Backed by the shared
// resourceCache so repeated expansion of the same policy (by the same or a
// different caller) doesn't re-fetch/re-parse it within the TTL window.
async function getPolicyPathNodes(
  policyName: string,
  token: string,
  bypassCache = false,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const rules = await getOrFetch(
    `policy:${policyName}`,
    async () => {
      const policyResponse = await vaultClient.get<{
        data: { rules?: string; policy?: string };
      }>(`/sys/policies/acl/${encodeURIComponent(policyName)}`, token);
      return policyResponse.data.rules ?? policyResponse.data.policy ?? '';
    },
    { bypassCache },
  );

  const paths = parsePolicyHCL(rules);
  const policyId = `policy-${policyName}`;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  paths.forEach((pathInfo, i) => {
    const pathId = `path-${policyName}-${pathInfo.path}`;
    const isAuthPath = pathInfo.path.startsWith('auth/') || pathInfo.path === 'auth';
    const authType = isAuthPath ? (pathInfo.path.split('/')[1] ?? 'auth') : undefined;
    nodes.push(createNode(pathId, 'secretPath', pathInfo.path, NODE_SPACING_X, i * NODE_SPACING_Y, {
      capabilities: pathInfo.capabilities,
      isAuthPath,
      authType,
    }));
    edges.push(createEdge(policyId, pathId));
  });

  return { nodes, edges };
}

// ── Shared helper: every group's attached policies (for policy-relationships) ─
// Composed from the same per-group cache entries (`group:${gId}`) that
// identity-map populates/reuses, plus a shared `group-id-list` entry — so a
// "scan" only pays for groups nobody's read recently, instead of rebuilding
// one big blob from scratch every time.
interface GroupPolicyInfo { id: string; name: string; policies: string[] }
async function getAllGroupPolicies(token: string, bypassCache = false): Promise<GroupPolicyInfo[]> {
  const groups: GroupPolicyInfo[] = [];
  try {
    const groupIds = await getOrFetch(
      'group-id-list',
      async () => {
        const groupsResp = await vaultClient.list<{ data: { keys: string[] } }>('/identity/group/id', token);
        return groupsResp.data.keys;
      },
      { bypassCache, ttlMs: REVERSE_INDEX_TTL_MS },
    );
    await concurrentMap(groupIds, CONCURRENT_LIMIT, async (gId) => {
      try {
        const g = await getOrFetch(
          `group:${gId}`,
          async () => {
            const gResp = await vaultClient.get<{ data: { id: string; name: string; policies: string[] } }>(
              `/identity/group/id/${gId}`, token,
            );
            return gResp.data;
          },
          { bypassCache, ttlMs: REVERSE_INDEX_TTL_MS },
        );
        groups.push({ id: g.id, name: g.name, policies: g.policies ?? [] });
      } catch { /* skip inaccessible group */ }
    });
  } catch { /* groups endpoint not accessible */ }
  return groups;
}

// ── Shared helper: every auth-mount role's attached policies (for policy-relationships) ─
// Composed from the same per-mount/per-role cache entries (`role-list:${mount}`,
// `role:${mount}:${role}`) that auth-policy-map populates/reuses, plus a
// shared `sys-auth-mounts` entry — same "only fetch what's cold" reasoning
// as getAllGroupPolicies above.
interface RolePolicyInfo { mountPath: string; mountType: string; roleName: string; policies: string[] }
async function getAllRolePolicies(token: string, bypassCache = false): Promise<RolePolicyInfo[]> {
  const roles: RolePolicyInfo[] = [];
  try {
    const authMounts = await getOrFetch(
      'sys-auth-mounts',
      async () => {
        const authResponse = await vaultClient.get<{
          data: Record<string, { type: string }>;
        }>('/sys/auth', token);
        return authResponse.data;
      },
      { bypassCache, ttlMs: REVERSE_INDEX_TTL_MS },
    );

    for (const [path, info] of Object.entries(authMounts)) {
      const normalizedPath = path.replace(/\/$/, '');
      try {
        const roleNames = await getOrFetch(
          `role-list:${normalizedPath}`,
          async () => {
            const rolesResp = await vaultClient.list<{ data: { keys: string[] } }>(
              `/auth/${normalizedPath}/role`, token,
            );
            return rolesResp.data.keys;
          },
          { bypassCache, ttlMs: REVERSE_INDEX_TTL_MS },
        );
        await concurrentMap(roleNames, CONCURRENT_LIMIT, async (roleName) => {
          try {
            const roleDetail = await getOrFetch(
              `role:${normalizedPath}:${roleName}`,
              async () => {
                const roleResp = await vaultClient.get<{
                  data: { token_policies?: string[]; policies?: string[] };
                }>(`/auth/${normalizedPath}/role/${roleName}`, token);
                return roleResp.data;
              },
              { bypassCache, ttlMs: REVERSE_INDEX_TTL_MS },
            );
            const rPolicies = [...new Set([
              ...(roleDetail.token_policies ?? []),
              ...(roleDetail.policies ?? []),
            ])];
            roles.push({ mountPath: normalizedPath, mountType: info.type, roleName, policies: rPolicies });
          } catch { /* skip */ }
        });
      } catch { /* no roles for this mount */ }
    }
  } catch { /* /sys/auth not accessible */ }
  return roles;
}

// ── Auth method → roles → policies graph ─────────────────────────────────────
// Three levels: summary (mounts + role counts, no detail fan-out), then
// ?mount= (roles for one mount), then ?mount=&role= (policies for one role).
router.get(
  '/auth-policy-map',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      const mount = typeof req.query['mount'] === 'string' ? req.query['mount'] : undefined;
      const role = typeof req.query['role'] === 'string' ? req.query['role'] : undefined;
      const bypassCache = req.query['refresh'] === 'true';
      const _graphStart = process.hrtime.bigint();

      // Level 2: policies attached to one role
      if (mount && role) {
        const normalizedMount = mount.replace(/\/$/, '');
        const roleId = `role-${normalizedMount}-${role}`;
        const roleDetail = await getOrFetch(
          `role:${normalizedMount}:${role}`,
          async () => {
            const roleResp = await vaultClient.get<{
              data: { token_policies?: string[]; policies?: string[] };
            }>(`/auth/${normalizedMount}/role/${role}`, token);
            return roleResp.data;
          },
          { bypassCache },
        );

        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        const policyNames = [...new Set([
          ...(roleDetail.token_policies ?? []),
          ...(roleDetail.policies ?? []),
        ])];
        policyNames.forEach((policyName, i) => {
          const policyId = `policy-${policyName}`;
          nodes.push(createNode(policyId, 'policy', policyName, NODE_SPACING_X * 2, i * NODE_SPACING_Y));
          edges.push(createEdge(roleId, policyId));
        });

        graphQueriesTotal.inc({ graph_type: 'auth-policy', cache_hit: 'false' });
        res.json({ nodes, edges });
        return;
      }

      // Level 1: roles under one auth mount
      if (mount) {
        const normalizedMount = mount.replace(/\/$/, '');
        const mountId = `auth-${normalizedMount}`;
        const roleNames = await getOrFetch(
          `role-list:${normalizedMount}`,
          async () => {
            const rolesResp = await vaultClient.list<{ data: { keys: string[] } }>(
              `/auth/${normalizedMount}/role`, token,
            );
            return rolesResp.data.keys;
          },
          { bypassCache },
        );

        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        roleNames.forEach((roleName, i) => {
          const roleId = `role-${normalizedMount}-${roleName}`;
          nodes.push(createNode(roleId, 'role', roleName, NODE_SPACING_X, i * NODE_SPACING_Y, { method: normalizedMount }));
          edges.push(createEdge(mountId, roleId));
        });

        graphQueriesTotal.inc({ graph_type: 'auth-policy', cache_hit: 'false' });
        res.json({ nodes, edges });
        return;
      }

      // Level 0: summary — one node per auth mount. Whether it's expandable is
      // decided from its type alone (no Vault call) — actually listing roles
      // happens lazily in Level 1, when the user expands that mount. Doing a
      // role-list call per mount here used to mean one Vault (and audit-log)
      // entry per auth mount on every page load / cache expiry, for a count
      // that's never even displayed — only used to gate expandability.
      const authMounts = await getOrFetch(
        'sys-auth-mounts',
        async () => {
          const authResponse = await vaultClient.get<{
            data: Record<string, { type: string; description: string; accessor: string }>;
          }>('/sys/auth', token);
          return authResponse.data;
        },
        { bypassCache },
      );

      // Auth types that don't support standard /role list — skip silently.
      // token: no roles; ldap/userpass/github/radius/cert: use groups/users/certs, not roles.
      const NO_ROLE_TYPES = new Set(['token', 'ldap', 'userpass', 'github', 'radius', 'okta']);

      const nodes: GraphNode[] = [];
      let methodY = 0;
      for (const [path, info] of Object.entries(authMounts)) {
        const normalizedPath = path.replace(/\/$/, '');
        const methodId = `auth-${normalizedPath}`;

        nodes.push(createNode(methodId, 'authMethod', `${info.type} (${path})`, 0, methodY, {
          authType: info.type,
          hasRoles: !NO_ROLE_TYPES.has(info.type),
        }));
        methodY += NODE_SPACING_Y * 2;
      }

      graphQueriesTotal.inc({ graph_type: 'auth-policy', cache_hit: 'false' });
      graphComputationDurationSeconds.observe({ graph_type: 'auth-policy' }, Number(process.hrtime.bigint() - _graphStart) / 1e9);
      graphNodeCount.set({ graph_type: 'auth-policy' }, nodes.length);
      graphEdgeCount.set({ graph_type: 'auth-policy' }, 0);
      res.json({ nodes, edges: [] });
    } catch (error) {
      next(error);
    }
  }
);

// ── Policy → secret paths graph ──────────────────────────────────────────────
// Summary: policy-name nodes only. ?policy=<name>: that one policy's paths.
router.get(
  '/policy-secret-map',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      const policyName = typeof req.query['policy'] === 'string' ? req.query['policy'] : undefined;
      const bypassCache = req.query['refresh'] === 'true';
      const _graphStart = process.hrtime.bigint();

      if (policyName) {
        const pathResult = await getPolicyPathNodes(policyName, token, bypassCache);
        // getPolicyPathNodes only returns the path children — this response is
        // used as a fresh top-level graph root (not merged onto an existing
        // node like user-identity-map does), so the policy node itself must
        // be included or the client has no root to render from.
        const nodes: GraphNode[] = [
          createNode(`policy-${policyName}`, 'policy', policyName, 0, 0),
          ...pathResult.nodes,
        ];
        graphQueriesTotal.inc({ graph_type: 'policy-secret', cache_hit: 'false' });
        res.json({ nodes, edges: pathResult.edges });
        return;
      }

      const policiesResponse = await vaultClient.list<{ data: { keys: string[] } }>(
        '/sys/policies/acl', token,
      );
      const nodes = policiesResponse.data.keys.map((name, i) =>
        createNode(`policy-${name}`, 'policy', name, 0, i * NODE_SPACING_Y),
      );

      graphQueriesTotal.inc({ graph_type: 'policy-secret', cache_hit: 'false' });
      graphComputationDurationSeconds.observe({ graph_type: 'policy-secret' }, Number(process.hrtime.bigint() - _graphStart) / 1e9);
      graphNodeCount.set({ graph_type: 'policy-secret' }, nodes.length);
      graphEdgeCount.set({ graph_type: 'policy-secret' }, 0);
      res.json({ nodes, edges: [] });
    } catch (error) {
      next(error);
    }
  }
);

// ── Identity summary / one-hop entity or group expansion ─────────────────────
// Summary: entity + group counts only. ?entityId= / ?groupId=: that one
// entity's or group's direct policies + immediate neighbors (names only —
// expanding a policy shown here into its secret paths is the same one-hop
// "expand a policy" action as policy-secret-map?policy=, reused by the client
// rather than re-implemented here).
router.get(
  '/identity-map',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      const entityId = typeof req.query['entityId'] === 'string' ? req.query['entityId'] : undefined;
      const groupId = typeof req.query['groupId'] === 'string' ? req.query['groupId'] : undefined;
      const bypassCache = req.query['refresh'] === 'true';
      const _graphStart = process.hrtime.bigint();

      if (!entityId && !groupId) {
        let entityCount = 0;
        let groupCount = 0;
        try {
          const entityIds = await getOrFetch(
            'entity-id-list',
            async () => {
              const r = await vaultClient.list<{ data: { keys: string[] } }>('/identity/entity/id', token);
              return r.data.keys;
            },
            { bypassCache },
          );
          entityCount = entityIds.length;
        } catch (e) {
          if (!(e instanceof VaultError && e.statusCode === 404)) throw e;
        }
        try {
          const groupIds = await getOrFetch(
            'group-id-list',
            async () => {
              const r = await vaultClient.list<{ data: { keys: string[] } }>('/identity/group/id', token);
              return r.data.keys;
            },
            { bypassCache },
          );
          groupCount = groupIds.length;
        } catch (e) {
          if (!(e instanceof VaultError && e.statusCode === 404)) throw e;
        }

        const nodes: GraphNode[] = [
          createNode('entities-summary', 'summary', `Entities (${entityCount})`, 0, 0, { kind: 'entities', count: entityCount }),
          createNode('groups-summary', 'summary', `Groups (${groupCount})`, NODE_SPACING_X, 0, { kind: 'groups', count: groupCount }),
        ];

        graphQueriesTotal.inc({ graph_type: 'identity', cache_hit: 'false' });
        graphComputationDurationSeconds.observe({ graph_type: 'identity' }, Number(process.hrtime.bigint() - _graphStart) / 1e9);
        graphNodeCount.set({ graph_type: 'identity' }, nodes.length);
        graphEdgeCount.set({ graph_type: 'identity' }, 0);
        res.json({ nodes, edges: [] });
        return;
      }

      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      if (entityId) {
        let entity: { id: string; name: string; policies?: string[]; group_ids?: string[] };
        try {
          entity = await getOrFetch(
            `entity:${entityId}`,
            async () => {
              const r = await vaultClient.get<{ data: { id: string; name: string; policies?: string[]; group_ids?: string[] } }>(
                `/identity/entity/id/${encodeURIComponent(entityId)}`, token,
              );
              return r.data;
            },
            { bypassCache },
          );
        } catch {
          res.status(404).json({ error: `Entity ID '${entityId}' not found` });
          return;
        }

        const entityNodeId = `entity-${entityId}`;
        nodes.push(createNode(entityNodeId, 'entity', entity.name || entityId, 0, 0, { entityId }));
        for (const policyName of entity.policies ?? []) {
          const policyId = `policy-${policyName}`;
          nodes.push(createNode(policyId, 'policy', policyName, NODE_SPACING_X * 2, nodes.length * NODE_SPACING_Y));
          edges.push(createEdge(entityNodeId, policyId));
        }
        await concurrentMap((entity.group_ids ?? []).slice(0, MAX_EXPANDED_MEMBERS), CONCURRENT_LIMIT, async (gId) => {
          const groupNodeId = `group-${gId}`;
          try {
            const group = await getOrFetch(
              `group:${gId}`,
              async () => {
                const r = await vaultClient.get<{ data: { id: string; name: string } }>(
                  `/identity/group/id/${gId}`, token,
                );
                return r.data;
              },
              { bypassCache },
            );
            nodes.push(createNode(groupNodeId, 'group', group.name || gId, NODE_SPACING_X, nodes.length * NODE_SPACING_Y, { groupId: gId }));
          } catch {
            nodes.push(createNode(groupNodeId, 'group', gId, NODE_SPACING_X, nodes.length * NODE_SPACING_Y, { groupId: gId }));
          }
          edges.push(createEdge(entityNodeId, groupNodeId));
        });
      } else if (groupId) {
        let group: { id: string; name: string; policies?: string[]; member_entity_ids?: string[] };
        try {
          group = await getOrFetch(
            `group:${groupId}`,
            async () => {
              const r = await vaultClient.get<{ data: { id: string; name: string; policies?: string[]; member_entity_ids?: string[] } }>(
                `/identity/group/id/${encodeURIComponent(groupId)}`, token,
              );
              return r.data;
            },
            { bypassCache },
          );
        } catch {
          res.status(404).json({ error: `Group '${groupId}' not found` });
          return;
        }

        const groupNodeId = `group-${groupId}`;
        nodes.push(createNode(groupNodeId, 'group', group.name || groupId, 0, 0, { groupId }));
        for (const policyName of group.policies ?? []) {
          const policyId = `policy-${policyName}`;
          nodes.push(createNode(policyId, 'policy', policyName, NODE_SPACING_X * 2, nodes.length * NODE_SPACING_Y));
          edges.push(createEdge(groupNodeId, policyId));
        }
        await concurrentMap((group.member_entity_ids ?? []).slice(0, MAX_EXPANDED_MEMBERS), CONCURRENT_LIMIT, async (eId) => {
          const entityNodeId = `entity-${eId}`;
          try {
            const entity = await getOrFetch(
              `entity:${eId}`,
              async () => {
                const r = await vaultClient.get<{ data: { id: string; name: string } }>(
                  `/identity/entity/id/${eId}`, token,
                );
                return r.data;
              },
              { bypassCache },
            );
            nodes.push(createNode(entityNodeId, 'entity', entity.name || eId, NODE_SPACING_X, nodes.length * NODE_SPACING_Y, { entityId: eId }));
          } catch {
            nodes.push(createNode(entityNodeId, 'entity', eId, NODE_SPACING_X, nodes.length * NODE_SPACING_Y, { entityId: eId }));
          }
          edges.push(createEdge(groupNodeId, entityNodeId));
        });
      }

      graphQueriesTotal.inc({ graph_type: 'identity', cache_hit: 'false' });
      graphComputationDurationSeconds.observe({ graph_type: 'identity' }, Number(process.hrtime.bigint() - _graphStart) / 1e9);
      graphNodeCount.set({ graph_type: 'identity' }, nodes.length);
      graphEdgeCount.set({ graph_type: 'identity' }, edges.length);
      res.json({ nodes, edges });
    } catch (error) {
      next(error);
    }
  }
);

// ── User identity chain: Me → Groups → Policies → Secret Paths ──────────────
// Already scoped to a single user/group (not a global fan-out) — just cached
// (previously wasn't) and parallelized (previously had two sequential loops).
router.get(
  '/user-identity-map',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      const entityName = req.query['entityName'] as string | undefined;
      const entityId = req.query['entityId'] as string | undefined;
      const groupId = req.query['groupId'] as string | undefined;
      const bypassCache = req.query['refresh'] === 'true';

      const cacheKey = graphCacheKey(
        `user-identity-map:${entityId ?? ''}:${entityName ?? ''}:${groupId ?? ''}`,
        token,
      );
      if (!bypassCache) {
        const cached = getFromGraphCache(cacheKey);
        if (cached) {
          graphQueriesTotal.inc({ graph_type: 'user-identity', cache_hit: 'true' });
          res.json(cached);
          return;
        }
      }

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
          res.status(404).json({ error: `Group '${groupId}' not found` });
          return;
        }

        const groupName = (groupData.name as string) ?? groupId;
        const gPolicies = (groupData.policies as string[]) ?? [];
        const memberEntityIds = (groupData.member_entity_ids as string[]) ?? [];
        const gNodeId = `group-${groupId}`;
        nodes.push(createNode(gNodeId, 'group', groupName, 0, 0, { groupId, groupName, policies: gPolicies }));

        // Member entities (capped to avoid oversize graphs), fetched concurrently
        await concurrentMap(memberEntityIds.slice(0, MAX_EXPANDED_MEMBERS), CONCURRENT_LIMIT, async (eId) => {
          try {
            const eResp = await vaultClient.get<{ data: Record<string, unknown> }>(
              `/identity/entity/id/${eId}`, token,
            );
            const eName = (eResp.data.name as string) ?? eId;
            nodes.push(createNode(`entity-${eId}`, 'entity', eName, 220, nodes.length * NODE_SPACING_Y, { entityId: eId }));
            edges.push(createEdge(gNodeId, `entity-${eId}`));
          } catch { /* skip inaccessible */ }
        });

        // Policies → paths, fetched/parsed concurrently via the shared cached helper
        await concurrentMap(gPolicies, CONCURRENT_LIMIT, async (policyName) => {
          const pId = `policy-${policyName}`;
          nodes.push(createNode(pId, 'policy', policyName, 450, nodes.length * NODE_SPACING_Y));
          edges.push(createEdge(gNodeId, pId));
          try {
            const pathResult = await getPolicyPathNodes(policyName, token, bypassCache);
            nodes.push(...pathResult.nodes);
            edges.push(...pathResult.edges);
          } catch { /* skip */ }
        });

        graphQueriesTotal.inc({ graph_type: 'user-identity', cache_hit: 'false' });
        res.json(setInGraphCache(cacheKey, nodes, edges));
        return;
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
          res.status(404).json({ error: `Entity ID '${entityId}' not found` });
          return;
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
          res.status(404).json({ error: `Entity '${entityName}' not found` });
          return;
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
        const resolvedEntityId = tokenLookup.data.entity_id as string | undefined;

        if (resolvedEntityId) {
          try {
            const entityResp = await vaultClient.get<{ data: Record<string, unknown> }>(
              `/identity/entity/id/${resolvedEntityId}`,
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

      // ── Groups (fetched concurrently — was a sequential for-loop) ───────────
      const groupPolicyMap = new Map<string, string[]>(); // gNodeId → policies
      await concurrentMap(groupIds, CONCURRENT_LIMIT, async (gId) => {
        try {
          const groupResp = await vaultClient.get<{ data: Record<string, unknown> }>(
            `/identity/group/id/${gId}`,
            token
          );
          const group = groupResp.data;
          const gNodeId = `group-${gId}`;
          nodes.push(
            createNode(gNodeId, 'group', (group.name as string) || gId, 220, nodes.length * NODE_SPACING_Y, {
              groupId: gId,
              groupName: group.name,
              policies: group.policies || [],
            })
          );
          edges.push(createEdge(meId, gNodeId));
          groupPolicyMap.set(gNodeId, (group.policies as string[]) || []);
        } catch (e) {
          console.warn(
            `[graph] Could not read group '${gId}':`,
            e instanceof Error ? e.message : e
          );
        }
      });

      // ── Collect all unique policies ─────────────────────────────────────────
      const allPolicies = new Set<string>(directPolicies);
      for (const gPolicies of groupPolicyMap.values()) {
        for (const p of gPolicies) allPolicies.add(p);
      }

      // ── Policies + Paths (fetched concurrently — was a sequential for-loop,
      //    now also reuses the shared cached getPolicyPathNodes helper) ────────
      await concurrentMap([...allPolicies], CONCURRENT_LIMIT, async (policyName) => {
        const policyId = `policy-${policyName}`;
        nodes.push(createNode(policyId, 'policy', policyName, 450, nodes.length * NODE_SPACING_Y));

        if (directPolicies.includes(policyName)) {
          edges.push(createEdge(meId, policyId));
        }
        for (const [gNodeId, gPolicies] of groupPolicyMap) {
          if (gPolicies.includes(policyName)) {
            edges.push(createEdge(gNodeId, policyId));
          }
        }

        try {
          const pathResult = await getPolicyPathNodes(policyName, token, bypassCache);
          nodes.push(...pathResult.nodes);
          edges.push(...pathResult.edges);
        } catch (e) {
          console.warn(
            `[graph] Could not read policy '${policyName}':`,
            e instanceof Error ? e.message : e
          );
        }
      });

      graphQueriesTotal.inc({ graph_type: 'user-identity', cache_hit: 'false' });
      res.json(setInGraphCache(cacheKey, nodes, edges));
    } catch (error) {
      return next(error);
    }
  }
);

// ── Policy → relationships graph (paths, groups that use the policy, auth method roles that use the policy)
// Summary: policy-name nodes only. ?policy=<name>: that one policy's paths +
// matching groups/roles (the group/role reverse-lookup scans are cached — see
// getAllGroupPolicies/getAllRolePolicies — so they run once per TTL window,
// not once per policy click).
router.get(
  '/policy-relationships',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      const policyName = typeof req.query['policy'] === 'string' ? req.query['policy'] : undefined;
      const bypassCache = req.query['refresh'] === 'true';
      const _graphStart = process.hrtime.bigint();

      if (!policyName) {
        const policiesResponse = await vaultClient.list<{ data: { keys: string[] } }>(
          '/sys/policies/acl', token,
        );
        const nodes = policiesResponse.data.keys.map((name, i) =>
          createNode(`policy-${name}`, 'policy', name, 0, i * NODE_SPACING_Y),
        );

        graphQueriesTotal.inc({ graph_type: 'policy-relationships', cache_hit: 'false' });
        graphComputationDurationSeconds.observe({ graph_type: 'policy-relationships' }, Number(process.hrtime.bigint() - _graphStart) / 1e9);
        graphNodeCount.set({ graph_type: 'policy-relationships' }, nodes.length);
        graphEdgeCount.set({ graph_type: 'policy-relationships' }, 0);
        res.json({ nodes, edges: [] });
        return;
      }

      const policyId = `policy-${policyName}`;
      const pathResult = await getPolicyPathNodes(policyName, token, bypassCache);
      // Same as policy-secret-map above: this is a fresh top-level graph root,
      // so the policy node itself must be included, not just its children.
      const nodes: GraphNode[] = [createNode(policyId, 'policy', policyName, 0, 0), ...pathResult.nodes];
      const edges: GraphEdge[] = [...pathResult.edges];

      const groups = await getAllGroupPolicies(token, bypassCache);
      for (const g of groups) {
        if ((g.policies ?? []).includes(policyName)) {
          const gNodeId = `grprel-${policyName}-${g.id}`;
          nodes.push(createNode(gNodeId, 'group', g.name, NODE_SPACING_X * 2, nodes.length * NODE_SPACING_Y, {
            groupId: g.id,
          }));
          edges.push(createEdge(policyId, gNodeId));
        }
      }

      const roles = await getAllRolePolicies(token, bypassCache);
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

      graphQueriesTotal.inc({ graph_type: 'policy-relationships', cache_hit: 'false' });
      graphComputationDurationSeconds.observe({ graph_type: 'policy-relationships' }, Number(process.hrtime.bigint() - _graphStart) / 1e9);
      graphNodeCount.set({ graph_type: 'policy-relationships' }, nodes.length);
      graphEdgeCount.set({ graph_type: 'policy-relationships' }, edges.length);
      res.json({ nodes, edges });
    } catch (error) {
      next(error);
    }
  }
);

// ── Secret path relationship graph ──────────────────────────────────────────
// Already scoped to one path — just cached (previously wasn't) and de-duped
// (previously re-fetched each matching group a second time for member IDs).
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
      const bypassCache = req.query['refresh'] === 'true';
      const cacheKey = graphCacheKey(`secret-path-relationships:${rawPath}`, token);
      if (!bypassCache) {
        const cached = getFromGraphCache(cacheKey);
        if (cached) {
          graphQueriesTotal.inc({ graph_type: 'secret-path-relationships', cache_hit: 'true' });
          res.json(cached);
          return;
        }
      }
      const _graphStart = process.hrtime.bigint();

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
        res.json(setInGraphCache(cacheKey, nodes, edges));
        return;
      }

      // Add policy nodes
      matchingPolicies.forEach((policyName, i) => {
        const pId = `policy-${policyName}`;
        nodes.push(createNode(pId, 'policy', policyName, NODE_SPACING_X, i * NODE_SPACING_Y));
        edges.push(createEdge(rootId, pId));
      });

      // 3. Collect groups that include matching policies (keeping member_entity_ids
      //    from this same read so step 4 doesn't have to re-fetch the group).
      interface GroupInfo { id: string; name: string; policies: string[]; member_entity_ids: string[] }
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
                member_entity_ids: gResp.data.member_entity_ids ?? [],
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

      // 4. Entities in matching groups — reuses member_entity_ids from step 3,
      //    no second per-group fetch.
      let entityY = 0;
      const addedEntityIds = new Set<string>();
      await concurrentMap(groups, CONCURRENT_LIMIT, async (g) => {
        await concurrentMap(g.member_entity_ids, CONCURRENT_LIMIT, async (eId) => {
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

      graphQueriesTotal.inc({ graph_type: 'secret-path-relationships', cache_hit: 'false' });
      graphComputationDurationSeconds.observe({ graph_type: 'secret-path-relationships' }, Number(process.hrtime.bigint() - _graphStart) / 1e9);
      graphNodeCount.set({ graph_type: 'secret-path-relationships' }, nodes.length);
      graphEdgeCount.set({ graph_type: 'secret-path-relationships' }, edges.length);
      res.json(setInGraphCache(cacheKey, nodes, edges));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
