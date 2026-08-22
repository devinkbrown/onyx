// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Home catch-up inbox — "what did I miss?"
 *
 * Pure ranking for Home: mentions of you, then unread rooms/DMs, each recency
 * first. Invites are accepted only when the caller already has that state
 * (system notifications from INVITE). This module never invents occupancy,
 * hide/close lists, or a parallel invite store.
 */
import type { CatchUpItem } from '@/lib/notifications/catchUp';

export type HomeInboxInvite = {
  key: string;
  inviter: string;
  channel: string;
  at: number;
};

export type HomeInboxRow = CatchUpItem & {
  /** Authoritative first-unread id when the store already has one. */
  boundaryId: string | null;
};

export type HomeInbox = {
  mentions: readonly HomeInboxRow[];
  missed: readonly HomeInboxRow[];
  invites: readonly HomeInboxInvite[];
  empty: boolean;
};

export type HomeInboxInviteSource = {
  id: string;
  type: string;
  text: string;
  from?: string;
  channel?: string;
  at: Date;
};

const INVITE_TEXT = /^(.+?)\s+invited you to\s+([#&]\S+)/i;

export function compareInboxRecency(
  a: { lastActivity: number; name: string },
  b: { lastActivity: number; name: string },
): number {
  return b.lastActivity - a.lastActivity || a.name.localeCompare(b.name);
}

export function parseInviteNotification(
  notice: HomeInboxInviteSource,
): HomeInboxInvite | null {
  if (notice.type !== 'system') return null;
  const from = notice.from?.trim() ?? '';
  const channel = notice.channel?.trim() ?? '';
  if (from && channel && /^[#&]/.test(channel)) {
    return {
      key: notice.id,
      inviter: from,
      channel,
      at: notice.at.getTime(),
    };
  }
  const match = notice.text.match(INVITE_TEXT);
  const inviter = from || match?.[1]?.trim() || '';
  const room = channel || match?.[2]?.trim() || '';
  if (!inviter || !room || !/^[#&]/.test(room)) return null;
  return {
    key: notice.id,
    inviter,
    channel: room,
    at: notice.at.getTime(),
  };
}

function withBoundary(
  item: CatchUpItem,
  firstUnreadId: ReadonlyMap<string, string | null>,
): HomeInboxRow {
  return {
    ...item,
    boundaryId: firstUnreadId.get(item.target.toLowerCase()) ?? null,
  };
}

/**
 * Split already-classified catch-up items into a quiet inbox.
 * Mentions stay out of the unread list so a room is not listed twice.
 */
export function composeHomeInbox(input: {
  items: readonly CatchUpItem[];
  firstUnreadId?: ReadonlyMap<string, string | null>;
  invites?: readonly HomeInboxInvite[];
}): HomeInbox {
  const firstUnreadId = input.firstUnreadId ?? new Map();
  const mentions = input.items
    .filter((item) => item.highlights > 0)
    .slice()
    .sort(compareInboxRecency)
    .map((item) => withBoundary(item, firstUnreadId));
  const mentionKeys = new Set(mentions.map((item) => item.key));
  const missed = input.items
    .filter((item) => item.unread > 0 && !mentionKeys.has(item.key))
    .slice()
    .sort(compareInboxRecency)
    .map((item) => withBoundary(item, firstUnreadId));
  const invites = (input.invites ?? [])
    .slice()
    .sort((a, b) => b.at - a.at || a.channel.localeCompare(b.channel));

  return {
    mentions,
    missed,
    invites,
    empty: mentions.length === 0 && missed.length === 0 && invites.length === 0,
  };
}
