// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_UNFURL_PRIVACY,
  mayUnfurlUrl,
  PREVIEW_SSRF_ONLY,
  unfurlPrivacyFromLinkPreviews,
  unfurlPrivacyFromPrefs,
} from './unfurlPrivacy';

describe('unfurlPrivacy', () => {
  it('allows public https and blocks private/local', () => {
    expect(mayUnfurlUrl('https://example.com/x')).toBe(true);
    expect(mayUnfurlUrl('http://example.com/x')).toBe(false);
    expect(mayUnfurlUrl('https://127.0.0.1/x')).toBe(false);
    expect(mayUnfurlUrl('https://192.168.1.1/x')).toBe(false);
    expect(mayUnfurlUrl('https://user:pass@example.com/')).toBe(false);
    expect(mayUnfurlUrl('https://evil.intranet.local/a', {
      linkPreviews: true,
      httpsOnly: true,
      blockedHosts: ['intranet.local'],
    })).toBe(false);
  });

  it('fail-closed when linkPreviews is disabled', () => {
    expect(mayUnfurlUrl('https://example.com/x', {
      linkPreviews: false,
      httpsOnly: false,
      blockedHosts: [],
    })).toBe(false);
  });

  it('allows plain http only when httpsOnly is false', () => {
    expect(mayUnfurlUrl('http://example.com/x', PREVIEW_SSRF_ONLY)).toBe(true);
    expect(mayUnfurlUrl('http://example.com/x', DEFAULT_UNFURL_PRIVACY)).toBe(false);
  });

  it('maps the linkPreviews preference onto DEFAULT_UNFURL_PRIVACY', () => {
    expect(unfurlPrivacyFromLinkPreviews(true)).toEqual({
      ...DEFAULT_UNFURL_PRIVACY,
      linkPreviews: true,
    });
    expect(unfurlPrivacyFromLinkPreviews(false)).toEqual({
      ...DEFAULT_UNFURL_PRIVACY,
      linkPreviews: false,
    });
    expect(unfurlPrivacyFromLinkPreviews(true, { httpsOnly: false, blockedHosts: ['evil.test'] })).toEqual({
      linkPreviews: true,
      httpsOnly: false,
      blockedHosts: ['evil.test'],
    });
    expect(unfurlPrivacyFromPrefs({ linkPreviews: false })).toEqual({
      ...DEFAULT_UNFURL_PRIVACY,
      linkPreviews: false,
    });
  });

  it('maps full display prefs including https-only and blocked hosts', () => {
    const privacy = unfurlPrivacyFromPrefs({
      linkPreviews: true,
      httpsOnly: true,
      blockedHosts: ['corp.example'],
    });
    expect(privacy).toEqual({
      linkPreviews: true,
      httpsOnly: true,
      blockedHosts: ['corp.example'],
    });
    expect(mayUnfurlUrl('https://app.corp.example/x', privacy)).toBe(false);
    expect(mayUnfurlUrl('https://example.com/x', privacy)).toBe(true);
    expect(mayUnfurlUrl('http://example.com/x', privacy)).toBe(false);
  });
});
