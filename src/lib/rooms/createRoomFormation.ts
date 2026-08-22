// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * createRoomFormation.ts — Start a room as a people-first loop.
 *
 * WhatsApp / Telegram / Slack all put people on the create path. Slack's
 * graveyard is rooms created and never invited. The formation target is
 * 3 people who know each other, each sending a message within 48 hours.
 *
 * Default path is JOIN + optional TOPIC + existing /invite/?join= links.
 * No MODE, ACCESS, keys, or a second invite protocol.
 */

/** Same joinable shape as `?join=` — no spaces, commas, or control chars. */
const JOINABLE_ROOM_RE = /^[&#][^\s\x00-\x1f\x7f,]{1,63}$/;
const TOPIC_CONTROL_PATTERN = /[\x00-\x1f\x7f]/u;
const CREATE_TOPIC_MAX_CHARS = 300;
const INVITEE_RE = /^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]{0,63}$/;

export const FORMATION_INVITE_TARGET = 3;
export const FORMATION_WINDOW_HOURS = 48;
export const SOFT_LAUNCH_MEMBER_MAX = 1;

export type RoomSkin = 'friends' | 'club' | 'creator';

export type RoomSkinOption = {
  id: RoomSkin;
  label: string;
  blurb: string;
  topicSeed: string;
  firstLine: string;
};

export const ROOM_SKINS: readonly RoomSkinOption[] = [
  {
    id: 'friends',
    label: 'Friends',
    blurb: 'People who already know each other.',
    topicSeed: 'Friends hang',
    firstLine: 'hey — this is our room',
  },
  {
    id: 'club',
    label: 'Club',
    blurb: 'A recurring hang — class, project, or club.',
    topicSeed: 'Club hang',
    firstLine: 'first meeting — when can you do Saturday?',
  },
  {
    id: 'creator',
    label: 'Creator',
    blurb: 'A place for an audience to gather.',
    topicSeed: 'Creator room',
    firstLine: 'welcome in — say hi if you are here',
  },
];

export const DEFAULT_FIRST_LINE = 'hey — this is our room';

export const FORMATION_COPY =
  'Rooms form when 3 people who know each other each send a message in the first two days.';

export type CreateRoomRequest = {
  name: string;
  topic?: string;
  skin?: RoomSkin | null;
  hangLabel?: string | null;
  firstLine?: string | null;
  sharedInvite: boolean;
};

export type BrowseRoomRow = {
  name: string;
  count: number;
  topic: string;
};

/**
 * Consumer create-room names: bare "friends" becomes "#friends".
 * Same joinable shape as `?join=`.
 */
export function normalizeCreateRoomName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const prefixed = trimmed.startsWith('#') || trimmed.startsWith('&') ? trimmed : `#${trimmed}`;
  const normalized = prefixed.toLowerCase();
  return JOINABLE_ROOM_RE.test(normalized) ? normalized : null;
}

/** Optional topic. Empty is allowed; control characters are not. */
export function sanitizeCreateRoomTopic(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (TOPIC_CONTROL_PATTERN.test(trimmed)) return null;
  if (trimmed.length > CREATE_TOPIC_MAX_CHARS) return null;
  return trimmed;
}

export function sanitizeCreateInvitee(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 64) return null;
  return INVITEE_RE.test(trimmed) ? trimmed : null;
}

export function roomSkinOption(id: RoomSkin | null | undefined): RoomSkinOption | null {
  if (!id) return null;
  return ROOM_SKINS.find((skin) => skin.id === id) ?? null;
}

export function suggestedFirstLine(skin: RoomSkin | null | undefined): string {
  return roomSkinOption(skin)?.firstLine ?? DEFAULT_FIRST_LINE;
}

export function canFinishCreateRoom(input: { sharedInvite: boolean }): boolean {
  return input.sharedInvite === true;
}

export function addFormationInvitee(current: readonly string[], raw: string): string[] | null {
  const nick = sanitizeCreateInvitee(raw);
  if (!nick) return null;
  const key = nick.toLowerCase();
  if (current.some((entry) => entry.toLowerCase() === key)) return [...current];
  if (current.length >= FORMATION_INVITE_TARGET) return [...current];
  return [...current, nick];
}

export function removeFormationInvitee(current: readonly string[], raw: string): string[] {
  const key = raw.trim().toLowerCase();
  return current.filter((entry) => entry.toLowerCase() !== key);
}

export function isSoftLaunchRoom(row: { count: number }): boolean {
  return row.count <= SOFT_LAUNCH_MEMBER_MAX;
}

/** Hide 1-member rooms from the default hall directory. Search can still find them. */
export function visibleBrowseRooms(
  rows: readonly BrowseRoomRow[],
  query: string,
): BrowseRoomRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows.filter((row) => !isSoftLaunchRoom(row));
  return rows.filter(
    (row) => row.name.toLowerCase().includes(q) || row.topic.toLowerCase().includes(q),
  );
}

export function browseMemberLabel(row: { count: number }): string {
  if (isSoftLaunchRoom(row)) return 'Just started';
  return `${row.count} ${row.count === 1 ? 'user' : 'users'}`;
}

export function nextSaturdayHang(now: Date = new Date(), hour = 16, minute = 0): Date {
  const candidate = new Date(now.getTime());
  const daysUntilSaturday = (6 - candidate.getDay() + 7) % 7;
  candidate.setDate(candidate.getDate() + daysUntilSaturday);
  candidate.setHours(hour, minute, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate;
}

export function formatHangLabel(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function buildCreateRoomTopic(input: {
  skin?: RoomSkin | null;
  topic?: string;
  hangLabel?: string | null;
}): string | null {
  const parts: string[] = [];
  const skin = roomSkinOption(input.skin);
  if (skin) parts.push(skin.topicSeed);

  const custom = sanitizeCreateRoomTopic(input.topic ?? '');
  if (custom === null) return null;
  if (custom) parts.push(custom);

  const hang = input.hangLabel?.trim();
  if (hang) {
    const hangLine = sanitizeCreateRoomTopic(`Next hang: ${hang}`);
    if (hangLine === null) return null;
    if (hangLine) parts.push(hangLine);
  }

  if (parts.length === 0) return '';
  return sanitizeCreateRoomTopic(parts.join(' · '));
}
