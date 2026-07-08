/**
 * inviteCard.ts — pure model helpers for rich invite link previews.
 */

import { parseAtParam, parseJoinParam } from '@/lib/deeplink';

export interface InviteCard {
  channel: string | null;
  at: Date | null;
  guestName: string | null;
  network: string;
  url: string;
}

function trimmedParam(raw: string | null): string | null {
  const trimmed = raw?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function canonicalInviteUrl(origin: string, card: Omit<InviteCard, 'network' | 'url'>): string {
  const canonicalParams = new URLSearchParams();
  if (card.channel !== null) canonicalParams.set('join', card.channel);
  if (card.at !== null) canonicalParams.set('at', card.at.toISOString());
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
  const guestName = trimmedParam(params.get('as'));
  const partialCard = { channel, at, guestName };

  return {
    channel,
    at,
    guestName,
    network: opts.network,
    url: canonicalInviteUrl(opts.origin, partialCard),
  };
}

export function inviteTitle(card: InviteCard): string {
  return card.channel !== null ? `Join ${card.channel} on ${card.network}` : `Join ${card.network}`;
}

export function inviteDescription(card: InviteCard): string {
  const details: string[] = [];
  if (card.at !== null) details.push(`Jump into the conversation from ${card.at.toISOString()}`);
  if (card.guestName !== null) details.push(`Continue as ${card.guestName}`);
  const target = card.channel !== null ? `${card.channel} on ${card.network}` : card.network;
  return details.length > 0 ? details.join('. ') : `Open an invite to ${target}.`;
}

export function inviteOgMeta(card: InviteCard): Array<{ property: string; content: string }> {
  return [
    { property: 'og:title', content: inviteTitle(card) },
    { property: 'og:description', content: inviteDescription(card) },
    { property: 'og:url', content: card.url },
    { property: 'og:type', content: 'website' },
  ];
}
