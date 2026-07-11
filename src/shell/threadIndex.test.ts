// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { threadParentIds, type ReplyLike } from './threadIndex';

const msg = (id: string, replyToId?: string): ReplyLike & { id: string } =>
  replyToId ? { id, replyTo: { id: replyToId } } : { id };

describe('threadParentIds', () => {
  it('returns an empty set for no messages', () => {
    expect(threadParentIds([]).size).toBe(0);
  });

  it('returns an empty set when nothing replies', () => {
    const set = threadParentIds([msg('a'), msg('b'), msg('c')]);
    expect(set.size).toBe(0);
  });

  it('marks a message that has a single reply', () => {
    const set = threadParentIds([msg('a'), msg('b', 'a')]);
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(false);
  });

  it('marks a parent once even with multiple replies', () => {
    const set = threadParentIds([msg('a'), msg('b', 'a'), msg('c', 'a'), msg('d', 'a')]);
    expect([...set]).toEqual(['a']);
  });

  it('handles a reply whose parent is not in the buffer (windowed out)', () => {
    // The parent may have scrolled out of the window; we still record the id.
    const set = threadParentIds([msg('reply', 'missing-parent')]);
    expect(set.has('missing-parent')).toBe(true);
  });

  it('ignores an undefined/empty replyTo id', () => {
    const set = threadParentIds([{ id: 'x', replyTo: undefined } as ReplyLike, msg('y')]);
    expect(set.size).toBe(0);
  });

  it('collects several distinct parents', () => {
    const set = threadParentIds([
      msg('a'),
      msg('b'),
      msg('r1', 'a'),
      msg('r2', 'b'),
      msg('r3', 'a'),
    ]);
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
    expect(set.size).toBe(2);
  });
});
