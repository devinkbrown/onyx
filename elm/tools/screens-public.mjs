// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-public.mjs — extra screens.mjs scenarios for the public site,
 * the connect gate, /appearance and Theme Studio.
 *
 *   node elm/tools/screens.mjs --extra elm/tools/screens-public.mjs [--only …]
 *
 * SCREENS_FULL=DIR additionally writes a full-page PNG of each scenario
 * (phone and desktop) into DIR, for reviewing below-the-fold layout.
 */
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const brandDir = resolve(here, '../../public/brand');
const fullDir = process.env.SCREENS_FULL || '';
if (fullDir) mkdirSync(fullDir, { recursive: true });

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// The harness only serves elm/dist-elm; production also serves the
// first-party /brand assets, so mirror those for faithful shots. Phone
// runs also present as an iPhone 15 (Safari UA; the harness already
// sets 390x844, DPR 3, isMobile, hasTouch).
async function brand(page) {
  if (page.viewportSize().width < 600) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' });
  }
  await page.route('**/brand/*', (route) => {
    const file = join(brandDir, new URL(route.request().url()).pathname.split('/').pop());
    if (!existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: 'image/png', body: readFileSync(file) });
  });
}

async function full(page, name) {
  if (!fullDir) return;
  const { width } = page.viewportSize();
  const vp = width < 600 ? 'phone' : 'desktop';
  const step = vp === 'phone' ? 1000 : 1100;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let i = 0, y = 0; y < height && i < 12; i += 1, y += step) {
    await page.screenshot({
      path: join(fullDir, `${name}--${vp}-${i}.png`),
      fullPage: true,
      clip: { x: 0, y, width, height: Math.min(step, height - y) },
    });
  }
}

const visit = (path, name) => async (page, h) => {
  await brand(page);
  await page.goto(`${h.base}${path}`);
  await h.settle(page, 700);
  await full(page, name);
};

const connectMode = (label, name) => async (page, h) => {
  await brand(page);
  await page.goto(`${h.base}/app?${h.pin}`);
  await h.settle(page, 500);
  await page.click(`[data-testid="conn-modes"] button:has-text("${label}")`);
  await h.settle(page, 300);
  await full(page, name);
};

export default {
  'pub-landing': visit('/', 'pub-landing'),
  'pub-landing-menu': async (page, h) => {
    await brand(page);
    await page.goto(`${h.base}/`);
    await h.settle(page, 500);
    if ((page.viewportSize().width) < 769) {
      await page.click('.public-frame__menu-toggle');
      await h.settle(page, 300);
    } else {
      await page.mouse.wheel(0, 900);
      await h.settle(page, 400);
    }
  },
  'pub-about': visit('/about', 'pub-about'),
  'pub-download': visit('/download', 'pub-download'),
  'pub-guides': visit('/guides', 'pub-guides'),
  'pub-invite': visit('/invite?join=%23root', 'pub-invite'),
  'pub-community': visit('/community', 'pub-community'),
  'pub-onyxos': visit('/onyxos', 'pub-onyxos'),
  'pub-privacy': visit('/privacy', 'pub-privacy'),
  'pub-guidelines': visit('/guidelines', 'pub-guidelines'),
  'pub-contact': visit('/contact', 'pub-contact'),
  'pub-accessibility': visit('/accessibility', 'pub-accessibility'),
  'pub-glossary': visit('/glossary', 'pub-glossary'),
  'pub-integrations': visit('/integrations', 'pub-integrations'),
  'pub-agents': visit('/agents', 'pub-agents'),
  'pub-stats': visit('/stats', 'pub-stats'),
  'pub-status': visit('/status', 'pub-status'),
  'pub-roadmap': visit('/roadmap', 'pub-roadmap'),
  'pub-404': visit('/no-such-page', 'pub-404'),
  'pub-appearance': visit('/appearance', 'pub-appearance'),
  'pub-studio': async (page, h) => {
    await brand(page);
    await page.goto(`${h.base}/appearance`);
    await h.settle(page, 500);
    await h.tryClick(page, '[data-testid="appearance-advanced"] > summary');
    await h.settle(page, 400);
    const studio = await page.$('.studio, [data-testid="theme-studio"], .ap-studio .st');
    if (studio) await studio.scrollIntoViewIfNeeded().catch(() => {});
    await h.settle(page, 300);
    await full(page, 'pub-studio');
  },
  'conn-guest': async (page, h) => {
    await brand(page);
    await page.goto(`${h.base}/app?${h.pin}`);
    await h.settle(page, 500);
    await full(page, 'conn-guest');
  },
  'conn-typed': async (page, h) => {
    await brand(page);
    await page.goto(`${h.base}/app?${h.pin}`);
    await h.settle(page, 400);
    await page.fill('#conn-nick', 'kai');
    await page.fill('#conn-room', '#lounge');
    await h.settle(page, 200);
  },
  // Phone with the on-screen keyboard up: ~half the height is gone.
  'conn-keyboard': async (page, h) => {
    await brand(page);
    const vp = page.viewportSize();
    if (vp.width < 600) await page.setViewportSize({ width: vp.width, height: 450 });
    await page.goto(`${h.base}/app?${h.pin}`);
    await h.settle(page, 400);
    await page.focus('#conn-nick');
    await page.keyboard.type('kai');
    await h.settle(page, 300);
  },
  'conn-join-invite': visit('/app?join=%23root', 'conn-join-invite'),
  'conn-signin': connectMode('Sign in', 'conn-signin'),
  'conn-register': connectMode('Create account', 'conn-register'),
  'conn-register-typed': async (page, h) => {
    await connectMode('Create account', 'x')(page, h);
    await page.fill('#conn-nick', 'kai');
    await page.fill('#conn-password', 'hunter22');
    await page.fill('#conn-confirm', 'hunter2');
    await page.click('[data-testid="conn-submit"]').catch(() => {});
    await h.settle(page, 300);
  },
};
