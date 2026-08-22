// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * inviteCard.ts — pure model helpers for rich invite link previews.
 */

import { parseAtParam, parseJoinParam, parseReaderParam, parseTopicParam } from '@/lib/deeplink';

export interface InviteCard {
  channel: string | null;
  at: Date | null;
  topic: string | null;
  readerMode: boolean;
  guestName: string | null;
  network: string;
  url: string;
}

/**
 * IRC nick rules — mirror Connect.validateNick, the downstream consumer of a
 * suggested guest name: start with a letter or IRC special char, then letters,
 * digits, `-`, or the special chars, capped at 64. The `?as=` value is
 * untrusted input like every other invite param, so it is validated at THIS
 * boundary rather than trusted raw: whitespace, commas, and — critically —
 * control characters (NUL, CR/LF) are rejected, so a crafted invite can never
 * seat a corrupt nick, garble the Open Graph meta, or bloat the canonical URL.
 */
const GUEST_NICK_RE = /^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]*$/;
const GUEST_NICK_MAX = 64;

export function parseGuestName(raw: string | null): string | null {
  const trimmed = raw?.trim() ?? '';
  if (trimmed.length === 0 || trimmed.length > GUEST_NICK_MAX) return null;
  return GUEST_NICK_RE.test(trimmed) ? trimmed : null;
}

/** Empty is allowed (the recipient can still join and pick a name later). */
export function guestNameError(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > GUEST_NICK_MAX) return 'Name must be 64 characters or fewer.';
  if (!GUEST_NICK_RE.test(trimmed)) {
    return 'Start with a letter. Use letters, numbers, or -[]\\`_^{|}.';
  }
  return undefined;
}

function canonicalInviteUrl(origin: string, card: Omit<InviteCard, 'network' | 'url'>): string {
  const canonicalParams = new URLSearchParams();
  if (card.channel !== null) canonicalParams.set('join', card.channel);
  if (card.at !== null) canonicalParams.set('at', card.at.toISOString());
  if (card.topic !== null) canonicalParams.set('topic', card.topic);
  if (card.readerMode) canonicalParams.set('reader', '1');
  if (card.guestName !== null) canonicalParams.set('as', card.guestName);

  const query = canonicalParams.toString();
  return query.length > 0 ? `${origin}?${query}` : origin;
}

export function buildInviteCard(
  params: URLSearchParams,
  opts: { network: string; origin: string },
): InviteCard {
  const channel = parseJoinParam(params.get('join'));
  const at = parseAtParam(params.get('at'));
  const topic = parseTopicParam(params.get('topic'));
  const readerMode = parseReaderParam(params.get('reader'));
  const guestName = parseGuestName(params.get('as'));
  const partialCard = { channel, at, topic, readerMode, guestName };

  return {
    channel,
    at,
    topic,
    readerMode,
    guestName,
    network: opts.network,
    url: canonicalInviteUrl(opts.origin, partialCard),
  };
}

export function inviteTitle(card: InviteCard): string {
  return card.channel !== null ? `Join ${card.channel} on ${card.network}` : `Join ${card.network}`;
}

export function inviteHeadline(card: InviteCard): string {
  return card.channel !== null ? `Join ${card.channel}` : `Join ${card.network}`;
}

export function inviteWelcome(card: InviteCard): string {
  return card.channel !== null
    ? 'Choose a display name to enter this room.'
    : 'Choose a display name, then pick a room once you are in.';
}

export function inviteDescription(card: InviteCard): string {
  const parts: string[] = [];
  if (card.channel !== null) {
    parts.push(`A friend invited you to ${card.channel} on ${card.network}.`);
  } else {
    parts.push(`A friend invited you to ${card.network}.`);
  }
  if (card.topic !== null) parts.push(`They're talking about ${card.topic}.`);
  return parts.join(' ');
}

export function inviteOgMeta(card: InviteCard): Array<{ property: string; content: string }> {
  return [
    { property: 'og:title', content: inviteTitle(card) },
    { property: 'og:description', content: inviteDescription(card) },
    { property: 'og:url', content: card.url },
    { property: 'og:type', content: 'website' },
  ];
}
