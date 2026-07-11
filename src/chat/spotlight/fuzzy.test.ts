// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch } from './fuzzy';

describe('fuzzyMatch', () => {
  it('matches subsequences and rejects missing characters', () => {
    expect(fuzzyMatch('gch', 'Go to #chat')).not.toBeNull();
    expect(fuzzyMatch('zxq', 'Go to #chat')).toBeNull();
  });

  it('returns every item for an empty query without highlights', () => {
    const items = ['Go to #lapis', 'Disconnect'];
    const result = fuzzyFilter(items, '', (item) => item, () => []);

    expect(result.map((entry) => entry.item)).toEqual(items);
    expect(result.every((entry) => entry.ranges.length === 0)).toBe(true);
  });

  it('ranks tight prefix and substring matches ahead of loose matches', () => {
    const items = ['Switch theme: Onyx', 'Go to #onyx-lab', 'Disconnect'];
    const result = fuzzyFilter(items, 'onyx', (item) => item, () => []);

    expect(result[0]?.item).toBe('Go to #onyx-lab');
    expect(result.at(-1)?.item).not.toBe('Disconnect');
  });

  it('compacts adjacent highlighted characters into ranges', () => {
    const match = fuzzyMatch('chat', 'Go to #chat');

    expect(match?.ranges).toEqual([{ start: 7, end: 11 }]);
  });

  it('keeps separated highlighted characters in separate ranges', () => {
    const match = fuzzyMatch('gtc', 'Go to #chat');

    expect(match?.ranges).toEqual([
      { start: 0, end: 1 },
      { start: 3, end: 4 },
      { start: 7, end: 8 },
    ]);
  });
});
