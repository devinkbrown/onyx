import { chromium } from '@playwright/test';
const shots = '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
await page.goto('https://eshmaki.me/app', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.locator('input').first().fill('mrib' + Math.floor(Math.random() * 999));
await page.keyboard.press('Enter');
await page.waitForTimeout(7000);
await page.screenshot({ path: `${shots}/ribbon-mobile.png`, clip: { x: 0, y: 0, width: 390, height: 120 } });
const geo = await page.evaluate(() => {
  const row = document.querySelector('.shell-ribbon, [class*="ribbon"]');
  const items = document.querySelectorAll('.shell-ribbon-inbox, .shell-ribbon-bell, [data-testid="ribbon-account-chip"], .shell-ribbon-conn, .shell-ribbon-divider, [class*="ribbon"] button');
  return [...items].slice(0, 12).map((e) => {
    const r = e.getBoundingClientRect();
    return `${(e.className.toString() || e.tagName).slice(0, 36)} x=${Math.round(r.x)} y=${Math.round(r.y)} w=${Math.round(r.width)} h=${Math.round(r.height)}`;
  }).concat(row ? [`ROW h=${Math.round(row.getBoundingClientRect().height)}`] : []);
});
console.log(geo.join('\n'));
await browser.close();
