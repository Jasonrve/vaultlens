import { Router, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { VaultClient } from '../lib/vaultClient.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { buildAuthActionTokens, readAuthActions, resolveAuthActions, validateActions, writeAuthActions } from '../lib/authActions.js';
import type { AuthenticatedRequest } from '../types/index.js';
import type { AuthActionConfig, AuthActionContext } from '../../shared/authActions.js';

const router = Router();
const vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);
router.use(authMiddleware);

async function getContext(mount: string, role: string, token: string, screen: AuthActionContext['screen']): Promise<AuthActionContext & { roleData: Record<string, unknown> }> {
  const response = await vaultClient.get<{ data: Record<string, { type: string }> }>('/sys/auth', token);
  const authType = response.data[mount.endsWith('/') ? mount : `${mount}/`]?.type ?? mount;
  let roleData: Record<string, unknown> = {};
  if (role) {
    try {
      const roleResponse = await vaultClient.get<{ data: Record<string, unknown> }>(`/auth/${encodeURIComponent(mount)}/role/${encodeURIComponent(role)}`, token);
      roleData = roleResponse.data ?? {};
    } catch { /* Role actions can still resolve mount-level tokens when the role is unavailable. */ }
  }
  return { screen, mount, role, authType, roleData };
}

router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const screen = String(req.query['screen'] ?? 'mount') as AuthActionContext['screen'];
    const mount = String(req.query['mount'] ?? '').replace(/\/$/, '');
    const role = String(req.query['role'] ?? '');
    if (!['list', 'mount', 'role'].includes(screen) || !mount || !/^[\w-]+$/.test(mount) || (role && !/^[\w-]+$/.test(role))) {
      res.status(400).json({ error: 'Invalid action context' });
      return;
    }
    const context = await getContext(mount, role, req.vaultToken!, screen);
    const typeConfig = await readAuthActions('auth-type', (context.authType ?? mount).toLowerCase());
    const mountConfig = await readAuthActions('mount', mount);
    const actions = new Map(typeConfig.actions.map((action) => [action.id, action]));
    for (const action of mountConfig.actions) actions.set(action.id, action);
    const tokens = buildAuthActionTokens(context, context.roleData);
    res.json({ authType: context.authType, tokens, actions: resolveAuthActions([...actions.values()], context, tokens) });
  } catch (error) { next(error); }
});

router.get('/config', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const scope = String(req.query['scope'] ?? '') as AuthActionConfig['scope'];
    const key = String(req.query['key'] ?? '');
    if (!['auth-type', 'mount'].includes(scope) || !key) { res.status(400).json({ error: 'Invalid action scope' }); return; }
    res.json(await readAuthActions(scope, key));
  } catch (error) { next(error); }
});

router.put('/config', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { scope, key, actions } = req.body as Partial<AuthActionConfig>;
    if (!['auth-type', 'mount'].includes(scope ?? '') || typeof key !== 'string' || !key) { res.status(400).json({ error: 'Invalid action scope' }); return; }
    const value: AuthActionConfig = { scope: scope as AuthActionConfig['scope'], key, actions: validateActions(actions) };
    await writeAuthActions(value);
    res.json(value);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid action configuration' });
  }
});

export default router;