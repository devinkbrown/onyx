// Screenshot the feed loading skeleton (channel with history in flight, no msgs).
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://localhost:3000';
function seed() {
  const mod = /** @type {any} */ (window).__onyx;
  const store = mod.store;
  const init = store.getInitialState();
  const users = new Map();
  const channels = new Map([['#loading', {
    name: '#loading', topic: 'fetching history…', topicSetBy: 'aurora', topicSetAt: null,
    modes: '+nt', users, unread: 0, highlights: 0, createdAt: null, messages: [],
  }]]);
  store.setState({
    ...init, channels,
    historyLoading: new Map([['#loading', true]]),
    activeView: { kind: 'channel', channel: '#loading' },
    connectionStatus: 'connected', ourNick: 'kain', networkName: 'IRCXNet', showMemberList: true,
  }, true);
}
const browser = await chromium.launch();
for (const w of [1440, 390]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: w < 700 ? 740 : 810 },
    deviceScaleFactor: w < 700 ? 2 : 1, isMobile: w < 700, hasTouch: w < 700, colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !!(window).__onyx, { timeout: 15000 });
  await page.evaluate(seed);
  await page.waitForSelector('.shell-feed-loading', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/skel-${w}.png` });
  console.log(`skel-${w} ok`);
  await ctx.close();
}
await browser.close();
