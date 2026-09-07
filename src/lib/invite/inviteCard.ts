// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * inviteCard.ts — pure model helpers for rich invite link previews.
 */

import { parseAtParam, parseJoinParam, parseReaderParam, parseTopicParam } from '@/lib/deeplink';
import { nicknameError, parseNickname } from '@/lib/identity/nickname';

export const INVITE_FACE_MAX = 3;

export interface InviteCard {
  channel: string | null;
  at: Date | null;
  topic: string | null;
  readerMode: boolean;
  guestName: string | null;
  /** Who sent the link, when `?by=` carries a valid nick. */
  inviter: string | null;
  /** Up to three nicks from `?with=`. Never padded or invented. */
  faces: string[];
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
export function parseGuestName(raw: string | null): string | null {
  return parseNickname(raw);
}

/** Empty is allowed (the recipient can still join and pick a name later). */
export function guestNameError(raw: string): string | undefined {
  return nicknameError(raw, { allowEmpty: true });
}

/** Deduped, validated nicks, capped at three. Later lists fill gaps only. */
export function mergeInviteFaces(...lists: Array<readonly string[] | null | undefined>): string[] {
  const seen = new Set<string>();
  const faces: string[] = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const nick = parseGuestName(raw);
      if (!nick) continue;
      const key = nick.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      faces.push(nick);
      if (faces.length >= INVITE_FACE_MAX) return faces;
    }
  }
  return faces;
}

/** `?with=alice,bob` — comma-separated, then each nick is re-validated. */
export function parseInviteFaces(raw: string | null): string[] {
  if (!raw) return [];
  return mergeInviteFaces(raw.split(','));
}

function canonicalInviteUrl(origin: string, card: Omit<InviteCard, 'network' | 'url'>): string {
  const canonicalParams = new URLSearchParams();
  if (card.channel !== null) canonicalParams.set('join', card.channel);
  if (card.at !== null) canonicalParams.set('at', card.at.toISOString());
  if (card.topic !== null) canonicalParams.set('topic', card.topic);
  if (card.readerMode) canonicalParams.set('reader', '1');
  if (card.guestName !== null) canonicalParams.set('as', card.guestName);
  if (card.inviter !== null) canonicalParams.set('by', card.inviter);
  if (card.faces.length > 0) canonicalParams.set('with', card.faces.join(','));

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
  const inviter = parseGuestName(params.get('by'));
  const faces = parseInviteFaces(params.get('with'));
  const partialCard = { channel, at, topic, readerMode, guestName, inviter, faces };

  return {
    channel,
    at,
    topic,
    readerMode,
    guestName,
    inviter,
    faces,
    network: opts.network,
    url: canonicalInviteUrl(opts.origin, partialCard),
  };
}

export function inviteTitle(card: InviteCard): string {
  return card.channel !== null ? `Join ${card.channel} on ${card.network}` : `Join ${card.network}`;
}

/** Room name is the card title. Bare links keep the network name. */
export function inviteHeadline(card: InviteCard): string {
  return card.channel !== null ? card.channel : `Join ${card.network}`;
}

export function inviteWelcome(card: InviteCard): string {
  return card.channel !== null
    ? 'Choose a display name to walk in.'
    : 'Choose a display name, then pick a room once you are in.';
}

export function inviteDescription(card: InviteCard): string {
  const target = card.channel !== null ? `${card.channel} on ${card.network}` : card.network;
  const parts: string[] = [];
  if (card.inviter !== null) {
    parts.push(`${card.inviter} invited you to ${target}.`);
  } else {
    parts.push(`Join ${target}.`);
  }
  if (card.topic !== null) parts.push(card.topic);
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
