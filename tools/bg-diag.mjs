// Diagnose the background engine: is the canvas drawing, and is it covered by the
// opaque .shell veil? Screenshots (a) as-is, (b) with the veil forced transparent.
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://localhost:3000';
const bg = process.argv[3] ?? 'aurora';

function seed(bg) {
  const store = /** @type {any} */ (window).__onyx.store;
  const init = store.getInitialState();
  const users = new Map([['aurora', { nick: 'aurora', modes: new Set(['q']) }]]);
  const channels = new Map([['#bg', { name: '#bg', topic: 'bg test', topicSetBy: 'aurora', topicSetAt: null, modes: '+nt', users, unread: 0, highlights: 0, createdAt: null, messages: [] }]]);
  store.setState({ ...init, channels, activeView: { kind: 'channel', channel: '#bg' }, connectionStatus: 'connected', ourNick: 'kain', networkName: 'IRCXNet', showMemberList: true }, true);
  store.getState().setBackground(bg);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 760 }, colorScheme: 'dark' });
const page = await ctx.newPage();
await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => !!(window).__onyx, { timeout: 15000 });
await page.evaluate(seed, bg);
await page.waitForTimeout(1200);

const info = await page.evaluate(() => {
  const c = document.querySelector('canvas[data-background-canvas]');
  const shell = document.querySelector('.shell');
  return {
    canvasExists: !!c,
    canvasSize: c ? { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight } : null,
    canvasDataId: c?.dataset.backgroundId,
    canvasKind: c?.dataset.backgroundKind,
    shellBg: shell ? getComputedStyle(shell).backgroundImage.slice(0, 80) : null,
  };
});
console.log('diag:', JSON.stringify(info, null, 2));

await page.screenshot({ path: '/tmp/bg-asis.png' });

// Force the shell veil transparent to reveal whatever the canvas is painting.
await page.addStyleTag({ content: '.shell{background:transparent !important} .shell::before,.shell::after{display:none !important}' });
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/bg-revealed.png' });
console.log('shots: /tmp/bg-asis.png, /tmp/bg-revealed.png');
await browser.close();
