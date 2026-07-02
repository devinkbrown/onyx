import { chromium } from '@playwright/test';
const shots = '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 500 } })).newPage();
await page.goto('https://eshmaki.me/', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${shots}/nav-live.png`, clip: { x: 0, y: 0, width: 1440, height: 140 } });
const geo = await page.evaluate(() => {
  const row = document.querySelector('.nav-row');
  const container = row?.parentElement;
  const r = row?.getBoundingClientRect();
  const cs = container ? getComputedStyle(container) : null;
  return { row: r ? { x: r.x, w: r.width } : null, containerMax: cs?.maxWidth, containerMargin: cs?.marginLeft + '/' + cs?.marginRight, viewport: window.innerWidth };
});
console.log(JSON.stringify(geo));
await browser.close();
