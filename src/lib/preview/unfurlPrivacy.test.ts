// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { mayUnfurlUrl } from './unfurlPrivacy';

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
});
