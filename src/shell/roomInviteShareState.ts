// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Ephemeral UI signal for the Invite friends sheet. Not a store kernel change —
 * just a door so Home, the room header, and empty states share one sheet.
 */
import { createSignal } from 'solid-js';

export type RoomInviteShareTarget = {
  /** Empty string = network-only invite (no specific room yet). */
  channel: string;
};

const [target, setTarget] = createSignal<RoomInviteShareTarget | null>(null);

export function openRoomInviteShare(channel = ''): void {
  setTarget({ channel });
}

export function closeRoomInviteShare(): void {
  setTarget(null);
}

export function roomInviteShareTarget(): RoomInviteShareTarget | null {
  return target();
}
