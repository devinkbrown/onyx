import { chromium } from '@playwright/test';
const base = 'http://localhost:3000';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: 'dark' });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(`${base}/appearance`, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('[data-testid="theme-studio"]', { timeout: 10000 });
await p.waitForTimeout(400);

const readVar = (name) => p.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

// 1. every built-in theme applies (distinct --ink across themes)
const ids = await p.$$eval('[data-testid^="ts-theme-chip-"]:not([data-testid*="custom"])', (els) =>
  els.map((e) => e.getAttribute('data-testid').replace('ts-theme-chip-','')).filter((x)=>!x.startsWith('custom:')));
const inks = {};
let applied = 0;
for (const id of ids) {
  await p.locator(`[data-testid="ts-theme-chip-${id}"]`).click();
  await p.waitForTimeout(120);
  const ink = await readVar('--ink');
  inks[id] = ink;
  if (ink) applied++;
}
const distinctInks = new Set(Object.values(inks)).size;

// 2. edit a token + save as a custom theme
await p.getByRole('tab', { name: /accents/i }).click().catch(()=>{});
await p.waitForTimeout(150);
await p.locator('.ts-token-control input[type=color]').first()
  .evaluate((el) => { el.value = '#ff3366'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await p.waitForTimeout(150);
const modifiedBadge = await p.locator('.ts-badge--modified').count();
await p.locator('[data-testid="ts-save-btn"]').click();
await p.waitForTimeout(150);
await p.locator('.ts-save-input').fill('E2E Test Theme');
await p.locator('[data-testid="ts-save-confirm"]').click();
await p.waitForTimeout(300);
const customChip = await p.locator('[data-testid^="ts-theme-chip-custom:"]').count();

// 3. persistence across reload
const stored = await p.evaluate(() => localStorage.getItem('ruri:custom-themes'));
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForSelector('[data-testid="theme-studio"]', { timeout: 10000 });
await p.waitForTimeout(400);
const customChipAfterReload = await p.locator('[data-testid^="ts-theme-chip-custom:"]').count();

// 4. contrast audit present + reactive
const auditRows = await p.locator('.ts-audit__row').count();

console.log(JSON.stringify({
  themeCount: ids.length, applied, distinctInks,
  modifiedBadge, customChip, customChipAfterReload,
  storedHasTheme: !!stored && stored.includes('E2E Test Theme'),
  auditRows, errs,
}, null, 2));
await b.close();
