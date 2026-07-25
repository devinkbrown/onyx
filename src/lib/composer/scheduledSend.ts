// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * scheduledSend.ts — pure queue helpers for the store's scheduled-message list.
 *
 * Client-side only ("send later" lives in device memory / localStorage, not on
 * the server). Types, persistence parse, and due/pending split live in
 * `lib/schedule/dispatch.ts`; this module owns create / enqueue / cancel so the
 * store action boundary stays thin and unit-testable without Zustand.
 *
 * Field names match the store queue: `{ id, channel, text, sendAt, owner }`.
 */

import {
  MAX_SCHEDULED_CHANNEL_LENGTH,
  MAX_SCHEDULED_ID_LENGTH,
  MAX_SCHEDULED_MESSAGES,
  MAX_SCHEDULED_TEXT_LENGTH,
  selectDueMessages,
  type ScheduledMessage,
  type ScheduledMessageOwner,
} from '@/lib/schedule/dispatch';

export {
  MAX_SCHEDULED_CHANNEL_LENGTH,
  MAX_SCHEDULED_ID_LENGTH,
  MAX_SCHEDULED_MESSAGES,
  MAX_SCHEDULED_TEXT_LENGTH,
  selectDueMessages,
  type ScheduledMessage,
  type ScheduledMessageOwner,
};

/** @deprecated Prefer MAX_SCHEDULED_MESSAGES — same cap as the store queue. */
export const MAX_SCHEDULED_SENDS = MAX_SCHEDULED_MESSAGES;

/** Alias for the store queue row shape (docs / era ledger home path). */
export type ScheduledSend = ScheduledMessage;

/** Control / space class rejected on wire tokens (matches store inbound guard). */
const INVALID_CHANNEL = /[\u0000-\u0020\u007f]/u;

/**
 * True when `sendAt` is a safe positive integer epoch suitable for the queue.
 * Future-ness is enforced by the composer (`isSchedulable`); the store boundary
 * only rejects non-integers and non-positive values.
 */
export function canScheduleAt(sendAt: number): boolean {
  return Number.isSafeInteger(sendAt) && sendAt > 0;
}

/** Channel / target token accepted by scheduleMessage. */
export function canScheduleChannel(channel: string): boolean {
  const target = channel.trim();
  return (
    target.length > 0
    && target.length <= MAX_SCHEDULED_CHANNEL_LENGTH
    && !INVALID_CHANNEL.test(target)
    && !target.startsWith(':')
    && !target.includes(',')
  );
}

export function createScheduledSend(input: {
  channel: string;
  text: string;
  sendAt: number;
  owner: ScheduledMessageOwner | null;
  id?: string;
  /** Optional clock for deterministic ids in tests. */
  now?: number;
}): ScheduledMessage | null {
  const channel = input.channel.trim();
  if (!canScheduleChannel(channel)) return null;
  if (!input.text.trim() || input.text.length > MAX_SCHEDULED_TEXT_LENGTH) return null;
  if (!canScheduleAt(input.sendAt)) return null;

  const now = input.now ?? Date.now();
  const id = input.id ?? `sched-${now}-${Math.random().toString(36).slice(2)}`;
  if (!id || id.length > MAX_SCHEDULED_ID_LENGTH) return null;

  return {
    id,
    channel,
    text: input.text,
    sendAt: input.sendAt,
    owner: input.owner,
  };
}

/**
 * Append one row, sorted by `sendAt`. Returns null when the queue is full or
 * the id already exists (never mutates `queue`).
 */
export function enqueueScheduled(
  queue: readonly ScheduledMessage[],
  item: ScheduledMessage,
): ScheduledMessage[] | null {
  if (queue.length >= MAX_SCHEDULED_MESSAGES) return null;
  if (queue.some((row) => row.id === item.id)) return null;
  return [...queue, item].sort((a, b) => a.sendAt - b.sendAt);
}

/**
 * Split due vs still-queued. Offline (`connected === false`) holds everything,
 * including past-due rows — same invariant as `selectDueMessages`.
 */
export function dueScheduled(
  queue: readonly ScheduledMessage[],
  now = Date.now(),
  connected = true,
): { due: ScheduledMessage[]; remaining: ScheduledMessage[] } {
  const { due, pending } = selectDueMessages(queue, now, connected);
  return { due, remaining: pending };
}

/** Remove one id; returns a fresh array (no-op filter if missing). */
export function cancelScheduled(
  queue: readonly ScheduledMessage[],
  id: string,
): ScheduledMessage[] {
  return queue.filter((row) => row.id !== id);
}
