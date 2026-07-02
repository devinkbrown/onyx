import { chromium } from '@playwright/test';
const shots = '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.goto('http://localhost:3000/app', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window).__onyx);
await page.evaluate(() => {
  const store = window.__onyx.store;
  const init = store.getInitialState();
  const users = new Map([['kain', { nick: 'kain', modes: new Set(['q']) }], ['trev', { nick: 'trev', modes: new Set(['o']) }]]);
  const t = (m) => new Date(Date.now() - m * 60000);
  const msgs = [
    { id: 'h1', from: 'trev', text: 'hover a row — the action pill should surface here', time: t(6), type: 'msg', target: '#root' },
    { id: 'h2', from: 'kain', text: 'react, reply, edit, more — no right-click needed', time: t(1), type: 'msg', target: '#root' },
  ];
  store.setState({ ...init,
    channels: new Map([['#root', { name: '#root', topic: 'the living room', topicSetBy: 'kain', topicSetAt: null, modes: '+nt', users, unread: 0, highlights: 0, createdAt: null, messages: msgs }]]),
    activeView: { kind: 'channel', channel: '#root' },
    connectionStatus: 'connected', ourNick: 'kain', networkName: 'IRCXNet', canEditMessages: true,
  }, true);
});
await page.waitForTimeout(1000);
await page.locator('.shell-msg-group').last().hover();
await page.waitForTimeout(500);
await page.screenshot({ path: `${shots}/hover-actions.png`, clip: { x: 220, y: 60, width: 1010, height: 420 } });
console.log('done');
await browser.close();
