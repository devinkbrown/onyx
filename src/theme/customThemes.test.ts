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
  isSafeCustomThemeToken,
  loadCustomThemes,
  parseCustomThemeTokenMap,
  removeCustomTheme,
} from './customThemes';
import { THEMES, type TokenMap } from './themes';

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
  it('accepts only the finite safe grammar used by palette tokens', () => {
    expect(parseCustomThemeTokenMap({
      '--lapis': '#78d5ff',
      '--paper': 'oklch(92% 0.02 220)',
      '--seam': 'color-mix(in oklab, var(--lapis) 38%, transparent)',
      '--r-sm': '8px',
      '--dur': '260ms',
      '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
      '--font-mono': "'JetBrains Mono Variable', ui-monospace, monospace",
    })).toEqual({
      '--lapis': '#78d5ff',
      '--paper': 'oklch(92% 0.02 220)',
      '--seam': 'color-mix(in oklab, var(--lapis) 38%, transparent)',
      '--r-sm': '8px',
      '--dur': '260ms',
      '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
      '--font-mono': "'JetBrains Mono Variable', ui-monospace, monospace",
    });
  });

  it('accepts every built-in token map through the same persistence boundary', () => {
    for (const theme of Object.values(THEMES)) {
      expect(parseCustomThemeTokenMap(theme.tokens)).toEqual(theme.tokens);
    }
  });

  it.each([
    ['resource URL', '--stone', 'url(https://attacker.example/pixel)'],
    ['escaped resource URL', '--stone', 'u\\72l(https://attacker.example/pixel)'],
    ['import at-rule', '--stone', '@import "https://attacker.example/theme.css"'],
    ['declaration breakout', '--stone', '#fff; background: red'],
    ['rule breakout', '--stone', '#fff} body { color: red'],
    ['unknown variable', '--stone', 'var(--attacker-controlled)'],
    ['fallback indirection', '--stone', 'var(--lapis, url(https://attacker.example/pixel))'],
    ['gradient in a color token', '--stone', 'linear-gradient(#fff, #000)'],
    ['unknown token', '--external-image', '#fff'],
  ])('rejects %s before it can reach CSSOM', (_label, property, value) => {
    expect(isSafeCustomThemeToken(property, value)).toBe(false);
    expect(parseCustomThemeTokenMap({ [property]: value })).toBeNull();
  });

  it('drops unsafe persisted themes without losing a safe sibling', () => {
    localStorage.setItem('onyx:custom-themes', JSON.stringify([
      {
        id: 'custom:unsafe-resource',
        name: 'Unsafe resource',
        base: 'ocean',
        overrides: { '--stone': 'url(https://attacker.example/pixel)' },
      },
      {
        id: 'custom:safe-sibling',
        name: 'Safe sibling',
        base: 'ocean',
        overrides: { '--stone': '#123456' },
      },
    ]));

    expect(loadCustomThemes()).toEqual([
      {
        id: 'custom:safe-sibling',
        name: 'Safe sibling',
        base: 'ocean',
        overrides: { '--stone': '#123456' },
      },
    ]);
  });

  it('never persists a resource-bearing runtime override', () => {
    const theme = addCustomTheme('No beacon', 'ocean', {
      '--stone': 'url(https://attacker.example/pixel)',
    });

    expect(theme.overrides).toEqual({});
    expect(JSON.parse(localStorage.getItem('onyx:custom-themes') ?? 'null'))
      .toEqual([{ ...theme, overrides: {} }]);
  });

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
        { id: 'custom:prototype-base', name: 'Prototype base', base: 'toString', overrides: {} },
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

  it('bounds the serialized collection before parsing', () => {
    localStorage.setItem('onyx:custom-themes', ' '.repeat((256 * 1024) + 1));
    expect(loadCustomThemes()).toEqual([]);
  });

  it('rejects unsafe ids, names, token keys, values, and oversized token maps', () => {
    const tooManyTokens = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`--token-${index}`, '#fff']),
    );
    localStorage.setItem('onyx:custom-themes', JSON.stringify([
      { id: 'custom:UPPER', name: 'Upper', base: 'ocean', overrides: {} },
      { id: 'custom:control', name: 'Bad\nName', base: 'ocean', overrides: {} },
      { id: 'custom:key', name: 'Bad key', base: 'ocean', overrides: { color: '#fff' } },
      { id: 'custom:value', name: 'Bad value', base: 'ocean', overrides: { '--lapis': 'x\nred' } },
      { id: 'custom:many', name: 'Too many', base: 'ocean', overrides: tooManyTokens },
    ]));

    expect(loadCustomThemes()).toEqual([]);
  });

  it('caps retained themes and sanitizes runtime add inputs', () => {
    for (let index = 0; index < 40; index += 1) {
      addCustomTheme(`Theme ${index}`, 'ocean', { '--lapis': '#00ace9' });
    }
    const added = addCustomTheme(
      `  Final\n${'x'.repeat(100)}  `,
      'ocean',
      { '--lapis': '#ff0000', invalid: 'discard all unsafe overrides' } as TokenMap,
    );

    expect(loadCustomThemes()).toHaveLength(32);
    expect(added.name).not.toContain('\n');
    expect(added.name.length).toBeLessThanOrEqual(80);
    expect(added.overrides).toEqual({});
    expect(getCustomTheme(added.id)).toEqual(added);
  });

  it('migrates and removes the legacy theme key once', () => {
    localStorage.setItem('ruri:custom-themes', JSON.stringify([
      { id: 'custom:legacy', name: 'Legacy', base: 'ruri', overrides: { '--lapis': '#00ace9' } },
    ]));

    expect(loadCustomThemes()).toEqual([
      { id: 'custom:legacy', name: 'Legacy', base: 'onyx', overrides: { '--lapis': '#00ace9' } },
    ]);
    expect(localStorage.getItem('ruri:custom-themes')).toBeNull();
    expect(JSON.parse(localStorage.getItem('onyx:custom-themes') ?? 'null')).toHaveLength(1);
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
