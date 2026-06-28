/**
 * customThemes.test.ts — user-created theme storage + token merging.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addCustomTheme,
  customThemeScheme,
  customThemeTokens,
  getCustomTheme,
  isCustomThemeId,
  loadCustomThemes,
  removeCustomTheme,
} from './customThemes';
import { THEMES } from './themes';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('isCustomThemeId', () => {
  it('distinguishes custom ids from built-ins', () => {
    expect(isCustomThemeId('custom:my-theme')).toBe(true);
    expect(isCustomThemeId('ocean')).toBe(false);
  });
});

describe('addCustomTheme', () => {
  it('creates, persists, and returns a custom theme', () => {
    const ct = addCustomTheme('My Theme', 'ocean', { '--lapis': '#ff0000' });
    expect(ct.id).toBe('custom:my-theme');
    expect(ct.base).toBe('ocean');
    expect(loadCustomThemes()).toHaveLength(1);
    expect(getCustomTheme(ct.id)?.name).toBe('My Theme');
  });

  it('uniquifies ids derived from the same name', () => {
    const a = addCustomTheme('Dup', 'ocean', {});
    const b = addCustomTheme('Dup', 'ocean', {});
    expect(a.id).toBe('custom:dup');
    expect(b.id).toBe('custom:dup-2');
    expect(loadCustomThemes()).toHaveLength(2);
  });
});

describe('removeCustomTheme', () => {
  it('deletes by id', () => {
    const ct = addCustomTheme('Gone', 'abyss', {});
    removeCustomTheme(ct.id);
    expect(loadCustomThemes()).toHaveLength(0);
    expect(getCustomTheme(ct.id)).toBeUndefined();
  });
});

describe('customThemeTokens', () => {
  it('overlays overrides on the base theme tokens', () => {
    const ct = addCustomTheme('Red', 'ocean', { '--lapis': '#ff0000' });
    const tokens = customThemeTokens(ct);
    expect(tokens['--lapis']).toBe('#ff0000'); // override wins
    expect(tokens['--gold']).toBe(THEMES.ocean.tokens['--gold']); // base preserved
  });

  it('inherits the base scheme', () => {
    const dark = addCustomTheme('D', 'ocean', {});
    const light = addCustomTheme('L', 'pearl', {});
    expect(customThemeScheme(dark)).toBe('dark');
    expect(customThemeScheme(light)).toBe('light');
  });
});

describe('persistence', () => {
  it('rejects malformed entries on load', () => {
    localStorage.setItem('ruri:custom-themes', JSON.stringify([{ id: 'nope', name: 'x' }, 42]));
    expect(loadCustomThemes()).toHaveLength(0);
  });
});
