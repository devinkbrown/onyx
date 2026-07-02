import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0,160)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e}`));
await page.goto('https://eshmaki.me/app', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.locator('input').first().fill('uiprobe' + Math.floor(Math.random() * 999));
await page.keyboard.press('Enter');
await page.waitForTimeout(6000);

// 1. Account chip (profile)
const chip = page.getByTestId('ribbon-account-chip');
console.log('account chip visible:', await chip.isVisible().catch(() => false));
await chip.click().catch((e) => console.log('chip click err:', String(e).slice(0,120)));
await page.waitForTimeout(1500);
const acctOpen = await page.evaluate(() => ({
  sheet: !!document.querySelector('.onyx-sheet'),
  acctPanel: !!document.querySelector('[class*="acct"]'),
}));
console.log('after account-chip click:', JSON.stringify(acctOpen));
await page.screenshot({ path: '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots/probe-account.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// 2. Member list profile mini-card
const member = page.locator('.shell-member-row').first();
console.log('member row visible:', await member.isVisible().catch(() => false));
await member.click().catch((e) => console.log('member click err:', String(e).slice(0,120)));
await page.waitForTimeout(1200);
const cardOpen = await page.evaluate(() => !!document.querySelector('.onyx-popover [class*="member"], [class*="mini-card"], [class*="membercard"]'));
console.log('member mini-card open:', cardOpen);
await page.screenshot({ path: '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots/probe-member.png' });

console.log('--- errors:'); for (const l of logs.slice(-10)) console.log(l);
await browser.close();
