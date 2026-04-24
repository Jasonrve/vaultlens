import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import app from './app.js';
import { config } from './config/index.js';
import { isSystemTokenConfigured, getSystemToken } from './lib/systemToken.js';
import { initializeTemplates } from './lib/devIntegrationLoader.js';
import { startRotationScheduler } from './routes/rotation.js';
import { startAuditWatcher } from './routes/hooks.js';
import { startAuditSocketServer, autoRegisterSocketAuditWithVault } from './lib/auditSocket.js';

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
      // Start background services that need system token
      startRotationScheduler();
      startAuditWatcher();

      // Auto-register socket audit device with Vault when socket mode is enabled
      if (config.auditSource === 'socket') {
        getSystemToken().then((token) => {
          return autoRegisterSocketAuditWithVault(
            config.vaultAddr,
            token,
            config.auditSocketVaultAddress,
            config.vaultSkipTlsVerify,
          );
        }).catch((err: unknown) => {
          console.warn(
            '[Audit Socket] Could not auto-register socket audit device with Vault:',
            err instanceof Error ? err.message : String(err),
            '\n  Ensure VAULT_AUDIT_SOCKET_VAULT_ADDRESS is reachable from Vault and the system token has sys/audit/* permissions.',
          );
        });
      }
    }
  });
}

start().catch(console.error);
