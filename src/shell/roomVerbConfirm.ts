// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Ephemeral confirm door for Leave room and Close conversation.
 * Not a store kernel change — one quiet harbor sheet for overflow, settings,
 * and Spotlight.
 */
import { createSignal } from 'solid-js';

export type RoomVerbConfirm =
  | { kind: 'leave'; channel: string }
  | { kind: 'close-conversation'; nick: string };

const [pending, setPending] = createSignal<RoomVerbConfirm | null>(null);

export function openLeaveRoomConfirm(channel: string): void {
  const name = channel.trim();
  if (!name) return;
  setPending({ kind: 'leave', channel: name });
}

export function openCloseConversationConfirm(nick: string): void {
  const name = nick.trim();
  if (!name) return;
  setPending({ kind: 'close-conversation', nick: name });
}

export function closeRoomVerbConfirm(): void {
  setPending(null);
}

export function roomVerbConfirm(): RoomVerbConfirm | null {
  return pending();
}
