/**
 * Regression: applyThemeToDom must CLEAR inline token overrides that the
 * previously-applied theme wrote but the incoming theme does not define.
 *
 * Built-in themes carry different token key sets — e.g. `ocean` defines the
 * `--font-*` stack while `pearl` omits it (inheriting the stylesheet default).
 * Without clearing, ocean's inline `--font-display` bleeds through onto pearl,
 * silently overriding the CSS `:root` value on documentElement.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { applyThemeToDom } from './ThemeProvider';
import { THEMES } from './themes';

function getVar(prop: string): string {
  return document.documentElement.style.getPropertyValue(prop).trim();
}

afterEach(() => {
  // Wipe every inline var + attribute so cases stay isolated.
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

describe('applyThemeToDom stale-override clearing', () => {
  it('clears a token the previous theme set but the next theme omits', () => {
    // `ocean` defines --font-display; `pearl` does not.
    expect('--font-display' in THEMES.ocean.tokens).toBe(true);
    expect('--font-display' in THEMES.pearl.tokens).toBe(false);

    applyThemeToDom('ocean');
    expect(getVar('--font-display')).not.toBe('');

    applyThemeToDom('pearl');
    // The stale ocean override must be gone, not bleeding onto pearl.
    expect(getVar('--font-display')).toBe('');
    // Tokens pearl DOES define are still present.
    expect(getVar('--ink')).toBe(THEMES.pearl.tokens['--ink']);
    expect(document.documentElement.getAttribute('data-theme')).toBe('pearl');
  });

  it('keeps a shared token that both themes define', () => {
    applyThemeToDom('ocean');
    applyThemeToDom('tide');
    // --ink exists in both; it should now hold tide's value, not be cleared.
    expect(getVar('--ink')).toBe(THEMES.tide.tokens['--ink']);
  });
});
