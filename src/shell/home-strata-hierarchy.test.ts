// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * home-strata-hierarchy.test.ts — residual visual-hierarchy locks for
 * A9 Home catch-up strata + A8 ribbon place-strip (CSS contracts).
 *
 * These are source locks, not browser screenshots: they fail closed if a
 * residual polish reintroduces non-token colors, whole-section opacity
 * demotion, or equal weight between place chips and More chrome.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const homeCss = readFileSync(join(here, 'home-view.css'), 'utf8');
const shellCss = readFileSync(join(here, 'shell.css'), 'utf8');

function block(css: string, selector: string): string {
  const idx = css.indexOf(selector);
  expect(idx, `missing selector ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  expect(open).toBeGreaterThan(idx);
  expect(close).toBeGreaterThan(open);
  return css.slice(open + 1, close);
}

describe('Home catch-up residual hierarchy (A9)', () => {
  it('demotes catch-up source with a real mute token (never --text-muted)', () => {
    const body = block(homeCss, '.home-catchup-source');
    expect(body).toMatch(/var\(--washi-mute\)/);
    expect(body).not.toMatch(/--text-muted|--fg-muted/);
    expect(homeCss).not.toMatch(/var\(--text-muted/);
    expect(homeCss).not.toMatch(/var\(--fg-muted/);
  });

  it('demotes Quiet by chrome/weight, not whole-section opacity', () => {
    const quiet = block(homeCss, '.home-catchup-tier--quiet');
    // The quiet tier rule itself must not fade the whole group.
    expect(quiet).not.toMatch(/opacity\s*:/);
    // Attention keeps the gold surface band; quiet stays a seam-only tail.
    const attention = block(homeCss, '.home-catchup-tier--attention');
    expect(attention).toMatch(/var\(--gold\)/);
    expect(quiet).not.toMatch(/var\(--gold/);
  });

  it('keeps Followed on lapis instrument chrome without gold competition', () => {
    const followed = block(homeCss, '.home-catchup-tier--followed');
    expect(followed).toMatch(/var\(--lapis/);
    expect(followed).not.toMatch(/var\(--gold/);
  });

  it('softens recap cards relative to the Needs-you band', () => {
    const recap = block(homeCss, '.home-recap-card');
    // Recap may wash gold faintly, but must not re-use the solid gold-bright seal.
    expect(recap).not.toMatch(/var\(--gold-bright\)/);
  });
});

describe('Presence ribbon residual hierarchy (A8)', () => {
  it('defaults More trigger quieter than place chrome', () => {
    const more = block(shellCss, '.shell-ribbon-more-trigger');
    expect(more).toMatch(/var\(--washi-mute\)/);
  });

  it('keeps place chips (event/voice) on semantic accent seals', () => {
    const event = block(shellCss, '.shell-ribbon-event-chip');
    const voice = block(shellCss, '.shell-ribbon-voice-chip');
    expect(event).toMatch(/var\(--gold/);
    expect(voice).toMatch(/var\(--lapis/);
    expect(event).toMatch(/font-weight:\s*750/);
    expect(voice).toMatch(/font-weight:\s*750/);
  });

  it('demotes connected status so it never competes with place', () => {
    const connected = block(shellCss, ".shell-ribbon-conn[data-state='connected']");
    expect(connected).toMatch(/background:\s*transparent/);
  });
});
