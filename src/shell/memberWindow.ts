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
export const MEMBER_USER_ROW_PX = 36;

export type MemberFlatRow =
  | { kind: 'group'; key: string; label: string; count: number }
  | { kind: 'member'; groupKey: string; entry: MemberEntry };

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

export function memberRowHeight(row: MemberFlatRow): number {
  return row.kind === 'group' ? MEMBER_GROUP_ROW_PX : MEMBER_USER_ROW_PX;
}

export function memberIndexAtOffset(rows: readonly MemberFlatRow[], offsetPx: number): number {
  const offset = Number.isFinite(offsetPx) ? Math.max(0, offsetPx) : 0;
  let y = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const next = y + memberRowHeight(rows[i]!);
    if (offset < next) return i;
    y = next;
  }
  return rows.length;
}

export function memberPrefixHeight(rows: readonly MemberFlatRow[], end: number): number {
  const last = Math.max(0, Math.min(rows.length, Math.floor(end)));
  let y = 0;
  for (let i = 0; i < last; i += 1) y += memberRowHeight(rows[i]!);
  return y;
}

export function computeMemberWindow(
  rows: readonly MemberFlatRow[],
  scrollTopPx: number,
  windowSize = MEMBER_WINDOW_SIZE,
): MessageWindow {
  return computeMessageWindow({
    total: rows.length,
    windowSize,
    pageStart: memberIndexAtOffset(rows, scrollTopPx),
  });
}

export type MemberWindowSection = {
  key: string;
  label: string;
  count: number;
  continuation: boolean;
  members: MemberEntry[];
};

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
