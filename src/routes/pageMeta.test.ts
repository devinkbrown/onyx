// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { PUBLIC_HOME_DESCRIPTION, setPageMeta } from './pageMeta';

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
    const jsonLd = JSON.parse(document.querySelector('script[data-onyx-route-jsonld]')?.textContent ?? '{}') as {
      '@graph'?: Array<Record<string, unknown>>;
    };
    const types = (jsonLd['@graph'] ?? []).map((node) => node['@type']);
    expect(types).toEqual(expect.arrayContaining(['Organization', 'SoftwareApplication', 'WebPage']));
    const software = (jsonLd['@graph'] ?? []).find((node) => node['@type'] === 'SoftwareApplication');
    expect(software).toMatchObject({
      offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
    });
    expect(JSON.stringify(jsonLd)).not.toMatch(/aggregateRating/i);
  });

  it('keeps the Home share description in the 110–160 band with local history and no ads', () => {
    expect(PUBLIC_HOME_DESCRIPTION.length).toBeGreaterThanOrEqual(110);
    expect(PUBLIC_HOME_DESCRIPTION.length).toBeLessThanOrEqual(160);
    expect(PUBLIC_HOME_DESCRIPTION).toMatch(/400/);
    expect(PUBLIC_HOME_DESCRIPTION).toMatch(/No ads/);
    expect(PUBLIC_HOME_DESCRIPTION).not.toMatch(/fully encrypted|mesh telemetry|cloud history/i);
  });
});
