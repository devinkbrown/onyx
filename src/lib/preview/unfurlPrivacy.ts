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

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host === '127.0.0.1'
    || host === '::1'
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
