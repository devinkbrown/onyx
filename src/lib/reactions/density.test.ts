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

  it('shows all chips in full mode', () => {
    const full = summarizeReactions(buckets, 'full');
    expect(full.chips).toHaveLength(5);
    expect(full.overflow).toBe(0);
    expect(full.hidden).toBe(false);
    expect(full.chips[0]).toMatchObject({ emoji: '🔥', count: 12, label: '🔥 12' });
  });

  it('compacts and counts-only', () => {
    const compact = summarizeReactions(buckets, 'compact');
    expect(compact.chips).toHaveLength(4);
    expect(compact.overflow).toBe(1);
    expect(compact.chips[0]?.label).toBe('🔥12');

    expect(summarizeReactions(buckets, 'counts-only').chips[0]?.count).toBe(19);
    expect(summarizeReactions(buckets, 'hidden').hidden).toBe(true);
  });
});
