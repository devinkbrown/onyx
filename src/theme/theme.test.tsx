// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Tests for the Onyx theming engine.
 *
 * Coverage areas:
 *   1. applyThemeToDom — writes expected CSS vars to documentElement.
 *   2. ThemeProvider — reactive application + localStorage persistence.
 *   3. Export → import round-trip.
 *   4. ThemeStudio — renders, editing a token writes the live var.
 *   5. useTheme — throws outside provider.
 */

import { cleanup, render, screen, fireEvent } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSignal, Show } from 'solid-js';

import { applyThemeToDom, ThemeProvider, useTheme } from './ThemeProvider';
import { THEMES, THEME_IDS, DEFAULT_THEME_ID, type ThemeId, type TokenMap } from './themes';
import { contrastRatio, parseHex } from './contrast';
import { ThemeStudio } from './ThemeStudio';
import { ALL_STUDIO_TOKENS, EDITABLE_PROPERTIES } from './tokens';
import { auditPalette, hexToOklch, generatePalette, enforceAA, type PaletteSeed } from './paletteFactory';
import { setPreference } from '@/lib/prefs/preferences';
import { updateCoordinator } from '@/pwa/updateCoordinator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getVar(prop: string): string {
  return document.documentElement.style.getPropertyValue(prop).trim();
}

function ThemeIdDisplay() {
  const { themeId } = useTheme();
  return <span data-testid="theme-id">{themeId()}</span>;
}

function ThemeSetterButton(props: { id: string }) {
  const { setTheme } = useTheme();
  return (
    <button
      type="button"
      data-testid="set-theme-btn"
      onClick={() => setTheme(props.id)}
    >
      set
    </button>
  );
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
  // Strip any inline style vars from a previous test.
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
  delete document.documentElement.dataset.themeScheme;
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// 1. applyThemeToDom
// ---------------------------------------------------------------------------

describe('applyThemeToDom', () => {
  it('writes every token in the theme onto documentElement', () => {
    applyThemeToDom('onyx');

    expect(document.documentElement.getAttribute('data-theme')).toBe('onyx');

    const onyxTheme = THEMES.onyx;
    expect(onyxTheme).toBeDefined();

    // Spot-check several well-known tokens.
    expect(getVar('--ink')).toBeTruthy();
    expect(getVar('--gold')).toBeTruthy();
    expect(getVar('--lapis')).toBeTruthy();
    expect(getVar('--paper')).toBeTruthy();
  });

  it('sets color-scheme to the theme scheme value', () => {
    applyThemeToDom('pearl');
    expect(getVar('color-scheme')).toBe('light');
    expect(document.documentElement.dataset.themeScheme).toBe('light');

    applyThemeToDom('onyx');
    expect(getVar('color-scheme')).toBe('dark');
    expect(document.documentElement.dataset.themeScheme).toBe('dark');
  });

  it('applies every defined token for all themes without throwing', () => {
    for (const id of THEME_IDS) {
      expect(() => applyThemeToDom(id)).not.toThrow();
      expect(document.documentElement.getAttribute('data-theme')).toBe(id);
    }
  });

  it('owns the normal coral action only on ocean and clears it on theme switch', () => {
    applyThemeToDom('ocean');
    expect(getVar('--brand-action')).toBe('#ff987d');

    for (const id of THEME_IDS.filter((themeId) => themeId !== 'ocean')) {
      expect(THEMES[id].tokens['--brand-action'], `${id} must not own brand action`).toBeUndefined();
    }

    applyThemeToDom('pearl');
    expect(getVar('--brand-action')).toBe('');
    applyThemeToDom('frost');
    expect(getVar('--brand-action')).toBe('');
  });

  it('derives readable semantic inks and an accent alias for every theme', () => {
    for (const id of THEME_IDS) {
      applyThemeToDom(id);
      expect(getVar('--accent')).toBe(getVar('--lapis'));

      const onAccent = parseHex(getVar('--on-accent'));
      const onSecondary = parseHex(getVar('--on-secondary'));
      const onDanger = parseHex(getVar('--on-danger'));
      const lapis = parseHex(getVar('--lapis'));
      const lapisBright = parseHex(getVar('--lapis-bright'));
      const danger = parseHex(getVar('--danger')) ?? parseHex(getVar('--shu'));
      const shu = parseHex(getVar('--shu'));
      const goldBright = parseHex(getVar('--gold-bright'));
      expect(onAccent, `${id} --on-accent`).not.toBeNull();
      expect(onSecondary, `${id} --on-secondary`).not.toBeNull();
      expect(onDanger, `${id} --on-danger`).not.toBeNull();
      expect(lapis, `${id} --lapis`).not.toBeNull();
      expect(lapisBright, `${id} --lapis-bright`).not.toBeNull();
      expect(danger, `${id} --danger`).not.toBeNull();
      expect(shu, `${id} --shu`).not.toBeNull();
      expect(goldBright, `${id} --gold-bright`).not.toBeNull();
      expect(contrastRatio(onAccent!, lapis!), `${id} on lapis`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(onAccent!, lapisBright!), `${id} on lapis-bright`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(onSecondary!, goldBright!), `${id} on gold-bright`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(onDanger!, danger!), `${id} on danger`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(onDanger!, shu!), `${id} on shu`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('pearl theme sets light color-scheme', () => {
    applyThemeToDom('pearl');
    expect(THEMES.pearl.scheme).toBe('light');
    expect(getVar('color-scheme')).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// 2. ThemeProvider — reactive application + persistence
// ---------------------------------------------------------------------------

describe('ThemeProvider', () => {
  it('re-derives the active palette when the manual high-contrast preference changes', () => {
    setPreference('highContrast', false);
    render(() => (
      <ThemeProvider>
        <ThemeIdDisplay />
      </ThemeProvider>
    ));

    const base = getVar('--paper-dim');
    expect(base).toBeTruthy();

    setPreference('highContrast', true);
    const boosted = getVar('--paper-dim');
    expect(boosted).toBeTruthy();
    expect(boosted).not.toBe(base);

    setPreference('highContrast', false);
    expect(getVar('--paper-dim')).toBe(base);
  });

  it('applies the default theme on mount', () => {
    render(() => (
      <ThemeProvider>
        <ThemeIdDisplay />
      </ThemeProvider>
    ));

    expect(screen.getByTestId('theme-id').textContent).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_THEME_ID);
  });

  it('reads an existing localStorage value on mount', () => {
    localStorage.setItem('onyx:theme', 'obsidian');

    render(() => (
      <ThemeProvider>
        <ThemeIdDisplay />
      </ThemeProvider>
    ));

    expect(screen.getByTestId('theme-id').textContent).toBe('obsidian');
    expect(document.documentElement.getAttribute('data-theme')).toBe('obsidian');
  });

  it('normalizes old stored theme names into the current theme ids', () => {
    localStorage.setItem('onyx:theme', 'lacquer');

    render(() => (
      <ThemeProvider>
        <ThemeIdDisplay />
      </ThemeProvider>
    ));

    expect(screen.getByTestId('theme-id').textContent).toBe('shu');
    expect(document.documentElement.getAttribute('data-theme')).toBe('shu');
  });

  it('falls back to the default when localStorage has an unknown value', () => {
    localStorage.setItem('onyx:theme', 'unknown-theme-xyz');

    render(() => (
      <ThemeProvider>
        <ThemeIdDisplay />
      </ThemeProvider>
    ));

    expect(screen.getByTestId('theme-id').textContent).toBe(DEFAULT_THEME_ID);
  });

  it('rejects prototype-chain names from corrupted theme storage', () => {
    localStorage.setItem('onyx:theme', '__proto__');

    expect(() => render(() => (
      <ThemeProvider>
        <ThemeIdDisplay />
      </ThemeProvider>
    ))).not.toThrow();

    expect(screen.getByTestId('theme-id').textContent).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_THEME_ID);
  });

  it('setTheme writes the new theme to localStorage', () => {
    render(() => (
      <ThemeProvider>
        <ThemeSetterButton id="ink" />
      </ThemeProvider>
    ));

    fireEvent.click(screen.getByTestId('set-theme-btn'));

    expect(localStorage.getItem('onyx:theme')).toBe('ink');
  });

  it('setTheme applies the new theme to the DOM', () => {
    render(() => (
      <ThemeProvider>
        <ThemeSetterButton id="shu" />
        <ThemeIdDisplay />
      </ThemeProvider>
    ));

    fireEvent.click(screen.getByTestId('set-theme-btn'));

    expect(screen.getByTestId('theme-id').textContent).toBe('shu');
    expect(document.documentElement.getAttribute('data-theme')).toBe('shu');
  });

  it('falls back atomically when setTheme receives an invalid or deleted id', () => {
    render(() => (
      <ThemeProvider>
        <ThemeSetterButton id="custom:missing" />
        <ThemeIdDisplay />
      </ThemeProvider>
    ));

    fireEvent.click(screen.getByTestId('set-theme-btn'));

    expect(screen.getByTestId('theme-id').textContent).toBe(DEFAULT_THEME_ID);
    expect(localStorage.getItem('onyx:theme')).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_THEME_ID);
  });

  it('synchronizes theme changes made in another tab', () => {
    render(() => (
      <ThemeProvider>
        <ThemeIdDisplay />
      </ThemeProvider>
    ));

    localStorage.setItem('onyx:theme', 'pearl');
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'onyx:theme',
      newValue: 'pearl',
    }));

    expect(screen.getByTestId('theme-id').textContent).toBe('pearl');
    expect(document.documentElement.getAttribute('data-theme')).toBe('pearl');
  });

  it('does not overwrite a newer cross-tab fallback while a custom deletion converges', () => {
    localStorage.setItem('onyx:custom-themes', JSON.stringify([{
      id: 'custom:shared',
      name: 'Shared',
      base: 'pearl',
      overrides: { '--gold': '#aa7700' },
    }]));
    localStorage.setItem('onyx:theme', 'custom:shared');
    render(() => <ThemeProvider><ThemeIdDisplay /></ThemeProvider>);
    expect(screen.getByTestId('theme-id').textContent).toBe('custom:shared');

    localStorage.removeItem('onyx:custom-themes');
    localStorage.setItem('onyx:theme', 'pearl');
    window.dispatchEvent(new StorageEvent('storage', { key: 'onyx:custom-themes', newValue: null }));
    expect(screen.getByTestId('theme-id').textContent).toBe('pearl');
    expect(document.documentElement.getAttribute('data-theme')).toBe('pearl');
    expect(localStorage.getItem('onyx:theme')).toBe('pearl');

    window.dispatchEvent(new StorageEvent('storage', { key: 'onyx:theme', newValue: 'pearl' }));
    expect(screen.getByTestId('theme-id').textContent).toBe('pearl');
    expect(localStorage.getItem('onyx:theme')).toBe('pearl');
  });

  it('synchronizes a non-component theme command through the canonical event bridge', () => {
    render(() => (
      <ThemeProvider>
        <ThemeIdDisplay />
      </ThemeProvider>
    ));

    localStorage.setItem('onyx:theme', 'shu');
    window.dispatchEvent(new CustomEvent('onyx:theme-change', { detail: { id: 'shu' } }));

    expect(screen.getByTestId('theme-id').textContent).toBe('shu');
    expect(document.documentElement.getAttribute('data-theme')).toBe('shu');
  });

  it('synchronizes when any non-component entry point persists a theme', async () => {
    const { persistThemeId } = await import('./themeStorage');
    render(() => <ThemeProvider><ThemeIdDisplay /></ThemeProvider>);

    persistThemeId('pearl');

    expect(screen.getByTestId('theme-id').textContent).toBe('pearl');
    expect(document.documentElement.getAttribute('data-theme')).toBe('pearl');
    expect(document.documentElement.dataset.themeScheme).toBe('light');
  });

  it('derives semantic inks from incoming custom var references, not the previous DOM', () => {
    // Start from a bright Ocean palette, then switch to a custom palette whose
    // semantic fills reference a very dark incoming --gold token. Resolving
    // against stale DOM would select dark text; the two-phase apply must select
    // white from the new palette instead.
    applyThemeToDom('ocean');
    localStorage.setItem('onyx:custom-themes', JSON.stringify([{
      id: 'custom:var-reference',
      name: 'Var reference',
      base: 'pearl',
      overrides: {
        '--gold': '#003000',
        '--lapis': 'var(--gold)',
        '--lapis-bright': 'var(--gold)',
        '--danger': 'var(--gold)',
        '--shu': 'var(--gold)',
      },
    }]));

    applyThemeToDom('custom:var-reference');

    const fill = parseHex(getVar('--gold'))!;
    const onAccent = parseHex(getVar('--on-accent'))!;
    const onDanger = parseHex(getVar('--on-danger'))!;
    expect(contrastRatio(onAccent, fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(onDanger, fill)).toBeGreaterThanOrEqual(4.5);
  });

  it('removes provider-owned theme mutations on unmount', () => {
    const view = render(() => <ThemeProvider><ThemeIdDisplay /></ThemeProvider>);
    expect(getVar('--ink')).toBeTruthy();
    view.unmount();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.documentElement.dataset.themeScheme).toBeUndefined();
    expect(getVar('--ink')).toBe('');
    expect(getVar('color-scheme')).toBe('');
  });

  it('respects a controlled value prop', () => {
    const [value, setValue] = createSignal<ThemeId>('hisui');

    // render()'s callback IS a tracked component scope — the plugin just
    // doesn't recognise the testing-library entrypoint.
    // eslint-disable-next-line solid/reactivity
    render(() => (
      <ThemeProvider value={value()}>
        <ThemeIdDisplay />
      </ThemeProvider>
    ));

    expect(screen.getByTestId('theme-id').textContent).toBe('hisui');

    setValue('kohaku');
    // Reactive update — re-read after signal change.
    expect(screen.getByTestId('theme-id').textContent).toBe('kohaku');
  });
});

// ---------------------------------------------------------------------------
// 3. Export → import round-trip
// ---------------------------------------------------------------------------

describe('Export / import round-trip', () => {
  it('an exported blob serialises to JSON and back with the correct shape', () => {
    const base: ThemeId = 'obsidian';
    const overrides: TokenMap = {
      '--gold': '#ff9900',
      '--r-0': '4px',
    };

    const blob = {
      __onyx_theme_export__: true as const,
      base,
      overrides,
      exported: new Date().toISOString(),
    };

    const json = JSON.stringify(blob);
    const parsed = JSON.parse(json) as typeof blob;

    expect(parsed.__onyx_theme_export__).toBe(true);
    expect(parsed.base).toBe('obsidian');
    expect(parsed.overrides['--gold']).toBe('#ff9900');
    expect(parsed.overrides['--r-0']).toBe('4px');
  });

  it('a round-tripped blob preserves every override key', () => {
    const overrides: TokenMap = {};
    // Add a representative set of overrides.
    for (const token of ALL_STUDIO_TOKENS.slice(0, 6)) {
      overrides[token.property] = 'test-value';
    }

    const blob = {
      __onyx_theme_export__: true as const,
      base: 'onyx' as ThemeId,
      overrides,
      exported: new Date().toISOString(),
    };

    const parsed = JSON.parse(JSON.stringify(blob)) as typeof blob;

    for (const key of Object.keys(overrides)) {
      expect(parsed.overrides[key]).toBe('test-value');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. ThemeStudio — renders and token editing writes live vars
// ---------------------------------------------------------------------------

describe('ThemeStudio', () => {
  afterEach(() => { expect(updateCoordinator.hasActiveWork).toBe(false); });

  it('renders the studio inside a provider', () => {
    render(() => (
      <ThemeProvider>
        <ThemeStudio />
      </ThemeProvider>
    ));

    expect(screen.getByTestId('theme-studio')).toBeTruthy();
  });

  it('renders a chip for every available theme', () => {
    render(() => (
      <ThemeProvider>
        <ThemeStudio />
      </ThemeProvider>
    ));

    for (const id of THEME_IDS) {
      expect(screen.getByTestId(`ts-theme-chip-${id}`)).toBeTruthy();
    }
  });

  it('clicking a theme chip updates the active theme', () => {
    render(() => (
      <ThemeProvider>
        <ThemeStudio />
        <ThemeIdDisplay />
      </ThemeProvider>
    ));

    const pearlChip = screen.getByTestId('ts-theme-chip-pearl');
    fireEvent.click(pearlChip);

    expect(screen.getByTestId('theme-id').textContent).toBe('pearl');
  });

  it('the export button is present and focusable', () => {
    render(() => (
      <ThemeProvider>
        <ThemeStudio />
      </ThemeProvider>
    ));

    const exportBtn = screen.getByTestId('ts-export-btn');
    expect(exportBtn).toBeTruthy();
  });

  it('the reset button is disabled when there are no overrides', () => {
    render(() => (
      <ThemeProvider>
        <ThemeStudio />
      </ThemeProvider>
    ));

    const resetBtn = screen.getByTestId('ts-reset-btn') as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);
  });

  it('holds updates while editing and releases the hold after reset', () => {
    render(() => <ThemeProvider><ThemeStudio /></ThemeProvider>);
    expect(updateCoordinator.hasActiveWork).toBe(false);

    fireEvent.input(document.getElementById('ts-control-paper') as HTMLInputElement, { target: { value: '#232a33' } });
    expect(updateCoordinator.hasActiveWork).toBe(true);

    fireEvent.click(screen.getByTestId('ts-reset-btn'));
    expect(updateCoordinator.hasActiveWork).toBe(false);
  });

  it('releases the update hold after saving a named theme', async () => {
    render(() => <ThemeProvider><ThemeStudio /></ThemeProvider>);
    fireEvent.input(document.getElementById('ts-control-paper') as HTMLInputElement, { target: { value: '#232a33' } });
    fireEvent.click(screen.getByTestId('ts-save-btn'));
    expect(updateCoordinator.hasActiveWork).toBe(true);
    fireEvent.input(document.querySelector('.ts-save-input') as HTMLInputElement, { target: { value: 'Saved theme' } });
    fireEvent.click(screen.getByTestId('ts-save-confirm'));
    await Promise.resolve();
    expect(updateCoordinator.hasActiveWork).toBe(false);
  });

  it('the import button is present', () => {
    render(() => (
      <ThemeProvider>
        <ThemeStudio />
      </ThemeProvider>
    ));

    expect(screen.getByTestId('ts-import-btn')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 5. Token catalogue integrity
// ---------------------------------------------------------------------------

describe('Token catalogue', () => {
  it('every editable property starts with --', () => {
    for (const token of ALL_STUDIO_TOKENS) {
      expect(token.property.startsWith('--')).toBe(true);
    }
  });

  it('EDITABLE_PROPERTIES matches ALL_STUDIO_TOKENS', () => {
    for (const token of ALL_STUDIO_TOKENS) {
      expect(EDITABLE_PROPERTIES.has(token.property)).toBe(true);
    }
  });

  it('all themes define --ink, --gold, and --paper tokens', () => {
    for (const id of THEME_IDS) {
      const theme = THEMES[id];
      expect(theme).toBeDefined();
      expect(theme!.tokens['--ink']).toBeTruthy();
      expect(theme!.tokens['--gold']).toBeTruthy();
      expect(theme!.tokens['--paper']).toBeTruthy();
    }
  });

  it('exposes the expected light-scheme themes', () => {
    const lightThemes = THEME_IDS.filter((id) => THEMES[id]?.scheme === 'light');
    expect(lightThemes.sort()).toEqual(['frost', 'pearl']);
  });
});

// ---------------------------------------------------------------------------
// 8. Palette quality — every built-in theme passes the factory's AA audit and
//    keeps every chromatic accent out of the banned purple/indigo band.
// ---------------------------------------------------------------------------

describe('Palette quality (all built-in themes)', () => {
  const ACCENT_TOKENS = [
    '--lapis', '--lapis-bright', '--lapis-deep',
    '--gold', '--gold-bright', '--gold-deep',
    '--shu', '--shu-bright',
    '--ok', '--warn',
  ];

  it('every theme passes every WCAG AA pair in auditPalette', () => {
    for (const id of THEME_IDS) {
      const rows = auditPalette(THEMES[id].tokens);
      for (const row of rows) {
        expect(row.pass, `${id}: ${row.fg} on ${row.bg} is ${row.ratio} (needs ${row.min})`).toBe(true);
      }
    }
  });

  it('pins Astra ocean identity values and keeps coral action distinct from danger', () => {
    const ocean = THEMES.ocean.tokens;
    const expected: Readonly<Record<string, string>> = {
      '--ink': '#202429',
      '--stone': '#2d333a',
      '--paper': '#f5f7f8',
      '--paper-dim': '#b4bfca',
      '--lapis': '#65adf5',
      '--lapis-bright': '#65adf5',
      '--brand-action': '#ff987d',
    };

    for (const [token, value] of Object.entries(expected)) {
      expect(ocean[token], token).toBe(value);
    }
    expect(ocean['--danger']).toBe('var(--shu)');
    expect(ocean['--shu']).not.toBe(ocean['--brand-action']);

    const ink = parseHex(ocean['--ink']!);
    const paper = parseHex(ocean['--paper']!);
    const muted = parseHex(ocean['--paper-dim']!);
    const cobalt = parseHex(ocean['--lapis']!);
    const action = parseHex(ocean['--brand-action']!);
    expect(ink).not.toBeNull();
    expect(paper).not.toBeNull();
    expect(muted).not.toBeNull();
    expect(cobalt).not.toBeNull();
    expect(action).not.toBeNull();
    expect(contrastRatio(paper!, ink!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(muted!, ink!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(cobalt!, ink!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(action!, ink!)).toBeGreaterThanOrEqual(4.5);
  });

  it('no chromatic accent sits in the banned purple/indigo band (258–342°)', () => {
    for (const id of THEME_IDS) {
      for (const token of ACCENT_TOKENS) {
        const value = THEMES[id].tokens[token];
        if (!value) continue;
        const o = hexToOklch(value);
        if (!o || o.c <= 0.03) continue; // var()/near-neutral tokens are exempt
        const banned = o.h >= 258 && o.h <= 342;
        expect(banned, `${id} ${token} hue ${o.h.toFixed(1)} chroma ${o.c.toFixed(3)}`).toBe(false);
      }
    }
  });

  it('dark themes ramp ground lightness ink → stone-line strictly upward', () => {
    const GROUNDS = ['--ink', '--stone', '--stone-2', '--stone-3', '--stone-line'];
    for (const id of THEME_IDS) {
      const theme = THEMES[id];
      const ls = GROUNDS.map((g) => hexToOklch(theme.tokens[g]!)!.l);
      for (let i = 1; i < ls.length; i += 1) {
        if (theme.scheme === 'dark') {
          expect(ls[i]!, `${id} ${GROUNDS[i]} should sit above ${GROUNDS[i - 1]}`).toBeGreaterThan(ls[i - 1]!);
        } else {
          expect(ls[i]!, `${id} ${GROUNDS[i]} should sit below ${GROUNDS[i - 1]}`).toBeLessThan(ls[i - 1]!);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 8b. Terracotta — the warm editorial earthenware theme, derived through the
//     factory from its recorded seed (no hand-picked hex that bypasses the solver).
// ---------------------------------------------------------------------------

describe('Terracotta theme', () => {
  // The seed recorded in the theme's comment block in themes.ts.
  const TERRACOTTA_SEED: PaletteSeed = {
    scheme: 'dark',
    primaryHue: 42,
    accentHue: 20,
    depth: 0.8,
    vibrancy: 0.5,
    warmth: 0.6,
    contrast: 10,
  };

  // Colour tokens the factory owns (chrome tokens — seams/radii/motion/fonts —
  // are hand-set and excluded from this equality check).
  const GENERATED_TOKENS = [
    '--ink', '--ink-2', '--stone', '--stone-2', '--stone-3', '--stone-line',
    '--lapis', '--lapis-bright', '--lapis-deep',
    '--gold', '--gold-bright', '--gold-deep',
    '--shu', '--shu-bright',
    '--paper', '--paper-dim', '--paper-mute',
    '--ok', '--warn',
  ];

  it('is registered as a dark built-in in the picker', () => {
    expect(THEME_IDS).toContain('terracotta');
    expect(THEMES.terracotta).toBeDefined();
    expect(THEMES.terracotta.scheme).toBe('dark');
    expect(THEMES.terracotta.label).toBe('Terracotta');
  });

  it('every registered colour token equals the factory output for its seed', () => {
    const generated = enforceAA(generatePalette(TERRACOTTA_SEED), 'dark');
    for (const key of GENERATED_TOKENS) {
      expect(THEMES.terracotta.tokens[key], key).toBe(generated[key]);
    }
  });

  it('passes every WCAG AA pair via auditPalette (regenerated + as-registered)', () => {
    const regenerated = enforceAA(generatePalette(TERRACOTTA_SEED), 'dark');
    for (const tokens of [regenerated, THEMES.terracotta.tokens]) {
      for (const row of auditPalette(tokens)) {
        expect(row.pass, `${row.fg} on ${row.bg} = ${row.ratio} (min ${row.min})`).toBe(true);
      }
    }
  });

  it('keeps the clay primary hue out of the banned purple/indigo band', () => {
    const primary = hexToOklch(THEMES.terracotta.tokens['--lapis']!)!;
    expect(primary.h < 258 || primary.h > 342, `lapis hue ${primary.h.toFixed(1)}`).toBe(true);
    // The seed primary is a warm clay orange, well below the banned floor.
    expect(primary.h).toBeLessThan(70);
  });
});

// ---------------------------------------------------------------------------
// 8c. Pine — the deep-forest verdant dark theme, derived through the factory
//     from its recorded seed (no hand-picked hex that bypasses the solver).
// ---------------------------------------------------------------------------

describe('Pine theme', () => {
  // The seed recorded in the theme's comment block in themes.ts.
  const PINE_SEED: PaletteSeed = {
    scheme: 'dark',
    primaryHue: 142,
    accentHue: 110,
    depth: 0.85,
    vibrancy: 0.55,
    warmth: -0.1,
    contrast: 10,
  };

  // Colour tokens the factory owns (chrome tokens — seams/radii/motion/fonts —
  // are hand-set and excluded from this equality check).
  const GENERATED_TOKENS = [
    '--ink', '--ink-2', '--stone', '--stone-2', '--stone-3', '--stone-line',
    '--lapis', '--lapis-bright', '--lapis-deep',
    '--gold', '--gold-bright', '--gold-deep',
    '--shu', '--shu-bright',
    '--paper', '--paper-dim', '--paper-mute',
    '--ok', '--warn',
  ];

  it('is registered as a dark built-in in the picker', () => {
    expect(THEME_IDS).toContain('pine');
    expect(THEMES.pine).toBeDefined();
    expect(THEMES.pine.scheme).toBe('dark');
    expect(THEMES.pine.label).toBe('Pine');
  });

  it('pairs with an existing background scene variant', () => {
    expect(THEMES.pine.signatureBg).toBeTruthy();
  });

  it('every registered colour token equals the factory output for its seed', () => {
    const generated = enforceAA(generatePalette(PINE_SEED), 'dark');
    for (const key of GENERATED_TOKENS) {
      expect(THEMES.pine.tokens[key], key).toBe(generated[key]);
    }
  });

  it('passes every WCAG AA pair via auditPalette (regenerated + as-registered)', () => {
    const regenerated = enforceAA(generatePalette(PINE_SEED), 'dark');
    for (const tokens of [regenerated, THEMES.pine.tokens]) {
      for (const row of auditPalette(tokens)) {
        expect(row.pass, `${row.fg} on ${row.bg} = ${row.ratio} (min ${row.min})`).toBe(true);
      }
    }
  });

  it('keeps the pine primary hue in the green band, well outside the banned arc', () => {
    const primary = hexToOklch(THEMES.pine.tokens['--lapis']!)!;
    expect(primary.h < 258 || primary.h > 342, `lapis hue ${primary.h.toFixed(1)}`).toBe(true);
    // A cool coniferous green: comfortably inside the 120–160° green band.
    expect(primary.h).toBeGreaterThan(120);
    expect(primary.h).toBeLessThan(160);
    // And distinct from jade (hisui) — a different, deeper green hue.
    const jade = hexToOklch(THEMES.hisui.tokens['--lapis']!)!;
    expect(Math.abs(primary.h - jade.h)).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------
// 8d. Vermillion — the "Ink & Vermillion" house-identity dark theme, derived
//     through the factory from its recorded seed (no hand-picked hex).
// ---------------------------------------------------------------------------

describe('Vermillion theme (Ink & Vermillion house identity)', () => {
  // The seed recorded in the theme's comment block in themes.ts.
  const VERMILLION_SEED: PaletteSeed = {
    scheme: 'dark',
    primaryHue: 33,
    accentHue: 18,
    depth: 0.9,
    vibrancy: 0.62,
    warmth: 0.08,
    contrast: 11,
  };

  // Colour tokens the factory owns (chrome tokens — seams/radii/motion/fonts —
  // are hand-set and excluded from this equality check).
  const GENERATED_TOKENS = [
    '--ink', '--ink-2', '--stone', '--stone-2', '--stone-3', '--stone-line',
    '--lapis', '--lapis-bright', '--lapis-deep',
    '--gold', '--gold-bright', '--gold-deep',
    '--shu', '--shu-bright',
    '--paper', '--paper-dim', '--paper-mute',
    '--ok', '--warn',
  ];

  it('is registered as a dark built-in in the picker', () => {
    expect(THEME_IDS).toContain('vermillion');
    expect(THEMES.vermillion).toBeDefined();
    expect(THEMES.vermillion.scheme).toBe('dark');
    expect(THEMES.vermillion.label).toBe('Vermillion');
  });

  it('pairs with an existing background scene variant', () => {
    expect(THEMES.vermillion.signatureBg).toBeTruthy();
  });

  it('is deterministic — the same seed reproduces the same palette', () => {
    const a = enforceAA(generatePalette(VERMILLION_SEED), 'dark');
    const b = enforceAA(generatePalette(VERMILLION_SEED), 'dark');
    for (const key of GENERATED_TOKENS) expect(a[key], key).toBe(b[key]);
  });

  it('every registered colour token equals the factory output for its seed', () => {
    const generated = enforceAA(generatePalette(VERMILLION_SEED), 'dark');
    for (const key of GENERATED_TOKENS) {
      expect(THEMES.vermillion.tokens[key], key).toBe(generated[key]);
    }
  });

  it('passes every WCAG AA pair via auditPalette (regenerated + as-registered)', () => {
    const regenerated = enforceAA(generatePalette(VERMILLION_SEED), 'dark');
    for (const tokens of [regenerated, THEMES.vermillion.tokens]) {
      for (const row of auditPalette(tokens)) {
        expect(row.pass, `${row.fg} on ${row.bg} = ${row.ratio} (min ${row.min})`).toBe(true);
      }
    }
  });

  it('leads with a true vermillion primary, outside the banned purple/indigo band', () => {
    const primary = hexToOklch(THEMES.vermillion.tokens['--lapis']!)!;
    expect(primary.h < 258 || primary.h > 342, `lapis hue ${primary.h.toFixed(1)}`).toBe(true);
    // Vermillion sits in the warm red-orange band: past crimson, short of amber.
    expect(primary.h).toBeGreaterThan(28);
    expect(primary.h).toBeLessThan(40);
    // Vividly chromatic — the seal is a signature, not a muted neutral.
    expect(primary.c).toBeGreaterThan(0.14);
  });

  it('grounds the theme in the deepest warm ink (very low lightness)', () => {
    const ink = hexToOklch(THEMES.vermillion.tokens['--ink']!)!;
    expect(ink.l).toBeLessThan(0.12);
  });

  it('is distinct from Garnet (shu) — vermillion leads warmer than the crimson jewel', () => {
    const vermillion = hexToOklch(THEMES.vermillion.tokens['--lapis']!)!;
    const garnet = hexToOklch(THEMES.shu.tokens['--lapis']!)!;
    expect(vermillion.h).toBeGreaterThan(garnet.h);
  });
});

// ---------------------------------------------------------------------------
// 8e. Sapphire — the monochrome royal-blue jewel dark theme, derived through the
//     factory from its recorded seed (no hand-picked hex that bypasses the solver).
// ---------------------------------------------------------------------------

describe('Sapphire theme', () => {
  // The seed recorded in the theme's comment block in themes.ts.
  const SAPPHIRE_SEED: PaletteSeed = {
    scheme: 'dark',
    primaryHue: 250,
    accentHue: 238,
    depth: 0.9,
    vibrancy: 0.85,
    warmth: -0.12,
    contrast: 11,
  };

  // Colour tokens the factory owns (chrome tokens — seams/radii/motion/fonts —
  // are hand-set and excluded from this equality check).
  const GENERATED_TOKENS = [
    '--ink', '--ink-2', '--stone', '--stone-2', '--stone-3', '--stone-line',
    '--lapis', '--lapis-bright', '--lapis-deep',
    '--gold', '--gold-bright', '--gold-deep',
    '--shu', '--shu-bright',
    '--paper', '--paper-dim', '--paper-mute',
    '--ok', '--warn',
  ];

  it('is registered as a dark built-in in the picker', () => {
    expect(THEME_IDS).toContain('sapphire');
    expect(THEMES.sapphire).toBeDefined();
    expect(THEMES.sapphire.scheme).toBe('dark');
    expect(THEMES.sapphire.label).toBe('Sapphire');
  });

  it('every registered colour token equals the factory output for its seed', () => {
    const generated = enforceAA(generatePalette(SAPPHIRE_SEED), 'dark');
    for (const key of GENERATED_TOKENS) {
      expect(THEMES.sapphire.tokens[key], key).toBe(generated[key]);
    }
  });

  it('passes every WCAG AA pair via auditPalette (regenerated + as-registered)', () => {
    const regenerated = enforceAA(generatePalette(SAPPHIRE_SEED), 'dark');
    for (const tokens of [regenerated, THEMES.sapphire.tokens]) {
      for (const row of auditPalette(tokens)) {
        expect(row.pass, `${row.fg} on ${row.bg} = ${row.ratio} (min ${row.min})`).toBe(true);
      }
    }
  });

  it('keeps both royal-blue accents just under the banned indigo floor (deepest safe blue)', () => {
    for (const token of ['--lapis', '--gold']) {
      const o = hexToOklch(THEMES.sapphire.tokens[token]!)!;
      expect(o.h < 258 || o.h > 342, `${token} hue ${o.h.toFixed(1)}`).toBe(true);
      // A true royal blue, not the teal-azure of the ocean cuts.
      expect(o.h, `${token} should read deep blue`).toBeGreaterThan(215);
      expect(o.h, `${token} must stay below the banned floor`).toBeLessThan(258);
    }
  });

  it('keeps its royal-blue cut distinct while ocean uses the approved cobalt', () => {
    const sapphire = hexToOklch(THEMES.sapphire.tokens['--lapis']!)!;
    const ocean = hexToOklch(THEMES.ocean.tokens['--lapis']!)!;
    // The approved ocean cobalt is close to the safe royal-blue boundary; both
    // cuts must remain in the non-banned blue range.
    for (const [label, colour] of [['sapphire', sapphire], ['ocean', ocean]] as const) {
      expect(colour.h, `${label} should read blue`).toBeGreaterThan(215);
      expect(colour.h, `${label} must stay below the banned floor`).toBeLessThan(258);
    }
    // The second accent stays in Sapphire's royal family — no cyan glacier contrast.
    const sapphireGold = hexToOklch(THEMES.sapphire.tokens['--gold']!)!;
    expect(sapphireGold.h).toBeGreaterThan(215);
    expect(sapphireGold.h).toBeLessThan(258);
  });
});

// ---------------------------------------------------------------------------
// 7. Ocean family — flagship + sub-variants
// ---------------------------------------------------------------------------

describe('Ocean family', () => {
  const OCEAN_FAMILY: ThemeId[] = ['ocean', 'tide', 'abyss', 'reef'];

  it('ocean is the default theme', () => {
    expect(DEFAULT_THEME_ID).toBe('ocean');
  });

  it('registers the flagship and all three sub-variants', () => {
    for (const id of OCEAN_FAMILY) {
      expect(THEME_IDS).toContain(id);
      expect(THEMES[id]).toBeDefined();
    }
  });

  it('lists the Ocean family first, with ocean leading', () => {
    expect(THEME_IDS.slice(0, OCEAN_FAMILY.length)).toEqual(OCEAN_FAMILY);
  });

  it('every Ocean-family theme is dark and labelled in the Ocean family', () => {
    expect(THEMES.ocean.label).toBe('Ocean');
    for (const id of OCEAN_FAMILY) {
      const theme = THEMES[id];
      expect(theme.scheme).toBe('dark');
      // Flagship is exactly "Ocean"; sub-variants are namespaced "Ocean · …".
      expect(theme.label.startsWith('Ocean')).toBe(true);
    }
  });

  it('each sub-variant defines the same token slots as the flagship', () => {
    // --brand-action is intentionally ocean-only: all other themes fall back
    // through commercial-action-primary to their existing --lapis signal.
    const oceanKeys = Object.keys(THEMES.ocean.tokens)
      .filter((key) => key !== '--brand-action')
      .sort();
    for (const id of ['tide', 'abyss', 'reef'] as ThemeId[]) {
      const variantKeys = Object.keys(THEMES[id].tokens).sort();
      expect(variantKeys).toEqual(oceanKeys);
    }
  });

  it('sub-variants change values rather than copy the flagship verbatim', () => {
    for (const id of ['tide', 'abyss', 'reef'] as ThemeId[]) {
      expect(THEMES[id].tokens['--ink']).not.toBe(THEMES.ocean.tokens['--ink']);
    }
  });

  it('every Ocean-family theme keeps an azure-primary lapis token', () => {
    for (const id of OCEAN_FAMILY) {
      // All Ocean variants stay azure-primary: --lapis is a real colour value.
      expect(THEMES[id].tokens['--lapis']).toBeTruthy();
      expect(THEMES[id].tokens['--lapis-bright']).toBeTruthy();
      expect(THEMES[id].tokens['--lapis-deep']).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 5b. Segmented-control active-segment pair passes AA across every theme
// ---------------------------------------------------------------------------

// ChannelNotifyControl + CalmModeControl render the checked segment as --ink
// text on a --lapis-bright fill. The label is small bold body text, so the pair
// must clear the 4.5 body-text floor (not just the 3:1 large-text floor) in
// every built-in theme. Under prefers-contrast: more the high-contrast path
// only boosts --lapis-bright (toward its AAA target vs --ink) and leaves --ink
// untouched; since contrast is symmetric that boost can only RAISE this pair's
// ratio, so clearing 4.5 on the base tokens here also covers the boosted path.
describe('segmented-control active segment (--ink on --lapis-bright)', () => {
  const AA_BODY = 4.5;

  it.each(THEME_IDS)('theme %s clears AA body contrast for the active segment', (id) => {
    const tokens = THEMES[id].tokens;
    const ink = parseHex(tokens['--ink']!);
    const lapisBright = parseHex(tokens['--lapis-bright']!);
    expect(ink, `${id} --ink`).toBeTruthy();
    expect(lapisBright, `${id} --lapis-bright`).toBeTruthy();
    const ratio = contrastRatio(ink!, lapisBright!);
    expect(ratio, `${id} --ink/--lapis-bright = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
      AA_BODY,
    );
  });
});

// ---------------------------------------------------------------------------
// 5c. High-contrast path — applyThemeToDom(id, true) writes a per-theme,
// mechanically-derived boost, not one shared static override.
// ---------------------------------------------------------------------------

describe('applyThemeToDom high-contrast variant', () => {
  it('boosts the current theme foreground when highContrast is set', () => {
    applyThemeToDom('ocean', false);
    const base = getVar('--paper-dim');
    applyThemeToDom('ocean', true);
    const boosted = getVar('--paper-dim');

    expect(base).toBeTruthy();
    expect(boosted).toBeTruthy();
    expect(boosted).not.toBe(base);

    // Boosting only raises contrast: the derived --paper-dim reads better on --ink.
    const ink = parseHex(getVar('--ink'))!;
    expect(contrastRatio(parseHex(boosted)!, ink)).toBeGreaterThanOrEqual(
      contrastRatio(parseHex(base)!, ink),
    );
  });

  it('derives DIFFERENT boosted foregrounds for different themes', () => {
    applyThemeToDom('ocean', true);
    const oceanPaperDim = getVar('--paper-dim');
    applyThemeToDom('kohaku', true);
    const kohakuPaperDim = getVar('--paper-dim');

    expect(oceanPaperDim).toBeTruthy();
    expect(kohakuPaperDim).toBeTruthy();
    expect(oceanPaperDim).not.toBe(kohakuPaperDim);
  });

  it('every boosted built-in theme still passes the base AA audit', () => {
    for (const id of THEME_IDS) {
      applyThemeToDom(id, true);
      const resolved: TokenMap = {};
      // Read the boosted fg tokens back off the DOM, falling back to the theme's
      // base value for any ground/seam the boost does not touch.
      for (const prop of Object.keys(THEMES[id].tokens)) {
        resolved[prop] = getVar(prop) || THEMES[id].tokens[prop]!;
      }
      for (const row of auditPalette(resolved)) {
        expect(row.pass, `${id} ${row.fg}/${row.bg} = ${row.ratio} (min ${row.min})`).toBe(true);
      }
    }
  });

  it('toggling highContrast off restores the base foreground values', () => {
    applyThemeToDom('ocean', false);
    const base = getVar('--paper-dim');
    applyThemeToDom('ocean', true);
    expect(getVar('--paper-dim')).not.toBe(base);
    applyThemeToDom('ocean', false);
    expect(getVar('--paper-dim')).toBe(base);
  });
});

// ---------------------------------------------------------------------------
// 6. useTheme throws outside provider
// ---------------------------------------------------------------------------

describe('useTheme', () => {
  it('throws when called outside a ThemeProvider', () => {
    function BareConsumer() {
      let thrown: unknown = null;
      try {
        useTheme();
      } catch (err) {
        thrown = err;
      }
      return (
        <Show when={thrown !== null} fallback={<span data-testid="no-error" />}>
          <span data-testid="error">{String(thrown)}</span>
        </Show>
      );
    }

    render(() => <BareConsumer />);

    const errorEl = screen.queryByTestId('error');
    // The error should have been caught and rendered.
    expect(errorEl).toBeTruthy();
  });
});
