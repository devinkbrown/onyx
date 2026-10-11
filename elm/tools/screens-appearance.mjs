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
/* global matchMedia, getComputedStyle -- used inside page.evaluate callbacks */
import shell from './screens-shell.mjs';
import { auditContrast, assertContrast, auditSceneContrast } from './contrast-audit.mjs';

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
  await openYou(page, h);
  await h.tryClick(page, '[data-testid="you-settings-open-preferences"]');
  if (category) await h.tryClick(page, `#pref-category-tab-${category}`);
  await h.settle(page, 300);
}


/** Open the You hub (phone: the bottom nav; else the rail). */
async function openYou(page, h) {
  const phone = (page.viewportSize()?.width ?? 1440) < 768;
  if (phone) {
    // Inside a conversation the bottom nav is away: back to the list first.
    await h.tryClick(page, '[data-testid="room-back"]');
    await h.tryClick(page, '.onyx-mobile-nav [data-testid="nav-you"]');
  } else await h.tryClick(page, '[data-testid="you-open"]');
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

const PUBLIC_PATHS = ['/', '/about', '/status', '/guides', '/roadmap', '/privacy', '/stats', '/community', '/accessibility', '/download', '/onyxos', '/guidelines', '/invite', '/contact'];

/** The public pages follow the look too: audit each under one theme. */
async function auditPublic(page, h, theme) {
  await seed(page, { theme });
  const seen = [];
  for (const path of PUBLIC_PATHS) {
    await page.goto(`${h.base}${path}`);
    await h.settle(page, 500);
    const result = await auditContrast(page, { min: 3 });
    seen.push(`${path}:${result.checked}`);
    assertContrast(`${theme} ${path}`, result);
  }
  await page.goto(`${h.base}/app?${h.pin}`);
  await h.settle(page, 600);
  const gate = await auditContrast(page, { min: 3 });
  seen.push(`connect:${gate.checked}`);
  assertContrast(`${theme} connect gate`, gate);
  if (process.env.AUDIT_VERBOSE) console.log(`audit public ${theme} @${page.viewportSize()?.width}: ${seen.join(' ')}`);
}

/** Transcript text against the pixels the scene actually paints behind it. */
async function sceneContrast(page, h, theme, bg, highContrast, surface = 'app') {
  if (surface === 'appearance') {
    await seed(page, { theme, bg, prefs: highContrast ? { highContrast: true } : {} });
    await page.goto(`${h.base}/appearance`);
    await h.settle(page, 700);
  } else {
    await room(page, h, { theme, bg, prefs: highContrast ? { highContrast: true } : {} });
  }
  await page.waitForFunction((want) => document.documentElement.dataset.scene === want, surface, { timeout: 5000 });
  const result = await auditSceneContrast(page, { scope: surface === 'app' ? '.onyx-thread-pane' : 'body', min: 4.5 });
  if (process.env.AUDIT_VERBOSE) console.log(`scene ${surface} ${theme}/${bg}${highContrast ? '+hc' : ''} @${page.viewportSize()?.width}: ${result.checked} boxes, worst ${result.worst.map((w) => `${w.tag}"${w.text}"=${w.ratio}/${w.worst}`).join(' ')}`);
  if (result.failures.length) {
    throw new Error(`scene ${surface} ${theme}/${bg}: ${result.failures.length}/${result.checked} text boxes below target — ${result.failures.slice(0, 5).map((f) => `${f.tag} "${f.text}" ${f.ratio}:1 (worst ${f.worst})`).join('; ')}`);
  }
}

/**
 * Computed-style assertions for Text size and Density in a real browser:
 * the root follows the scale (sm 15 / md 16 / lg 18 px), body text follows the
 * root, and touch devices keep 44px targets in every density. Throws on a miss
 * (screens.mjs reports it as a PROBLEM).
 */
async function assertScaleDensity(page, h, fontScale, density) {
  await room(page, h, { prefs: { fontScale, density } });
  // On a phone the list pages (rail rows, bottom nav) sit behind the room.
  if ((page.viewportSize()?.width ?? 1440) < 768) await h.tryClick(page, '[data-testid="room-back"]');
  const touch = await page.evaluate(() => matchMedia('(hover: none)').matches);
  const got = await page.evaluate(() => {
    const px = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
    const heights = (sel) => [...document.querySelectorAll(sel)]
      .filter((e) => e.getClientRects().length)
      .map((e) => Math.round(e.getBoundingClientRect().height));
    return {
      root: px(document.documentElement),
      body: px(document.querySelector('.onyx-message .onyx-body')),
      attrs: [document.documentElement.dataset.fontScale, document.documentElement.dataset.density].join('/'),
      railItems: heights('.onyx-rail .onyx-rail-item'),
      navButtons: heights('.onyx-mobile-nav .onyx-nav-btn, .onyx-primary-nav .onyx-nav-btn'),
    };
  });
  const root = { sm: 15, md: 16, lg: 18 }[fontScale];
  const problems = [];
  if (got.attrs !== `${fontScale}/${density}`) problems.push(`html data attrs ${got.attrs}`);
  if (Math.abs(got.root - root) > 0.05) problems.push(`root ${got.root}px, want ${root}`);
  if (got.body === null || Math.abs(got.body - 0.9375 * root) > 0.2) problems.push(`message body ${got.body}px, want ${0.9375 * root}`);
  if (touch) {
    const small = [...got.railItems, ...got.navButtons].filter((height) => height < 44);
    if (small.length) problems.push(`touch targets under 44px: ${small.join(',')}`);
  }
  if (process.env.AUDIT_VERBOSE) console.log(`scale ${fontScale}/${density} @${page.viewportSize()?.width}${touch ? ' touch' : ''}: root ${got.root} body ${got.body} rail ${got.railItems.slice(0, 3)} nav ${got.navButtons.slice(0, 3)}`);
  if (problems.length) throw new Error(`scale ${fontScale}/${density}: ${problems.join('; ')}`);
}

/**
 * The Appearance stage in a real browser: picking a background paints it on
 * the page behind (the renderer), and Escape drops the unapplied pick and the
 * scene returns to the saved one (v3/gap-appearance).
 */
async function assertEscapePreview(page, h) {
  await seed(page, {});
  await page.goto(`${h.base}/appearance`);
  await h.settle(page, 700);
  await page.evaluate(() => { document.querySelector('[data-testid="appearance-advanced"]').open = true; });
  await h.settle(page, 200);
  const scene = () => page.evaluate(() => {
    const canvas = document.getElementById('onyx-scene');
    return { id: canvas ? canvas.dataset.backgroundId : null, surface: document.documentElement.dataset.scene || null };
  });
  const before = await scene();
  if (before.surface !== 'appearance' || before.id !== 'deep-current') throw new Error(`escape-preview: want deep-current on the stage, got ${JSON.stringify(before)}`);
  await page.click('[data-background-id="ember"]');
  await h.settle(page, 300);
  const staged = await scene();
  if (staged.id !== 'ember') throw new Error(`escape-preview: a staged pick must paint, got ${JSON.stringify(staged)}`);
  await page.keyboard.press('Escape');
  await h.settle(page, 400);
  const after = await scene();
  const checked = await page.evaluate(() => document.querySelector('[data-background-id="ember"]').getAttribute('aria-checked'));
  if (after.id !== 'deep-current' || checked !== 'false') throw new Error(`escape-preview: Escape must drop the pick, got ${JSON.stringify(after)} checked=${checked}`);
  if (process.env.AUDIT_VERBOSE) console.log(`escape-preview @${page.viewportSize()?.width}: ${before.id} -> ${staged.id} -> ${after.id}`);
}

/**
 * Conversation width in a real browser: Measured keeps the reading column
 * (the log and the composer share it and stay centred); Full lets both run
 * the width of the conversation column. Only meaningful where the column is
 * wider than the measure, so narrower viewports just check nothing overflows.
 */
async function assertWidth(page, h, width) {
  await room(page, h, { prefs: { width } });
  const m = await page.evaluate(() => {
    const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, w: r.width }; };
    return { pane: rect('.onyx-main > .onyx-thread-pane'), log: rect('.onyx-thread-frame [role="log"]'), composer: rect('.onyx-main > .onyx-composer .onyx-composer-bar, .onyx-main > .onyx-composer'), attr: document.documentElement.dataset.width };
  });
  const vw = page.viewportSize()?.width ?? 0;
  const problems = [];
  if (m.attr !== width) problems.push(`data-width ${m.attr}`);
  if (m.pane && m.log && vw >= 1600) {
    const free = m.pane.w;
    if (width === 'measured' && m.log.w > 0.7 * free) problems.push(`measured log ${Math.round(m.log.w)}px fills ${Math.round(free)}px`);
    if (width === 'full' && m.log.w < 0.85 * free) problems.push(`full log ${Math.round(m.log.w)}px should fill ${Math.round(free)}px`);
    const centred = Math.abs((m.log.x + m.log.w / 2) - (m.pane.x + m.pane.w / 2));
    if (width === 'measured' && centred > 24) problems.push(`measured log off-centre by ${Math.round(centred)}px`);
  }
  if (process.env.AUDIT_VERBOSE) console.log(`width ${width} @${vw}: pane ${Math.round(m.pane?.w ?? 0)} log ${Math.round(m.log?.w ?? 0)} composer ${Math.round(m.composer?.w ?? 0)}`);
  if (problems.length) throw new Error(`width ${width}: ${problems.join('; ')}`);
}

const SCENE_IDS = ['deep-current', 'bioluminescence', 'caustics', 'aurora', 'pyrite-field', 'gold-veins', 'ember', 'forest', 'resin', 'ink-wash', 'mist', 'frost', 'aurora-ribbons', 'tide-bands', 'obsidian', 'lapis-gradient', 'paper-grain'];

export default {
  'ap-assert-width-measured': (page, h) => assertWidth(page, h, 'measured'),
  'ap-assert-width-full': (page, h) => assertWidth(page, h, 'full'),
  'ap-assert-escape-preview': (page, h) => assertEscapePreview(page, h),
  ...Object.fromEntries(['sm', 'md', 'lg'].flatMap((scale) => ['compact', 'cozy', 'roomy'].map((density) => [`ap-assert-${scale}-${density}`, (page, h) => assertScaleDensity(page, h, scale, density)]))),
  'ap-scene-frost-ember': (page, h) => sceneContrast(page, h, 'frost', 'ember', false),
  'ap-scene-frost-mist': (page, h) => sceneContrast(page, h, 'frost', 'mist', false),
  'ap-scene-kohaku-ember': (page, h) => sceneContrast(page, h, 'kohaku', 'ember', false),
  'ap-scene-hc-ocean-ember': (page, h) => sceneContrast(page, h, 'ocean', 'ember', true),
  'ap-scene-hc-pearl-ember': (page, h) => sceneContrast(page, h, 'pearl', 'ember', true),
  'ap-scene-appearance-dark-ember': (page, h) => sceneContrast(page, h, 'ocean', 'ember', false, 'appearance'),
  'ap-scene-appearance-light-ember': (page, h) => sceneContrast(page, h, 'pearl', 'ember', false, 'appearance'),
  'ap-scene-appearance-dark-aurora': (page, h) => sceneContrast(page, h, 'ocean', 'aurora', false, 'appearance'),
  ...Object.fromEntries(SCENE_IDS.flatMap((bg) => [
    [`ap-scene-dark-${bg}`, (page, h) => sceneContrast(page, h, 'ocean', bg, false)],
    [`ap-scene-light-${bg}`, (page, h) => sceneContrast(page, h, 'pearl', bg, false)],
  ])),
  ...Object.fromEntries(['ocean', 'pearl', 'frost', 'kohaku', 'slate'].map((id) => [`ap-audit-public-${id}`, (page, h) => auditPublic(page, h, id)])),
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
