// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * In-session accept-to-take offers. Not persisted and not a store kernel
 * change — just enough memory so MODE +q waits for accept.
 */
import { channelKey, type RoomTransferOffer } from './roomStewardship';

let offers: RoomTransferOffer[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeRoomTransfers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function roomTransferOffers(): RoomTransferOffer[] {
  return offers;
}

export function transferFor(channel: string): RoomTransferOffer | null {
  const key = channelKey(channel);
  return offers.find((offer) => channelKey(offer.channel) === key) ?? null;
}

export function writeRoomTransfer(next: RoomTransferOffer | null, channel: string): void {
  const key = channelKey(channel);
  offers = offers.filter((offer) => channelKey(offer.channel) !== key);
  if (next) offers = [...offers, next];
  emit();
}

export function resetRoomTransfers(): void {
  offers = [];
  emit();
}
