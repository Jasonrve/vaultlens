// Dev helper: renders the real icon components large, light and dark, from the running dev server.
import { chromium } from '@playwright/test';
const [out] = process.argv.slice(2);
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1672, height: 1400 }, deviceScaleFactor: 3 });
await page.addInitScript((t) => window.localStorage.setItem('vaultlens.theme', t), process.env.THEME || 'dark');
const base = 'http://localhost:3001';
await page.goto(`${base}/login`);
await page.request.post(`${base}/api/auth/login`, { data: { method: 'token', token: 'root' } });
await page.context().addCookies((await page.request.storageState()).cookies);
await page.goto(`${base}/client-intelligence`);
await page.getByTestId('client-row').first().waitFor();
await page.getByTestId('sort-client').click();
await page.waitForTimeout(1500);
const legend = page.getByTestId('backend-distribution');
await legend.screenshot({ path: out.replace('.png', '-legend.png') });
await page.getByTestId('client-table').screenshot({ path: out.replace('.png', '-table.png'), clip: undefined });
await browser.close();
