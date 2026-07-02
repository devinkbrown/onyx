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
  const users = new Map([mkU('kain', ['q']), mkU('trev', ['o']), mkU('mizu', ['v']), mkU('kagura')]);
  const t = (m) => new Date(Date.now() - m * 60000);
  const msgs = [
    { id: 's1', from: 'trev', text: 'shipped the glacier pass — reactions test below', time: t(50), type: 'msg', target: '#root',
      reactions: [{ emoji: '👍', users: ['kain', 'mizu'], count: 2 }, { emoji: '🔥', users: ['kagura'], count: 1 }] },
    { id: 's2', from: 'kain', text: 'this line was edited to be better', time: t(40), type: 'msg', target: '#root', edited: true },
    { id: 's3', from: 'mizu', text: 'replying to the edited one', time: t(30), type: 'msg', target: '#root',
      replyTo: { id: 's2', from: 'kain', text: 'this line was edited to be better' } },
    { id: 's4', from: 'kain', text: 'joins/parts render below as system lines', time: t(20), type: 'msg', target: '#root' },
    { id: 's5', from: 'kagura', text: 'joined', time: t(18), type: 'join', target: '#root' },
    { id: 's6', from: 'yoroi', text: 'left (goodbye)', time: t(15), type: 'part', target: '#root' },
    { id: 's7', from: 'kagura', text: 'and a fresh message after the events', time: t(2), type: 'msg', target: '#root' },
  ];
  store.setState({ ...init,
    channels: new Map([['#root', { name: '#root', topic: 'the network’s living room — a topic long enough to matter', topicSetBy: 'kain', topicSetAt: null, modes: '+nt', users, unread: 0, highlights: 0, createdAt: null, messages: msgs }]]),
    activeView: { kind: 'channel', channel: '#root' },
    connectionStatus: 'connected', ourNick: 'kain', networkName: 'IRCXNet', canEditMessages: true, canReact: true,
    typingUsers: new Map([['#root', new Map([['mizu', Date.now() + 8000], ['kagura', Date.now() + 8000]])]]),
  }, true);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${shots}/sink.png` });
console.log('done');
await browser.close();
