/**
 * deeplink.ts — website → app handoff helpers.
 *
 * The community site links into the app as `/app?join=%23channelname`. The
 * raw search-param value is untrusted input: it is URI-decoded, then validated
 * against IRC channel-name rules before it is allowed anywhere near a JOIN.
 *
 * Valid shape (after decodeURIComponent): `#` followed by 1–63 chars, none of
 * which may be whitespace, a comma (JOIN list separator) or \x07 (^G, the
 * historical channel-name terminator). Anything else is ignored — a bad deep
 * link must never break the connect flow.
 */

const JOIN_PARAM_RE = /^#[^\s,\x07]{1,63}$/;

/**
 * Parse and validate a `?join=` search-param value into a channel name.
 * Accepts both pre-decoded ("#foo") and encoded ("%23foo") input.
 * Returns the validated channel, or null when absent/malformed.
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

/** Earliest instant an `?at=` link may point to (sanity bound, not history). */
const AT_PARAM_MIN_MS = Date.UTC(2020, 0, 1);
/** How far into the future an `?at=` link may point (clock-skew allowance). */
const AT_PARAM_FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

/**
 * Parse and validate an `?at=` search-param value into a Date — the "time
 * travel" deep link (`/app?join=%23chan&at=...`). Accepts epoch seconds,
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
