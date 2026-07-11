// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import type { ReviewHistoryEntry } from '@/lib/notifications/reviewHistory';
import {
  buildReviewedContextTrail,
  hasReviewedAnchor,
  mergeReviewedContextTrails,
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
