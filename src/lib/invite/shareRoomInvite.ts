// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * shareRoomInvite.ts — build the shareable room link a friend can open.
 *
 * Reuses buildInviteLink (`?join=` / `/invite/`). Does not invent a second
 * invite protocol. Share text stays in public copy: invite, join, room, friends.
 */

import { buildInviteLink, type InviteLink } from './inviteLink';

export interface RoomSharePayload {
  link: InviteLink;
  shareUrl: string;
  shareData: ShareData;
}

export function inviteLandingOrigin(): string {
  return typeof window !== 'undefined'
    ? `${window.location.origin}/invite/`
    : 'https://eshmaki.me/invite/';
}

export function buildRoomSharePayload(input: {
  channel: string;
  network: string;
  origin: string;
  guestName?: string;
}): RoomSharePayload {
  const link = buildInviteLink(
    { channel: input.channel, guestName: input.guestName },
    { network: input.network, origin: input.origin, appOrigin: '/app/' },
  );
  const shareUrl = link.shareUrl;
  const shareData: ShareData = {
    title: link.hasChannel
      ? `Join ${link.card.channel} on ${input.network}`
      : `Join ${input.network}`,
    text: link.hasChannel
      ? `A friend invited you to ${link.card.channel} on ${input.network}.`
      : `A friend invited you to ${input.network}.`,
    url: shareUrl,
  };
  return { link, shareUrl, shareData };
}

export function canNativeShare(data: ShareData): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  try {
    return typeof navigator.canShare !== 'function' || navigator.canShare(data);
  } catch {
    return false;
  }
}
