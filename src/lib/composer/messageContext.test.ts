// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/lib/irc/types';
import { activeReplyForTarget, messageContextMatchesTarget } from './messageContext';

function msg(target: string, id = 'm1'): ChatMessage {
  return {
    id,
    from: 'alice',
    text: 'hello',
    time: new Date('2026-07-19T12:00:00Z'),
    type: 'msg',
    target,
  };
}

describe('messageContextMatchesTarget', () => {
  it('matches case-insensitively', () => {
    expect(messageContextMatchesTarget(msg('#Room'), '#room')).toBe(true);
    expect(messageContextMatchesTarget(msg('Alice'), 'alice')).toBe(true);
  });

  it('rejects a different conversation', () => {
    expect(messageContextMatchesTarget(msg('#ops'), '#general')).toBe(false);
    expect(messageContextMatchesTarget(msg('bob'), 'alice')).toBe(false);
  });

  it('fails closed on missing sides', () => {
    expect(messageContextMatchesTarget(null, '#room')).toBe(false);
    expect(messageContextMatchesTarget(msg('#room'), null)).toBe(false);
    expect(messageContextMatchesTarget(undefined, '')).toBe(false);
    expect(messageContextMatchesTarget(msg('#room'), '')).toBe(false);
  });
});

describe('activeReplyForTarget', () => {
  it('returns the reply only when the target matches', () => {
    const reply = msg('#ops', 'parent');
    expect(activeReplyForTarget(reply, '#ops')).toBe(reply);
    expect(activeReplyForTarget(reply, '#OPS')).toBe(reply);
    expect(activeReplyForTarget(reply, '#general')).toBeNull();
    expect(activeReplyForTarget(null, '#ops')).toBeNull();
  });
});
