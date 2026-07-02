// Screenshot the new HomeView + ChannelBrowser (dev server, seeded state,
// stats route stubbed).  node tools/home-shot.mjs http://localhost:3000
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://localhost:3000';
const shots = '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots';

const now = Math.floor(Date.now() / 1000);
const statsPayload = {
  generated_at: now - 20, network: 'IRCXNet', node: 'eshmaki.me',
  channels: [
    { channel: '#root', messages: 4821, active_users: 14, last_active: now - 120, topic: "the network's living room — welcome home", spark: [12,17,25,31,22,40,38,52,44,61,58,72,66,89] },
    { channel: '#zig', messages: 1932, active_users: 7, last_active: now - 800, topic: 'comptime enjoyers anonymous', spark: [5,8,12,9,14,11,18,15,22,19,25,21,28,24] },
    { channel: '#music', messages: 746, active_users: 4, last_active: now - 8000, topic: '', spark: [2,0,4,3,6,1,8,5,3,7,4,9,6,11] },
    { channel: '#comicchat', messages: 214, active_users: 2, last_active: now - 90000, topic: "panels or it didn't happen", spark: [1,2,0,3,1,2,4,1,0,2,3,1,2,5] },
  ],
};

function seed() {
  const mod = /** @type {any} */ (window).__onyx;
  const store = mod.store;
  const init = store.getInitialState();
  store.setState({
    ...init,
    channels: new Map(),
    activeView: { kind: 'home' },
    connectionStatus: 'connected',
    ourNick: 'kain',
    networkName: 'IRCXNet',
    joinHistory: ['#mesh', '#design'],
    channelList: [
      { name: '#root', count: 14, topic: "the network's living room — welcome home" },
      { name: '#zig', count: 7, topic: 'comptime enjoyers anonymous' },
      { name: '#music', count: 4, topic: '' },
      { name: '#comicchat', count: 2, topic: "panels or it didn't happen" },
    ],
    channelListLoading: false,
  }, true);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.route('**/stats/data/index.json', (route) =>
  route.fulfill({ contentType: 'application/json', body: JSON.stringify(statsPayload) }));
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => !!(window).__onyx, { timeout: 15000 });
await page.evaluate(seed);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${shots}/onyx-home.png`, fullPage: false });
await page.getByRole('button', { name: 'Browse all channels' }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${shots}/onyx-browser.png`, fullPage: false });
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
