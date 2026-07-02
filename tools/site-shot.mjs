import { chromium } from '@playwright/test';
const shots = '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots';
const browser = await chromium.launch();
const views = [[1440, 900, 'desktop'], [768, 1024, 'tablet'], [375, 780, 'mobile']];
const pages = [['/', 'home'], ['/guides/', 'guides'], ['/community/', 'community']];
for (const [w, h, vname] of views) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  for (const [path, pname] of pages) {
    await page.goto(`http://localhost:8901${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${shots}/${pname}-${vname}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log('done');
