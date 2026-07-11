// SPDX-License-Identifier: AGPL-3.0-or-later
const MIN_TIME_MS = Date.UTC(2020, 0, 1);
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const CLOCK_RE = /^(\d{1,2}):(\d{2})$/;
const RELATIVE_RE = /^([1-9]\d*)\s*(m|minute|minutes|min|mins|h|hour|hours|hr|hrs|d|day|days)\s+ago$/i;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:\s*(Z|[+-]\d{2}:?\d{2}))?)?$/i;

type ClockParts = {
  hour: number;
  minute: number;
};

function validNow(now: number | undefined): number {
  const value = typeof now === 'number' ? now : Date.now();
  return Number.isFinite(value) ? value : Date.now();
}

function parseClock(input: string): ClockParts | null {
  const match = CLOCK_RE.exec(input);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function makeLocalDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date | null {
  const date = new Date(year, month - 1, day, hour, minute, second, millisecond);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second ||
    date.getMilliseconds() !== millisecond
  ) {
    return null;
  }
  return date;
}

function makeUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCMilliseconds() !== millisecond
  ) {
    return null;
  }
  return date;
}

function parseZoneOffset(zone: string): number | null {
  if (zone.toUpperCase() === 'Z') return 0;

  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (!match) return null;

  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59) return null;

  const sign = match[1] === '+' ? 1 : -1;
  return sign * (hours * HOUR_MS + minutes * MINUTE_MS);
}

function parseIso(input: string): Date | null {
  const match = ISO_RE.exec(input);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const millisecond = match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0'));
  const zone = match[8];

  if (hour > 23 || minute > 59 || second > 59) return null;

  if (!zone) {
    return makeLocalDate(year, month, day, hour, minute, second, millisecond);
  }

  const offset = parseZoneOffset(zone);
  if (offset === null) return null;

  const utc = makeUtcDate(year, month, day, hour, minute, second, millisecond);
  return utc ? new Date(utc.getTime() - offset) : null;
}

function dateAtClock(nowMs: number, clock: ClockParts): Date | null {
  const now = new Date(nowMs);
  return makeLocalDate(now.getFullYear(), now.getMonth() + 1, now.getDate(), clock.hour, clock.minute);
}

function yesterdayAtClock(nowMs: number, clock: ClockParts): Date | null {
  const base = new Date(nowMs);
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() - 1);
  return makeLocalDate(base.getFullYear(), base.getMonth() + 1, base.getDate(), clock.hour, clock.minute);
}

function parseKeyword(input: string, nowMs: number): Date | null {
  const normalized = input.replace(/\s+/g, ' ');
  if (/^now$/i.test(normalized)) return new Date(nowMs);

  const today = /^today\s+(.+)$/i.exec(normalized);
  if (today) {
    const clock = parseClock(today[1] ?? '');
    return clock ? dateAtClock(nowMs, clock) : null;
  }

  const yesterday = /^yesterday(?:\s+(.+))?$/i.exec(normalized);
  if (yesterday) {
    const clockText = yesterday[1] ?? '00:00';
    const clock = parseClock(clockText);
    return clock ? yesterdayAtClock(nowMs, clock) : null;
  }

  return null;
}

function parseRelative(input: string, nowMs: number): Date | null {
  const match = RELATIVE_RE.exec(input);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount)) return null;

  const unit = (match[2] ?? '').toLowerCase();
  const factor = unit.startsWith('m') ? MINUTE_MS : unit.startsWith('h') ? HOUR_MS : DAY_MS;
  const delta = amount * factor;
  if (!Number.isSafeInteger(delta)) return null;

  return new Date(nowMs - delta);
}

function inBounds(date: Date, nowMs: number): boolean {
  const ms = date.getTime();
  return Number.isFinite(ms) && ms >= MIN_TIME_MS && ms <= nowMs + FUTURE_SLACK_MS;
}

export function parseTimeExpr(input: string, now?: number): Date | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const nowMs = validNow(now);
  const clock = parseClock(trimmed);
  const parsed =
    parseKeyword(trimmed, nowMs) ??
    parseRelative(trimmed, nowMs) ??
    (clock ? dateAtClock(nowMs, clock) : null) ??
    parseIso(trimmed);

  return parsed && inBounds(parsed, nowMs) ? parsed : null;
}
