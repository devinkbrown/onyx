// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Tests for the Theme Studio's generative Factory section.
 *
 * Coverage areas:
 *   1. Factory controls render (generate / randomize / seed-from-current /
 *      adjust knobs / bake / auto-fix).
 *   2. Generate applies the engine's palette as live overrides.
 *   3. Randomize changes the applied --lapis var.
 *   4. Light-scheme generation flips color-scheme for the preview.
 *   5. Adjust transforms compose from a baseline and identity restores it.
 *   6. Auto-fix repairs a broken text token so auditPalette passes.
 *   7. Seed-from-current recovers the active theme's hue.
 */

import { cleanup, render, screen, fireEvent } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from './ThemeProvider';
import { ThemeStudio, seedSwatches } from './ThemeStudio';
import { THEMES, type TokenMap } from './themes';
import {
  AA_PAIRS,
  DEFAULT_SEED,
  auditPalette,
  generatePalette,
  hexToOklch,
} from './paletteFactory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getVar(prop: string): string {
  return document.documentElement.style.getPropertyValue(prop).trim();
}

function mountStudio() {
  return render(() => (
    <ThemeProvider>
      <ThemeStudio />
    </ThemeProvider>
  ));
}

/** Resolve the AA-pair tokens straight off the live root vars. */
function liveAaTokens(): TokenMap {
  const out: TokenMap = {};
  for (const [fg, bg] of AA_PAIRS) {
    out[fg] = getVar(fg);
    out[bg] = getVar(bg);
  }
  return out;
}

const HEX6 = /^#[0-9a-f]{6}$/i;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// 1. Controls render
// ---------------------------------------------------------------------------

describe('Factory controls', () => {
  it('renders the generate, randomize, seed-from-current, bake, and auto-fix controls', () => {
    mountStudio();

    expect(screen.getByTestId('ts-factory')).toBeTruthy();
    expect(screen.getByTestId('ts-generate')).toBeTruthy();
    expect(screen.getByTestId('ts-randomize')).toBeTruthy();
    expect(screen.getByTestId('ts-seed-from-current')).toBeTruthy();
    expect(screen.getByTestId('ts-bake')).toBeTruthy();
    expect(screen.getByTestId('ts-autofix')).toBeTruthy();
    expect(screen.getByTestId('ts-seed-primary')).toBeTruthy();
    expect(screen.getByTestId('ts-seed-accent')).toBeTruthy();
  });

  it('bake is disabled until an adjustment is in flight', () => {
    mountStudio();
    const bake = screen.getByTestId('ts-bake') as HTMLButtonElement;
    expect(bake.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Generate
// ---------------------------------------------------------------------------

describe('Generate', () => {
  it('clicking Generate applies the engine palette as live --* overrides', () => {
    mountStudio();

    fireEvent.click(screen.getByTestId('ts-generate'));

    const expected = generatePalette(DEFAULT_SEED);
    expect(getVar('--lapis')).toBe(expected['--lapis']);
    expect(getVar('--ink')).toBe(expected['--ink']);
    expect(getVar('--washi')).toBe(expected['--washi']);
  });

  it('changing the applied --lapis var enables the studio reset button', () => {
    mountStudio();

    const resetBtn = screen.getByTestId('ts-reset-btn') as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('ts-generate'));
    expect(resetBtn.disabled).toBe(false);
  });

  it('generating a light-scheme palette flips color-scheme for the preview', () => {
    mountStudio();

    fireEvent.click(screen.getByTestId('ts-scheme-light'));
    fireEvent.click(screen.getByTestId('ts-generate'));

    expect(getVar('color-scheme')).toBe('light');
    // The generated ground is genuinely light.
    const ink = hexToOklch(getVar('--ink'))!;
    expect(ink.l).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------
// 3. Randomize
// ---------------------------------------------------------------------------

describe('Randomize', () => {
  it('clicking Randomize changes the applied --lapis var to a fresh hex', () => {
    mountStudio();

    const before = getVar('--lapis'); // the base theme's own lapis
    fireEvent.click(screen.getByTestId('ts-randomize'));
    const after = getVar('--lapis');

    expect(after).toMatch(HEX6);
    expect(after).not.toBe(before);
  });

  it('random palettes never land in the banned purple/indigo band', () => {
    mountStudio();

    fireEvent.click(screen.getByTestId('ts-randomize'));
    const lapis = hexToOklch(getVar('--lapis'))!;
    const banned = lapis.h >= 258 && lapis.h <= 305 && lapis.c > 0.03;
    expect(banned).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Adjust — baseline composition + identity restore
// ---------------------------------------------------------------------------

describe('Adjust', () => {
  it('saturation 0 desaturates the live palette', () => {
    mountStudio();

    fireEvent.input(screen.getByTestId('ts-adjust-saturation'), { target: { value: '0' } });

    const lapis = hexToOklch(getVar('--lapis'))!;
    expect(lapis.c).toBeLessThan(0.02);
  });

  it('dragging back to identity restores the baseline palette exactly', () => {
    mountStudio();
    const before = getVar('--lapis');

    const sat = screen.getByTestId('ts-adjust-saturation');
    fireEvent.input(sat, { target: { value: '0.4' } });
    expect(getVar('--lapis')).not.toBe(before);

    fireEvent.input(sat, { target: { value: '1' } });
    expect(getVar('--lapis')).toBe(before);
  });

  it('bake commits the adjusted palette and zeroes the knobs', () => {
    mountStudio();

    const sat = screen.getByTestId('ts-adjust-saturation') as HTMLInputElement;
    fireEvent.input(sat, { target: { value: '0.5' } });
    const adjusted = getVar('--lapis');

    fireEvent.click(screen.getByTestId('ts-bake'));

    expect(getVar('--lapis')).toBe(adjusted); // tokens kept
    expect(sat.value).toBe('1'); // knob reset to identity
    expect((screen.getByTestId('ts-bake') as HTMLButtonElement).disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Auto-fix contrast
// ---------------------------------------------------------------------------

describe('Auto-fix contrast', () => {
  it('repairs a deliberately broken text token so auditPalette passes', () => {
    mountStudio();

    // Break --washi via the manual editor's own control (too dark on dark ink).
    const washiInput = document.getElementById('ts-control-washi') as HTMLInputElement;
    expect(washiInput).toBeTruthy();
    fireEvent.input(washiInput, { target: { value: '#232a33' } });
    expect(getVar('--washi')).toBe('#232a33');
    expect(auditPalette(liveAaTokens()).every((r) => r.pass)).toBe(false);

    fireEvent.click(screen.getByTestId('ts-autofix'));

    const rows = auditPalette(liveAaTokens());
    expect(rows.every((r) => r.pass), rows.filter((r) => !r.pass).map((r) => `${r.fg}/${r.bg}=${r.ratio}`).join(', ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Seed from current
// ---------------------------------------------------------------------------

describe('Seed from current', () => {
  it('recovers the active theme hue, so a re-generate stays in-family', () => {
    mountStudio();

    fireEvent.click(screen.getByTestId('ts-seed-from-current'));
    fireEvent.click(screen.getByTestId('ts-generate'));

    const generated = hexToOklch(getVar('--lapis'))!;
    const source = hexToOklch(THEMES.ocean.tokens['--lapis']!)!;
    const delta = Math.abs(((generated.h - source.h + 540) % 360) - 180);
    expect(delta).toBeLessThan(12);
  });
});

// ---------------------------------------------------------------------------
// 7. Seed swatches are faithful to the engine (no banned-hue lie)
// ---------------------------------------------------------------------------

const BANNED = { min: 258, max: 342 };
const inBannedBand = (h: number): boolean => h >= BANNED.min && h <= BANNED.max;

describe('seedSwatches', () => {
  it('returns the engine\'s exact --lapis / --gold for the seed', () => {
    const seed = { ...DEFAULT_SEED, primaryHue: 210, accentHue: 40 };
    const palette = generatePalette(seed);
    const sw = seedSwatches(seed);
    expect(sw.primary).toBe(palette['--lapis']);
    expect(sw.accent).toBe(palette['--gold']);
  });

  it('never previews a banned indigo→magenta hue even when the seed asks for one', () => {
    // A seed dialled deep into the banned arc: the picker must NOT paint the raw
    // purple the factory would never emit — it must show the snapped result.
    const seed = { ...DEFAULT_SEED, primaryHue: 300, accentHue: 320 };
    const sw = seedSwatches(seed);

    const primaryHue = hexToOklch(sw.primary)!.h;
    const accentHue = hexToOklch(sw.accent)!.h;
    expect(inBannedBand(primaryHue)).toBe(false);
    expect(inBannedBand(accentHue)).toBe(false);
  });

  it('previews the true hue for an in-gamut, allowed seed', () => {
    const seed = { ...DEFAULT_SEED, primaryHue: 200 };
    const primaryHue = hexToOklch(seedSwatches(seed).primary)!.h;
    // Allowed hue should survive within a small clamp tolerance.
    expect(Math.abs(primaryHue - 200)).toBeLessThan(10);
  });
});
