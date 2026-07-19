import { chromium } from '@playwright/test';
const shots = '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.route('**/linkpreview**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
  url: 'https://github.com/devinkbrown/onyx-server', title: 'GitHub - devinkbrown/onyx: Pure-Zig, clean-slate IRC daemon',
  description: 'IRCv3 · IRCX · SASL · in-process services · WebSocket · voice/video over the post-quantum Cadence mesh.',
  image: '', site: 'GitHub' }) }));
await page.goto('http://localhost:3000/app', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window).__onyx);
await page.evaluate(() => {
  const store = window.__onyx.store;
  const init = store.getInitialState();
  const users = new Map([['kain', { nick: 'kain', modes: new Set(['q']) }], ['trev', { nick: 'trev', modes: new Set(['o']) }]]);
  const t = (m) => new Date(Date.now() - m * 60000);
  const messages = [
    { id: 'm1', from: 'trev', text: 'check out the daemon repo: https://github.com/devinkbrown/onyx-server', time: t(9), type: 'msg', target: '#root' },
    { id: 'm2', from: 'kain', text: 'nice — link previews land today', time: t(2), type: 'msg', target: '#root' },
  ];
  store.setState({ ...init,
    channels: new Map([['#root', { name: '#root', topic: 'the living room', topicSetBy: 'kain', topicSetAt: null, modes: '+nt', users, unread: 0, highlights: 0, createdAt: null, messages }]]),
    activeView: { kind: 'channel', channel: '#root' },
    connectionStatus: 'connected', ourNick: 'kain', networkName: 'IRCXNet',
    notifications: [
      { id: 'n1', type: 'mention', from: 'trev', channel: '#root', text: 'kain: the mesh relinked clean', at: new Date(Date.now() - 300000) },
      { id: 'n2', type: 'dm', from: 'mizu', text: 'got a sec?', at: new Date(Date.now() - 1200000) },
      { id: 'n3', type: 'system', text: 'Connected to eshmaki.me', at: new Date(Date.now() - 3600000) },
    ],
    readNotificationIds: new Set(),
  }, true);
});
await page.waitForTimeout(1400);
await page.screenshot({ path: `${shots}/wave-chat.png` });
await page.getByTestId('ribbon-bell').click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${shots}/wave-inbox.png` });
console.log('done');
await browser.close();
