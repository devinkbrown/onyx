// SPDX-License-Identifier: AGPL-3.0-or-later
// Relative time and compact duration formatting.

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;
const JUST_NOW_MS = 45 * SECOND_MS;

type DurationUnit = {
  label: string;
  seconds: number;
};

const DURATION_UNITS: readonly DurationUnit[] = [
  { label: 'd', seconds: DAY_MS / SECOND_MS },
  { label: 'h', seconds: HOUR_MS / SECOND_MS },
  { label: 'm', seconds: MINUTE_MS / SECOND_MS },
  { label: 's', seconds: 1 },
];

function agoLabel(amount: number, unit: string, isFuture: boolean): string {
  const label = `${amount}${unit}`;
  return isFuture ? `in ${label}` : `${label} ago`;
}

function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/**
 * Format a compact relative label between `then` and `now`.
 */
export function relativeTime(then: Date, now: Date = new Date(Date.now())): string {
  const deltaMs = then.getTime() - now.getTime();
  if (!Number.isFinite(deltaMs)) return 'just now';

  const absMs = Math.abs(deltaMs);
  if (absMs < JUST_NOW_MS) return 'just now';

  const isFuture = deltaMs > 0;
  if (absMs < HOUR_MS) {
    return agoLabel(Math.max(1, Math.floor(absMs / MINUTE_MS)), 'm', isFuture);
  }
  if (absMs < DAY_MS) {
    return agoLabel(Math.floor(absMs / HOUR_MS), 'h', isFuture);
  }
  if (absMs < 2 * DAY_MS) {
    return isFuture ? 'tomorrow' : 'yesterday';
  }
  if (absMs < WEEK_MS) {
    return agoLabel(Math.floor(absMs / DAY_MS), 'd', isFuture);
  }
  if (absMs < MONTH_MS) {
    return agoLabel(Math.floor(absMs / WEEK_MS), 'w', isFuture);
  }
  if (absMs < YEAR_MS) {
    return agoLabel(Math.floor(absMs / MONTH_MS), 'mo', isFuture);
  }

  return agoLabel(Math.max(1, Math.floor(absMs / YEAR_MS)), 'y', isFuture);
}

/**
 * Format elapsed milliseconds as a compact duration with at most two units.
 */
export function shortDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';

  let remainingSeconds = Math.floor(ms / SECOND_MS);
  if (remainingSeconds <= 0) return '0s';

  const parts: string[] = [];
  for (const unit of DURATION_UNITS) {
    const amount = Math.floor(remainingSeconds / unit.seconds);
    if (amount <= 0) continue;

    parts.push(`${amount}${unit.label}`);
    remainingSeconds -= amount * unit.seconds;
    if (parts.length === 2) break;
  }

  return parts.length > 0 ? parts.join(' ') : '0s';
}

/**
 * Format `then` as a local calendar-day label relative to `now`.
 */
export function calendarDay(then: Date, now: Date = new Date(Date.now())): string {
  const thenDay = localDayNumber(then);
  const nowDay = localDayNumber(now);

  if (thenDay === nowDay) return 'Today';
  if (thenDay === nowDay - 1) return 'Yesterday';

  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(then.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

function compactWithinWeek(absMs: number): string {
  if (absMs < HOUR_MS) return `${Math.max(1, Math.floor(absMs / MINUTE_MS))}m`;
  if (absMs < DAY_MS) return `${Math.floor(absMs / HOUR_MS)}h`;
  return `${Math.floor(absMs / DAY_MS)}d`;
}

function absoluteDate(fromMs: number, nowMs: number): string {
  const then = new Date(fromMs);
  const now = new Date(nowMs);
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(then.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/**
 * Format the gap between two epoch-millisecond instants as a suffix-free compact
 * label — `just now`, `3m`, `2h`, `5d` — falling back to an absolute calendar
 * date at and beyond a week. Future instants are prefixed with `in ` (e.g.
 * `in 2m`). `now` is passed in, never read internally, so the result is
 * deterministic; non-finite input yields an empty string.
 */
export function formatRelative(fromMs: number, nowMs: number): string {
  if (!Number.isFinite(fromMs) || !Number.isFinite(nowMs)) return '';

  const deltaMs = fromMs - nowMs;
  const absMs = Math.abs(deltaMs);
  if (absMs < JUST_NOW_MS) return 'just now';
  if (absMs >= WEEK_MS) return absoluteDate(fromMs, nowMs);

  const compact = compactWithinWeek(absMs);
  return deltaMs > 0 ? `in ${compact}` : compact;
}
