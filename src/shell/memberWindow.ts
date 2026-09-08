// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * memberWindow.ts — flatten + bound the channel roster so a 3k-nick NAMES
 * burst cannot mount thousands of Popover rows.
 *
 * Reuses {@link computeMessageWindow} with an explicit pageStart so the roster
 * pages from the top (unlike the message log's live tail).
 */

import type { GroupEntry, MemberEntry } from '@/lib/memberGroups';
import { computeMessageWindow, type MessageWindow } from './messageWindow';

export const MEMBER_WINDOW_SIZE = 96;
export const MEMBER_GROUP_ROW_PX = 28;
export const MEMBER_USER_ROW_PX = 52;
export const MEMBER_MOBILE_GROUP_ROW_PX = 32;
export const MEMBER_MOBILE_USER_ROW_PX = 56;

export type MemberWindowMetrics = {
  groupRowPx: number;
  userRowPx: number;
  /** Border-box heights of mounted rows, keyed by identity, not window index. */
  heights?: ReadonlyMap<string, number>;
};

export const MEMBER_WINDOW_METRICS: MemberWindowMetrics = {
  groupRowPx: MEMBER_GROUP_ROW_PX,
  userRowPx: MEMBER_USER_ROW_PX,
};

export const MEMBER_MOBILE_WINDOW_METRICS: MemberWindowMetrics = {
  groupRowPx: MEMBER_MOBILE_GROUP_ROW_PX,
  userRowPx: MEMBER_MOBILE_USER_ROW_PX,
};

export type MemberFlatRow =
  | { kind: 'group'; key: string; label: string; count: number }
  | { kind: 'member'; groupKey: string; entry: MemberEntry };

export function memberRowKey(row: MemberFlatRow): string {
  return row.kind === 'group' ? `group:${row.key}`
    : `member:${row.groupKey}:${row.entry.user.nick.toLowerCase()}`;
}

export function flattenMemberRows(groups: readonly GroupEntry[]): MemberFlatRow[] {
  const rows: MemberFlatRow[] = [];
  for (const group of groups) {
    rows.push({
      kind: 'group',
      key: group.key,
      label: group.label,
      count: group.members.length,
    });
    for (const entry of group.members) {
      rows.push({ kind: 'member', groupKey: group.key, entry });
    }
  }
  return rows;
}

export function memberRowHeight(
  row: MemberFlatRow,
  metrics: MemberWindowMetrics = MEMBER_WINDOW_METRICS,
): number {
  const measured = metrics.heights?.get(memberRowKey(row));
  if (measured !== undefined && Number.isFinite(measured) && measured > 0) return measured;
  return row.kind === 'group' ? metrics.groupRowPx : metrics.userRowPx;
}

/** Keep the same row and intra-row position when estimates are replaced by
 * measurements (or invalidated by width/font changes). */
export function rebaseMemberOffset(
  rows: readonly MemberFlatRow[],
  offset: number,
  before: MemberWindowMetrics,
  after: MemberWindowMetrics,
): number {
  const index = memberIndexAtOffset(rows, offset, before);
  const row = rows[index];
  const within = row ? Math.min(
    Math.max(0, offset - memberPrefixHeight(rows, index, before)),
    Math.max(0, memberRowHeight(row, after) - 1),
  ) : 0;
  return memberPrefixHeight(rows, index, after) + within;
}

export function memberIndexAtOffset(
  rows: readonly MemberFlatRow[],
  offsetPx: number,
  metrics: MemberWindowMetrics = MEMBER_WINDOW_METRICS,
): number {
  const offset = Number.isFinite(offsetPx) ? Math.max(0, offsetPx) : 0;
  let y = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const next = y + memberRowHeight(rows[i]!, metrics);
    if (offset < next) return i;
    y = next;
  }
  return rows.length;
}

export function memberPrefixHeight(
  rows: readonly MemberFlatRow[],
  end: number,
  metrics: MemberWindowMetrics = MEMBER_WINDOW_METRICS,
): number {
  const last = Math.max(0, Math.min(rows.length, Math.floor(end)));
  let y = 0;
  for (let i = 0; i < last; i += 1) y += memberRowHeight(rows[i]!, metrics);
  return y;
}

export function computeMemberWindow(
  rows: readonly MemberFlatRow[],
  scrollTopPx: number,
  windowSize = MEMBER_WINDOW_SIZE,
  metrics: MemberWindowMetrics = MEMBER_WINDOW_METRICS,
): MessageWindow {
  const capacity = Number.isFinite(windowSize)
    ? Math.max(1, Math.min(MEMBER_WINDOW_SIZE, Math.floor(windowSize)))
    : MEMBER_WINDOW_SIZE;
  return computeMessageWindow({
    total: rows.length,
    windowSize: capacity,
    // Measured overscan above the viewport prevents small reverse scrolls from
    // immediately replacing the first visible control.
    pageStart: Math.max(0, memberIndexAtOffset(rows, scrollTopPx, metrics) - Math.min(12, capacity - 1)),
  });
}

export type MemberWindowSection = {
  key: string;
  label: string;
  count: number;
  continuation: boolean;
  members: MemberEntry[];
};

/** Preserve mounted member rows when only the viewport presentation changes. */
export function memberWindowSectionsEqual(
  previous: readonly MemberWindowSection[],
  next: readonly MemberWindowSection[],
): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((section, sectionIndex) => {
    const candidate = next[sectionIndex];
    if (!candidate
      || section.key !== candidate.key
      || section.label !== candidate.label
      || section.count !== candidate.count
      || section.continuation !== candidate.continuation
      || section.members.length !== candidate.members.length) {
      return false;
    }
    return section.members.every((member, memberIndex) => member === candidate.members[memberIndex]);
  });
}

/** Rebuild grouped sections from a windowed flat slice so list semantics stay intact. */
export function sectionMemberWindow(
  rows: readonly MemberFlatRow[],
  start: number,
  end: number,
): MemberWindowSection[] {
  const sections: MemberWindowSection[] = [];
  let current: MemberWindowSection | null = null;
  const lastLabels = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    if (row.kind === 'group') lastLabels.set(row.key, { label: row.label, count: row.count });
  }

  const from = Math.max(0, Math.floor(start));
  const to = Math.max(from, Math.min(rows.length, Math.floor(end)));
  for (let i = from; i < to; i += 1) {
    const row = rows[i]!;
    if (row.kind === 'group') {
      current = {
        key: row.key,
        label: row.label,
        count: row.count,
        continuation: false,
        members: [],
      };
      sections.push(current);
      continue;
    }
    if (!current || current.key !== row.groupKey) {
      const meta = lastLabels.get(row.groupKey);
      current = {
        key: row.groupKey,
        label: meta?.label ?? row.groupKey,
        count: meta?.count ?? 0,
        continuation: true,
        members: [],
      };
      sections.push(current);
    }
    current.members.push(row.entry);
  }
  return sections;
}
