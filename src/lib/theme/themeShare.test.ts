// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * themeShare.test.ts — compact custom-theme share-code behavior.
 */
import { describe, expect, it } from 'vitest';

import type { CustomTheme } from '@/theme';
import { decodeTheme, encodeTheme, parseThemeParam, themeShareUrl } from './themeShare';

const MINIMAL_THEME: CustomTheme = {
  id: 'custom:mistline',
  name: 'Mistline',
  base: 'ocean',
  overrides: {
    '--lapis': '#78d5ff',
    '--washi': 'oklch(92% 0.02 220)',
    '--font-mono': "'JetBrains Mono Variable', monospace",
  },
};

describe('encodeTheme and decodeTheme', () => {
  it('round-trips a custom theme', () => {
    const code = encodeTheme(MINIMAL_THEME);
    const decoded = decodeTheme(code);

    expect(decoded).toEqual(MINIMAL_THEME);
  });

  it('returns null for non-base64 junk', () => {
    expect(decodeTheme('%not-base64%')).toBeNull();
  });

  it('returns null for valid base64url that is not JSON', () => {
    expect(decodeTheme('bm90LWpzb24')).toBeNull();
  });

  it('returns null for JSON missing required CustomTheme fields', () => {
    expect(decodeTheme(encodeJson({ id: 'custom:missing' }))).toBeNull();
  });

  it('returns null for JSON with wrong-typed CustomTheme fields', () => {
    expect(
      decodeTheme(
        encodeJson({
          id: 'custom:bad',
          name: ['Mistline'],
          base: 'ocean',
          overrides: { '--lapis': 42 },
        }),
      ),
    ).toBeNull();
  });

  it('rejects oversized codes and unsafe token maps before seating them', () => {
    expect(decodeTheme('a'.repeat(65_537))).toBeNull();
    expect(decodeTheme(encodeJson({
      ...MINIMAL_THEME,
      overrides: { color: 'red' },
    }))).toBeNull();
    expect(decodeTheme(encodeJson({
      ...MINIMAL_THEME,
      base: 'toString',
    }))).toBeNull();
  });

  it.each([
    'url(https://attacker.example/pixel)',
    'u\\72l(https://attacker.example/pixel)',
    '@import "https://attacker.example/theme.css"',
    'var(--unknown)',
    '#fff; background: red',
  ])('rejects a shared theme resource payload: %s', (value) => {
    expect(decodeTheme(encodeJson({
      ...MINIMAL_THEME,
      overrides: { '--stone': value },
    }))).toBeNull();
  });

  it('does not encode a runtime-invalid theme', () => {
    expect(encodeTheme({
      ...MINIMAL_THEME,
      name: 'x'.repeat(81),
    })).toBe('');
  });
});

describe('parseThemeParam', () => {
  it('returns null for a missing value', () => {
    expect(parseThemeParam(null)).toBeNull();
  });
});

describe('themeShareUrl', () => {
  it('creates a theme param that parseThemeParam round-trips', () => {
    const origin = 'https://onyx.local/app';
    const url = themeShareUrl(MINIMAL_THEME, origin);
    const code = url.slice(`${origin}?theme=`.length);

    expect(url).toBe(`${origin}?theme=${code}`);
    expect(parseThemeParam(code)).toEqual(MINIMAL_THEME);
  });
});

function encodeJson(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
