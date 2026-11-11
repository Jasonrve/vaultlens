import { defineConfig } from '@playwright/test';

// UI tests run against the Vite dev server with every /api call mocked in-test
// (see e2e/fixtures.ts) — no Vault is needed. Set PW_CHANNEL=chrome|msedge to use an installed browser.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5199',
    ...(process.env['PW_CHANNEL'] ? { channel: process.env['PW_CHANNEL'] } : {}),
  },
  webServer: {
    command: 'npx vite --port 5199 --host 127.0.0.1 --strictPort',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
