import { chromium } from '@playwright/test';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 }, colorScheme: 'dark' });
const p = await ctx.newPage();
await p.goto('http://localhost:3000/appearance', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('[data-testid="theme-studio"]', { timeout: 10000 });
await p.waitForTimeout(500);
// edit a token to make it "modified" so the revert button shows, then audit shot
await p.locator('[data-testid="ts-contrast-audit"]').scrollIntoViewIfNeeded();
await p.waitForTimeout(300);
await p.locator('[data-testid="ts-contrast-audit"]').screenshot({ path: '/tmp/audit.png' });
// open Text tab + change a token, confirm revert button appears
await p.getByRole('tab', { name: /text/i }).click().catch(()=>{});
await p.waitForTimeout(200);
const swatch = p.locator('.ts-token-control input[type=color]').first();
await swatch.evaluate((el) => { el.value = '#334455'; el.dispatchEvent(new Event('input', { bubbles: true })); }).catch(()=>{});
await p.waitForTimeout(300);
const revertCount = await p.locator('.ts-token-revert').count();
console.log('revert buttons after edit:', revertCount);
await b.close();
