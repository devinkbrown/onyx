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
import { auditContrast, assertContrast } from './contrast-audit.mjs';

const THEME_IDS = ['ocean', 'tide', 'abyss', 'reef', 'onyx', 'obsidian', 'pearl', 'ink', 'shu', 'hisui', 'pine', 'kohaku', 'terracotta', 'vermillion', 'sapphire', 'teal', 'slate', 'frost'];

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


/** Open the You hub (phone: the bottom nav; else the rail). */
async function openYou(page, h) {
  const phone = (page.viewportSize()?.width ?? 1440) < 768;
  if (phone) await h.tryClick(page, '.onyx-mobile-nav [data-testid="nav-you"]');
  else await h.tryClick(page, '[data-testid="you-open"]');
}

/**
 * Real rendered contrast for one theme across the surfaces the shell
 * paints: the room, the You hub, Preferences (two panes) and the palette.
 * `highContrast` raises the bar to AA (4.5); otherwise the house metadata
 * budget (3:1) — ShellPalette's own targets are AA for text.
 */
async function auditTheme(page, h, theme, highContrast) {
  const min = highContrast ? 4.5 : 3;
  const state = { theme, prefs: highContrast ? { highContrast: true } : {} };
  await room(page, h, state);
  const seen = [];
  const run = async (label, scope) => {
    const result = await auditContrast(page, { min, scope });
    seen.push(`${label}:${result.checked}`);
    assertContrast(`${theme}${highContrast ? '+hc' : ''} ${label}`, result);
  };
  await run('room', '');
  await openYou(page, h);
  await run('you', '[role="dialog"]');
  await h.tryClick(page, '[data-testid="you-settings-open-preferences"]');
  await h.tryClick(page, '#pref-category-tab-display');
  await run('prefs-display', '[role="dialog"]');
  await h.tryClick(page, '#pref-category-tab-conversation');
  await run('prefs-conversation', '[role="dialog"]');
  await page.keyboard.press('Escape');
  await h.settle(page, 250);
  await page.keyboard.press('Control+k');
  await h.settle(page, 400);
  await run('palette', '[role="dialog"]');
  await page.keyboard.press('Escape');
  await h.settle(page, 200);
  await page.goto(`${h.base}/appearance`);
  await h.settle(page, 700);
  await run('appearance', '');
  if (process.env.AUDIT_VERBOSE) console.log(`audit ${theme}${highContrast ? '+hc' : ''} @${page.viewportSize()?.width}: ${seen.join(' ')}`);
}

export default {
  ...Object.fromEntries(THEME_IDS.map((id) => [`ap-audit-${id}`, (page, h) => auditTheme(page, h, id, false)])),
  ...Object.fromEntries(['ocean', 'pearl', 'frost', 'kohaku'].map((id) => [`ap-audit-hc-${id}`, (page, h) => auditTheme(page, h, id, true)])),
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
