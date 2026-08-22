// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { setPageMeta } from './pageMeta';

describe('setPageMeta', () => {
  it('updates the document title and description', () => {
    setPageMeta('Onyx status', 'Network health and node status.', '/status?view=mesh#local-only');

    expect(document.title).toBe('Onyx status');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'Network health and node status.',
    );
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe('Onyx status');
    expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe('summary_large_image');
    expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(`${window.location.origin}/og.png`);
    expect(document.querySelector('meta[property="og:image:width"]')?.getAttribute('content')).toBe('1200');
    expect(document.querySelector('meta[property="og:image:height"]')?.getAttribute('content')).toBe('630');
    expect(document.querySelector('meta[name="twitter:image"]')?.getAttribute('content')).toBe(`${window.location.origin}/og.png`);
    const canonical = `${window.location.origin}/status/?view=mesh`;
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(canonical);
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(canonical);
    expect(document.querySelector('script[data-onyx-route-jsonld]')?.textContent).toContain('Onyx status');
  });
});
