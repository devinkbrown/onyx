import { chromium } from '@playwright/test';
const base = 'http://localhost:3000';
const bg = process.argv[2] ?? 'aurora';
function seed(bg) {
  const store = window.__onyx.store;
  store.setState({ ...store.getInitialState(), activeView: { kind: 'home' }, connectionStatus: 'connected', ourNick: 'kain' }, true);
  store.getState().setBackground(bg);
}
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 800, height: 500 }, colorScheme: 'dark' });
const p = await ctx.newPage();
await p.goto(`${base}/app`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__onyx);
await p.evaluate(seed, bg);
await p.waitForTimeout(1500);
// sample a few canvas pixels via a 2D readback of the same canvas
const px = await p.evaluate(() => {
  const c = document.querySelector('canvas[data-background-canvas]');
  if (!c) return 'no-canvas';
  const g = c.getContext('2d');
  if (!g) return 'no-2d-ctx';
  const pts = [[0.5,0.5],[0.2,0.3],[0.8,0.7]].map(([x,y]) => {
    const d = g.getImageData(Math.floor(c.width*x), Math.floor(c.height*y), 1, 1).data;
    return `rgba(${d[0]},${d[1]},${d[2]},${d[3]})`;
  });
  return pts;
});
console.log(bg, 'canvas pixels:', JSON.stringify(px));
await p.locator('canvas[data-background-canvas]').screenshot({ path: `/tmp/canvas-${bg}.png` });
await b.close();
