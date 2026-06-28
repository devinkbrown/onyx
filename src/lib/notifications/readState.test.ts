import { describe, expect, it } from 'vitest';

import { applyIncomingUnread, markViewedRead, normalizeTargetKey, totalMentions } from './readState';

describe('readState helpers', () => {
  it('starts unread tracking at the first inactive message', () => {
    expect(applyIncomingUnread({
      unread: 0,
      mentions: 0,
      firstUnreadId: null,
      messageId: 'm1',
      isMention: false,
      isActive: false,
    })).toEqual({
      unread: 1,
      mentions: 0,
      firstUnreadId: 'm1',
    });
  });

  it('keeps the first unread id while incrementing mentions', () => {
    expect(applyIncomingUnread({
      unread: 2,
      mentions: 1,
      firstUnreadId: 'm1',
      messageId: 'm3',
      isMention: true,
      isActive: false,
    })).toEqual({
      unread: 3,
      mentions: 2,
      firstUnreadId: 'm1',
    });
  });

  it('does not count active-view messages as unread', () => {
    expect(applyIncomingUnread({
      unread: 5,
      mentions: 2,
      firstUnreadId: 'm1',
      messageId: 'm6',
      isMention: true,
      isActive: true,
    })).toEqual({
      unread: 0,
      mentions: 0,
      firstUnreadId: null,
    });
  });

  it('captures the divider id while marking a target viewed', () => {
    expect(markViewedRead({
      unread: 4,
      mentions: 2,
      firstUnreadId: 'm8',
    }, 1234)).toEqual({
      unread: 0,
      mentions: 0,
      firstUnreadId: null,
      dividerId: 'm8',
      lastReadAtMs: 1234,
    });
  });

  it('normalizes targets and totals mentions', () => {
    expect(normalizeTargetKey('#Root')).toBe('#root');
    expect(totalMentions({ '#root': 2, bob: 1 })).toBe(3);
  });
});
