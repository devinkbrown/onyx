import { chromium } from '@playwright/test';
const shots = '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
await page.goto('https://eshmaki.me/', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${shots}/nav-mobile.png`, clip: { x: 0, y: 0, width: 390, height: 70 } });
const geo = await page.evaluate(() => {
  const items = document.querySelectorAll('.wordmark, .nav-cta, .nav-toggle, .nav-cta-group, .nav-row');
  return [...items].map((e) => {
    const r = e.getBoundingClientRect();
    return `${e.className.toString().slice(0, 24)} x=${Math.round(r.x)} y=${Math.round(r.y)} w=${Math.round(r.width)} h=${Math.round(r.height)}`;
  });
});
console.log(geo.join('\n'));
await browser.close();
