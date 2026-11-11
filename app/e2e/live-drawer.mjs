// Dev helper: opens a client (by display name, default first row) in the REAL app and screenshots just the detail panel.
//   node e2e/live-drawer.mjs <out.png> [clientName] [tab]    (env THEME=dark|light)
import { chromium } from '@playwright/test';
const [out, name, tab] = process.argv.slice(2);
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1672, height: 1500 }, deviceScaleFactor: 2 });
await page.addInitScript((t) => window.localStorage.setItem('vaultlens.theme', t), process.env.THEME || 'dark');
const base = 'http://localhost:3001';
await page.goto(`${base}/login`);
await page.request.post(`${base}/api/auth/login`, { data: { method: 'token', token: 'root' } });
await page.context().addCookies((await page.request.storageState()).cookies);
await page.goto(`${base}/client-intelligence`);
await page.getByTestId('client-row').first().waitFor();
if (name) await page.getByTestId('search').fill(name);
await page.waitForTimeout(800);
await page.getByTestId('client-row').first().click();
await page.waitForTimeout(1500);
if (tab) { await page.getByRole('tab', { name: tab }).click(); await page.waitForTimeout(500); }
await page.getByTestId('client-drawer').screenshot({ path: out });
await browser.close();
