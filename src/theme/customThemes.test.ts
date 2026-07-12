// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * customThemes.test.ts — user-created theme storage + token merging.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

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
    localStorage.setItem('onyx:custom-themes', JSON.stringify([{ id: 'nope', name: 'x' }, 42]));
    expect(loadCustomThemes()).toHaveLength(0);
  });

  it('rejects malformed themes without dropping valid stored themes', () => {
    localStorage.setItem(
      'onyx:custom-themes',
      JSON.stringify([
        { id: 'custom:good', name: 'Good', base: 'ocean', overrides: { '--lapis': '#00ace9' } },
        { id: 'ocean', name: 'Built-in collision', base: 'ocean', overrides: {} },
        { id: 'custom:missing-base', name: 'Missing base', overrides: {} },
        { id: 'custom:bad-base', name: 'Bad base', base: 'does-not-exist', overrides: {} },
        { id: 'custom:bad-name', name: 12, base: 'ocean', overrides: {} },
        { id: 'custom:bad-overrides', name: 'Bad overrides', base: 'ocean', overrides: null },
      ]),
    );

    expect(loadCustomThemes()).toEqual([
      { id: 'custom:good', name: 'Good', base: 'ocean', overrides: { '--lapis': '#00ace9' } },
    ]);
  });

  it('drops a theme whose overrides is an array (would seat numeric-key props)', () => {
    localStorage.setItem(
      'onyx:custom-themes',
      JSON.stringify([{ id: 'custom:arr', name: 'Arr', base: 'ocean', overrides: ['#ff0000'] }]),
    );
    expect(loadCustomThemes()).toHaveLength(0);
  });

  it('drops a theme with a non-string override value (would corrupt CSS vars)', () => {
    localStorage.setItem(
      'onyx:custom-themes',
      JSON.stringify([
        { id: 'custom:obj', name: 'Obj', base: 'ocean', overrides: { '--lapis': { evil: 1 } } },
        { id: 'custom:num', name: 'Num', base: 'ocean', overrides: { '--gold': 42 } },
      ]),
    );
    expect(loadCustomThemes()).toHaveLength(0);
  });

  it('keeps a well-formed theme with all-string overrides', () => {
    localStorage.setItem(
      'onyx:custom-themes',
      JSON.stringify([
        { id: 'custom:good', name: 'Good', base: 'ocean', overrides: { '--lapis': '#ff0000' } },
      ]),
    );
    const loaded = loadCustomThemes();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.overrides['--lapis']).toBe('#ff0000');
  });

  it('round-trips saved themes through the onyx custom theme key', () => {
    const saved = addCustomTheme('Cyan Wake', 'reef', {
      '--lapis': '#00b8ed',
      '--gold': 'color-mix(in oklab, #5dcbd1 80%, white)',
    });

    const stored = JSON.parse(localStorage.getItem('onyx:custom-themes') ?? 'null');

    expect(stored).toEqual([
      {
        id: 'custom:cyan-wake',
        name: 'Cyan Wake',
        base: 'reef',
        overrides: {
          '--lapis': '#00b8ed',
          '--gold': 'color-mix(in oklab, #5dcbd1 80%, white)',
        },
      },
    ]);
    expect(loadCustomThemes()).toEqual([saved]);
  });

  it('does not throw when localStorage rejects persistence writes', () => {
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    expect(() => addCustomTheme('Quota Safe', 'ocean', { '--lapis': '#ff0000' })).not.toThrow();
    expect(setItem).toHaveBeenCalledWith(
      'onyx:custom-themes',
      JSON.stringify([
        { id: 'custom:quota-safe', name: 'Quota Safe', base: 'ocean', overrides: { '--lapis': '#ff0000' } },
      ]),
    );
  });
});
