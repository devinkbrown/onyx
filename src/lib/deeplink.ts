// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * deeplink.ts — website → app handoff helpers.
 *
 * The community site links into the app as `/app/?join=%23channelname`. The
 * raw search-param value is untrusted input: it is URI-decoded, then validated
 * against IRC channel-name rules before it is allowed anywhere near a JOIN.
 *
 * Valid shape (after decodeURIComponent): a CHANTYPES prefix (`#` public room
 * or `&` local/server room) followed by 1–63 chars, none of which may be
 * whitespace, a comma (JOIN list separator) or any C0/DEL control character
 * (\x00–\x1f, \x7f) — this range subsumes \x07 (^G) and, critically, NUL,
 * which IRC channel-name rules forbid and which could otherwise truncate or
 * corrupt the downstream JOIN. Anything else is ignored — a bad deep link must
 * never break the connect flow. Moment links for local `&` rooms must round-
 * trip through the same validator so cross-room handoffs do not drop context.
 */

const JOIN_PARAM_RE = /^[&#][^\s\x00-\x1f\x7f,]{1,63}$/;
const TOPIC_PARAM_CONTROL_PATTERN = /[\x00-\x1f\x7f,]/u;
const textEncoder = new TextEncoder();

/**
 * Parse and validate a `?join=` search-param value into a channel name.
 * Accepts both pre-decoded ("#foo" / "&ops") and encoded ("%23foo" / "%26ops")
 * input. Returns the validated channel, or null when absent/malformed.
 */
export function parseJoinParam(raw: string | string[] | null | undefined): string | null {
  // useSearchParams can surface repeated params as an array — take the first.
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null; // malformed percent-encoding
  }

  const trimmed = decoded.trim();
  return JOIN_PARAM_RE.test(trimmed) ? trimmed : null;
}

export function parseTopicParam(raw: string | string[] | null | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }

  const trimmed = decoded.trim();
  if (trimmed.length === 0 || TOPIC_PARAM_CONTROL_PATTERN.test(trimmed)) return null;
  return textEncoder.encode(trimmed).length <= 50 ? trimmed : null;
}

export function parseReaderParam(raw: string | string[] | null | undefined): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'reader';
}

/** Earliest instant an `?at=` link may point to (sanity bound, not history). */
const AT_PARAM_MIN_MS = Date.UTC(2020, 0, 1);
/** How far into the future an `?at=` link may point (clock-skew allowance). */
const AT_PARAM_FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

/**
 * Parse and validate an `?at=` search-param value into a Date — the "time
 * travel" deep link (`/app/?join=%23chan&at=...`). Accepts epoch seconds,
 * epoch milliseconds, or an ISO-8601 date/datetime. Out-of-range or malformed
 * values return null; a bad link must never break the connect flow.
 */
export function parseAtParam(raw: string | string[] | null | undefined): Date | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }

  const trimmed = decoded.trim();
  let ms: number;
  if (/^\d{1,10}$/.test(trimmed)) {
    ms = Number(trimmed) * 1000; // epoch seconds
  } else if (/^\d{11,14}$/.test(trimmed)) {
    ms = Number(trimmed); // epoch milliseconds
  } else {
    ms = Date.parse(trimmed); // ISO-8601 (NaN when malformed)
  }

  if (!Number.isFinite(ms)) return null;
  if (ms < AT_PARAM_MIN_MS || ms > Date.now() + AT_PARAM_FUTURE_SLACK_MS) return null;
  return new Date(ms);
}

export function buildMomentLink(channel: string, at: Date, href = 'https://onyx.local/app/'): string {
  const url = new URL(href);
  url.pathname = '/app/';
  url.hash = '';
  url.search = '';
  url.searchParams.set('join', channel);
  url.searchParams.set('at', at.toISOString());
  return url.toString();
}

/** How far ahead a scheduled event may be set (one year). */
const EVENT_MAX_FUTURE_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * Parse a FUTURE instant for scheduling a channel event. Accepts the same
 * forms as `parseAtParam` (epoch s/ms, ISO-8601) but validates the opposite
 * window: the moment must be in the future (allowing 5 min of clock skew) and
 * within a year. Past or far-future values return null.
 */
export function parseEventTime(raw: string | null | undefined): Date | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const trimmed = raw.trim();
  let ms: number;
  if (/^\d{1,10}$/.test(trimmed)) {
    ms = Number(trimmed) * 1000;
  } else if (/^\d{11,14}$/.test(trimmed)) {
    ms = Number(trimmed);
  } else {
    ms = Date.parse(trimmed);
  }
  if (!Number.isFinite(ms)) return null;
  const now = Date.now();
  if (ms < now - 5 * 60 * 1000 || ms > now + EVENT_MAX_FUTURE_MS) return null;
  return new Date(ms);
}
