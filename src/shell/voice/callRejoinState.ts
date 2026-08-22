// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Presentation-only memory for "rejoin after disconnect".
 * Does not change Cadence signaling or invent a media protocol.
 */

let liveChannel: string | null = null;
let pendingRejoin: string | null = null;

export function noteLiveCall(channel: string): void {
  const trimmed = channel.trim();
  if (!trimmed) return;
  liveChannel = trimmed;
}

export function noteUserLeftCall(): void {
  liveChannel = null;
  pendingRejoin = null;
}

export function noteTransportLost(): void {
  if (liveChannel) pendingRejoin = liveChannel;
}

export function peekRejoinChannel(): string | null {
  return pendingRejoin;
}

export function clearRejoinChannel(): void {
  pendingRejoin = null;
}

export function resetCallRejoinState(): void {
  liveChannel = null;
  pendingRejoin = null;
}
