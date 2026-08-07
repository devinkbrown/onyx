// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * quietBoosts.ts — pure aggregation and optimistic toggles for calm reactions.
 */
import type { ChatMessage, MessageReaction } from '@/lib/irc/types';

export const BOOST_NOTIFIES = false;

export interface Boost {
  emoji: string;
  from: string;
  /** Optional source total, independent of the named actor in `from`. */
  count?: number;
}

export interface BoostGroup {
  emoji: string;
  count: number;
  reactors: readonly string[];
  youBoosted: boolean;
}

export interface BoostConversation {
  target: string;
  messages: readonly ChatMessage[];
}

export interface QuietBoostDigestItem {
  target: string;
  messageId: string;
  at: Date;
  from: string;
  text: string;
  groups: readonly BoostGroup[];
  total: number;
}

function sameNick(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function hasReactor(reactors: readonly string[], nick: string): boolean {
  return reactors.some((reactor) => sameNick(reactor, nick));
}

function compareBoostGroups(a: BoostGroup, b: BoostGroup): number {
  const countOrder = b.count - a.count;
  if (countOrder !== 0) return countOrder;
  if (a.emoji < b.emoji) return -1;
  if (a.emoji > b.emoji) return 1;
  return 0;
}

function sortBoostGroups(groups: readonly BoostGroup[]): BoostGroup[] {
  return [...groups].sort(compareBoostGroups);
}

function makeBoostGroup(
  emoji: string,
  reactors: readonly string[],
  you: string,
  count = reactors.length,
): BoostGroup {
  return {
    emoji,
    count: Math.max(reactors.length, count),
    reactors: [...reactors],
    youBoosted: hasReactor(reactors, you),
  };
}

export function aggregateBoosts(boosts: readonly Boost[], you: string): BoostGroup[] {
  const reactorsByEmoji = new Map<string, { reactors: string[]; count: number }>();

  for (const boost of boosts) {
    if (boost.emoji.length === 0) continue;
    const explicitCount = typeof boost.count === 'number'
      && Number.isSafeInteger(boost.count)
      && boost.count > 0
      ? boost.count
      : 0;
    if (boost.from.length === 0 && explicitCount === 0) continue;

    const entry = reactorsByEmoji.get(boost.emoji);
    if (!entry) {
      reactorsByEmoji.set(boost.emoji, {
        reactors: boost.from.length > 0 ? [boost.from] : [],
        count: explicitCount,
      });
      continue;
    }

    entry.count = Math.max(entry.count, explicitCount);
    if (boost.from.length > 0 && !hasReactor(entry.reactors, boost.from)) {
      entry.reactors.push(boost.from);
    }
  }

  const groups = Array.from(
    reactorsByEmoji.entries(),
    ([emoji, entry]) => makeBoostGroup(emoji, entry.reactors, you, Math.max(entry.count, entry.reactors.length)),
  );
  return sortBoostGroups(groups);
}

/** Aggregate message reactions while retaining imported totals and named actors separately. */
export function aggregateMessageReactions(
  reactions: readonly MessageReaction[],
  you: string,
): BoostGroup[] {
  return aggregateBoosts(
    reactions.flatMap((reaction) => {
      const count = reaction.count;
      if (reaction.users.length === 0) return [{ emoji: reaction.emoji, from: '', count }];
      return reaction.users.map((from) => ({ emoji: reaction.emoji, from, count }));
    }),
    you,
  );
}

export function toggleBoost(groups: readonly BoostGroup[], emoji: string, you: string): BoostGroup[] {
  const nextGroups: BoostGroup[] = [];
  let foundEmoji = false;

  for (const group of groups) {
    if (group.emoji !== emoji) {
      nextGroups.push(makeBoostGroup(group.emoji, group.reactors, you));
      continue;
    }

    foundEmoji = true;
    const reactors = hasReactor(group.reactors, you)
      ? group.reactors.filter((reactor) => !sameNick(reactor, you))
      : [...group.reactors, you];

    if (reactors.length > 0) {
      nextGroups.push(makeBoostGroup(group.emoji, reactors, you));
    }
  }

  if (!foundEmoji && emoji.length > 0 && you.length > 0) {
    nextGroups.push(makeBoostGroup(emoji, [you], you));
  }

  return sortBoostGroups(nextGroups);
}

export function totalBoosts(groups: readonly BoostGroup[]): number {
  return groups.reduce((total, group) => total + group.count, 0);
}

function messageBoosts(message: ChatMessage, you: string): BoostGroup[] {
  return aggregateMessageReactions(message.reactions ?? [], you);
}

export function buildQuietBoostDigest(
  conversations: Iterable<BoostConversation>,
  you: string,
  limit = 4,
): QuietBoostDigestItem[] {
  const items: QuietBoostDigestItem[] = [];
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      if (message.deleted || message.redacted) continue;
      const groups = messageBoosts(message, you);
      const total = totalBoosts(groups);
      const text = (message.plaintext ?? message.text).replace(/\s+/g, ' ').trim();
      if (total === 0 || text.length === 0) continue;
      items.push({
        target: conversation.target,
        messageId: message.id,
        at: message.time,
        from: message.from,
        text,
        groups,
        total,
      });
    }
  }
  return items
    .sort((a, b) =>
      b.total - a.total ||
      b.at.getTime() - a.at.getTime() ||
      a.target.localeCompare(b.target) ||
      a.messageId.localeCompare(b.messageId),
    )
    .slice(0, limit);
}
