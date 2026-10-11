// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-appearance.mjs — screens.mjs scenarios for v3/gap-appearance:
 * themes re-skinning the whole shell (Ocean / Pearl / Frost / Garnet, high
 * contrast by switch and by prefers-contrast), Text size, Density,
 * Conversation width, the background scene, the Appearance page and the
 * Preferences sheet. Re-exports the screens-shell.mjs scenarios so one
 * --extra covers both.
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-appearance.mjs \
 *     --only ap-room-ocean,ap-room-pearl,ap-room-hc
 *
 * Device state is seeded through localStorage before the app boots (the
 * same keys the app writes), so every shot is a cold load of that state.
 */
import shell from './screens-shell.mjs';

/** Seed onyx:* storage before any script runs. */
async function seed(page, { theme, prefs, bg, motion } = {}) {
  await page.addInitScript((state) => {
    try {
      const p = Object.assign({ e2eeDms: false }, state.prefs || {});
      localStorage.setItem('onyx:preferences', JSON.stringify(p));
      if (state.theme) localStorage.setItem('onyx:theme', state.theme);
      if (state.bg) localStorage.setItem('onyx:bg', state.bg);
      if (state.motion) localStorage.setItem('onyx:scene-motion', state.motion);
    } catch { /* private mode */ }
  }, { theme, prefs, bg, motion });
}

async function dismissAsks(page, h) {
  for (let i = 0; i < 3 && (await page.$('[role="dialog"]')); i += 1) {
    await page.keyboard.press('Escape');
    await h.settle(page, 250);
  }
}

async function room(page, h, state) {
  await seed(page, state);
  await h.joinRoom(page);
  await dismissAsks(page, h);
  await h.settle(page, 300);
}

async function prefsSheet(page, h, state, category) {
  await room(page, h, state);
  const phone = (page.viewportSize()?.width ?? 1440) < 768;
  if (phone) await h.tryClick(page, '.onyx-mobile-nav [data-testid="nav-you"]');
  else await h.tryClick(page, '[data-testid="you-open"]');
  await h.tryClick(page, '[data-testid="you-settings-open-preferences"]');
  if (category) await h.tryClick(page, `#pref-category-tab-${category}`);
  await h.settle(page, 300);
}

export default {
  ...shell,
  'ap-room-ocean': (page, h) => room(page, h, {}),
  'ap-room-pearl': (page, h) => room(page, h, { theme: 'pearl' }),
  'ap-room-frost': (page, h) => room(page, h, { theme: 'frost' }),
  'ap-room-garnet': (page, h) => room(page, h, { theme: 'shu' }),
  'ap-room-hc': (page, h) => room(page, h, { prefs: { highContrast: true } }),
  'ap-room-pearl-hc': (page, h) => room(page, h, { theme: 'pearl', prefs: { highContrast: true } }),
  'ap-room-os-contrast': async (page, h) => {
    await page.emulateMedia({ contrast: 'more' }).catch(() => {});
    await room(page, h, { theme: 'frost' });
  },
  'ap-room-text-lg': (page, h) => room(page, h, { prefs: { fontScale: 'lg' } }),
  'ap-room-text-sm': (page, h) => room(page, h, { prefs: { fontScale: 'sm' } }),
  'ap-room-compact': (page, h) => room(page, h, { prefs: { density: 'compact' } }),
  'ap-room-roomy': (page, h) => room(page, h, { prefs: { density: 'roomy' } }),
  'ap-room-full-width': (page, h) => room(page, h, { prefs: { width: 'full' } }),
  'ap-room-scene-off': (page, h) => room(page, h, { motion: 'off' }),
  'ap-room-ember': (page, h) => room(page, h, { theme: 'kohaku', bg: 'ember' }),
  'ap-home-pearl': async (page, h) => {
    await seed(page, { theme: 'pearl' });
    await h.joinRoom(page, 'kn', '');
    await dismissAsks(page, h);
  },
  'ap-connect-pearl': async (page, h) => {
    await seed(page, { theme: 'pearl' });
    await page.goto(`${h.base}/app?${h.pin}`);
    await h.settle(page, 800);
  },
  'ap-landing-pearl': async (page, h) => {
    await seed(page, { theme: 'pearl' });
    await page.goto(`${h.base}/`);
    await h.settle(page, 800);
  },
  'ap-appearance': async (page, h) => {
    await seed(page, {});
    await page.goto(`${h.base}/appearance`);
    await h.settle(page, 800);
  },
  'ap-appearance-pearl': async (page, h) => {
    await seed(page, { theme: 'pearl' });
    await page.goto(`${h.base}/appearance`);
    await h.settle(page, 800);
  },
  'ap-prefs-display': (page, h) => prefsSheet(page, h, {}, 'display'),
  'ap-prefs-conversation': (page, h) => prefsSheet(page, h, {}, 'conversation'),
  'ap-prefs-pearl': (page, h) => prefsSheet(page, h, { theme: 'pearl' }, 'display'),
  // Browser zoom 200% on a laptop ≈ a 640x360 CSS viewport.
  'ap-zoom-200': async (page, h) => {
    const vp = page.viewportSize();
    if (vp && vp.width >= 1280 && vp.height >= 600) await page.setViewportSize({ width: 640, height: 360 });
    await room(page, h, { prefs: { fontScale: 'lg' } });
  },
};
