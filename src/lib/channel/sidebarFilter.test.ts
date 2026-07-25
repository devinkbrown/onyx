// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  filterSidebarNames,
  matchesSidebarQuery,
  normalizeSidebarQuery,
} from './sidebarFilter';

describe('sidebarFilter', () => {
  it('normalizes query whitespace and case', () => {
    expect(normalizeSidebarQuery('  Root  ')).toBe('root');
  });

  it('matches substring case-insensitively', () => {
    expect(matchesSidebarQuery('#Root', 'roo')).toBe(true);
    expect(matchesSidebarQuery('#Root', 'xyz')).toBe(false);
    expect(matchesSidebarQuery('Alice', '')).toBe(true);
  });

  it('filters channel-like names without mutating the source', () => {
    const names = ['#alpha', '#bravo', '#root'];
    const filtered = filterSidebarNames(names, 'a');
    expect(filtered).toEqual(['#alpha', '#bravo']);
    expect(names).toEqual(['#alpha', '#bravo', '#root']);
  });

  it('filters objects by nameOf', () => {
    const items = [{ name: '#ops' }, { name: '#lobby' }, { name: 'dave' }];
    expect(filterSidebarNames(items, 'op', (i) => i.name)).toEqual([{ name: '#ops' }]);
  });
});
