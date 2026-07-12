// SPDX-License-Identifier: AGPL-3.0-or-later

/** Minutes in a full day. */
export const MINUTES_PER_DAY = 1440;

/**
 * Scheduled quiet-hours window: a daily LOCAL-time span during which the notify
 * decision suppresses sound + OS notifications. Unread badges are unaffected —
 * badging is governed upstream (the store / calm-preset gate), never here.
 *
 * `startMinute` / `endMinute` are minutes since LOCAL midnight (0..1439).
 *  - start < end  → same-day window, active over the half-open span [start, end).
 *  - start > end  → OVERNIGHT window that wraps past midnight (e.g. 22:00→06:00):
 *                   active when now >= start OR now < end.
 *  - start === end → EMPTY (a zero-width span, never active). Treating equal as
 *                   "all day" would silence the user around the clock on a
 *                   mis-set schedule; empty fails OPEN so alerts still fire.
 */
export interface QuietHoursSchedule {
  readonly enabled: boolean;
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * Local wall-clock minute-of-day for `now` (0..1439), derived from the Date's
 * LOCAL hour/minute components.
 *
 * This is the DST-safe basis for the window test: getHours()/getMinutes() apply
 * the correct UTC offset for this exact instant INCLUDING any daylight-saving
 * transition, so the comparison follows the wall clock the user reads — never
 * elapsed-UTC or a stale fixed offset. Deriving minute-of-day by epoch
 * arithmetic (`epochMs % 86_400_000`) would drift by the gained/lost hour across
 * a DST boundary and mis-classify instants near it; this does not.
 */
export function localMinuteOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Wrap a possibly out-of-range minute into [0, MINUTES_PER_DAY). Returns null for
 * non-finite input so callers can fail OPEN rather than silence on a bad value.
 */
function normalizeMinute(minute: number): number | null {
  if (!Number.isFinite(minute)) return null;
  const floored = Math.floor(minute);
  return ((floored % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Pure overnight-capable membership test over minutes-of-day. Half-open
 * [start, end): the start minute is inside, the end minute is outside. Fails OPEN
 * (returns false) on a non-finite or zero-width span so a bad schedule can never
 * silence the user around the clock.
 */
export function isMinuteWithinWindow(
  minuteOfDay: number,
  startMinute: number,
  endMinute: number,
): boolean {
  const now = normalizeMinute(minuteOfDay);
  const start = normalizeMinute(startMinute);
  const end = normalizeMinute(endMinute);
  if (now === null || start === null || end === null) return false;
  if (start === end) return false; // empty span — never an all-day silence
  if (start < end) return now >= start && now < end; // same-day window
  return now >= start || now < end; // overnight wrap past midnight
}

/**
 * Whether the local wall-clock instant `now` falls inside the quiet window
 * [start, end) (minutes since local midnight). Overnight-capable and DST-safe.
 */
export function isWithinQuietWindow(now: Date, startMinute: number, endMinute: number): boolean {
  return isMinuteWithinWindow(localMinuteOfDay(now), startMinute, endMinute);
}

/**
 * Whether a scheduled quiet-hours window is currently active for `now`. A
 * disabled schedule is never active.
 */
export function isQuietHoursActive(schedule: QuietHoursSchedule, now: Date): boolean {
  if (!schedule.enabled) return false;
  return isWithinQuietWindow(now, schedule.startMinute, schedule.endMinute);
}
