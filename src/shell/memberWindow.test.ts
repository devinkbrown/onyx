// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { GroupEntry } from '@/lib/memberGroups';
import {
  computeMemberWindow,
  flattenMemberRows,
  MEMBER_GROUP_ROW_PX,
  MEMBER_USER_ROW_PX,
  MEMBER_WINDOW_SIZE,
  memberIndexAtOffset,
  memberPrefixHeight,
  sectionMemberWindow,
} from './memberWindow';

function group(key: GroupEntry['key'], label: string, nicks: string[]): GroupEntry {
  return {
    key,
    label,
    members: nicks.map((nick) => ({
      user: { nick, modes: new Set<string>() },
      role: { key, label, symbol: '', sort: 0 },
    })),
  };
}

describe('flattenMemberRows', () => {
  it('emits a group header then each member in order', () => {
    const rows = flattenMemberRows([
      group('op', 'ops', ['opal']),
      group('member', 'members', ['alice', 'bob']),
    ]);
    expect(rows.map((row) => row.kind === 'group' ? row.label : row.entry.user.nick)).toEqual([
      'ops',
      'opal',
      'members',
      'alice',
      'bob',
    ]);
  });
});

describe('computeMemberWindow', () => {
  it('keeps a small roster fully rendered from the top', () => {
    const rows = flattenMemberRows([group('member', 'members', ['a', 'b', 'c'])]);
    const window = computeMemberWindow(rows, 0);
    expect(window.start).toBe(0);
    expect(window.end).toBe(rows.length);
    expect(window.hiddenBefore).toBe(0);
    expect(window.hiddenAfter).toBe(0);
  });

  it('pages a large roster from the top, then from scroll offset', () => {
    const nicks = Array.from({ length: 400 }, (_, i) => `nick${i}`);
    const rows = flattenMemberRows([group('member', 'members', nicks)]);
    const top = computeMemberWindow(rows, 0);
    expect(top.start).toBe(0);
    expect(top.rendered).toBe(MEMBER_WINDOW_SIZE);
    expect(top.hiddenAfter).toBe(rows.length - MEMBER_WINDOW_SIZE);

    const scrolled = computeMemberWindow(rows, MEMBER_GROUP_ROW_PX + (120 * MEMBER_USER_ROW_PX));
    expect(scrolled.start).toBeGreaterThan(0);
    expect(scrolled.rendered).toBeLessThanOrEqual(MEMBER_WINDOW_SIZE);
    expect(scrolled.start + scrolled.rendered).toBe(scrolled.end);
  });

  it('maps scroll offsets onto the matching flat index', () => {
    const rows = flattenMemberRows([group('member', 'members', ['a', 'b', 'c'])]);
    expect(memberIndexAtOffset(rows, 0)).toBe(0);
    expect(memberIndexAtOffset(rows, MEMBER_GROUP_ROW_PX)).toBe(1);
    expect(memberIndexAtOffset(rows, MEMBER_GROUP_ROW_PX + MEMBER_USER_ROW_PX)).toBe(2);
    expect(memberPrefixHeight(rows, 2)).toBe(MEMBER_GROUP_ROW_PX + MEMBER_USER_ROW_PX);
  });

  it('rebuilds a continuation section when the window starts mid-group', () => {
    const rows = flattenMemberRows([group('member', 'members', ['a', 'b', 'c', 'd'])]);
    const sections = sectionMemberWindow(rows, 2, 4);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ key: 'member', continuation: true, count: 4 });
    expect(sections[0]!.members.map((entry) => entry.user.nick)).toEqual(['b', 'c']);
  });
});
