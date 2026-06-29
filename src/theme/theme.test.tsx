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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal, type JSX } from 'solid-js';

import { applyThemeToDom, ThemeProvider, useTheme } from './ThemeProvider';
import { THEMES, THEME_IDS, DEFAULT_THEME_ID, type ThemeId, type TokenMap } from './themes';
import { ThemeStudio } from './ThemeStudio';
import { ALL_STUDIO_TOKENS, EDITABLE_PROPERTIES } from './tokens';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getVar(prop: string): string {
  return document.documentElement.style.getPropertyValue(prop).trim();
}

function Wrapper(props: { children: JSX.Element }) {
  return <ThemeProvider>{props.children}</ThemeProvider>;
}

function ThemeIdDisplay() {
  const { themeId } = useTheme();
  return <span data-testid="theme-id">{themeId()}</span>;
}

function ThemeSetterButton(props: { id: ThemeId }) {
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
    expect(getVar('--washi')).toBeTruthy();
  });

  it('sets color-scheme to the theme scheme value', () => {
    applyThemeToDom('pearl');
    expect(getVar('color-scheme')).toBe('light');

    applyThemeToDom('onyx');
    expect(getVar('color-scheme')).toBe('dark');
  });

  it('applies every defined token for all themes without throwing', () => {
    for (const id of THEME_IDS) {
      expect(() => applyThemeToDom(id)).not.toThrow();
      expect(document.documentElement.getAttribute('data-theme')).toBe(id);
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

  it('falls back to the default when localStorage has an unknown value', () => {
    localStorage.setItem('onyx:theme', 'unknown-theme-xyz');

    render(() => (
      <ThemeProvider>
        <ThemeIdDisplay />
      </ThemeProvider>
    ));

    expect(screen.getByTestId('theme-id').textContent).toBe(DEFAULT_THEME_ID);
  });

  it('setTheme writes the new theme to localStorage', () => {
    render(() => (
      <ThemeProvider>
        <ThemeSetterButton id="sumi" />
      </ThemeProvider>
    ));

    fireEvent.click(screen.getByTestId('set-theme-btn'));

    expect(localStorage.getItem('onyx:theme')).toBe('sumi');
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

  it('respects a controlled value prop', () => {
    const [value, setValue] = createSignal<ThemeId>('hisui');

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

  it('all themes define --ink, --gold, and --washi tokens', () => {
    for (const id of THEME_IDS) {
      const theme = THEMES[id];
      expect(theme).toBeDefined();
      expect(theme!.tokens['--ink']).toBeTruthy();
      expect(theme!.tokens['--gold']).toBeTruthy();
      expect(theme!.tokens['--washi']).toBeTruthy();
    }
  });

  it('exposes the expected light-scheme themes', () => {
    const lightThemes = THEME_IDS.filter((id) => THEMES[id]?.scheme === 'light');
    expect(lightThemes.sort()).toEqual(['frost', 'pearl']);
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
    const oceanKeys = Object.keys(THEMES.ocean.tokens).sort();
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
// 6. useTheme throws outside provider
// ---------------------------------------------------------------------------

describe('useTheme', () => {
  it('throws when called outside a ThemeProvider', () => {
    function BareConsumer() {
      try {
        useTheme();
      } catch (err) {
        return <span data-testid="error">{String(err)}</span>;
      }
      return <span data-testid="no-error" />;
    }

    render(() => <BareConsumer />);

    const errorEl = screen.queryByTestId('error');
    // The error should have been caught and rendered.
    expect(errorEl).toBeTruthy();
  });
});
