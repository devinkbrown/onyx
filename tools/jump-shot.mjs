// Screenshot the jump-to-latest "N new" pill: seed many messages, scroll up,
// append new ones, capture.
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://localhost:3000';

function seed(n) {
  const mod = /** @type {any} */ (window).__onyx;
  const store = mod.store;
  const init = store.getInitialState();
  const users = new Map([['aurora', { nick: 'aurora', modes: new Set(['q']) }]]);
  const t = (m) => new Date(Date.now() - m * 60000);
  const mk = (i) => ({ id: 'm' + i, from: i % 2 ? 'aurora' : 'vesper', text: 'message line number ' + i + ' in the build channel', time: t(n - i), type: 'msg', target: '#jump' });
  const messages = Array.from({ length: n }, (_, i) => mk(i));
  const channels = new Map([['#jump', { name: '#jump', topic: 'scroll demo', topicSetBy: 'aurora', topicSetAt: null, modes: '+nt', users, unread: 0, highlights: 0, createdAt: null, messages }]]);
  store.setState({ ...init, channels, activeView: { kind: 'channel', channel: '#jump' }, connectionStatus: 'connected', ourNick: 'kain', networkName: 'IRCXNet', showMemberList: false }, true);
}
function append(k) {
  const store = /** @type {any} */ (window).__onyx.store;
  const s = store.getState();
  const ch = s.channels.get('#jump');
  const base = ch.messages.length;
  const extra = Array.from({ length: k }, (_, i) => ({ id: 'x' + i, from: 'newcomer', text: 'fresh message ' + i, time: new Date(), type: 'msg', target: '#jump' }));
  const channels = new Map(s.channels);
  channels.set('#jump', { ...ch, messages: [...ch.messages, ...extra] });
  store.setState({ channels });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, colorScheme: 'dark' });
const page = await ctx.newPage();
await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => !!(window).__onyx, { timeout: 15000 });
await page.evaluate(seed, 30);
await page.waitForSelector('.shell-feed', { timeout: 5000 });
await page.waitForTimeout(400);
// scroll to top so we're not at bottom
await page.locator('.shell-feed').evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
await page.waitForTimeout(300);
await page.evaluate(append, 7);
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/jump-unread.png' });
const pill = await page.locator('.shell-jump-latest').textContent().catch(() => '(none)');
console.log('pill text:', JSON.stringify(pill));
await browser.close();
