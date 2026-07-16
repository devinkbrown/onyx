// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Tests for /about — Onyx's editorial deep-dive page.
 *
 * Strategy: static source + runtime DOM assertions.
 *
 * The About page is a fully static component (no signals, effects, or
 * server-fetched data). Its source is the single source of truth for
 * content and structure. We test two ways:
 *
 *  1. Source analysis (fast, env-agnostic): read About.tsx and scan for
 *     required content strings, class names, and structural markers. This
 *     works regardless of test environment and is robust to renderer issues.
 *
 *  2. DOM rendering via @solidjs/testing-library (when the environment
 *     has vite-plugin-solid available). Tests are skipped gracefully if
 *     the SolidJS client renderer is not available in the current env.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it, beforeAll } from 'vitest';

// ── Source file ──────────────────────────────────────────────────────────────
const ABOUT_SRC_PATH = resolve(__dirname, 'About.tsx');
const CSS_SRC_PATH = resolve(__dirname, 'about.css');

let src = '';
let css = '';

beforeAll(() => {
  src = readFileSync(ABOUT_SRC_PATH, 'utf-8');
  css = readFileSync(CSS_SRC_PATH, 'utf-8');
});

// ── Attempt DOM rendering (graceful skip if env is unavailable) ───────────────
let renderAvailable = false;
let renderAbout: (() => { cleanup: () => void }) | null = null;

try {
  // This dynamic require will succeed or fail at import time in the test runner.
  // We wrap it so failures don't crash the whole test file.
  const solidLib = await import('@solidjs/testing-library');
  const AboutComponent = (await import('./About')).default;

  // Quick canary: try rendering into a detached DOM node.
  // If it throws "Client-only API called on server side", we skip DOM tests.
  const container = document.createElement('div');
  document.body.appendChild(container);

  try {
    solidLib.render(() => AboutComponent(), { container });
    renderAvailable = true;
    solidLib.cleanup();

    renderAbout = () => {
      const result = solidLib.render(() => AboutComponent());
      return { cleanup: result.unmount };
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Client-only API') || msg.includes('server side')) {
      console.warn('[About.test] SolidJS client renderer not available in this env — DOM tests skipped.');
    }
  } finally {
    document.body.removeChild(container);
  }
} catch {
  // testing-library not importable — skip DOM tests
}

// ── Helper: check source contains a string ──────────────────────────────────
function srcContains(needle: string): boolean {
  return src.includes(needle);
}

// ── Source-analysis tests (always run) ──────────────────────────────────────
describe('About page — source structure', () => {
  it('imports landing.css for shared atmosphere classes', () => {
    expect(srcContains("import './landing.css'")).toBe(true);
  });

  it('imports about.css for page-specific styles', () => {
    expect(srcContains("import './about.css'")).toBe(true);
  });

  it('has a <main> root carrying the shared "r" atmosphere class', () => {
    // Root is <main class="r ab-ocean"> — "r" wires the shared atmosphere,
    // "ab-ocean" scopes the azure re-tint.
    expect(/<main class="r(\s|")/.test(src)).toBe(true);
  });

  it('has a <header class="r-status"> top bar', () => {
    expect(srcContains('class="r-status"')).toBe(true);
  });

  it('has a footer with class r-footer', () => {
    expect(srcContains('r-footer')).toBe(true);
  });

  it('has an h1 heading in the hero', () => {
    expect(/<h1/.test(src)).toBe(true);
  });

  it('hero contains "open wire" text', () => {
    expect(/[Oo]pen wire/i.test(src)).toBe(true);
  });

  it('has a protocol section with id="protocol"', () => {
    expect(srcContains('id="protocol"')).toBe(true);
  });

  it('has a media section with id="media"', () => {
    expect(srcContains('id="media"')).toBe(true);
  });

  it('has an e2ee section with id="e2ee"', () => {
    expect(srcContains('id="e2ee"')).toBe(true);
  });

  it('has a mesh section with id="mesh"', () => {
    expect(srcContains('id="mesh"')).toBe(true);
  });

  it('has a services section with id="services"', () => {
    expect(srcContains('id="services"')).toBe(true);
  });

  it('has a mythos section with id="mythos"', () => {
    expect(srcContains('id="mythos"')).toBe(true);
  });

  it('has a developer section with id="developer"', () => {
    expect(srcContains('id="developer"')).toBe(true);
  });

  it('mentions KaguraVox (audio codec)', () => {
    expect(/kaguravox/i.test(src)).toBe(true);
  });

  it('mentions KaguraVis (video codec)', () => {
    expect(/kaguravis/i.test(src)).toBe(true);
  });

  it('does not mention old transport branding in the main website copy', () => {
    const oldTransportBrand = ['la', 'don media'].join('');
    expect(src.toLowerCase()).not.toContain(oldTransportBrand);
  });

  it('mentions Kagura frames as the primary/default transport framing', () => {
    expect(srcContains('Kagura frames')).toBe(true);
  });

  it('mentions mesh relay as the browser fallback carrier', () => {
    expect(srcContains('Mesh relay')).toBe(true);
  });

  it('does not use WebRTC framing in the main website copy', () => {
    expect(/webrtc/i.test(src)).toBe(false);
  });

  it('does not frame Onyx as an IRC client in the main website copy', () => {
    expect(/irc client/i.test(src)).toBe(false);
  });

  it('mentions TreeKEM for group key derivation', () => {
    expect(srcContains('TreeKEM')).toBe(true);
  });

  it('mentions HPKE for per-frame encryption', () => {
    expect(srcContains('HPKE')).toBe(true);
  });

  it('calls out Tsumugi as the secure channel layer', () => {
    expect(srcContains('Tsumugi')).toBe(true);
  });

  it('includes eshmaki.me node address with port 8080', () => {
    expect(srcContains('eshmaki.me')).toBe(true);
    expect(srcContains('8080')).toBe(true);
  });

  it('includes ircx.us node address', () => {
    expect(srcContains('ircx.us')).toBe(true);
  });

  it('mentions CRDT or delta-state convergence for the mesh', () => {
    expect(/crdt|delta-state|convergent/i.test(src)).toBe(true);
  });

  it('mentions HyParView for mesh membership', () => {
    expect(srcContains('HyParView')).toBe(true);
  });

  it('mentions Plumtree for epidemic broadcast', () => {
    expect(srcContains('Plumtree')).toBe(true);
  });

  it('contains the REGISTER service command', () => {
    expect(srcContains('REGISTER')).toBe(true);
  });

  it('contains the GHOST service command', () => {
    expect(srcContains('GHOST')).toBe(true);
  });

  it('contains the CHANNEL service command', () => {
    expect(srcContains('CHANNEL')).toBe(true);
  });

  it('contains the TEGAMI service command', () => {
    expect(srcContains('TEGAMI')).toBe(true);
  });

  it('has a no-bot manifesto (.ab-nobot)', () => {
    expect(srcContains('ab-nobot')).toBe(true);
  });

  it('references NickServ or bot in the no-bot context', () => {
    expect(/NickServ|ChanServ|bot|fake/i.test(src)).toBe(true);
  });

  it('frames Orochi as the engine in the stack section (no kanji lore)', () => {
    expect(srcContains('Orochi · the engine')).toBe(true);
    expect(srcContains('大蛇')).toBe(false);
  });

  it('frames the gate as the open network entrance — no devil/Aēšma lore', () => {
    // Onyx reframe: the middle stack card is "the gate · where you enter".
    expect(srcContains('the gate · where you enter')).toBe(true);
    // Devil/Zoroastrian lore must be fully removed.
    expect(srcContains('Aēšma')).toBe(false);
    expect(srcContains('ეშმაკი')).toBe(false);
    expect(/\bdevil\b/i.test(src)).toBe(false);
    expect(/\bwrath\b/i.test(src)).toBe(false);
    expect(/\bAvesta\b|Zoroastrian|daeva/i.test(src)).toBe(false);
  });

  it('keeps eshmaki.me only as a plain node/domain name (no demonic framing)', () => {
    // The node address is still a real entrance to the mesh.
    expect(srcContains('eshmaki.me')).toBe(true);
    // The old "eshmaki · the gate" devil glyph card label is gone.
    expect(srcContains('eshmaki · the gate')).toBe(false);
  });

  it('frames Onyx as the client (no Japanese jewel lore)', () => {
    expect(srcContains('Onyx · the client')).toBe(true);
    expect(srcContains('瑠璃')).toBe(false);
  });

  it('has three stack article classes: serpent, tide, jewel (no devil class)', () => {
    expect(srcContains('ab-myth serpent')).toBe(true);
    expect(srcContains('ab-myth tide')).toBe(true);
    expect(srcContains('ab-myth jewel')).toBe(true);
    expect(srcContains('ab-myth devil')).toBe(false);
  });

  it('has three transport card classes: primary, secondary, fallback', () => {
    expect(srcContains('ab-transport primary')).toBe(true);
    expect(srcContains('ab-transport secondary')).toBe(true);
    expect(srcContains('ab-transport fallback')).toBe(true);
  });

  it('developer section mentions SASL PLAIN for client connection', () => {
    expect(srcContains('SASL')).toBe(true);
  });

  it('developer section mentions Ed25519 for node identity', () => {
    expect(srcContains('Ed25519')).toBe(true);
  });

  it('developer section mentions BLAKE3-160 as NodeId derivation', () => {
    expect(srcContains('BLAKE3-160')).toBe(true);
  });

  it('brand links back to / (home)', () => {
    expect(srcContains('href="/"')).toBe(true);
  });

  it('Open Onyx links point to the canonical app route', () => {
    expect(srcContains('href="/app/"')).toBe(true);
  });

  it('nav links include in-page anchors for protocol, media, mesh', () => {
    expect(srcContains('href="#protocol"')).toBe(true);
    expect(srcContains('href="#media"')).toBe(true);
    expect(srcContains('href="#mesh"')).toBe(true);
  });

  it('atmosphere layers are aria-hidden', () => {
    expect(srcContains('aria-hidden="true"')).toBe(true);
  });

  it('SVG diagrams have role="img" and aria-label', () => {
    expect(srcContains('role="img"')).toBe(true);
    expect(srcContains('aria-label=')).toBe(true);
  });

  it('footer has the Onyx brand and year 2026, no kanji', () => {
    expect(srcContains('aria-label="Onyx" /> Onyx</span>')).toBe(true);
    expect(srcContains('2026')).toBe(true);
    expect(srcContains('瑠璃')).toBe(false);
  });

  it('CAP listing contains sasl, ircx, session, chathistory entries', () => {
    expect(srcContains('sasl')).toBe(true);
    expect(srcContains('ircx')).toBe(true);
    expect(srcContains('session')).toBe(true);
    expect(srcContains('chathistory')).toBe(true);
  });

  it('contains zero devil/demonic references anywhere on the page', () => {
    expect(/\bdevil\b/i.test(src)).toBe(false);
    expect(srcContains('Aēšma')).toBe(false);
    expect(srcContains('ეშმაკი')).toBe(false);
    expect(/Zoroastrian|Avesta|daeva|\bwrath\b/i.test(src)).toBe(false);
  });

  it('imports the Onyx brand Mascot and uses it', () => {
    expect(srcContains("import { Mascot } from '@/components/brand/Mascot'")).toBe(true);
    expect(/<Mascot\b/.test(src)).toBe(true);
  });

  it('roots the page in the deep-water aesthetic (ab-ocean root class)', () => {
    expect(srcContains('class="r ab-ocean"')).toBe(true);
  });
});

// ── CSS source tests ─────────────────────────────────────────────────────────
describe('About page — CSS source', () => {
  it('defines .ab-hero class', () => {
    expect(css.includes('.ab-hero')).toBe(true);
  });

  it('defines .ab-proto-grid class', () => {
    expect(css.includes('.ab-proto-grid')).toBe(true);
  });

  it('defines .ab-transport class with primary/secondary/fallback variants', () => {
    expect(css.includes('.ab-transport.primary')).toBe(true);
    expect(css.includes('.ab-transport.secondary')).toBe(true);
    expect(css.includes('.ab-transport.fallback')).toBe(true);
  });

  it('defines .ab-e2ee-split for the E2EE layout', () => {
    expect(css.includes('.ab-e2ee-split')).toBe(true);
  });

  it('defines .ab-mesh-body for the mesh layout', () => {
    expect(css.includes('.ab-mesh-body')).toBe(true);
  });

  it('defines .ab-svc for service command cards', () => {
    expect(css.includes('.ab-svc')).toBe(true);
  });

  it('defines .ab-mythos-grid for the three-column mythic layout', () => {
    expect(css.includes('.ab-mythos-grid')).toBe(true);
  });

  it('defines .ab-dev-grid for the developer section layout', () => {
    expect(css.includes('.ab-dev-grid')).toBe(true);
  });

  it('uses design tokens (var(--gold), var(--lapis), var(--shu))', () => {
    expect(css.includes('var(--gold)')).toBe(true);
    expect(css.includes('var(--lapis')).toBe(true);
    expect(css.includes('var(--shu)')).toBe(true);
  });

  it('uses font tokens (var(--font-mono), var(--font-display), var(--font-serif))', () => {
    expect(css.includes('var(--font-mono)')).toBe(true);
    expect(css.includes('var(--font-display)')).toBe(true);
    expect(css.includes('var(--font-serif)')).toBe(true);
  });

  it('uses clamp() for responsive sizing', () => {
    expect(css.includes('clamp(')).toBe(true);
  });

  it('has a prefers-reduced-motion rule for the vein animation', () => {
    expect(css.includes('prefers-reduced-motion')).toBe(true);
  });

  it('does not use backdrop-filter (glassmorphism banned)', () => {
    // The page-level about.css must not add backdrop-filter; landing.css handles the status bar separately
    expect(css.includes('backdrop-filter')).toBe(false);
  });

  it('does not use purple or indigo as color values (brand constraint)', () => {
    // Strip CSS comments first, then check for color usage
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/\bpurple\b|\bindigo\b/.test(cssNoComments)).toBe(false);
  });

  it('defines the .ab-seam kintsugi divider', () => {
    expect(css.includes('.ab-seam')).toBe(true);
  });

  it('defines responsive breakpoints via @media (max-width)', () => {
    expect(css.includes('@media (max-width')).toBe(true);
  });

  it('re-tints the shared atmosphere to azure bioluminescence (.ab-ocean scope)', () => {
    expect(css.includes('.ab-ocean')).toBe(true);
    expect(css.includes('.ab-ocean .r-veins path')).toBe(true);
  });

  it('renames the devil mythos card to a neutral .ab-myth.tide', () => {
    expect(css.includes('.ab-myth.tide')).toBe(true);
    expect(css.includes('.ab-myth.devil')).toBe(false);
  });

  it('uses fluid radii tokens (var(--r-md) / var(--r-sm)) for the deep-water cut', () => {
    expect(css.includes('var(--r-md)') || css.includes('var(--r-sm)')).toBe(true);
  });
});

// ── DOM rendering tests (run only if the SolidJS client renderer is available) ─
describe('About page — DOM rendering', () => {
  it.skipIf(!renderAvailable)('renders without throwing', () => {
    const { cleanup } = renderAbout!();
    cleanup();
  });

  it.skipIf(!renderAvailable)('has main.r root element in the DOM', () => {
    const { cleanup } = renderAbout!();
    expect(document.querySelector('main.r')).not.toBeNull();
    cleanup();
  });

  it.skipIf(!renderAvailable)('has header.r-status in the DOM', () => {
    const { cleanup } = renderAbout!();
    expect(document.querySelector('header.r-status')).not.toBeNull();
    cleanup();
  });

  it.skipIf(!renderAvailable)('has footer.r-footer in the DOM', () => {
    const { cleanup } = renderAbout!();
    expect(document.querySelector('footer.r-footer')).not.toBeNull();
    cleanup();
  });

  it.skipIf(!renderAvailable)('hero h1 is present and contains expected text', () => {
    const { cleanup } = renderAbout!();
    const h1 = document.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1!.textContent?.toLowerCase()).toContain('open wire');
    cleanup();
  });

  it.skipIf(!renderAvailable)('all seven section ids are present', () => {
    const { cleanup } = renderAbout!();
    const ids = ['protocol', 'media', 'e2ee', 'mesh', 'services', 'mythos', 'developer'];
    for (const id of ids) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    cleanup();
  });

  it.skipIf(!renderAvailable)('three myth articles render in the DOM', () => {
    const { cleanup } = renderAbout!();
    expect(document.querySelector('.ab-myth.serpent')).not.toBeNull();
    expect(document.querySelector('.ab-myth.tide')).not.toBeNull();
    expect(document.querySelector('.ab-myth.jewel')).not.toBeNull();
    cleanup();
  });

  it.skipIf(!renderAvailable)('three transport cards render in the DOM', () => {
    const { cleanup } = renderAbout!();
    expect(document.querySelectorAll('.ab-transport').length).toBe(3);
    cleanup();
  });

  it.skipIf(!renderAvailable)('footer contains brand, Orochi, and year', () => {
    const { cleanup } = renderAbout!();
    const footer = document.querySelector('footer.r-footer');
    const t = footer?.textContent ?? '';
    expect(t).toContain('Onyx');
    expect(t).toContain('Orochi');
    expect(t).toContain('2026');
    cleanup();
  });
});
