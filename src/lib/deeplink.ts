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

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null; // malformed percent-encoding
  }

  const trimmed = decoded.trim();
  return JOIN_PARAM_RE.test(trimmed) ? trimmed : null;
}
