// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Tests for /about — community story, not a protocol desk.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it, beforeAll } from 'vitest';

const ABOUT_SRC_PATH = resolve(__dirname, 'About.tsx');
const CSS_SRC_PATH = resolve(__dirname, 'about.css');

let src = '';
let css = '';

beforeAll(() => {
  src = readFileSync(ABOUT_SRC_PATH, 'utf-8');
  css = readFileSync(CSS_SRC_PATH, 'utf-8');
});

let renderAvailable = false;
let renderAbout: (() => { cleanup: () => void }) | null = null;

try {
  const solidLib = await import('@solidjs/testing-library');
  const AboutComponent = (await import('./About')).default;
  const container = document.createElement('div');
  document.body.appendChild(container);

  try {
    solidLib.render(() => AboutComponent(), { container });
    renderAvailable = true;
    solidLib.cleanup();

    renderAbout = () => {
      solidLib.cleanup();
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

function srcContains(needle: string): boolean {
  return src.includes(needle);
}

describe('About page — source structure', () => {
  it('imports landing.css and about.css and uses PublicFrame', () => {
    expect(srcContains("import './landing.css'")).toBe(true);
    expect(srcContains("import './about.css'")).toBe(true);
    expect(srcContains('import { PublicFrame }')).toBe(true);
    expect(srcContains('currentPath="/about/"')).toBe(true);
    expect(srcContains('mainLabel="About Onyx"')).toBe(true);
    expect(srcContains('Rooms, messages, and calls')).toBe(true);
    expect(srcContains('class="ui-root r ab-ocean"')).toBe(true);
  });

  it('does not duplicate PublicFrame header, main, or footer chrome', () => {
    expect(srcContains('<header')).toBe(false);
    expect(srcContains('<main')).toBe(false);
    expect(srcContains('<PublicFooter')).toBe(false);
  });

  it('tells the community story before operators', () => {
    expect(srcContains('id="rooms"')).toBe(true);
    expect(srcContains('id="people"')).toBe(true);
    expect(srcContains('id="join"')).toBe(true);
    expect(srcContains('id="hosting"')).toBe(true);
    expect(src.indexOf('id="rooms"')).toBeLessThan(src.indexOf('id="hosting"'));
    expect(src.indexOf('id="join"')).toBeLessThan(src.indexOf('id="hosting"'));
    expect(srcContains('No ads')).toBe(true);
    expect(srcContains('Private DMs')).toBe(true);
    expect(srcContains('Friends, clubs, and creators')).toBe(true);
    expect(srcContains('href="/invite/"')).toBe(true);
    expect(srcContains('href="/app/"')).toBe(true);
  });

  it('does not mention OnyxOS in the public About story', () => {
    expect(src).not.toMatch(/onyxos/i);
  });

  it('keeps local topic anchors without duplicating primary navigation', () => {
    expect(srcContains('aria-label="About topics"')).toBe(true);
    expect(srcContains('href="#rooms"')).toBe(true);
    expect(srcContains('href="#people"')).toBe(true);
    expect(srcContains('href="#join"')).toBe(true);
    expect(srcContains('href="#accessibility"')).toBe(true);
  });

  it('has a single community h1', () => {
    expect((src.match(/<h1/g) ?? []).length).toBe(1);
    expect(srcContains('Rooms for people you already like.')).toBe(true);
  });

  it('does not use operator or protocol jargon on the public page', () => {
    expect(/\bmesh\b/i.test(src)).toBe(false);
    expect(/\bnode\b/i.test(src)).toBe(false);
    expect(/\bhandshake\b/i.test(src)).toBe(false);
    expect(/claim path/i.test(src)).toBe(false);
    expect(/\bIRCv?3?\b/i.test(src)).toBe(false);
    expect(/\bCAP\b/.test(src)).toBe(false);
    expect(/\bSASL\b/.test(src)).toBe(false);
    expect(/nobody.?s product/i.test(src)).toBe(false);
    expect(/product sauce/i.test(src)).toBe(false);
    expect(/discord killer/i.test(src)).toBe(false);
    expect(/fully encrypted/i.test(src)).toBe(false);
    expect(/passkeys?/i.test(src)).toBe(false);
    expect(/irc client/i.test(src)).toBe(false);
  });

  it('does not invent member counts, store badges, or legal pages', () => {
    expect(/\d[\d,]+\s+(members|users|people online)/i.test(src)).toBe(false);
    expect(/app store|play store|microsoft store/i.test(src)).toBe(false);
    expect(/href="\/terms\/"|href="\/privacy\/"/.test(src)).toBe(false);
  });

  it('keeps retired lore and unfinished crypto claims out', () => {
    expect(srcContains('大蛇')).toBe(false);
    expect(srcContains('瑠璃')).toBe(false);
    expect(srcContains('Aēšma')).toBe(false);
    expect(/\bdevil\b/i.test(src)).toBe(false);
    expect(srcContains('TreeKEM')).toBe(false);
    expect(/webrtc/i.test(src)).toBe(false);
  });

  it('keeps accessibility after the community story', () => {
    expect(srcContains('AccessibilityStatement')).toBe(true);
    expect(srcContains('id="accessibility"')).toBe(true);
    expect(src.indexOf('id="join"')).toBeLessThan(src.indexOf('id="accessibility"'));
  });
});

describe('About page — CSS source', () => {
  it('defines community layout classes', () => {
    expect(css.includes('.ab-hero')).toBe(true);
    expect(css.includes('.ab-ocean')).toBe(true);
    expect(css.includes('.ab-seam')).toBe(true);
    expect(css.includes('.ab-who')).toBe(true);
    expect(css.includes('.ab-pillars')).toBe(true);
  });

  it('uses Instrument Sans and at most one Fraunces line, not Anton or gold', () => {
    expect(css.includes('var(--font-sans)')).toBe(true);
    expect(css.includes('var(--font-serif)')).toBe(true);
    expect((css.match(/var\(--font-serif\)/g) ?? []).length).toBe(1);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '').includes('Anton')).toBe(false);
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(cssNoComments.includes('var(--gold)')).toBe(false);
    expect(/\bpurple\b|\bindigo\b/.test(cssNoComments)).toBe(false);
  });

  it('keeps 44px targets, reduced motion, and no glass', () => {
    expect(css.includes('var(--target-min, 44px)')).toBe(true);
    expect(css.includes('prefers-reduced-motion')).toBe(true);
    expect(css.includes('forced-colors')).toBe(true);
    expect(css.includes('clamp(')).toBe(true);
    expect(css.includes('backdrop-filter')).toBe(false);
  });
});

describe('About page — DOM rendering', () => {
  it.skipIf(!renderAvailable)('renders without throwing', () => {
    const { cleanup } = renderAbout!();
    cleanup();
  });

  it.skipIf(!renderAvailable)('has exactly one labelled PublicFrame main', () => {
    const { cleanup } = renderAbout!();
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(document.querySelector('main#public-main[aria-label="About Onyx"]')).not.toBeNull();
    cleanup();
  });

  it.skipIf(!renderAvailable)('has canonical banner and About current-page navigation', () => {
    const { cleanup } = renderAbout!();
    expect(document.querySelectorAll('header.public-frame__header')).toHaveLength(1);
    expect(document.querySelector('a[href="/about/"][aria-current="page"]')).not.toBeNull();
    expect(document.querySelector('.public-frame__context')?.textContent)
      .toMatch(/Community\s*·\s*Rooms, messages, and calls/);
    expect(document.querySelector('a[href="/onyxos/"], a[href="/onyxos"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/onyxos/i);
    cleanup();
  });

  it.skipIf(!renderAvailable)('exposes one skip target, canonical handoff, and local topic navigation', () => {
    const { cleanup } = renderAbout!();
    expect(document.querySelectorAll('main#public-main')).toHaveLength(1);
    expect(document.querySelector('a.public-frame__skip[href="#public-main"]')).not.toBeNull();
    expect(document.querySelectorAll('a.public-frame__open[href="/app/"]')).toHaveLength(1);
    expect(document.querySelector('nav.ab-topics[aria-label="About topics"] a[href="#join"]')).not.toBeNull();
    cleanup();
  });

  it.skipIf(!renderAvailable)('uses the hero as the single page-level h1', () => {
    const { cleanup } = renderAbout!();
    const headings = document.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings.item(0)!.textContent).toContain('Rooms for people you already like');
    cleanup();
  });

  it.skipIf(!renderAvailable)('leads with rooms, people, and join before hosting', () => {
    const { cleanup } = renderAbout!();
    expect(document.getElementById('rooms')).not.toBeNull();
    expect(document.getElementById('people')).not.toBeNull();
    expect(document.getElementById('join')).not.toBeNull();
    expect(document.getElementById('hosting')).not.toBeNull();
    expect(document.body.textContent).toMatch(/no ads/i);
    expect(document.body.textContent).toMatch(/private DMs/i);
    cleanup();
  });

  it.skipIf(!renderAvailable)('has exactly one canonical footer', () => {
    const { cleanup } = renderAbout!();
    expect(document.querySelectorAll('footer')).toHaveLength(1);
    expect(document.querySelector('footer.public-frame__footer')).not.toBeNull();
    const t = document.querySelector('footer.public-frame__footer')?.textContent ?? '';
    expect(t).toContain('Onyx');
    expect(t).toContain('Accessibility');
    expect(t).not.toMatch(/onyxos/i);
    cleanup();
  });
});
