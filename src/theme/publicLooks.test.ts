// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME_ID, PUBLIC_THEME_IDS, THEME_IDS, THEMES } from './themes';
import { buildDefaultLookEntries } from './publicLooks';

describe('public appearance faces', () => {
  it('keeps the default path to ocean dark and pearl light', () => {
    expect(DEFAULT_THEME_ID).toBe('ocean');
    expect(PUBLIC_THEME_IDS).toEqual(['ocean', 'pearl']);
    expect(THEMES.ocean.scheme).toBe('dark');
    expect(THEMES.pearl.scheme).toBe('light');
    expect(THEMES.ocean.tokens['--font-display']).not.toMatch(/Anton/);
    expect(THEMES.pearl.tokens['--font-display']).toBeUndefined();
  });

  it('does not put the full catalogue on the default list', () => {
    const looks = buildDefaultLookEntries('ocean');
    expect(looks.map((entry) => entry.id)).toEqual(['ocean', 'pearl']);
    expect(THEME_IDS.length).toBeGreaterThan(looks.length);
    expect(looks.some((entry) => /anton|mesh|neon|vermillion|ink/i.test(entry.label))).toBe(false);
  });

  it('keeps a non-public active look visible without dumping the catalogue', () => {
    const looks = buildDefaultLookEntries('abyss');
    expect(looks.map((entry) => entry.id)).toEqual(['ocean', 'pearl', 'abyss']);
    expect(looks.at(-1)?.extra).toBe(true);
    expect(looks.at(-1)?.label).toBe('Ocean · Abyss');
  });
});
