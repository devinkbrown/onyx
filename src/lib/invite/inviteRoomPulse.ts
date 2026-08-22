// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Honest public pulse for the /invite room card.
 *
 * Only surfaces fields the public chanstats feed actually has: a topic, a last
 * active stamp, and at most one last-speaker nick. Never invents a member
 * count, never ingests top-user leaderboards, and omits a row when the feed
 * cannot back it.
 */

import { fetchChannelDetail, type ChannelDetail } from '@/lib/stats/channelDetail';
import { PUBLIC_FEED_UNIX_SECONDS_MAX } from '@/lib/stats/feedBounds';
import { fetchStatsIndex, type StatsIndex } from '@/lib/stats/networkIndex';
import { relativeTime } from '@/lib/time/relativeTime';
import { mergeInviteFaces, parseGuestName } from './inviteCard';

export type InviteRoomPulse = {
  topic: string | null;
  lastPulse: string | null;
  faces: string[];
};

export type InviteRoomPulseDeps = {
  nowMs?: number;
  fetchIndex?: () => Promise<StatsIndex | null>;
  fetchDetail?: (channel: string) => Promise<ChannelDetail | null>;
};

function findRoom(index: StatsIndex | null, channel: string) {
  const key = channel.toLowerCase();
  return index?.channels.find((room) => room.channel.toLowerCase() === key) ?? null;
}

/**
 * Last-pulse label from a unix-seconds stamp. Zero/unknown stamps stay omitted
 * unless the room is known and empty — then "just started" is honest.
 */
export function formatInvitePulse(
  lastActiveUnix: number,
  nowMs: number,
  knownEmpty: boolean,
): string | null {
  if (
    Number.isFinite(lastActiveUnix)
    && lastActiveUnix > 0
    && lastActiveUnix <= PUBLIC_FEED_UNIX_SECONDS_MAX
    && Number.isFinite(nowMs)
    && Math.abs(nowMs) <= PUBLIC_FEED_UNIX_SECONDS_MAX * 1000
  ) {
    const label = relativeTime(new Date(lastActiveUnix * 1000), new Date(nowMs));
    return label === 'just now' ? 'just started' : label;
  }
  return knownEmpty ? 'just started' : null;
}

export async function loadInviteRoomPulse(
  channel: string,
  deps: InviteRoomPulseDeps = {},
): Promise<InviteRoomPulse | null> {
  const name = channel.trim();
  if (!name) return null;

  const nowMs = deps.nowMs ?? Date.now();
  const fetchIndex = deps.fetchIndex ?? fetchStatsIndex;
  const fetchDetail = deps.fetchDetail ?? fetchChannelDetail;

  const [indexResult, detailResult] = await Promise.allSettled([
    fetchIndex(),
    fetchDetail(name),
  ]);
  const index = indexResult.status === 'fulfilled' ? indexResult.value : null;
  const detail = detailResult.status === 'fulfilled' ? detailResult.value : null;

  const room = findRoom(index, name);
  if (!room && !detail) return null;

  const topic = (room?.topic ?? '').trim() || null;
  const lastActive = detail?.lastActive || room?.last_active || 0;
  const knownEmpty = room !== null
    && room.messages === 0
    && lastActive === 0;
  const lastPulse = formatInvitePulse(lastActive, nowMs, knownEmpty);
  const speaker = parseGuestName(detail?.lastSpeaker ?? null);
  const faces = mergeInviteFaces(speaker ? [speaker] : []);

  return { topic, lastPulse, faces };
}
