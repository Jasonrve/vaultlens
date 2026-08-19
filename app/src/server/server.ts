import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import app from './app.js';
import { config } from './config/index.js';
import { isSystemTokenConfigured, getSystemToken } from './lib/systemToken.js';
import { VaultClient } from './lib/vaultClient.js';
import { SYSTEM_TOKEN_POLICY_HCL, ADMIN_POLICY_HCL } from './lib/policyLoader.js';
import { initializeTemplates } from './lib/devIntegrationLoader.js';
import { startRotationScheduler } from './routes/rotation.js';
import { startAuditWatcher } from './routes/hooks.js';
import { autoRegisterSocketAuditWithVault, startAuditSocketServer } from './lib/auditSocket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function start(): Promise<void> {
  // Security warnings
  if (config.vaultSkipTlsVerify) {
    console.warn('[SECURITY] VAULT_SKIP_TLS_VERIFY is enabled — TLS certificate verification is disabled. DO NOT use in production.');
    if (config.nodeEnv === 'production') {
      console.error('[SECURITY] WARNING: TLS verification is disabled in a production environment. This allows man-in-the-middle attacks.');
    }
  }

  // Start audit socket server before HTTP server so Vault can connect immediately
  if (config.auditSource === 'socket') {
    startAuditSocketServer(config.auditSocketPort, config.auditSocketHost);
  }

  if (config.nodeEnv !== 'production') {
    // Development: use Vite dev server as middleware for HMR
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: path.resolve(__dirname, '../..'),
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production: serve built frontend assets
    const clientDist = path.resolve(__dirname, '../../dist/client');
    app.use(express.static(clientDist));

    // SPA fallback — any non-API route serves index.html
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.resolve(clientDist, 'index.html'));
    });
  }

  app.listen(config.port, async () => {
    console.log(`VaultLens running on port ${config.port} [${config.nodeEnv}]`);
    console.log(`Vault address: ${config.vaultAddr}`);

    // Initialize dev integration templates from disk
    try {
      await initializeTemplates();
    } catch (err) {
      console.error('[Dev Integration Templates] Failed to initialize:', err instanceof Error ? err.message : err);
    }

    if (!isSystemTokenConfigured()) {
      console.warn(
        '[WARN] System token is not configured — password sharing and branding storage will return 503.\n' +
        '       Set VAULT_SYSTEM_TOKEN=root in app/.env for local development.'
      );
    } else {
      // Sync VaultLens policies to current version.
      // Fixes outdated policies from old setup wizard runs (e.g. missing sys/auth read
      // for OIDC detection). Uses the legacy sys/policy/* write capability that has
      // always been in the policy, so this works even on older deployments.
      try {
        const sysToken = await getSystemToken();
        if (sysToken) {
          const vc = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);
          const policyUpdates: Promise<unknown>[] = [
            vc.put('/sys/policy/vaultlens-system-policy', sysToken, { rules: SYSTEM_TOKEN_POLICY_HCL }),
            vc.put('/sys/policy/vaultlens-admin', sysToken, { rules: ADMIN_POLICY_HCL }),
          ];
          const results = await Promise.allSettled(policyUpdates);
          const names = ['vaultlens-system-policy', 'vaultlens-admin'];
          results.forEach((r, i) => {
            if (r.status === 'fulfilled') {
              console.log(`[Policy Sync] ${names[i]} updated to current version`);
            } else {
              console.warn(`[Policy Sync] Could not update ${names[i]} (non-fatal):`, r.reason instanceof Error ? r.reason.message : r.reason);
            }
          });

          if (config.auditSource === 'socket') {
            await autoRegisterSocketAuditWithVault(
              config.vaultAddr,
              sysToken,
              config.auditSocketVaultAddress,
              config.vaultSkipTlsVerify,
            );
          }
        }
      } catch (err) {
        console.warn('[Policy Sync] Skipped (non-fatal):', err instanceof Error ? err.message : err);
      }

      // Start background services that need system token
      startRotationScheduler();
      startAuditWatcher();

      if (config.auditSource === 'socket') {
        console.log('[Audit Socket] Listening for Vault audit events. Socket audit device registration is handled automatically on startup.');
      }
    }
  });
}

start().catch(console.error);
