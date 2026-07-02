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
  const mkU = (nick, modes = []) => [nick.toLowerCase(), { nick, modes: new Set(modes) }];
  const users = new Map([mkU('kain', ['q']), mkU('trev', ['o']), mkU('mizu', ['v']), mkU('kagura'), mkU('yoroi')]);
  const t = (m) => new Date(Date.now() - m * 60000);
  const y = (m) => new Date(Date.now() - 86400000 - m * 60000);
  const msgs = [
    { id: 'y1', from: 'yoroi', text: 'certfp binding worked first try, nice docs', time: y(200), type: 'msg', target: '#root' },
    { id: 'y2', from: 'mizu', text: 'the guides page carried me through the whole setup', time: y(120), type: 'msg', target: '#root' },
    { id: 'a1', from: 'trev', text: 'pushed the mesh relink fix — both heads reconverge clean now', time: t(48), type: 'msg', target: '#root' },
    { id: 'a2', from: 'trev', text: 'took 3 tries but the anti-entropy pass finally behaves', time: t(47), type: 'msg', target: '#root' },
    { id: 'a3', from: 'kain', text: 'beautiful. shipping the chat overhaul tonight — glacier accents, new composer, channel timestamps', time: t(30), type: 'msg', target: '#root' },
    { id: 'a4', from: 'mizu', text: 'the old gold always felt like a different app tbh', time: t(24), type: 'msg', target: '#root' },
    { id: 'a5', from: 'kagura', text: 'kain: can you grant me a persona for the poetry channel?', time: t(9), type: 'msg', target: '#root', highlight: true },
    { id: 'a6', from: 'kain', text: 'done — check /VHOST LIST, you should see poet.circle/kagura', time: t(2), type: 'msg', target: '#root' },
  ];
  const chan = (name, msgs2 = [], unread = 0, hi = 0) => [name.toLowerCase(), { name, topic: 'the network’s living room — welcome home', topicSetBy: 'kain', topicSetAt: null, modes: '+nt', users, unread, highlights: hi, createdAt: null, messages: msgs2 }];
  const now = Date.now();
  store.setState({ ...init,
    channels: new Map([chan('#root', msgs), chan('#zig', [], 3), chan('#music'), chan('#comicchat', [], 0, 1)]),
    historyExhausted: new Map([['#root', true]]),
    channelLastActivity: new Map([['#root', now - 120000], ['#zig', now - 3600000 * 2], ['#music', now - 86400000], ['#comicchat', now - 60000 * 12]]),
    activeView: { kind: 'channel', channel: '#root' },
    connectionStatus: 'connected', ourNick: 'kain', networkName: 'IRCXNet',
  }, true);
});
await page.waitForTimeout(1400);
await page.screenshot({ path: `${shots}/elegant-chat.png` });
// composer focus state
await page.locator('.shell-composer-textarea').fill('the new composer with real icons');
await page.waitForTimeout(400);
await page.screenshot({ path: `${shots}/elegant-composer.png`, clip: { x: 220, y: 700, width: 1000, height: 200 } });
console.log('done');
await browser.close();
