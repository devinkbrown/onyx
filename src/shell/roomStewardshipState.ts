// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Ephemeral Room care door. Transfer memory lives in lib so MODE can wait
 * for accept without a store-kernel rewrite.
 */
import { createSignal } from 'solid-js';
import {
  resetRoomTransfers,
  transferFor as readTransfer,
} from '@/lib/rooms/roomTransferMemory';
import type { RoomTransferOffer } from '@/lib/rooms/roomStewardship';

const [target, setTarget] = createSignal<{ channel: string } | null>(null);

export function openRoomStewardship(channel: string): void {
  const name = channel.trim();
  if (!name) return;
  setTarget({ channel: name });
}

export function closeRoomStewardship(): void {
  setTarget(null);
}

export function roomStewardshipTarget(): { channel: string } | null {
  return target();
}

export function transferFor(channel: string): RoomTransferOffer | null {
  return readTransfer(channel);
}

export function resetRoomStewardshipState(): void {
  setTarget(null);
  resetRoomTransfers();
}
