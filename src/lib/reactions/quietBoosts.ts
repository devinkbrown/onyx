// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * quietBoosts.ts — pure aggregation and optimistic toggles for calm reactions.
 */
import type { ChatMessage } from '@/lib/irc/types';

export const BOOST_NOTIFIES = false;

export interface Boost {
  emoji: string;
  from: string;
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

function makeBoostGroup(emoji: string, reactors: readonly string[], you: string): BoostGroup {
  return {
    emoji,
    count: reactors.length,
    reactors: [...reactors],
    youBoosted: hasReactor(reactors, you),
  };
}

export function aggregateBoosts(boosts: readonly Boost[], you: string): BoostGroup[] {
  const reactorsByEmoji = new Map<string, string[]>();

  for (const boost of boosts) {
    if (boost.emoji.length === 0 || boost.from.length === 0) continue;

    const reactors = reactorsByEmoji.get(boost.emoji);
    if (!reactors) {
      reactorsByEmoji.set(boost.emoji, [boost.from]);
      continue;
    }

    if (!hasReactor(reactors, boost.from)) {
      reactors.push(boost.from);
    }
  }

  const groups = Array.from(reactorsByEmoji.entries(), ([emoji, reactors]) => makeBoostGroup(emoji, reactors, you));
  return sortBoostGroups(groups);
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
  return aggregateBoosts(
    (message.reactions ?? []).flatMap((reaction) =>
      reaction.users.map((from) => ({ emoji: reaction.emoji, from })),
    ),
    you,
  );
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
