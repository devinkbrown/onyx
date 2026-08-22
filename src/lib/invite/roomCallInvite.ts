// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Invite-to-call reuses the existing room invite link.
 * No call-specific media protocol or query flag is invented here.
 */

import {
  parseEncryptionPolicy,
  withEncryptionPolicyParam,
} from './encryptionPolicyBadge';
import { buildInviteLink } from './inviteLink';

export function roomCallInviteOrigin(origin: string): string {
  const base = origin.replace(/\/$/, '');
  return `${base}/invite/`;
}

export function buildRoomCallInviteUrl(input: {
  channel: string;
  origin: string;
  network: string;
  encryptionPolicy?: string | null;
}): string {
  const link = buildInviteLink(
    { channel: input.channel },
    {
      network: input.network,
      origin: roomCallInviteOrigin(input.origin),
      appOrigin: '/app/',
    },
  );
  return withEncryptionPolicyParam(
    link.shareUrl,
    parseEncryptionPolicy(input.encryptionPolicy),
  );
}
