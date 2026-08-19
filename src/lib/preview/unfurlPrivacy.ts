// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * unfurlPrivacy.ts — link preview privacy controls.
 *
 * Decides whether a URL may be fetched for OG unfurl given user prefs and
 * link shape. Fail closed for private/local/credentialed URLs.
 */

export type UnfurlPrivacyPrefs = {
  linkPreviews: boolean;
  /** When true, only unfurl https. */
  httpsOnly: boolean;
  /** Blocklist host suffixes (lowercased), e.g. "intranet.local". */
  blockedHosts: string[];
};

export const DEFAULT_UNFURL_PRIVACY: UnfurlPrivacyPrefs = {
  linkPreviews: true,
  httpsOnly: true,
  blockedHosts: [],
};

/**
 * SSRF / scheme gate only — does **not** enforce user unfurl prefs.
 * Used by import/emoji URL safety and as the default for `isPreviewableUrl`
 * when no privacy object is supplied. Unfurl sinks (MessageText OG cards)
 * must pass an explicit prefs object from `unfurlPrivacyFromPrefs`.
 */
export const PREVIEW_SSRF_ONLY: UnfurlPrivacyPrefs = {
  linkPreviews: true,
  httpsOnly: false,
  blockedHosts: [],
};

/**
 * Map the user's `linkPreviews` preference into full unfurl privacy prefs.
 * Fail closed: inherits https-only + blocked-host defaults from
 * `DEFAULT_UNFURL_PRIVACY`.
 */
export function unfurlPrivacyFromLinkPreviews(
  linkPreviews: boolean,
  overrides: Partial<Omit<UnfurlPrivacyPrefs, 'linkPreviews'>> = {},
): UnfurlPrivacyPrefs {
  return {
    ...DEFAULT_UNFURL_PRIVACY,
    ...overrides,
    linkPreviews,
  };
}

/**
 * Map display preferences onto the unfurl privacy gate. Missing optional fields
 * inherit fail-closed defaults from `DEFAULT_UNFURL_PRIVACY`. Prefer this at
 * MessageText / OG sinks so PreferencesPanel https-only + host blocklist apply.
 */
export function unfurlPrivacyFromPrefs(input: {
  readonly linkPreviews: boolean;
  readonly httpsOnly?: boolean;
  readonly blockedHosts?: readonly string[];
}): UnfurlPrivacyPrefs {
  return unfurlPrivacyFromLinkPreviews(input.linkPreviews, {
    ...(input.httpsOnly !== undefined ? { httpsOnly: input.httpsOnly } : {}),
    ...(input.blockedHosts !== undefined ? { blockedHosts: [...input.blockedHosts] } : {}),
  });
}

/**
 * Lowercase a hostname and strip a trailing DNS root label ("."). `URL`
 * preserves that dot verbatim in `.hostname` (`new URL('https://x.internal./p')
 * .hostname === 'x.internal.'`), while `sanitizeBlockedHost` (preferences.ts)
 * strips it from stored blocklist entries — so without this normalization every
 * suffix/exact-match host check below silently misses a root-labeled host and
 * a trailing-dot URL defeats the user's blocklist and the internal-host
 * denylist outright (`https://wiki.intranet.corp./page` unfurled anyway).
 */
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.+$/, '');
}

export function mayUnfurlUrl(url: string, prefs: UnfurlPrivacyPrefs = DEFAULT_UNFURL_PRIVACY): boolean {
  if (!prefs.linkPreviews) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (prefs.httpsOnly && parsed.protocol !== 'https:') return false;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const host = normalizeHost(parsed.hostname);
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host === '127.0.0.1'
    // `URL.hostname` keeps the brackets on an IPv6 literal (`[::1]`), so the
    // unbracketed form here was always dead. This gate is defense-in-depth
    // only — every real fetch path revalidates through `isPreviewableUrl`
    // (linkPreview.ts), whose `isPrivateIPv6` covers loopback/ULA/link-local
    // properly; kept in sync here so a future direct `mayUnfurlUrl` caller
    // isn't silently exposed to a dead check.
    || host === '[::1]'
    || host.endsWith('.internal')
  ) {
    return false;
  }
  // Block private IPv4 literals.
  if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;

  for (const suffix of prefs.blockedHosts) {
    const s = suffix.trim().toLowerCase();
    if (!s) continue;
    if (host === s || host.endsWith(`.${s}`)) return false;
  }
  return true;
}
