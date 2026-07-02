import { chromium } from '@playwright/test';
const shots = '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto('https://eshmaki.me/app', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.locator('input').first().fill('ribprobe' + Math.floor(Math.random() * 999));
await page.keyboard.press('Enter');
await page.waitForTimeout(6500);
await page.screenshot({ path: `${shots}/ribbon-live.png`, clip: { x: 640, y: 0, width: 800, height: 56 } });
const geo = await page.evaluate(() => {
  const els = document.querySelectorAll('.shell-ribbon-bell, [data-testid="ribbon-account-chip"], .shell-ribbon-conn, .onyx-popover__trigger');
  return [...els].map((e) => { const r = e.getBoundingClientRect(); return `${e.className.toString().slice(0,30)} y=${Math.round(r.y)} h=${Math.round(r.height)}`; });
});
console.log(geo.join('\n'));
await browser.close();
