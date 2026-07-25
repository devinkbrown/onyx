// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * density.ts — reaction summary density modes for busy rooms.
 */

export type ReactionDensity = 'full' | 'compact' | 'counts-only' | 'hidden';

export type ReactionBucket = {
  emoji: string;
  count: number;
  mine?: boolean;
};

export type ReactionChip = {
  emoji: string;
  count: number;
  mine: boolean;
  /** Short label for the chip. */
  label: string;
};

export function summarizeReactions(
  buckets: readonly ReactionBucket[],
  density: ReactionDensity,
  maxChips = 8,
): { chips: ReactionChip[]; overflow: number; hidden: boolean } {
  if (density === 'hidden') return { chips: [], overflow: 0, hidden: true };

  const sorted = [...buckets]
    .filter((b) => b.count > 0 && b.emoji.trim().length > 0)
    .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));

  if (density === 'counts-only') {
    const total = sorted.reduce((sum, b) => sum + b.count, 0);
    return {
      chips: total > 0
        ? [{ emoji: '💬', count: total, mine: sorted.some((b) => b.mine), label: `${total}` }]
        : [],
      overflow: 0,
      hidden: false,
    };
  }

  const limit = density === 'compact' ? Math.min(4, maxChips) : maxChips;
  const visible = sorted.slice(0, limit);
  const chips: ReactionChip[] = visible.map((b) => ({
    emoji: b.emoji,
    count: b.count,
    mine: b.mine === true,
    label: density === 'compact' && b.count > 1 ? `${b.emoji}${b.count}` : `${b.emoji} ${b.count}`,
  }));
  return {
    chips,
    overflow: Math.max(0, sorted.length - visible.length),
    hidden: false,
  };
}
