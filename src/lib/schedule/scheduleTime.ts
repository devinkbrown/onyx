// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * scheduleTime.ts — pure future-time helpers for the composer's "send later".
 *
 * The Cmd-K time grammar (src/chat/spotlight/timeGrammar.ts) is PAST-oriented
 * (time travel — "yesterday 21:00", "3h ago") and rejects future instants, so
 * it can't be reused for scheduling. These helpers produce a strictly-future
 * epoch from either a quick preset or a native <input type="datetime-local">
 * value, with `now` injected so they test without a wall clock.
 */

const MINUTE_MS = 60_000;
/** A scheduled message must be at least this far out to be worth queuing. */
export const MIN_LEAD_MS = 30_000;
/** Guard against absurd inputs (a year) so a fat-fingered value can't queue. */
const MAX_LEAD_MS = 365 * 24 * 60 * MINUTE_MS;

export interface SchedulePreset {
  readonly id: string;
  readonly label: string;
  /** Compute the target epoch from `now` (ms). */
  readonly at: (now: number) => number;
}

/** Next occurrence of the given local wall-clock hour, strictly in the future. */
function nextLocalHour(now: number, hour: number): number {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export const SCHEDULE_PRESETS: readonly SchedulePreset[] = [
  { id: 'in-15m', label: 'In 15 minutes', at: (now) => now + 15 * MINUTE_MS },
  { id: 'in-1h', label: 'In 1 hour', at: (now) => now + 60 * MINUTE_MS },
  { id: 'in-3h', label: 'In 3 hours', at: (now) => now + 180 * MINUTE_MS },
  { id: 'tomorrow-9', label: 'Tomorrow, 9:00', at: (now) => nextLocalHour(now, 9) },
];

/**
 * Parse a native datetime-local string ("YYYY-MM-DDTHH:mm") to an epoch,
 * returning null unless it is a valid instant at least MIN_LEAD_MS in the
 * future and within MAX_LEAD_MS. datetime-local is local time (no zone), which
 * is exactly what `new Date(value)` interprets it as.
 */
export function parseDateTimeLocal(value: string, now: number): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = new Date(trimmed).getTime();
  if (!Number.isFinite(ms)) return null;
  return isSchedulable(ms, now) ? ms : null;
}

/** True when `epoch` is far enough out and not absurdly far to be scheduled. */
export function isSchedulable(epoch: number, now: number): boolean {
  if (!Number.isFinite(epoch)) return false;
  const delta = epoch - now;
  return delta >= MIN_LEAD_MS && delta <= MAX_LEAD_MS;
}

/** Two-digit zero-pad. */
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Format an epoch as a datetime-local value ("YYYY-MM-DDTHH:mm") in LOCAL time,
 * suitable for the `value`/`min` attribute of <input type="datetime-local">.
 */
export function toDateTimeLocalValue(epoch: number): string {
  const d = new Date(epoch);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
