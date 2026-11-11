import { test, expect, type Page } from '@playwright/test';
import { mockApi, type MockOptions } from './fixtures';

const SHOTS = process.env['CI_SHOT_DIR'] ?? 'test-results/shots';

async function open(page: Page, o: MockOptions = {}) {
  const api = await mockApi(page, o);
  await page.goto('/app');
  await page.getByRole('link', { name: 'Client Intelligence' }).click();
  await expect(page.getByTestId('client-intelligence-page')).toBeVisible();
  return api;
}
const rows = (page: Page) => page.getByTestId('client-row');
const more = async (page: Page) => { if (!(await page.getByTestId('filter-mount').isVisible())) await page.getByTestId('filters-more').click(); };
const exportAs = async (page: Page, f: 'csv' | 'json') => { await page.getByTestId('split').getByTestId('export-menu').click(); await page.getByTestId(`export-${f}`).click(); };

test('1-2 opens from the sidebar and loads KPIs, chart, distribution and inventory', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await open(page);
  await expect(page).toHaveURL(/\/client-intelligence$/);
  await expect(page.getByTestId('kpi-unique-value')).toHaveText('306');
  await expect(page.getByTestId('kpi-active-value')).toHaveText('138');
  await expect(page.getByTestId('kpi-unattributed-value')).toHaveText('8');
  await expect(page.getByTestId('kpi-ips-value')).toHaveText('412');
  await expect(rows(page)).toHaveCount(25);
  await expect(page.getByTestId('range')).toHaveText('1–25 of 31');
  await expect(page.getByTestId('activity-chart').locator('rect.ci-bar').first()).toBeVisible();
  await expect(page.getByTestId('vault-monthly')).toContainText('not request volume');
  await expect(page.getByTestId('data-sources')).toContainText('Primary');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/desktop-overview.png` });
});

test('3 switching auth backend filters inventory and chart; donut is interactive', async ({ page }) => {
  const { calls } = await open(page);
  await page.getByTestId('backend-kubernetes').click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByTestId('filter-backend')).toHaveValue('kubernetes');
  await expect.poll(() => calls.some((c) => c.url.includes('/activity') && c.url.includes('backend=kubernetes'))).toBe(true);
  await page.getByTestId('backend-kubernetes').click(); // toggle off
  await expect(rows(page)).toHaveCount(25);
  await page.getByTestId('filter-backend').selectOption('aws');
  await expect(rows(page)).toHaveCount(2);
});

test('4 filters Kubernetes clients by namespace', async ({ page }) => {
  await open(page);
  await page.getByTestId('filter-backend').selectOption('kubernetes');
  await page.getByTestId('search').fill('payments');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('payments-api');
  await expect(rows(page).first()).toContainText('namespace: payments');
});

test('5 finds a client by IP (exact IP filter and search box)', async ({ page }) => {
  await open(page);
  await page.getByTestId('filter-ip').fill('10.42.18.21');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('payments-api');
  await page.getByTestId('clear-filters').click();
  await page.getByTestId('search').fill('52.95.110.4');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('billing-lambda-prod');
});

test('6 searches AWS identities by ARN and account ID', async ({ page }) => {
  await open(page);
  await page.getByTestId('search').fill('123456789012');
  await expect(rows(page)).toHaveCount(1);
  await page.getByTestId('search').fill('arn:aws:iam::123456789012:role/billing');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('billing-lambda-prod');
});

test('7 searches GitHub clients by repository metadata', async ({ page }) => {
  await open(page);
  await page.getByTestId('search').fill('platform-infra');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('github-actions-prod');
});

test('8 + 10 selecting a client opens the drawer with backend identity and attribution evidence', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await open(page);
  await rows(page).first().click();
  const drawer = page.getByTestId('client-drawer');
  await expect(drawer).toBeVisible();
  await expect(rows(page).first()).toHaveAttribute('aria-selected', 'true');
  await expect(drawer).toContainText('payments-api');
  await expect(drawer).toContainText('Kubernetes namespace');
  await expect(drawer).toContainText('10.42.18.21');
  await drawer.getByRole('tab', { name: 'Identity' }).click();
  await expect(page.getByTestId('identity-fields')).toContainText('Service account');
  await drawer.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByTestId('ip-table')).toContainText('10.42.19.14');
  await drawer.getByRole('tab', { name: 'Evidence' }).click();
  await expect(page.getByTestId('attribution-evidence')).toContainText('resolved by kubernetes resolver');
  await expect(page.getByTestId('evidence-table')).toContainText('secret/data/payments');
  await expect(drawer.getByRole('link', { name: /Open Audit Logs/ })).toHaveAttribute('href', '/admin/audit-log');
  await drawer.getByRole('tab', { name: 'Overview' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/desktop-drawer.png` });
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});

test('missing backend fields render as Not available (never invented)', async ({ page }) => {
  await open(page);
  await page.getByTestId('search').fill('reporting-ec2');
  await expect(rows(page)).toHaveCount(1);
  await rows(page).first().click();
  const drawer = page.getByTestId('client-drawer');
  await expect(drawer.getByText('AWS account')).toBeVisible();
  await expect(drawer.getByText('Not available').first()).toBeVisible();
});

test('9 changing the time range refetches data for the new window', async ({ page }) => {
  const { calls } = await open(page);
  await page.getByTestId('range-select').selectOption('7');
  await expect.poll(() => calls.some((c) => c.url.includes('/summary') && c.url.includes('days=7'))).toBe(true);
  await expect.poll(() => calls.some((c) => c.url.includes('/clients?') && c.url.includes('days=7'))).toBe(true);
  await expect(page.getByTestId('kpi-active')).toContainText('last 7 days');
});

test('sorting, pagination and filter dropdowns', async ({ page }) => {
  await open(page);
  await expect(rows(page).first()).toContainText('payments-api'); // default: most requests
  await page.getByTestId('sort-client').click();
  await expect(rows(page).first()).toContainText('alice.smith');
  await expect(page.getByTestId('sort-client').locator('..')).toHaveAttribute('aria-sort', 'ascending');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(rows(page)).toHaveCount(6);
  await expect(page.getByTestId('range')).toHaveText('26–31 of 31');
  await page.getByRole('button', { name: 'Previous' }).click();
  await more(page);
  await page.getByTestId('filter-mount').selectOption('auth/aws-dev/');
  await expect(rows(page)).toHaveCount(1);
  await page.getByTestId('clear-filters').click();
  await more(page);
  await page.getByTestId('filter-unidentified').check();
  await expect(rows(page)).toHaveCount(2); // low-confidence token + unattributed anonymous
  await page.getByTestId('clear-filters').click();
  await page.getByTestId('search').fill('zzz-no-match');
  await expect(page.getByTestId('empty-inventory')).toBeVisible();
});

test('11 exports the current filtered inventory (request carries the filters)', async ({ page }) => {
  const { calls } = await open(page);
  await page.getByTestId('filter-backend').selectOption('kubernetes');
  await expect(rows(page)).toHaveCount(2);
  const [download] = await Promise.all([page.waitForEvent('download'), exportAs(page, 'csv')]);
  expect(download.suggestedFilename()).toMatch(/^vault-clients-\d{4}-\d{2}-\d{2}\.csv$/);
  const exportCall = calls.find((c) => c.url.includes('/export'))!;
  expect(exportCall.url).toContain('backend=kubernetes');
  expect(exportCall.url).toContain('format=csv');
  expect(exportCall.url).not.toContain('limit=');
  await expect(page.getByTestId('export-notice')).toContainText('Exported 2 clients');
  const [json] = await Promise.all([page.waitForEvent('download'), exportAs(page, 'json')]);
  expect(json.suggestedFilename()).toMatch(/\.json$/);
});

test('export failure is reported, not swallowed', async ({ page }) => {
  await open(page, { failExport: true });
  await exportAs(page, 'csv');
  await expect(page.getByTestId('export-notice')).toContainText('Export failed');
});

test('12 audit data unavailable: unknown values are shown as unavailable, never zero', async ({ page }) => {
  await open(page, { audit: false });
  await expect(page.getByTestId('kpi-active-value')).toHaveText('—');
  await expect(page.getByTestId('kpi-ips-value')).toHaveText('—');
  await expect(page.getByTestId('no-audit')).toBeVisible();
  await expect(rows(page).first().locator('td').nth(6)).toHaveText('—');
  await rows(page).first().click();
  await page.getByTestId('client-drawer').getByRole('tab', { name: 'Evidence' }).click();
  await expect(page.getByTestId('no-evidence')).toContainText('No audit evidence');
});

test('Vault activity API forbidden: permission state shown, page still usable', async ({ page }) => {
  await open(page, { activityUnavailable: true });
  await expect(page.getByTestId('activity-unavailable')).toContainText('forbidden');
  await expect(page.getByTestId('kpi-unique-value')).toHaveText('—');
  await expect(rows(page).first()).toBeVisible();
  await exportAs(page, 'csv');
  await expect(page.getByTestId('export-notice')).toContainText('partial data');
});

test('partial audit coverage is flagged on the chart', async ({ page }) => {
  await open(page, { partialCoverage: true });
  await expect(page.getByTestId('coverage-warning')).toContainText('3 days of 30 observed');
});

test('loading skeletons are shown while the inventory loads', async ({ page }) => {
  await mockApi(page, { slowClients: 800 });
  await page.goto('/client-intelligence');
  await expect(page.getByTestId('row-skeleton').first()).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
});

test('13 renders on desktop and narrow viewports without horizontal page overflow', async ({ page }) => {
  await open(page);
  for (const [w, h, name] of [[1440, 900, 'desktop'], [820, 1000, 'tablet'], [390, 844, 'mobile']] as const) {
    await page.setViewportSize({ width: w, height: h });
    await expect(page.getByTestId('client-table')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${name} page overflow`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  }
  await rows(page).first().click();
  await expect(page.getByTestId('client-drawer')).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/mobile-drawer.png` });
  await page.getByTestId('drawer-close').click();
  await expect(page.getByTestId('client-drawer')).toBeHidden();
});

test('14 slide uses a 1s transition and is disabled under prefers-reduced-motion', async ({ page }) => {
  await open(page);
  const css = (sel: string, prop: string) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  expect(await css('[data-testid=split]', 'transition-duration')).toContain('1s');
  await rows(page).first().click();
  expect(await css('.ci-drawer-wrap > .ci-drawer', 'transition-duration')).toContain('1s');
  await page.getByTestId('drawer-close').click();
  await expect(page.getByTestId('client-drawer')).toHaveCount(0, { timeout: 3000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await rows(page).first().click();
  expect(parseFloat(await css('[data-testid=split]', 'transition-duration'))).toBeLessThan(0.001);
  expect(parseFloat(await css('.ci-drawer-wrap > .ci-drawer', 'transition-duration'))).toBeLessThan(0.001);
  expect(parseFloat(await css('[data-testid=client-row]', 'transition-duration'))).toBeLessThan(0.001);
  // with reduced motion the panel is not left lingering after closing
  await page.getByTestId('drawer-close').click();
  await expect(page.getByTestId('client-drawer')).toHaveCount(0, { timeout: 500 });
});

test('detail panel is collapsed by default and slides out over 1 second when a row is clicked', async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await open(page);
  const split = page.getByTestId('split');
  const wrap = page.getByTestId('drawer-wrap');
  const width = () => wrap.evaluate((el) => el.getBoundingClientRect().width);
  const tableWidth = () => page.getByTestId('client-table').evaluate((el) => el.getBoundingClientRect().width);

  // collapsed: no drawer rendered, no column reserved for it, table uses the full width
  await expect(split).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('client-drawer')).toHaveCount(0);
  expect(await width()).toBeLessThan(1);
  const full = await tableWidth();

  // slides out over ~1s: sample the width mid-way (neither collapsed nor fully open), then fully open
  const t0 = Date.now();
  await rows(page).first().click();
  await expect(split).toHaveAttribute('data-open', 'true');
  await page.waitForTimeout(350);
  const mid = await width();
  expect(mid, 'mid-slide width').toBeGreaterThan(20);
  expect(mid, 'mid-slide width').toBeLessThan(385);
  await expect.poll(width, { timeout: 3000 }).toBeGreaterThan(388);
  expect(Date.now() - t0, 'slide took about a second').toBeGreaterThan(700);
  await page.screenshot({ path: `${SHOTS}/slide-open.png` });
  expect(await tableWidth()).toBeLessThan(full - 300); // table made room for the panel
  await expect(rows(page).first()).toHaveAttribute('aria-selected', 'true');

  // switching rows keeps the panel open and swaps its content without re-sliding
  await rows(page).nth(1).click();
  await expect(split).toHaveAttribute('data-open', 'true');
  expect(await width()).toBeGreaterThan(388);

  // closing slides back; the drawer unmounts after the slide and the table gets its width back
  await page.getByTestId('drawer-close').click();
  await expect(split).toHaveAttribute('data-open', 'false');
  await expect(rows(page).first()).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('client-drawer')).toHaveCount(0, { timeout: 3000 });
  await expect.poll(tableWidth, { timeout: 3000 }).toBeGreaterThan(full - 5);

  // Escape closes it too
  await rows(page).first().click();
  await expect(page.getByTestId('client-drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('client-drawer')).toHaveCount(0, { timeout: 3000 });
});

test('non-admin users cannot reach the page', async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ tokenInfo: { display_name: 'bob', policies: ['default'], identity_policies: [] } }) }));
  await mockApi(page).catch(() => undefined);
  await page.route('**/api/auth/me', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ tokenInfo: { display_name: 'bob', policies: ['default'], identity_policies: [] } }) }));
  await page.goto('/client-intelligence');
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('link', { name: 'Client Intelligence' })).toHaveCount(0);
});

test('transition animations: bars grow, donut draws, rows stagger, tab indicator slides, KPIs count up', async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.addInitScript(() => {
    const seen: number[] = [];
    (window as unknown as { __kpi: number[] }).__kpi = seen;
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid=kpi-unique-value]');
      const n = Number(el?.textContent?.replace(/,/g, ''));
      if (el && Number.isFinite(n) && el.textContent && seen[seen.length - 1] !== n) seen.push(n);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await mockApi(page);
  await page.goto('/client-intelligence');
  const style = (loc: ReturnType<Page['locator']>, prop: string) => loc.first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  await expect(page.locator('rect.ci-bar').first()).toBeVisible();
  expect(await style(page.locator('rect.ci-bar'), 'animation-name')).toBe('ci-grow');
  expect(await style(page.locator('circle.ci-seg'), 'animation-name')).toBe('ci-draw');
  expect(await style(page.getByTestId('client-row'), 'animation-name')).toBe('ci-rise');
  // staggered: later rows are delayed more than earlier ones
  const d0 = parseFloat(await page.getByTestId('client-row').nth(0).evaluate((el) => getComputedStyle(el).animationDelay));
  const d5 = parseFloat(await page.getByTestId('client-row').nth(5).evaluate((el) => getComputedStyle(el).animationDelay));
  expect(d5).toBeGreaterThan(d0);
  // KPI counts up through intermediate values (recorded in-page from before first paint)
  const kpi = page.getByTestId('kpi-unique-value');
  await expect(kpi).toHaveText('306');
  const seen = await page.evaluate(() => (window as unknown as { __kpi: number[] }).__kpi);
  expect(seen.length).toBeGreaterThan(1);
  expect(Math.min(...seen)).toBeLessThan(306);
  expect(seen[seen.length - 1]).toBe(306);
  // tab indicator slides (left changes, with a transition)
  await page.getByTestId('client-row').first().click();
  await page.waitForTimeout(1100);
  const ind = page.locator('.ci-tab-ind');
  await expect(ind).toBeVisible();
  const left1 = await ind.evaluate((el) => (el as HTMLElement).style.left);
  expect(await style(ind, 'transition-property')).toContain('left');
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect.poll(() => ind.evaluate((el) => (el as HTMLElement).style.left)).not.toBe(left1);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/reference-size.png` });
});

test('all entrance/chart animations are disabled under prefers-reduced-motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApi(page);
  await page.goto('/client-intelligence');
  await expect(page.locator('rect.ci-bar').first()).toBeVisible();
  for (const sel of ['rect.ci-bar', 'circle.ci-seg', '[data-testid=client-row]', '[data-testid=kpi-unique]']) {
    const dur = await page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    expect(dur, sel).toBeLessThan(0.001);
  }
  await expect(page.getByTestId('kpi-unique-value')).toHaveText('306'); // no count-up: immediate
});

const bgOf = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset['theme']);

test('global theme toggle: header, main and cards follow it everywhere and it persists', async ({ page }) => {
  await mockApi(page);
  await page.goto('/app');
  await expect(page.locator('header')).toBeVisible();
  expect(await theme(page)).toBe('light');
  expect(await bgOf(page, 'header')).toBe('rgb(255, 255, 255)');
  await page.getByTestId('theme-toggle').click();
  expect(await theme(page)).toBe('dark');
  await expect.poll(() => bgOf(page, 'header')).toBe('rgb(14, 20, 40)');
  await expect.poll(() => bgOf(page, 'main')).toBe('rgb(9, 14, 29)');
  await expect(page.getByTestId('theme-toggle')).toHaveAttribute('aria-label', 'Switch to light mode');
  // a non-Client-Intelligence page with plain Tailwind cards also goes dark
  for (const path of ['/policies', '/admin/analytics', '/secrets']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    expect(await theme(page), path).toBe('dark');
    expect(await bgOf(page, 'main'), path).toBe('rgb(9, 14, 29)');
    expect(await bgOf(page, 'header'), path).toBe('rgb(14, 20, 40)');
  }
  await page.reload();
  expect(await theme(page)).toBe('dark'); // persisted
  await page.getByTestId('theme-toggle').click();
  expect(await theme(page)).toBe('light');
  await page.reload();
  expect(await theme(page)).toBe('light');
  expect(await bgOf(page, 'main')).not.toBe('rgb(9, 14, 29)');
});

test('Client Intelligence follows the global theme in both modes', async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await mockApi(page);
  await page.goto('/client-intelligence');
  await expect(page.locator('rect.ci-bar').first()).toBeVisible();
  const root = '[data-testid=client-intelligence-page]';
  expect(await bgOf(page, root)).toBe('rgb(241, 244, 251)'); // light by default
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/theme-light.png` });
  await page.getByTestId('theme-toggle').click();
  await expect.poll(() => bgOf(page, root)).toBe('rgb(9, 14, 29)');
  expect(await bgOf(page, 'header')).toBe('rgb(14, 20, 40)');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/theme-dark.png` });
  // the sidebar menu is themed too
  expect(await bgOf(page, 'aside:not([data-testid=client-drawer])')).toBe('rgb(10, 15, 32)');
});

test('inventory shows a Role column and no longer has Client Type / Confidence', async ({ page }) => {
  await open(page);
  const table = page.getByTestId('client-table');
  const heads = (await table.locator('th').allTextContents()).map((t) => t.replace(/[↑↓↕]/g, '').trim());
  expect(heads).toEqual(['Client', 'Auth Backend', 'Role', 'Primary Identifier', 'Source IPs', 'Requests', 'Last Seen']);
  await expect(table.getByText('Client Type')).toHaveCount(0);
  await expect(table.getByText('Confidence')).toHaveCount(0);
  await expect(page.getByTestId('filter-type')).toHaveCount(0);
  await expect(page.getByTestId('filter-confidence')).toHaveCount(0);
  await expect(page.getByTestId('confidence')).toHaveCount(0);
  // role is shown for backends that have one, a dash for those that do not
  const k8s = page.locator('[data-testid=client-row][data-client-id=k1]');
  await expect(k8s.locator('td').nth(2)).toHaveText('payments');
  await expect(page.locator('[data-testid=client-row][data-client-id=a1]').locator('td').nth(2)).toHaveText('billing-lambda-prod');
  await expect(page.locator('[data-testid=client-row][data-client-id=l1]').locator('td').nth(2)).toHaveText('—');
  // searchable by role, and the drawer shows it
  await page.getByTestId('search').fill('ci-approle');
  await expect(rows(page)).toHaveCount(1);
  await rows(page).first().click();
  await expect(page.getByTestId('client-drawer').getByText('Role', { exact: true })).toBeVisible();
  await expect(page.getByTestId('client-drawer')).not.toContainText('Attribution confidence');
});

test('Role column is sortable', async ({ page }) => {
  await open(page);
  await page.getByTestId('sort-role').click();
  await expect(page.getByTestId('sort-role').locator('..')).toHaveAttribute('aria-sort', 'ascending');
  const calls: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/clients?')) calls.push(r.url()); });
  await page.getByTestId('sort-role').click();
  await expect.poll(() => calls.some((u) => u.includes('sort=role') && u.includes('dir=desc'))).toBe(true);
});

test('detail panel is organised: short overview, technical IDs on the Identity tab, no repeated or boxed-in facts', async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await open(page);
  await page.getByTestId('search').fill('payments-api');
  await expect(rows(page)).toHaveCount(1);
  await rows(page).first().click();
  const drawer = page.getByTestId('client-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('tab')).toHaveText(['Overview', 'Identity', 'Activity', 'Evidence']);

  // overview: one headline number, a handful of identity rows, network; fits without scrolling
  await expect(drawer).toContainText('requests');
  await expect(drawer.getByTestId('field-value')).toHaveCount(3); // role, namespace, service account
  await expect(drawer).not.toContainText('Mount accessor');
  await expect(drawer).not.toContainText('Vault client ID');
  await expect(drawer).not.toContainText('Attribution confidence');
  expect(await drawer.locator('[role=tabpanel]').evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  // long technical values never wrap into several lines: every value row is a single line
  for (const v of await drawer.getByTestId('field-value').all()) {
    expect(await v.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(40);
  }

  // identity tab: technical identifiers, with copy buttons
  await drawer.getByRole('tab', { name: 'Identity' }).click();
  const ident = page.getByTestId('identity-fields');
  await expect(ident).toContainText('Accessor');
  await expect(ident).toContainText('Vault client ID');
  await expect(ident).toContainText('Path');
  await expect(ident.getByRole('button', { name: /^Copy/ }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/drawer-identity.png` });

  // evidence entries are compact list items (operation + path, time, ip, request id)
  await drawer.getByRole('tab', { name: 'Evidence' }).click();
  const ev = page.getByTestId('evidence-table').locator('li').first();
  await expect(ev).toContainText('read');
  await expect(ev).toContainText('req b7d1c2e0');
  await expect(page.getByTestId('toggle-events')).toHaveCount(0); // only one event: nothing to expand
});

test('evidence list is capped at 6 with a show-all toggle; AWS overview keeps only the essentials', async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await open(page);
  await page.getByTestId('search').fill('billing-lambda-prod');
  await expect(rows(page)).toHaveCount(1);
  await rows(page).first().click();
  const drawer = page.getByTestId('client-drawer');
  // overview: role, account, ARN only (principal type/name are secondary and live on the Identity tab)
  await expect(drawer.getByTestId('field-value')).toHaveCount(3);
  await expect(drawer).not.toContainText('Principal type');
  await drawer.getByRole('tab', { name: 'Identity' }).click();
  await expect(page.getByTestId('identity-fields')).toContainText('Principal type');
  await drawer.getByRole('tab', { name: 'Evidence' }).click();
  const items = page.getByTestId('evidence-table').locator('li');
  await expect(items).toHaveCount(6);
  await page.getByTestId('toggle-events').click();
  await expect(items).toHaveCount(12);
  await expect(page.getByTestId('toggle-events')).toHaveText('Show fewer');
  await page.getByTestId('toggle-events').click();
  await expect(items).toHaveCount(6);
});
