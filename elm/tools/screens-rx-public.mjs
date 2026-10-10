// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-rx-public.mjs — v3/rx-public scenarios for screens.mjs: every
 * public page, the join screen and /appearance (re-exported from
 * screens-public.mjs) plus the join-screen states this slice added and
 * the zoom / large-font checks.
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-rx-public.mjs
 *
 * conn-remembered seeds `onyx:credentials` with opted-in identities
 * (metadata the ports list; no real secrets) before the page boots.
 * zoom-* emulate 200% browser zoom on a laptop (a 640x360 CSS viewport,
 * mouse, no touch) and bigfont-* a 24px browser default font size, so
 * run them with `--vp laptop`.
 */
import publicScenarios from './screens-public.mjs';

const REMEMBERED = {
  v: 1,
  active: '127.0.0.1|kai',
  slots: {
    '127.0.0.1|kai': { remembered: true, nick: 'kai', savedAt: '2026-10-09T20:00:00.000Z', sessionToken: 'demo-token', password: 'demo-only' },
    '127.0.0.1|mara': { remembered: true, nick: 'Mara', savedAt: '2026-10-01T20:00:00.000Z', password: 'demo-only' },
    '127.0.0.1|averyveryverylongaccountname': { remembered: true, nick: 'averyveryverylongaccountname', savedAt: '2026-09-01T20:00:00.000Z' },
  },
};

const seedRemembered = (page) =>
  page.addInitScript((store) => {
    try { window.localStorage.setItem('onyx:credentials', JSON.stringify(store)); } catch { /* blocked */ }
  }, REMEMBERED);

const conn = (query = '', prep = async () => {}) => async (page, h) => {
  await prep(page, h);
  await page.goto(`${h.base}/app?${h.pin}${query}`);
  await h.settle(page, 600);
};

const zoom = (path) => async (page, h) => {
  // 200% zoom of a 1280x720 laptop = a 640x360 CSS viewport.
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto(`${h.base}${path.replace('PIN', h.pin)}`);
  await h.settle(page, 600);
};

const bigFont = (path) => async (page, h) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 24, fixed: 20 } });
  await page.goto(`${h.base}${path.replace('PIN', h.pin)}`);
  await h.settle(page, 600);
};

// A fresh public stats export (index only; per-room files are empty), so the
// stats page shows its populated layout instead of the empty state.
function statsIndex() {
  const now = Math.floor(Date.now() / 1000);
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const rooms = [
    ['#root', 1840, 42, 18, 'The front door of the Onyx network'],
    ['#lounge', 960, 18, 9, 'Hang out, say hi'],
    ['#design', 410, 9, 4, 'Pixels, type and taste'],
    ['#elm', 220, 6, 3, 'The v3 client'],
    ['#game-night', 150, 5, 0, 'Fridays at 9pm'],
  ];
  return {
    generated_at: now - 120,
    network: 'Onyx',
    node: 'onyx-1',
    users_online: 42,
    network_days: Array.from({ length: 14 }, (_, i) => ({ date: day(13 - i), messages: 900 + ((i * 337) % 700) })),
    channels: rooms.map(([channel, messages, active, present, topic], r) => ({
      channel, messages, active_users: active, present, last_active: now - 60 * (r + 1), topic,
      spark: Array.from({ length: 24 }, (_, i) => Math.round(messages / 24 + ((i * (r + 3)) % 11) * 3)),
    })),
  };
}

const statsLive = (path) => async (page, h) => {
  await page.route('**/stats/data/index.json*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statsIndex()) }));
  await page.route('**/stats/data/*.json*', (route) =>
    (route.request().url().includes('/index.json') ? route.fallback() : route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })));
  await page.goto(`${h.base}${path}`);
  await h.settle(page, 900);
};

export default {
  ...publicScenarios,
  'pub-stats-live': statsLive('/stats'),
  'pub-stats-room': statsLive('/stats?room=%23lounge'),
  'conn-invite-preview': conn('&join=%23game-night&by=mara&topic=Game%20night%20at%209pm.%20Bring%20snacks.&with=jun,iris'),
  'conn-remembered': conn('', seedRemembered),
  'conn-remembered-signin': async (page, h) => {
    await conn('', seedRemembered)(page, h);
    await page.click('.conn-identity:nth-child(2) .conn-identity-select');
    await h.settle(page, 300);
  },
  'conn-signin-stay': async (page, h) => {
    await page.goto(`${h.base}/app?${h.pin}`);
    await h.settle(page, 400);
    await page.click('[data-testid="conn-mode-signin"]');
    await page.fill('#conn-nick', 'kai');
    await page.fill('#conn-password', 'hunter22');
    await page.check('#conn-stay-signed-in');
    await h.settle(page, 200);
  },
  // Landscape phone with the keyboard up: ~half the height is gone.
  'conn-land-keyboard': async (page, h) => {
    const vp = page.viewportSize();
    if (vp.height < 500 && vp.width > vp.height) await page.setViewportSize({ width: vp.width, height: 200 });
    await page.goto(`${h.base}/app?${h.pin}&join=%23root`);
    await h.settle(page, 400);
    await page.focus('#conn-nick');
    await page.keyboard.type('kai');
    await h.settle(page, 300);
  },
  'zoom-landing': zoom('/'),
  'zoom-connect': zoom('/app?PIN'),
  'zoom-privacy': zoom('/privacy/'),
  'zoom-appearance': zoom('/appearance'),
  'bigfont-landing': bigFont('/'),
  'bigfont-connect': bigFont('/app?PIN'),
};
