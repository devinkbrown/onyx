// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-css-regress.mjs — the scenario set behind elm/tools/css-regress.mjs
 * (the CSS pixel-regression harness; read the README comment in that file).
 *
 * This file does two jobs:
 *   1. `default` export: every scenario of the other screens-*.mjs files,
 *      re-exported under a `<name>__<file>` key (so same-named scenarios in
 *      different files never collide and `--extra` can be used once), plus a
 *      few state scenarios of its own (keyboard focus tour, hover states).
 *   2. `SET`: which scenarios are shot at which viewports (the "matrix").
 *      css-regress.mjs reads this to shard the run over parallel screens.mjs
 *      processes. Tiers trade viewport breadth for scenario breadth so the
 *      whole set stays near ~600 shots:
 *        core     all 15 matrix viewports  — the app shell and the surfaces
 *                                            that change shape per viewport
 *        sheets   3 viewports              — every overlay / sheet / panel,
 *                                            call surface and gap feature
 *        public   5 viewports, full page   — the public / connect pages
 *        seam     767 / 768 / 769 px       — the mobile/desktop breakpoint
 *      Extra states (focus tour, hover) write additional PNGs next to the
 *      scenario's own shot via $CSS_REGRESS_OUT.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import appearance from './screens-appearance.mjs';
import calls from './screens-calls.mjs';
import convo from './screens-convo.mjs';
import gapAccount from './screens-gap-account.mjs';
import gapAuth from './screens-gap-auth.mjs';
import gapChanserv from './screens-gap-chanserv.mjs';
import gapClaim from './screens-gap-claim.mjs';
import gapCommands from './screens-gap-commands.mjs';
import gapConvo from './screens-gap-convo.mjs';
import gapImport from './screens-gap-import.mjs';
import gapOper from './screens-gap-oper.mjs';
import gapPeople from './screens-gap-people.mjs';
import gapShell from './screens-gap-shell.mjs';
import gapUsermodes from './screens-gap-usermodes.mjs';
import messages from './screens-messages.mjs';
import organize from './screens-organize.mjs';
import rx from './screens-rx.mjs';
import rxPublic from './screens-rx-public.mjs';
import rxSheets from './screens-rx-sheets.mjs';
import shell from './screens-shell.mjs';
import uiSheets from './screens-ui-sheets.mjs';
import watch from './screens-watch.mjs';

const FILES = {
  ap: appearance, calls, cv: convo, ga: gapAccount, gauth: gapAuth, cs: gapChanserv, gcl: gapClaim,
  gcmd: gapCommands, gcv: gapConvo, gi: gapImport, oper: gapOper, gp: gapPeople, gs: gapShell,
  um: gapUsermodes, msg: messages, org: organize, rx, rxp: rxPublic, rxs: rxSheets, shell,
  uis: uiSheets, watch,
};

// --- scenarios of our own ---------------------------------------------------

/** Extra PNG next to the scenario's own shot: `<key>-<tag>--<W>x<H>.png`. */
async function extraShot(page, key, tag) {
  const out = process.env.CSS_REGRESS_OUT;
  if (!out) return;
  mkdirSync(out, { recursive: true });
  const { width, height } = page.viewportSize();
  await page.screenshot({ path: join(out, `${key}-${tag}--${width}x${height}.png`), animations: 'disabled', caret: 'hide' });
}

const OWN = {
  // Keyboard focus ring on the first N tab stops of the room (shell chrome,
  // header, rail, transcript tools, composer). Guards the focus-ring token.
  'focus-tour-room': async (page, h) => {
    await h.joinRoom(page);
    for (let i = 1; i <= 24; i += 1) {
      await page.keyboard.press('Tab');
      if ([1, 3, 5, 8, 12, 16, 20, 24].includes(i)) { await h.settle(page, 120); await extraShot(page, 'css__focus-tour-room', `t${i}`); }
    }
  },
  // Same walk on the connect gate (public form controls) and a public page.
  'focus-tour-connect': async (page, h) => {
    await page.goto(`${h.base}/app?${h.pin}`);
    await h.settle(page, 600);
    for (let i = 1; i <= 10; i += 1) {
      await page.keyboard.press('Tab');
      if ([1, 2, 4, 6, 8, 10].includes(i)) { await h.settle(page, 120); await extraShot(page, 'css__focus-tour-connect', `t${i}`); }
    }
  },
  'focus-tour-landing': async (page, h) => {
    await page.goto(`${h.base}/`);
    await h.settle(page, 700);
    for (let i = 1; i <= 12; i += 1) {
      await page.keyboard.press('Tab');
      if ([1, 2, 4, 7, 10, 12].includes(i)) { await h.settle(page, 120); await extraShot(page, 'css__focus-tour-landing', `t${i}`); }
    }
  },
  // Hover on the things that have hover styles (desktop pointers only; on
  // touch viewports hover is a no-op, which is itself worth pinning).
  'hover-room': async (page, h) => {
    await h.joinRoom(page);
    const targets = [
      ['msg', '.onyx-transcript .onyx-message:nth-of-type(3)'],
      ['rail', '.onyx-rail .onyx-rail-row'],
      ['nav', '.onyx-primary-nav .onyx-nav-btn:nth-of-type(2)'],
      ['member', '.onyx-roster .onyx-member:nth-of-type(3)'],
      ['send', '.onyx-composer-send'],
      ['hdr', '.onyx-room-header .onyx-room-header-btn'],
    ];
    for (const [tag, sel] of targets) {
      const el = await page.$(sel);
      if (el && await el.isVisible()) { await el.hover({ timeout: 1500 }).catch(() => {}); await h.settle(page, 160); await extraShot(page, 'css__hover-room', tag); }
    }
  },
  // A typed composer, then keyboard focus on the composer's tool strip.
  'composer-states': async (page, h) => {
    await h.joinRoom(page);
    await page.fill('#shell-composer-input', 'hello **world** @jun').catch(() => {});
    await h.settle(page, 200);
    await extraShot(page, 'css__composer-states', 'typed');
    await page.focus('#shell-composer-input').catch(() => {});
    await page.keyboard.press('Shift+Tab');
    await h.settle(page, 150);
    await extraShot(page, 'css__composer-states', 'tools-focus');
  },
};

// --- the matrix --------------------------------------------------------------

const ALL = 'all';
const SHEET_VPS = ['phone', 'phone-land', 'desktop'];
const PUBLIC_VPS = ['se', 'phone', 'tablet', 'desktop', 'ultrawide'];
const of = (file, names) => names.map((n) => `${n}:${file}`);

/** Entries are `name:fileKey`; a bare name is a screens.mjs built-in. */
export const SET = {
  core: {
    vps: ALL,
    scenarios: [
      'room', 'room-more',
      ...of('shell', ['room-keyboard', 'you-hub', 'rooms-list', 'messages-list', 'calls', 'inbox', 'browse', 'members']),
      ...of('cv', ['cv-menu', 'cv-search', 'cv-thread']),
      ...of('rxs', ['rx-prefs', 'rx-palette']),
      ...of('ap', ['ap-room-pearl']),
      ...of('rx', ['busy-home']),
    ],
  },
  sheets: {
    vps: SHEET_VPS,
    scenarios: [
      // sheets / overlays / panels (rx-sheets is the superset of ui-sheets)
      ...of('rxs', ['rx-you', 'rx-inbox', 'rx-palette-query', 'rx-shortcuts', 'rx-prefs-history', 'rx-notify',
        'rx-guest-claim', 'rx-account', 'rx-account-danger', 'rx-reclaim', 'rx-people', 'rx-theme-share', 'rx-room-menu', 'rx-room-settings',
        'rx-new-message', 'rx-browse', 'rx-formation', 'rx-profile', 'rx-member-card', 'rx-person-safety', 'rx-moddesk', 'rx-oper',
        'rx-steward', 'rx-invite', 'rx-activity', 'rx-leave-room', 'rx-commands-help', 'rx-jump-date', 'rx-scheduled',
        'rx-first-run-notify', 'rx-a2hs', 'rx-dm-safety', 'rx-toast']),
      // thread / composer
      ...of('cv', ['cv-react', 'cv-emoji', 'cv-lightbox', 'cv-pins', 'cv-edit-history', 'cv-compact', 'cv-code', 'cv-media', 'cv-reply']),
      // rail / lists / empty
      ...of('rx', ['rail-menu', 'rail-leave', 'empty-rooms', 'new-convo', 'busy-list', 'crowd-scroll']),
      // calls
      ...of('calls', ['call-voice', 'call-more', 'call-video', 'call-settings', 'call-ring', 'call-hub']),
      // organize / gap features
      ...of('org', ['org-rooms', 'org-saved', 'org-prefs']),
      ...of('ga', ['ga-protect', 'ga-history']),
      ...of('gauth', ['ga-signin-links', 'ga-2fa-code']),
      ...of('cs', ['cs-pace', 'cs-registered']),
      ...of('gcl', ['gc-home-guest', 'gc-prefs']),
      ...of('gcv', ['gc-draft', 'gc-undelivered']),
      ...of('gi', ['gi-review', 'gi-block']),
      ...of('oper', ['oper-live', 'oper-bans']),
      ...of('gp', ['gp-card-op', 'gp-steward']),
      ...of('gs', ['gs-activity', 'gs-join-error']),
      ...of('um', ['um-privacy', 'um-memo']),
      ...of('gcmd', ['actions']),
      ...of('watch', ['watch-card', 'watch-editor']),
      // appearance / themes (ocean is the baseline everywhere else)
      ...of('ap', ['ap-room-hc', 'ap-room-pearl-hc', 'ap-room-compact', 'ap-prefs-display', 'ap-appearance', 'ap-zoom-200']),
      // keyboard + hover states of our own (extra PNGs)
      ...of('css', ['focus-tour-room', 'hover-room', 'composer-states']),
    ],
  },
  public: {
    vps: PUBLIC_VPS, full: true, dpr: 1,
    scenarios: [
      ...of('rxp', ['pub-landing', 'pub-landing-menu', 'pub-about', 'pub-download', 'pub-guides', 'pub-invite', 'pub-community', 'pub-onyxos',
        'pub-privacy', 'pub-integrations', 'pub-stats', 'pub-status', 'pub-roadmap', 'pub-404', 'pub-appearance', 'pub-studio',
        'conn-guest', 'conn-signin', 'conn-register-typed']),
      ...of('css', ['focus-tour-connect', 'focus-tour-landing']),
      ...of('ap', ['ap-landing-pearl']),
    ],
  },
  // 767 / 768 / 769: where the app and the public site switch layouts.
  seam: {
    vps: ['w767x900', 'w768x900', 'w769x900'], dpr: 1,
    scenarios: [
      'room', ...of('shell', ['rooms-list', 'you-hub']), ...of('cv', ['cv-menu']),
      ...of('rxs', ['rx-prefs', 'rx-account', 'rx-room-settings', 'rx-browse', 'rx-inbox']),
      ...of('calls', ['call-hub']), ...of('oper', ['oper-live']), ...of('gs', ['gs-activity']), ...of('um', ['um-privacy']),
      ...of('rxp', ['pub-landing', 'pub-about', 'pub-guides', 'pub-download', 'pub-stats', 'conn-guest']),
    ],
  },
};

/** The scenario key used on disk (and with --only) for a SET entry. */
export const keyOf = (entry) => { const [name, file] = entry.split(':'); return file ? `${name}__${file}` : name; };

/** key -> function, for every entry referenced by SET (built-ins stay bare). */
const resolved = {};
for (const tier of Object.values(SET)) {
  for (const entry of tier.scenarios) {
    const [name, file] = entry.split(':');
    const key = keyOf(entry);
    if (key in resolved) continue;
    const src = file === 'css' ? OWN : file ? FILES[file] : null;
    if (file && !src) throw new Error(`css-regress: unknown scenario file key "${file}" in "${entry}"`);
    if (src && !src[name]) throw new Error(`css-regress: scenario "${name}" not found in "${file}"`);
    resolved[key] = src ? src[name] : null; // bare names are screens.mjs built-ins
  }
}

export default Object.fromEntries(Object.entries(resolved).filter(([, fn]) => fn));
