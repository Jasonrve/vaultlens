import { Router, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { VaultClient } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);

router.use(authMiddleware);

// List entities
router.get(
  '/entities',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const response = await vaultClient.list<{
        data: { keys: string[] };
      }>('/identity/entity/id', req.vaultToken!);

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

      res.json({ group: response.data });
    } catch (error) {
      next(error);
    }
  }
);

// Entity alias suggestions for autocomplete — returns alias names + entity IDs
router.get(
  '/entity-suggestions',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;

      // List all entity IDs
      let entityIds: string[] = [];
      try {
        const listResp = await vaultClient.list<{ data: { keys: string[] } }>(
          '/identity/entity/id',
          token
        );
        entityIds = listResp.data.keys;
      } catch {
        return res.json({ suggestions: [] });
      }

      interface Suggestion {
        aliasName: string;
        entityId: string;
        entityName: string;
        mountType: string;
      }

      const suggestions: Suggestion[] = [];

      await Promise.all(
        entityIds.map(async (entityId) => {
          try {
            const resp = await vaultClient.get<{
              data: {
                id: string;
                name: string;
                aliases: Array<{ name: string; mount_type: string }>;
              };
            }>(`/identity/entity/id/${entityId}`, token);

            const entity = resp.data;
            const aliases: Array<{ name: string; mount_type: string }> = entity.aliases ?? [];

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

            // Always include the entity name itself as a fallback if no aliases
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
        })
      );

      suggestions.sort((a, b) => a.aliasName.localeCompare(b.aliasName));

      return res.json({ suggestions });
    } catch (error) {
      return next(error);
    }
  }
);

// List entities with names (summary)
router.get(
  '/entities-summary',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      let entityIds: string[] = [];
      try {
        const listResp = await vaultClient.list<{ data: { keys: string[] } }>(
          '/identity/entity/id',
          token
        );
        entityIds = listResp.data.keys;
      } catch {
        return res.json({ entities: [] });
      }

      const entities: { id: string; name: string }[] = [];
      await Promise.all(
        entityIds.map(async (id) => {
          try {
            const resp = await vaultClient.get<{ data: { id: string; name: string } }>(
              `/identity/entity/id/${id}`,
              token
            );
            entities.push({ id: resp.data.id, name: resp.data.name || '' });
          } catch {
            entities.push({ id, name: '' });
          }
        })
      );

      entities.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
      return res.json({ entities });
    } catch (error) {
      return next(error);
    }
  }
);

// List groups with names (summary)
router.get(
  '/groups-summary',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.vaultToken!;
      let groupIds: string[] = [];
      try {
        const listResp = await vaultClient.list<{ data: { keys: string[] } }>(
          '/identity/group/id',
          token
        );
        groupIds = listResp.data.keys;
      } catch {
        return res.json({ groups: [] });
      }

      const groups: { id: string; name: string }[] = [];
      await Promise.all(
        groupIds.map(async (id) => {
          try {
            const resp = await vaultClient.get<{ data: { id: string; name: string } }>(
              `/identity/group/id/${id}`,
              token
            );
            groups.push({ id: resp.data.id, name: resp.data.name || '' });
          } catch {
            groups.push({ id, name: '' });
          }
        })
      );

      groups.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
      return res.json({ groups });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;