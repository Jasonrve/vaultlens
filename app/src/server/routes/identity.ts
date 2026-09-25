import { Router, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { VaultClient } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import { identityOperationsTotal } from '../lib/metrics.js';
import { concurrentMap } from '../lib/concurrency.js';
import { getOrFetch } from '../lib/resourceCache.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);
const CONCURRENT_LIMIT = 20;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

router.use(authMiddleware);

function parsePageParams(req: AuthenticatedRequest, defaultLimit = DEFAULT_PAGE_LIMIT) {
  const search = typeof req.query['search'] === 'string' ? req.query['search'].trim().toLowerCase() : '';
  const offset = Math.max(0, parseInt(String(req.query['offset'] ?? '0'), 10) || 0);
  const limitRaw = parseInt(String(req.query['limit'] ?? String(defaultLimit)), 10) || defaultLimit;
  const limit = Math.min(Math.max(1, limitRaw), MAX_PAGE_LIMIT);
  return { search, offset, limit };
}

// List entities
router.get(
  '/entities',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const response = await vaultClient.list<{
        data: { keys: string[] };
      }>('/identity/entity/id', req.vaultToken!);

      identityOperationsTotal.inc({ entity_type: 'entity', operation: 'list' });
      res.json({ entityIds: response.data.keys });
    } catch (error) {
      next(error);
    }
  }
);

// Get entity details
router.get(
  '/entities/:id',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params['id']);
      const response = await vaultClient.get<{ data: Record<string, unknown> }>(
        `/identity/entity/id/${encodeURIComponent(id)}`,
        req.vaultToken!
      );

      identityOperationsTotal.inc({ entity_type: 'entity', operation: 'read' });
      res.json({ entity: response.data });
    } catch (error) {
      next(error);
    }
  }
);

// List groups
router.get(
  '/groups',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const response = await vaultClient.list<{
        data: { keys: string[] };
      }>('/identity/group/id', req.vaultToken!);

      identityOperationsTotal.inc({ entity_type: 'group', operation: 'list' });
      res.json({ groupIds: response.data.keys });
    } catch (error) {
      next(error);
    }
  }
);

// Get group details
router.get(
  '/groups/:id',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params['id']);
      const response = await vaultClient.get<{ data: Record<string, unknown> }>(
        `/identity/group/id/${encodeURIComponent(id)}`,
        req.vaultToken!
      );

      identityOperationsTotal.inc({ entity_type: 'group', operation: 'read' });
      res.json({ group: response.data });
    } catch (error) {
      next(error);
    }
  }
);

// Entity alias suggestions for autocomplete — returns alias names + entity IDs.
// Filters Vault's name list (one cheap LIST, no per-entity fetch) by `search`
// BEFORE fetching any entity detail, so this stays cheap regardless of how
// many entities exist in Vault. Without a search term, only the first page
// of names (alphabetical-as-returned-by-Vault) is used — callers should pass
// `search` to find anything beyond that.
router.get(
  '/entity-suggestions',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      const bypassCache = req.query['refresh'] === 'true';
      const { search, limit } = parsePageParams(req, 25);

      let names: string[];
      try {
        names = await getOrFetch(
          'entity-name-list',
          async () => {
            const listResp = await vaultClient.list<{ data: { keys: string[] } }>('/identity/entity/name', token);
            return listResp.data.keys;
          },
          { bypassCache },
        );
      } catch {
        res.json({ suggestions: [] });
        return;
      }

      const page = (search ? names.filter((n) => n.toLowerCase().includes(search)) : names).slice(0, limit);

      interface Suggestion {
        aliasName: string;
        entityId: string;
        entityName: string;
        mountType: string;
      }
      const suggestions: Suggestion[] = [];

      await concurrentMap(page, CONCURRENT_LIMIT, async (name) => {
        try {
          const entity = await getOrFetch(
            `entity-by-name:${name}`,
            async () => {
              const resp = await vaultClient.get<{
                data: { id: string; name: string; aliases?: Array<{ name: string; mount_type: string }> };
              }>(`/identity/entity/name/${encodeURIComponent(name)}`, token);
              return resp.data;
            },
            { bypassCache },
          );

          const aliases = entity.aliases ?? [];
          for (const alias of aliases) {
            if (alias.name) {
              suggestions.push({
                aliasName: alias.name,
                entityId: entity.id,
                entityName: entity.name,
                mountType: alias.mount_type ?? '',
              });
            }
          }
          if (aliases.length === 0 && entity.name) {
            suggestions.push({
              aliasName: entity.name,
              entityId: entity.id,
              entityName: entity.name,
              mountType: '',
            });
          }
        } catch {
          // skip inaccessible entities
        }
      });

      suggestions.sort((a, b) => a.aliasName.localeCompare(b.aliasName));

      return res.json({ suggestions });
    } catch (error) {
      return next(error);
    }
  }
);

// List entities with names (summary) — paginated + searchable. Uses Vault's
// name-based LIST (returns names directly, no per-entity fetch) for the base
// list, and only fetches per-item detail (group/policy counts) for the
// current page, not every entity in Vault.
router.get(
  '/entities-summary',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      const bypassCache = req.query['refresh'] === 'true';
      const { search, offset, limit } = parsePageParams(req);

      let names: string[];
      try {
        names = await getOrFetch(
          'entity-name-list',
          async () => {
            const listResp = await vaultClient.list<{ data: { keys: string[] } }>('/identity/entity/name', token);
            return listResp.data.keys;
          },
          { bypassCache },
        );
      } catch {
        res.json({ entities: [], total: 0 });
        return;
      }

      const filtered = search ? names.filter((n) => n.toLowerCase().includes(search)) : names;
      const page = filtered.slice(offset, offset + limit);

      const entities: { id: string; name: string; aliasName: string; groupCount: number; policyCount: number }[] = [];
      await concurrentMap(page, CONCURRENT_LIMIT, async (name) => {
        try {
          const entity = await getOrFetch(
            `entity-by-name:${name}`,
            async () => {
              const resp = await vaultClient.get<{
                data: { id: string; name: string; group_ids?: string[]; policies?: string[]; aliases?: Array<{ name: string }> };
              }>(`/identity/entity/name/${encodeURIComponent(name)}`, token);
              return resp.data;
            },
            { bypassCache },
          );
          entities.push({
            id: entity.id,
            name: entity.name || name,
            aliasName: entity.aliases?.[0]?.name || '',
            groupCount: entity.group_ids?.length || 0,
            policyCount: entity.policies?.length || 0,
          });
        } catch {
          entities.push({ id: '', name, aliasName: '', groupCount: 0, policyCount: 0 });
        }
      });

      entities.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
      identityOperationsTotal.inc({ entity_type: 'entity', operation: 'list' });
      return res.json({ entities, total: filtered.length, offset, limit });
    } catch (error) {
      return next(error);
    }
  }
);

// List groups with names (summary) — paginated + searchable, same shape as
// /entities-summary above.
router.get(
  '/groups-summary',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      const bypassCache = req.query['refresh'] === 'true';
      const { search, offset, limit } = parsePageParams(req);

      let names: string[];
      try {
        names = await getOrFetch(
          'group-name-list',
          async () => {
            const listResp = await vaultClient.list<{ data: { keys: string[] } }>('/identity/group/name', token);
            return listResp.data.keys;
          },
          { bypassCache },
        );
      } catch {
        res.json({ groups: [], total: 0 });
        return;
      }

      const filtered = search ? names.filter((n) => n.toLowerCase().includes(search)) : names;
      const page = filtered.slice(offset, offset + limit);

      const groups: { id: string; name: string; memberCount: number; policyCount: number }[] = [];
      await concurrentMap(page, CONCURRENT_LIMIT, async (name) => {
        try {
          const group = await getOrFetch(
            `group-by-name:${name}`,
            async () => {
              const resp = await vaultClient.get<{
                data: { id: string; name: string; member_entity_ids?: string[]; policies?: string[] };
              }>(`/identity/group/name/${encodeURIComponent(name)}`, token);
              return resp.data;
            },
            { bypassCache },
          );
          groups.push({
            id: group.id,
            name: group.name || name,
            memberCount: group.member_entity_ids?.length || 0,
            policyCount: group.policies?.length || 0,
          });
        } catch {
          groups.push({ id: '', name, memberCount: 0, policyCount: 0 });
        }
      });

      groups.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
      identityOperationsTotal.inc({ entity_type: 'group', operation: 'list' });
      return res.json({ groups, total: filtered.length, offset, limit });
    } catch (error) {
      return next(error);
    }
  }
);

// Resolve entity and group names from lists of IDs (used by detail pages to show
// friendly names). Shares the resourceCache's entity:<id>/group:<id> entries
// with routes/graph.ts, so a name already resolved by a graph expand is free here.
router.get(
  '/resolve',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      const bypassCache = req.query['refresh'] === 'true';
      const entityIdList = String(req.query['entityIds'] ?? '').split(',').filter(Boolean).slice(0, 100);
      const groupIdList = String(req.query['groupIds'] ?? '').split(',').filter(Boolean).slice(0, 100);

      const entityNames: Record<string, string> = {};
      const groupNames: Record<string, string> = {};

      await Promise.all([
        ...entityIdList.map(async (id) => {
          try {
            const entity = await getOrFetch(
              `entity:${id}`,
              async () => {
                const resp = await vaultClient.get<{ data: { id: string; name: string } }>(
                  `/identity/entity/id/${encodeURIComponent(id)}`, token,
                );
                return resp.data;
              },
              { bypassCache },
            );
            entityNames[id] = entity.name || id;
          } catch {
            entityNames[id] = id;
          }
        }),
        ...groupIdList.map(async (id) => {
          try {
            const group = await getOrFetch(
              `group:${id}`,
              async () => {
                const resp = await vaultClient.get<{ data: { id: string; name: string } }>(
                  `/identity/group/id/${encodeURIComponent(id)}`, token,
                );
                return resp.data;
              },
              { bypassCache },
            );
            groupNames[id] = group.name || id;
          } catch {
            groupNames[id] = id;
          }
        }),
      ]);

      return res.json({ entityNames, groupNames });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
