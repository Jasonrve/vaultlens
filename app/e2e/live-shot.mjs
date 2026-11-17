// Dev helper: screenshots the REAL running app (http://localhost:3001) after a token login.
//   node e2e/live-shot.mjs <out.png> [width] [height] [clickFirstRow]   (env: PAGE=/path THEME=dark|light)
import { chromium } from '@playwright/test';

const [out, w = '1672', h = '941', click] = process.argv.slice(2);
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const theme = process.env.THEME || 'light';
await page.addInitScript((t) => window.localStorage.setItem('vaultlens.theme', t), theme);
const base = process.env.BASE_URL || 'http://localhost:3001';
await page.goto(`${base}/login`);
await page.request.post(`${base}/api/auth/login`, { data: { method: 'token', token: 'root' } });
await page.context().addCookies((await page.request.storageState()).cookies);
const path = process.env.PAGE || '/client-intelligence';
await page.goto(`${base}${path}`);
if (path === '/client-intelligence') await page.getByTestId('client-intelligence-page').waitFor();
await page.waitForTimeout(1500);
if (click) {
  await page.getByTestId('client-row').first().click();
  await page.waitForTimeout(1600);
}
await page.screenshot({ path: out });
await browser.close();
