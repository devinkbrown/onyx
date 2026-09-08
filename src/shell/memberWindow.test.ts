// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { GroupEntry } from '@/lib/memberGroups';
import {
  computeMemberWindow,
  flattenMemberRows,
  MEMBER_GROUP_ROW_PX,
  MEMBER_MOBILE_GROUP_ROW_PX,
  MEMBER_MOBILE_USER_ROW_PX,
  MEMBER_MOBILE_WINDOW_METRICS,
  MEMBER_USER_ROW_PX,
  MEMBER_WINDOW_SIZE,
  memberIndexAtOffset,
  memberPrefixHeight,
  memberRowKey,
  memberRowHeight,
  rebaseMemberOffset,
  memberWindowSectionsEqual,
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
  it('keeps the anchor inside even a small window and caps oversized requests', () => {
    const rows = flattenMemberRows([group('member', 'members',
      Array.from({ length: 3000 }, (_, i) => `nick${i}`))]);
    const offset = memberPrefixHeight(rows, 120);
    for (const capacity of [1, 8, 96, 3000, NaN]) {
      const win = computeMemberWindow(rows, offset, capacity);
      expect(win.start).toBeLessThanOrEqual(120);
      expect(win.end).toBeGreaterThan(120);
      expect(win.rendered).toBeLessThanOrEqual(MEMBER_WINDOW_SIZE);
    }
  });

  it('uses measured variable heights for lookup, spacers and anchor corrections', () => {
    const rows = flattenMemberRows([group('member', 'members', ['a', 'long-name', 'c'])]);
    const before = { groupRowPx: 28, userRowPx: 52 };
    const after = { ...before, heights: new Map([
      [memberRowKey(rows[0]!), 38.5],
      [memberRowKey(rows[1]!), 54],
      [memberRowKey(rows[2]!), 104.75],
    ]) };
    expect(memberPrefixHeight(rows, 3, after)).toBe(197.25);
    expect(memberIndexAtOffset(rows, 197.24, after)).toBe(2);
    expect(memberIndexAtOffset(rows, 197.25, after)).toBe(3);
    expect(rebaseMemberOffset(rows, 28 + 52 * 2 + 9, before, after)).toBe(206.25);
    expect(rebaseMemberOffset(rows, 206.25, after, before)).toBe(141);
  });

  it('retains identity heights through reordered groups and ignores invalid measurements', () => {
    const rows = flattenMemberRows([group('member', 'members', ['a', 'b'])]);
    const metrics = { groupRowPx: 28, userRowPx: 52, heights: new Map([
      [memberRowKey(rows[1]!), 112], [memberRowKey(rows[2]!), NaN],
    ]) };
    const reordered = flattenMemberRows([group('member', 'members', ['b', 'a'])]);
    expect(memberRowHeight(reordered[2]!, metrics)).toBe(112);
    expect(memberRowHeight(reordered[1]!, metrics)).toBe(52);
    metrics.heights.set(memberRowKey(rows[2]!), 0);
    expect(memberRowHeight(rows[2]!, metrics)).toBe(52);
  });

  it('conserves all 3k row heights across top, middle, group boundaries and tail', () => {
    const rows = flattenMemberRows([
      group('op', 'ops', Array.from({ length: 1500 }, (_, i) => `op${i}`)),
      group('member', 'members', Array.from({ length: 1500 }, (_, i) => `nick${i}`)),
    ]);
    for (const scale of [1, 2, 3]) {
      const metrics = { groupRowPx: 32 * scale, userRowPx: 56 * scale,
        heights: new Map(rows.map((row, i) => [memberRowKey(row),
          (row.kind === 'group' ? 38 : i % 7 === 0 ? 118 : 56) * scale])) };
      const total = memberPrefixHeight(rows, rows.length, metrics);
      for (const index of [0, 45, 1499, 1500, 1501, 1502, 2970, 3001]) {
        const offset = memberPrefixHeight(rows, index, metrics) + 1;
        const win = computeMemberWindow(rows, offset, undefined, metrics);
        expect(win.start).toBeLessThanOrEqual(index);
        expect(win.end).toBeGreaterThan(index);
        expect(win.rendered).toBeLessThanOrEqual(MEMBER_WINDOW_SIZE);
        const renderedHeight = rows.slice(win.start, win.end)
          .reduce((sum, row) => sum + memberRowHeight(row, metrics), 0);
        expect(memberPrefixHeight(rows, win.start, metrics) + renderedHeight
          + total - memberPrefixHeight(rows, win.end, metrics)).toBe(total);
        const sections = sectionMemberWindow(rows, win.start, win.end);
        expect(sections.filter((section) => !section.continuation).length)
          .toBe(rows.slice(win.start, win.end).filter((row) => row.kind === 'group').length);
      }
    }
  });

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

  it('uses the taller phone identity rows when mobile metrics are supplied', () => {
    const rows = flattenMemberRows([group('member', 'members', ['a', 'b', 'c'])]);
    expect(memberIndexAtOffset(rows, MEMBER_MOBILE_GROUP_ROW_PX, MEMBER_MOBILE_WINDOW_METRICS)).toBe(1);
    expect(memberIndexAtOffset(
      rows,
      MEMBER_MOBILE_GROUP_ROW_PX + MEMBER_MOBILE_USER_ROW_PX,
      MEMBER_MOBILE_WINDOW_METRICS,
    )).toBe(2);
    expect(memberPrefixHeight(rows, 2, MEMBER_MOBILE_WINDOW_METRICS))
      .toBe(MEMBER_MOBILE_GROUP_ROW_PX + MEMBER_MOBILE_USER_ROW_PX);
  });

  it('rebuilds a continuation section when the window starts mid-group', () => {
    const rows = flattenMemberRows([group('member', 'members', ['a', 'b', 'c', 'd'])]);
    const sections = sectionMemberWindow(rows, 2, 4);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ key: 'member', continuation: true, count: 4 });
    expect(sections[0]!.members.map((entry) => entry.user.nick)).toEqual(['b', 'c']);
  });

  it('recognizes an equivalent window so mounted member controls retain focus', () => {
    const rows = flattenMemberRows([group('member', 'members', ['a', 'b'])]);
    const first = sectionMemberWindow(rows, 0, rows.length);
    const second = sectionMemberWindow(rows, 0, rows.length);
    expect(second).not.toBe(first);
    expect(memberWindowSectionsEqual(first, second)).toBe(true);

    const changedRows = flattenMemberRows([group('member', 'members', ['a', 'c'])]);
    expect(memberWindowSectionsEqual(first, sectionMemberWindow(changedRows, 0, changedRows.length)))
      .toBe(false);
  });
});
