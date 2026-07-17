// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import type { ReviewHistoryEntry } from '@/lib/notifications/reviewHistory';
import {
  buildReviewedContextTrail,
  buildReaderMemoryContext,
  hasReviewedAnchor,
  mergeReviewedContextTrails,
  orderChronologically,
  reviewedAnchorSource,
} from './MessageView';

function message(id: string, from: string, text: string, offset: number): ChatMessage {
  return {
    id,
    from,
    text,
    time: new Date(1_700_000_000_000 + offset),
    type: 'msg',
    target: '#general',
  };
}

function review(firstMessageId: string): ReviewHistoryEntry {
  return {
    target: '#general',
    name: '#general',
    kind: 'channel',
    firstMessageId,
    firstAt: '2026-07-09T00:00:00.000Z',
    reviewedAt: '2026-07-09T00:05:00.000Z',
    messageCount: 2,
    mentionCount: 0,
    preview: 'anchor line',
  };
}

describe('reviewed reader context trails', () => {
  it('keeps a valid non-hash channel eligible when the active view identifies it as a channel', () => {
    const context = buildReaderMemoryContext('&ops', [
      { ...message('ops-a', 'alice', 'handoff', 0), target: '&ops' },
    ], true);

    expect(context).toMatchObject({ target: '&ops', lineCount: 1, voiceCount: 1 });
  });

  it('builds neighboring readable context around the reviewed anchor', () => {
    const trail = buildReviewedContextTrail(review('anchor'), [
      { ...message('system', 'server', 'join', 0), type: 'join' },
      message('before', 'alice', 'before line', 1),
      message('anchor', 'bob', 'anchor line', 2),
      message('after', 'carol', 'after line', 3),
    ]);

    expect(trail?.before?.id).toBe('before');
    expect(trail?.before?.label).toBe('Before');
    expect(trail?.after?.id).toBe('after');
    expect(trail?.after?.label).toBe('After');
  });

  it('merges hydrated context with vault fallback for missing sides', () => {
    const hydrated = buildReviewedContextTrail(review('anchor'), [
      message('anchor', 'bob', 'anchor line', 2),
      message('after-live', 'carol', 'live after', 3),
    ]);
    const vaulted = buildReviewedContextTrail(review('anchor'), [
      message('before-vault', 'alice', 'vault before', 1),
      message('anchor', 'bob', 'anchor line', 2),
      message('after-vault', 'dana', 'vault after', 3),
    ]);

    const merged = mergeReviewedContextTrails(hydrated, vaulted);

    expect(merged?.before?.id).toBe('before-vault');
    expect(merged?.after?.id).toBe('after-live');
  });

  it('detects visible and vault-only reviewed anchors', () => {
    const entry = review('anchor');
    const visible = [message('live', 'alice', 'visible line', 1)];
    const vaulted = [
      message('before-vault', 'alice', 'vault before', 1),
      message('anchor', 'bob', 'vault anchor', 2),
    ];

    expect(hasReviewedAnchor(entry, visible)).toBe(false);
    expect(hasReviewedAnchor(entry, vaulted)).toBe(true);
    expect(reviewedAnchorSource(entry, visible, vaulted)).toBe('vault');
    expect(reviewedAnchorSource(entry, vaulted, null)).toBe('visible');
    expect(reviewedAnchorSource(entry, visible, null)).toBeNull();
  });
});

describe('orderChronologically', () => {
  it('returns an already in-order buffer untouched (no reorder, no copy)', () => {
    // Common live-append case: buffer is non-decreasing by time. A stable sort
    // is a no-op here, so the fast-path must skip the copy+sort and hand back
    // the SAME array reference (lets dependent memos short-circuit).
    const list = [
      message('a', 'alice', 'first', 0),
      message('b', 'bob', 'second', 1),
      message('c', 'carol', 'third', 2),
    ];
    const result = orderChronologically(list);

    expect(result).toBe(list); // same reference — not copied
    expect(result.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('treats a live append at the tail as in-order (no reorder)', () => {
    const list = [
      message('a', 'alice', 'first', 0),
      message('b', 'bob', 'second', 1),
    ];
    list.push(message('c', 'carol', 'appended', 2));
    const result = orderChronologically(list);

    expect(result).toBe(list);
    expect(result.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps equal timestamps in insertion order (stable, preserves grouping)', () => {
    const list = [
      message('a', 'alice', 'same-time-1', 5),
      message('b', 'alice', 'same-time-2', 5),
      message('c', 'alice', 'same-time-3', 5),
    ];
    const result = orderChronologically(list);

    expect(result).toBe(list); // equal timestamps are non-decreasing → untouched
    expect(result.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('stable-sorts an out-of-order buffer (CHATHISTORY / vault replay)', () => {
    // A replayed/hydrated line lands after the live tail with an older time,
    // and an unsorted seam sits mid-list — must be defensively sorted.
    const list = [
      message('live-1', 'alice', 'live', 10),
      message('replay-old', 'bob', 'older replay', 3),
      message('live-2', 'carol', 'live later', 20),
    ];
    const result = orderChronologically(list);

    expect(result).not.toBe(list); // copied, not mutating the store buffer
    expect(list.map((m) => m.id)).toEqual(['live-1', 'replay-old', 'live-2']); // input untouched
    expect(result.map((m) => m.id)).toEqual(['replay-old', 'live-1', 'live-2']);
  });

  it('detects an out-of-order seam that is not at the tail', () => {
    // The tail (b→c) is in order, but the head (a after the prepend) is not —
    // a last-two-only check would wrongly skip the sort. Full scan catches it.
    const list = [
      message('prepended', 'alice', 'newer prepended', 9),
      message('b', 'bob', 'older', 1),
      message('c', 'carol', 'oldest+1', 2),
    ];
    const result = orderChronologically(list);

    expect(result).not.toBe(list);
    expect(result.map((m) => m.id)).toEqual(['b', 'c', 'prepended']);
  });
});
