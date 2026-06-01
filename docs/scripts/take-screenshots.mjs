/**
 * Playwright screenshot script for VaultLens documentation.
 * Run: node docs/scripts/take-screenshots.mjs
 * Requires VaultLens running at http://localhost:3001 with root token.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3001';
const OUT_DIR = path.resolve('docs/public/screenshots');
const TOKEN = 'root';

fs.mkdirSync(OUT_DIR, { recursive: true });

async function save(page, name, opts = {}) {
  const { clip } = opts;
  const buf = await page.screenshot({ fullPage: false, clip });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), buf);
  console.log(`  ✓ ${name}.png`);
}

async function dismissWizard(page) {
  const skipBtn = page.getByRole('button', { name: /skip for now/i });
  if (await skipBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await skipBtn.click();
    await page.waitForTimeout(800);
  }
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Token' }).click();
  await page.locator('#token').fill(TOKEN);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(`${BASE_URL}/setup`, { timeout: 8000 }).catch(() => {});
  // If redirected to setup, skip it (system token not configured in test)
  const url = page.url();
  if (url.includes('/setup')) {
    // Navigate directly to dashboard - skip setup for screenshot purposes
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(1000);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

try {
  // ── Login page ────────────────────────────────────────────────────────────
  console.log('📸 Login...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  // Ensure Token tab is active for screenshot
  const tokenBtn = page.getByRole('button', { name: 'Token' });
  if (await tokenBtn.isVisible()) await tokenBtn.click();
  await page.waitForTimeout(400);
  await save(page, 'login');

  // ── Log in ────────────────────────────────────────────────────────────────
  await page.locator('#token').fill(TOKEN);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(2000);

  // Dismiss any config wizard / setup screen
  const skipBtn = page.getByRole('button', { name: /skip for now/i });
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click();
    await page.waitForTimeout(1000);
  }
  const afterLogin = page.url();
  if (afterLogin.includes('/setup')) {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  console.log('📸 Dashboard...');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissWizard(page);
  await save(page, 'dashboard');

  // ── Secrets engines list ──────────────────────────────────────────────────
  console.log('📸 Secrets...');
  await page.goto(`${BASE_URL}/secrets`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissWizard(page);
  await save(page, 'secrets-engines');

  // ── Navigate into the kv/ KV engine ─────────────────────────────────────
  await page.goto(`${BASE_URL}/secrets/kv`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await save(page, 'secrets-list');

  // View a specific seeded secret
  await page.goto(`${BASE_URL}/secrets/view/kv/product/service/nprd/secret`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await save(page, 'secret-detail');

  // ── Policies ──────────────────────────────────────────────────────────────
  console.log('📸 Policies...');
  await page.goto(`${BASE_URL}/policies`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissWizard(page);
  await save(page, 'policies');

  // ── Auth Methods ──────────────────────────────────────────────────────────
  console.log('📸 Auth methods...');
  await page.goto(`${BASE_URL}/access/auth-methods`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissWizard(page);
  await save(page, 'auth-methods');

  // ── Identity ──────────────────────────────────────────────────────────────
  console.log('📸 Identity...');
  await page.goto(`${BASE_URL}/access/entities`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissWizard(page);
  await save(page, 'entities');

  await page.goto(`${BASE_URL}/access/groups`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await save(page, 'groups');

  // ── Visualizations ────────────────────────────────────────────────────────
  console.log('📸 Visualizations...');
  await page.goto(`${BASE_URL}/visualizations`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await dismissWizard(page);
  await save(page, 'visualizations');

  // ── My Identity ───────────────────────────────────────────────────────────
  console.log('📸 My Identity...');
  await page.goto(`${BASE_URL}/identity`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await dismissWizard(page);
  await save(page, 'my-identity');

  // ── Permission Tester ─────────────────────────────────────────────────────
  console.log('📸 Permission tester...');
  await page.goto(`${BASE_URL}/admin/permission-tester`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissWizard(page);
  await save(page, 'permission-tester');

  // ── Analytics ─────────────────────────────────────────────────────────────
  console.log('📸 Analytics...');
  await page.goto(`${BASE_URL}/admin/analytics`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await dismissWizard(page);
  await save(page, 'analytics');

  // ── Audit Log ─────────────────────────────────────────────────────────────
  console.log('📸 Audit log...');
  await page.goto(`${BASE_URL}/admin/audit-log`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissWizard(page);
  await save(page, 'audit-log');

  // ── Secret Rotation ───────────────────────────────────────────────────────
  console.log('📸 Rotation...');
  await page.goto(`${BASE_URL}/admin/rotation`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissWizard(page);
  await save(page, 'rotation');

  // ── Backup & Restore ──────────────────────────────────────────────────────
  console.log('📸 Backup...');
  await page.goto(`${BASE_URL}/admin/backup`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissWizard(page);
  await save(page, 'backup-restore');

  // ── Webhooks ──────────────────────────────────────────────────────────────
  console.log('📸 Webhooks...');
  await page.goto(`${BASE_URL}/admin/hooks`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissWizard(page);
  await save(page, 'webhooks');

  // ── Share a Secret ────────────────────────────────────────────────────────
  console.log('📸 Share secret...');
  await page.goto(`${BASE_URL}/tools/share`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissWizard(page);
  await save(page, 'share-secret');

  // ── Branding ──────────────────────────────────────────────────────────────
  console.log('📸 Branding...');
  await page.goto(`${BASE_URL}/admin/branding`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissWizard(page);
  await save(page, 'branding');

  console.log('\n✅ All screenshots saved to', OUT_DIR);
} catch (err) {
  console.error('Error:', err.message);
} finally {
  await browser.close();
}
