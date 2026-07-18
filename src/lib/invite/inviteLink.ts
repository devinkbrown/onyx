// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * inviteLink.ts — pure BUILDER for rich invite links (the create side).
 *
 * The inverse of inviteCard.buildInviteCard's canonicalisation: given an
 * InviteLinkSpec chosen inside the app (the active channel + an optional
 * preferred nick, moment, or conversation topic), it produces the canonical,
 * shareable landing link `<origin>?join=...` AND the direct in-app deep-link
 * `<appOrigin>?join=...` that opens the same room.
 *
 * Robustness by construction: every field is re-validated by routing the spec
 * through buildInviteCard, so a hostile or malformed spec can NEVER emit a
 * corrupt link — a bad nick, control character, or comma (a JOIN-list / CRLF
 * smuggling vector) is simply dropped, and a bad channel degrades to a
 * network-only invite rather than a broken navigation target. Because the app
 * deep-link's query is sliced from the SAME canonical URL, build+parse always
 * round-trips: buildInviteCard(query) yields exactly the returned card.
 */

import { buildInviteCard, type InviteCard } from './inviteCard';

export interface InviteLinkSpec {
  /** Target room (e.g. "#general"); invalid/empty → a network-only invite. */
  channel: string;
  /** Optional preferred guest nick to pre-seat on the connect form. */
  guestName?: string | null;
  /** Optional time anchor — a "jump to this moment" invite. */
  at?: Date | null;
  /** Optional named-conversation / topic anchor. */
  topic?: string | null;
  /** Open the room in reader mode first. */
  reader?: boolean;
}

export interface InviteLinkOpts {
  /** Network label carried into the resolved card (e.g. "Onyx"). */
  network: string;
  /** Origin for the shareable landing link, e.g. "https://eshmaki.me/invite/". */
  origin: string;
  /** Origin/path the in-app deep-link points at, e.g. "/app/". */
  appOrigin: string;
}

export interface InviteLink {
  /** The fully validated, canonicalised card the link resolves to. */
  card: InviteCard;
  /** Canonical shareable landing URL: `<origin>?...`. */
  shareUrl: string;
  /** Direct in-app deep-link: `<appOrigin>?...` — opens the same room. */
  appHref: string;
  /** True when a valid channel survived validation (else network-only). */
  hasChannel: boolean;
}

/**
 * Build the canonical share + app links for an invite spec. Never throws; a
 * malformed field is dropped and a malformed channel yields a network-only
 * invite (`hasChannel === false`).
 */
export function buildInviteLink(spec: InviteLinkSpec, opts: InviteLinkOpts): InviteLink {
  const params = new URLSearchParams();

  const channel = spec.channel.trim();
  if (channel.length > 0) params.set('join', channel);
  if (spec.at && !Number.isNaN(spec.at.getTime())) params.set('at', spec.at.toISOString());

  const topic = spec.topic?.trim();
  if (topic) params.set('topic', topic);
  if (spec.reader) params.set('reader', '1');

  const guestName = spec.guestName?.trim();
  if (guestName) params.set('as', guestName);

  // buildInviteCard re-validates every field and produces the canonical URL;
  // anything that fails validation is absent from card.url below.
  const card = buildInviteCard(params, { network: opts.network, origin: opts.origin });

  // Slice the query from the validated canonical URL so the app deep-link only
  // ever carries validated params (never the raw spec).
  const queryStart = card.url.indexOf('?');
  const query = queryStart >= 0 ? card.url.slice(queryStart) : '';

  return {
    card,
    shareUrl: card.url,
    appHref: `${opts.appOrigin}${query}`,
    hasChannel: card.channel !== null,
  };
}
