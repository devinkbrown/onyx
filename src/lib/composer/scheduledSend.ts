// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * scheduledSend.ts — local delayed-send queue (client-side only).
 *
 * Messages are held in device memory and flushed when due IF still connected.
 * Not a server-side schedule; honest about that in UI copy.
 */

export const MAX_SCHEDULED_SENDS = 32;
export const MAX_SCHEDULED_TEXT = 4096;
export const MAX_SCHEDULE_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;

export type ScheduledSend = {
  id: string;
  target: string;
  text: string;
  /** Epoch ms when the send becomes due. */
  dueAt: number;
  createdAt: number;
};

const CONTROL = /[\u0000-\u001f\u007f]/u;

export function canScheduleAt(dueAt: number, now = Date.now()): boolean {
  if (!Number.isFinite(dueAt)) return false;
  if (dueAt <= now) return false;
  if (dueAt - now > MAX_SCHEDULE_AHEAD_MS) return false;
  return true;
}

export function createScheduledSend(input: {
  target: string;
  text: string;
  dueAt: number;
  id?: string;
  now?: number;
}): ScheduledSend | null {
  const now = input.now ?? Date.now();
  const target = input.target.trim();
  const text = input.text.trim();
  if (!target || target.length > 64 || CONTROL.test(target)) return null;
  if (!text || text.length > MAX_SCHEDULED_TEXT || /[\r\n]/.test(text)) return null;
  if (!canScheduleAt(input.dueAt, now)) return null;
  return {
    id: input.id ?? `sched-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    target,
    text,
    dueAt: input.dueAt,
    createdAt: now,
  };
}

export function enqueueScheduled(
  queue: readonly ScheduledSend[],
  item: ScheduledSend,
): ScheduledSend[] | null {
  if (queue.length >= MAX_SCHEDULED_SENDS) return null;
  if (queue.some((row) => row.id === item.id)) return null;
  return [...queue, item].sort((a, b) => a.dueAt - b.dueAt);
}

export function dueScheduled(
  queue: readonly ScheduledSend[],
  now = Date.now(),
): { due: ScheduledSend[]; remaining: ScheduledSend[] } {
  const due: ScheduledSend[] = [];
  const remaining: ScheduledSend[] = [];
  for (const row of queue) {
    if (row.dueAt <= now) due.push(row);
    else remaining.push(row);
  }
  return { due, remaining };
}

export function cancelScheduled(
  queue: readonly ScheduledSend[],
  id: string,
): ScheduledSend[] {
  return queue.filter((row) => row.id !== id);
}
