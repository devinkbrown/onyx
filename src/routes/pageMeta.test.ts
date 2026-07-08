import { describe, expect, it } from 'vitest';

import { setPageMeta } from './pageMeta';

describe('setPageMeta', () => {
  it('updates the document title and description', () => {
    setPageMeta('Onyx status', 'Mesh health and node status.', '/status');

    expect(document.title).toBe('Onyx status');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'Mesh health and node status.',
    );
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe('Onyx status');
    expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe('summary');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toMatch(/\/status$/);
    expect(document.querySelector('script[data-onyx-route-jsonld]')?.textContent).toContain('Onyx status');
  });
});
