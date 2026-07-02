// Screenshot the typing indicator: seed a channel with another user typing.
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://localhost:3000';
function seed() {
  const mod = /** @type {any} */ (window).__onyx;
  const store = mod.store;
  const init = store.getInitialState();
  const users = new Map([
    ['aurora', { nick: 'aurora', modes: new Set(['q']) }],
    ['vesper', { nick: 'vesper', modes: new Set(['o']) }],
  ]);
  const t = (m) => new Date(Date.now() - m * 60000);
  const messages = [
    { id: 'm1', from: 'aurora', text: 'pushing the typing indicator now', time: t(3), type: 'msg', target: '#root' },
    { id: 'm2', from: 'vesper', text: 'finally — that was dead code for ages', time: t(1), type: 'msg', target: '#root' },
  ];
  const channels = new Map([['#root', { name: '#root', topic: 'build channel', topicSetBy: 'aurora', topicSetAt: null, modes: '+nt', users, unread: 0, highlights: 0, createdAt: null, messages }]]);
  store.setState({
    ...init, channels,
    typingUsers: new Map([['#root', new Map([['aurora', Date.now() + 6000]])]]),
    activeView: { kind: 'channel', channel: '#root' },
    connectionStatus: 'connected', ourNick: 'kain', networkName: 'IRCXNet', showMemberList: true,
  }, true);
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 }, colorScheme: 'dark' });
const page = await ctx.newPage();
await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => !!(window).__onyx, { timeout: 15000 });
await page.evaluate(seed);
await page.waitForSelector('.shell-typing-indicator', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/typing.png' });
const txt = await page.locator('.shell-typing-indicator').textContent().catch(() => '(none)');
console.log('typing indicator text:', JSON.stringify(txt));
await browser.close();
