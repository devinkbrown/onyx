// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  filterSidebarNames,
  hasSidebarAttention,
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

  it('unreadOnly keeps rows with unread or highlights', () => {
    expect(hasSidebarAttention({ unread: 0, highlights: 0 })).toBe(false);
    expect(hasSidebarAttention({ unread: 2, highlights: 0 })).toBe(true);
    expect(hasSidebarAttention({ unread: 0, highlights: 1 })).toBe(true);

    const items = [
      { name: '#a', unread: 0, highlights: 0 },
      { name: '#b', unread: 3, highlights: 0 },
      { name: '#c', unread: 0, highlights: 1 },
    ];
    expect(
      filterSidebarNames(items, '', (i) => i.name, { unreadOnly: true }).map((i) => i.name),
    ).toEqual(['#b', '#c']);
    expect(
      filterSidebarNames(items, 'c', (i) => i.name, { unreadOnly: true }).map((i) => i.name),
    ).toEqual(['#c']);
  });
});
