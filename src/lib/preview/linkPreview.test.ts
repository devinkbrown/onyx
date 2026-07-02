import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickPreviewUrl, fetchLinkPreview, _clearPreviewCache } from './linkPreview';

afterEach(() => {
  _clearPreviewCache();
  vi.unstubAllGlobals();
});

describe('pickPreviewUrl', () => {
  it('picks the first http(s) link', () => {
    expect(pickPreviewUrl(['https://example.com/a', 'https://example.com/b'])).toBe(
      'https://example.com/a',
    );
  });
  it('skips our own uploads (already inlined as media)', () => {
    expect(
      pickPreviewUrl(['https://eshmaki.me/uploads/x.bin', 'https://example.com/page']),
    ).toBe('https://example.com/page');
  });
  it('ignores non-http protocols and garbage', () => {
    expect(pickPreviewUrl(['ircs://eshmaki.me:6697', 'not a url'])).toBeNull();
  });
});

describe('fetchLinkPreview', () => {
  it('normalizes a good payload and dedupes concurrent fetches', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ title: 'Orochi', description: 'a daemon', image: '', site: 'GitHub' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([
      fetchLinkPreview('https://example.com'),
      fetchLinkPreview('https://example.com'),
    ]);
    expect(a).toEqual({ url: 'https://example.com', title: 'Orochi', description: 'a daemon', image: '', site: 'GitHub' });
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null for empty metadata or errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    expect(await fetchLinkPreview('https://empty.example')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })));
    expect(await fetchLinkPreview('https://down.example')).toBeNull();
  });
});
