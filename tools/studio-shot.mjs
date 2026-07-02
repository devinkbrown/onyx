import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://localhost:3000';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
const p = await ctx.newPage();
await p.goto(`${base}/appearance`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForSelector('[data-testid="theme-studio"]', { timeout: 10000 }).catch(()=>{});
await p.waitForTimeout(800);
await p.screenshot({ path: '/tmp/studio-1.png', fullPage: false });
// switch to a known light theme to see contrast change, then edit a token + revert
const status = await p.locator('[data-testid="ts-audit-status"]').textContent().catch(()=>'(none)');
const auditRows = await p.locator('.ts-audit__row').count().catch(()=>0);
console.log('audit status:', JSON.stringify(status), 'rows:', auditRows);
// click a base theme chip to verify audit reacts
await p.locator('[data-testid="ts-theme-chip-pearl"]').click().catch(()=>{});
await p.waitForTimeout(400);
const status2 = await p.locator('[data-testid="ts-audit-status"]').textContent().catch(()=>'(none)');
console.log('after pearl, audit status:', JSON.stringify(status2));
await p.screenshot({ path: '/tmp/studio-2.png', fullPage: false });
await b.close();
