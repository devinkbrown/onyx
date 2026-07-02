// Seed a connected AppShell state and screenshot it (mobile QA).
// Requires the DEV server (window.__onyx is dev-only).
//   node tools/seed-shot.mjs http://localhost:5173 390,360,768 mshell
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const widths = (process.argv[3] ?? '390,360,768').split(',').map(Number);
const tag = process.argv[4] ?? 'mshell';

function seed() {
  const mod = /** @type {any} */ (window).__onyx;
  const store = mod.store;
  const init = store.getInitialState();

  const mkUser = (nick, modes = []) => [nick.toLowerCase(), { nick, modes: new Set(modes) }];
  const users = new Map([
    mkUser('aurora', ['q']),
    mkUser('vesper', ['o']),
    mkUser('cinder', ['o']),
    mkUser('moss', ['v']),
    mkUser('quartz'),
    mkUser('ember'),
    mkUser('slate'),
    mkUser('onyxbot', ['o']),
  ]);

  const t = (m) => new Date(Date.now() - m * 60000);
  const msg = (id, from, text, mins, type = 'msg') => ({
    id, from, text, time: t(mins), type, target: '#root',
  });
  const messages = [
    msg('m1', 'aurora', 'welcome to #root — the build channel for onyx + orochi', 42),
    msg('m2', 'vesper', 'pushed the mobile polish branch, pulling now', 38),
    msg('m3', 'cinder', 'the auto-routing felt instant on cellular 👌', 33),
    msg('m4', 'moss', 'voice held up through a tunnel, mesh re-routed clean', 27),
    msg('m5', 'quartz', 'theme studio export/import is so good', 21),
    msg('m6', 'ember', 'can we get safe-area padding on the bottom nav? notch eats it', 14),
    msg('m7', 'aurora', 'on it — landing that in this pass', 9),
    msg('m8', 'vesper', 'screenshot looks gorgeous on the onyx theme', 4),
    msg('m9', 'slate', 'gold on black is the move', 2),
  ];

  const chan = (name, unread = 0, hi = 0) => [name.toLowerCase(), {
    name, topic: 'build channel — onyx core, media, mesh', topicSetBy: 'aurora',
    topicSetAt: null, modes: '+nt', users, unread, highlights: hi, createdAt: null,
    messages: name === '#root' ? messages : [],
  }];
  const channels = new Map([
    chan('#root'),
    chan('#media', 3),
    chan('#mesh', 12, 2),
    chan('#design'),
    chan('#offtopic', 1),
  ]);

  store.setState({
    ...init,
    channels,
    activeView: { kind: 'channel', channel: '#root' },
    connectionStatus: 'connected',
    ourNick: 'kain',
    networkName: 'IRCXNet',
    showMemberList: true,
  }, true);
}

const browser = await chromium.launch();
try {
  for (const w of widths) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: w < 700 ? Math.round(w * 1.9) : Math.round(w * 0.5625) },
      deviceScaleFactor: w < 700 ? 2 : 1,
      isMobile: w < 700,
      hasTouch: w < 700,
      colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !!(window).__onyx, { timeout: 15000 });
    await page.evaluate(seed);
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 8000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `/tmp/${tag}-${w}.png`, fullPage: false });

    if (w < 700) {
      const nav = page.locator('.shell-mobile-nav');
      // members drawer open (use the bottom-nav button specifically)
      await nav.getByRole('button', { name: 'Toggle member list' }).click().catch((e) => console.log('members click:', String(e)));
      await page.waitForTimeout(400);
      await page.screenshot({ path: `/tmp/${tag}-${w}-members.png`, fullPage: false });
      await nav.getByRole('button', { name: 'Toggle member list' }).click().catch(() => {});
      await page.waitForTimeout(300);
      // rooms drawer open
      await nav.getByRole('button', { name: 'Toggle channel list' }).click().catch((e) => console.log('rooms click:', String(e)));
      await page.waitForTimeout(400);
      await page.screenshot({ path: `/tmp/${tag}-${w}-rooms.png`, fullPage: false });
    }
    console.log(`shot ${tag}-${w} ${errs.length ? 'ERR: ' + errs.join(' | ') : 'ok'}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
