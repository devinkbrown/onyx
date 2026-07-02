import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.goto('https://eshmaki.me/app', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.locator('input').first().fill('nlprobe' + Math.floor(Math.random() * 999));
await page.keyboard.press('Enter');
await page.waitForTimeout(7000);
const members = await page.evaluate(() =>
  [...document.querySelectorAll('.shell-member-row')].map((r) => r.getAttribute('aria-label')).slice(0, 20)
);
console.log('member rows:', JSON.stringify(members, null, 1));
const memberPanelText = await page.evaluate(() => document.querySelector('.shell-members, [class*="members"]')?.textContent?.slice(0, 400));
console.log('panel text:', memberPanelText);
await page.screenshot({ path: '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots/nicklist-live.png' });
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
