import { chromium } from '@playwright/test';
const shots = '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('https://eshmaki.me/', { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 70)); }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${shots}/live-home.png`, fullPage: true });
await page.goto('https://eshmaki.me/stats/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${shots}/live-stats.png`, fullPage: true });
await browser.close();
console.log('done');
