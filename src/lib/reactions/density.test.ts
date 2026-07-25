// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { summarizeReactions } from './density';

describe('reaction density', () => {
  const buckets = [
    { emoji: '🔥', count: 12 },
    { emoji: '👍', count: 3, mine: true },
    { emoji: '✨', count: 1 },
    { emoji: '🎉', count: 2 },
    { emoji: '💙', count: 1 },
  ];

  it('compacts and counts-only', () => {
    expect(summarizeReactions(buckets, 'compact').chips).toHaveLength(4);
    expect(summarizeReactions(buckets, 'counts-only').chips[0]?.count).toBe(19);
    expect(summarizeReactions(buckets, 'hidden').hidden).toBe(true);
  });
});
