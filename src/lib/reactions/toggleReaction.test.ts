// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { MessageReaction } from '@/lib/irc/types';
import { addMessageReactor, removeMessageReactor, toggleMessageReactions } from './toggleReaction';

const base: MessageReaction[] = [
  { emoji: '👍', users: ['Alice', 'bob'] },
  { emoji: '🔥', users: ['carol'] },
];

describe('toggleMessageReactions', () => {
  it('adds a new emoji bucket when absent', () => {
    expect(toggleMessageReactions(undefined, '🎉', 'me')).toEqual([
      { emoji: '🎉', users: ['me'] },
    ]);
  });

  it('appends a nick onto an existing bucket', () => {
    const next = toggleMessageReactions(base, '👍', 'me');
    expect(next).toEqual([
      { emoji: '👍', users: ['Alice', 'bob', 'me'] },
      { emoji: '🔥', users: ['carol'] },
    ]);
    // Immutability: input untouched.
    expect(base[0]!.users).toEqual(['Alice', 'bob']);
  });

  it('removes a nick case-insensitively and keeps co-reactors', () => {
    const next = toggleMessageReactions(base, '👍', 'ALICE');
    expect(next).toEqual([
      { emoji: '👍', users: ['bob'] },
      { emoji: '🔥', users: ['carol'] },
    ]);
  });

  it('drops the emoji bucket when the last reactor leaves', () => {
    expect(toggleMessageReactions(base, '🔥', 'Carol')).toEqual([
      { emoji: '👍', users: ['Alice', 'bob'] },
    ]);
  });

  it('no-ops on empty emoji or nick', () => {
    expect(toggleMessageReactions(base, '', 'me')).toEqual(base.map((r) => ({
      emoji: r.emoji,
      users: [...r.users],
    })));
    expect(toggleMessageReactions(base, '👍', '')).toEqual(base.map((r) => ({
      emoji: r.emoji,
      users: [...r.users],
    })));
  });
});

describe('addMessageReactor', () => {
  it('adds a nick without toggling off an existing reactor', () => {
    expect(addMessageReactor(base, '👍', 'me')).toEqual([
      { emoji: '👍', users: ['Alice', 'bob', 'me'] },
      { emoji: '🔥', users: ['carol'] },
    ]);
    expect(addMessageReactor(base, '👍', 'ALICE')).toEqual([
      { emoji: '👍', users: ['Alice', 'bob'] },
      { emoji: '🔥', users: ['carol'] },
    ]);
  });
});

describe('removeMessageReactor', () => {
  it('drops only the named nick without re-adding when absent', () => {
    expect(removeMessageReactor(base, '👍', 'bob')).toEqual([
      { emoji: '👍', users: ['Alice'] },
      { emoji: '🔥', users: ['carol'] },
    ]);
    // Absent nick → structure preserved (fresh copy).
    expect(removeMessageReactor(base, '👍', 'nobody')).toEqual([
      { emoji: '👍', users: ['Alice', 'bob'] },
      { emoji: '🔥', users: ['carol'] },
    ]);
  });

  it('removes the bucket when the last reactor is dropped', () => {
    expect(removeMessageReactor(base, '🔥', 'CAROL')).toEqual([
      { emoji: '👍', users: ['Alice', 'bob'] },
    ]);
  });
});
