// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * toggleReaction.ts — pure optimistic toggle for IRCv3 draft/react state.
 *
 * The store's `addLocalReaction` and the TAGMSG/REACT fold-back both need the
 * same "add me if absent, drop me if present" rule with case-insensitive nick
 * matching (PREFIX-learned nicks can arrive mixed-case). Keep the maths pure so
 * unit tests pin the edge cases without a socket.
 */

import type { MessageReaction } from '@/lib/irc/types';

function sameNick(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Toggle `nick` onto/off of the `emoji` reaction bucket.
 *
 * - Empty emoji or nick → return a shallow copy of the input (no-op).
 * - Nick already present (case-insensitive) → remove; drop the bucket when empty.
 * - Nick absent → append (preserving existing casing of co-reactors).
 * - Never mutates the input array or nested user lists.
 */
export function toggleMessageReactions(
  reactions: readonly MessageReaction[] | undefined,
  emoji: string,
  nick: string,
): MessageReaction[] {
  const existing = reactions ?? [];
  if (!emoji || !nick) return existing.map((r) => ({ emoji: r.emoji, users: [...r.users] }));

  const rIdx = existing.findIndex((r) => r.emoji === emoji);
  if (rIdx < 0) {
    return [...existing.map((r) => ({ emoji: r.emoji, users: [...r.users] })), { emoji, users: [nick] }];
  }

  const current = existing[rIdx]!;
  const alreadyIn = current.users.some((u) => sameNick(u, nick));
  let nextUsers: string[];
  if (alreadyIn) {
    nextUsers = current.users.filter((u) => !sameNick(u, nick));
  } else {
    nextUsers = [...current.users, nick];
  }

  if (nextUsers.length === 0) {
    return existing
      .filter((_, i) => i !== rIdx)
      .map((r) => ({ emoji: r.emoji, users: [...r.users] }));
  }

  return existing.map((r, i) =>
    i === rIdx
      ? { emoji: r.emoji, users: nextUsers }
      : { emoji: r.emoji, users: [...r.users] },
  );
}

/**
 * Drop a single nick from an emoji bucket without toggling-on when absent.
 * Used by inbound unreact / removeReaction paths.
 */
export function removeMessageReactor(
  reactions: readonly MessageReaction[] | undefined,
  emoji: string,
  nick: string,
): MessageReaction[] {
  const existing = reactions ?? [];
  if (!emoji || !nick) return existing.map((r) => ({ emoji: r.emoji, users: [...r.users] }));

  const rIdx = existing.findIndex((r) => r.emoji === emoji);
  if (rIdx < 0) return existing.map((r) => ({ emoji: r.emoji, users: [...r.users] }));

  const current = existing[rIdx]!;
  const nextUsers = current.users.filter((u) => !sameNick(u, nick));
  if (nextUsers.length === current.users.length) {
    return existing.map((r) => ({ emoji: r.emoji, users: [...r.users] }));
  }
  if (nextUsers.length === 0) {
    return existing
      .filter((_, i) => i !== rIdx)
      .map((r) => ({ emoji: r.emoji, users: [...r.users] }));
  }
  return existing.map((r, i) =>
    i === rIdx
      ? { emoji: r.emoji, users: nextUsers }
      : { emoji: r.emoji, users: [...r.users] },
  );
}
