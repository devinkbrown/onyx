// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import type { CatchUpItem } from '@/lib/notifications/catchUp';
import {
  composeHomeInbox,
  parseInviteNotification,
} from './homeInbox';

const NOW = Date.parse('2026-08-22T18:00:00.000Z');

function item(
  target: string,
  unread: number,
  highlights = 0,
  kind: CatchUpItem['kind'] = 'channel',
  lastActivity = NOW,
): CatchUpItem {
  return {
    key: `${kind[0]}:${target.toLowerCase()}`,
    kind,
    name: target,
    target,
    unread,
    highlights,
    followed: false,
    lastActivity,
  };
}

describe('composeHomeInbox', () => {
  it('lists an unread room by recency, not unread count', () => {
    const inbox = composeHomeInbox({
      items: [
        item('#older', 40, 0, 'channel', NOW - 10_000),
        item('#newer', 1, 0, 'channel', NOW),
      ],
    });
    expect(inbox.mentions).toEqual([]);
    expect(inbox.missed.map((row) => row.target)).toEqual(['#newer', '#older']);
    expect(inbox.empty).toBe(false);
  });

  it('lists mentions of you separately, recency first', () => {
    const inbox = composeHomeInbox({
      items: [
        item('#old-ping', 2, 1, 'channel', NOW - 5_000),
        item('#new-ping', 1, 3, 'channel', NOW),
        item('#chatter', 9, 0, 'channel', NOW - 1_000),
      ],
    });
    expect(inbox.mentions.map((row) => row.target)).toEqual(['#new-ping', '#old-ping']);
    expect(inbox.missed.map((row) => row.target)).toEqual(['#chatter']);
  });

  it('does not list a mentioned room twice in unreads', () => {
    const inbox = composeHomeInbox({
      items: [item('#mentions', 5, 2)],
    });
    expect(inbox.mentions).toHaveLength(1);
    expect(inbox.missed).toHaveLength(0);
  });

  it('attaches an existing first-unread boundary and leaves others null', () => {
    const inbox = composeHomeInbox({
      items: [item('#room', 3, 1), item('mira', 1, 0, 'dm')],
      firstUnreadId: new Map([['#room', 'msg-1']]),
    });
    expect(inbox.mentions[0]?.boundaryId).toBe('msg-1');
    expect(inbox.missed[0]?.boundaryId).toBeNull();
  });

  it('is empty when nothing was missed', () => {
    expect(composeHomeInbox({ items: [] }).empty).toBe(true);
  });

  it('keeps real invites and does not invent hide or occupancy state', () => {
    const source = [
      './homeInbox.ts',
      new URL('./homeInbox.ts', import.meta.url).pathname,
    ];
    expect(source.join('\n')).not.toMatch(/hidden-rooms|closed-conversations|people online|occupancy/);
    const inbox = composeHomeInbox({
      items: [],
      invites: [{
        key: 'inv-1',
        inviter: 'Alex',
        channel: '#lounge',
        at: NOW,
      }],
    });
    expect(inbox.invites).toEqual([{
      key: 'inv-1',
      inviter: 'Alex',
      channel: '#lounge',
      at: NOW,
    }]);
    expect(inbox.empty).toBe(false);
  });
});

describe('parseInviteNotification', () => {
  it('accepts an existing INVITE system notice', () => {
    expect(parseInviteNotification({
      id: 'n1',
      type: 'system',
      text: 'Alex invited you to #lounge',
      from: 'Alex',
      channel: '#lounge',
      at: new Date(NOW),
    })).toEqual({
      key: 'n1',
      inviter: 'Alex',
      channel: '#lounge',
      at: NOW,
    });
  });

  it('ignores mentions, DMs, and unrelated system lines', () => {
    expect(parseInviteNotification({
      id: 'n2',
      type: 'mention',
      text: 'hey @me',
      channel: '#room',
      at: new Date(NOW),
    })).toBeNull();
    expect(parseInviteNotification({
      id: 'n3',
      type: 'system',
      text: 'Disconnected: timeout',
      at: new Date(NOW),
    })).toBeNull();
  });
});
