// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  pickPreviewUrl,
  fetchLinkPreview,
  isPreviewableUrl,
  _clearPreviewCache,
} from './linkPreview';

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

describe('isPreviewableUrl (SSRF defense in depth)', () => {
  it('accepts plain http(s) public web URLs', () => {
    expect(isPreviewableUrl('https://example.com/page')).toBe(true);
    expect(isPreviewableUrl('http://example.com')).toBe(true);
    expect(isPreviewableUrl('https://github.com/orochi/onyx?tab=readme')).toBe(true);
  });

  it('rejects dangerous / non-http(s) schemes', () => {
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'ftp://example.com/x',
      'ircs://eshmaki.me:6697',
      'not a url',
      '',
    ]) {
      expect(isPreviewableUrl(href)).toBe(false);
    }
  });

  it('rejects embedded credentials in the authority', () => {
    expect(isPreviewableUrl('https://user:pass@example.com')).toBe(false);
    expect(isPreviewableUrl('https://admin@169.254.169.254')).toBe(false);
  });

  it('rejects internal / loopback host names', () => {
    for (const href of [
      'http://localhost/',
      'http://localhost:8080/admin',
      'http://printer.local/',
      'http://vault.internal/',
      'http://foo.localhost/',
    ]) {
      expect(isPreviewableUrl(href)).toBe(false);
    }
  });

  it('rejects private / loopback / link-local IPv4 literals', () => {
    for (const href of [
      'http://127.0.0.1/',
      'http://10.0.0.5/',
      'http://172.16.31.1/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/', // cloud metadata
      'http://100.64.0.1/',
      'http://0.0.0.0/',
    ]) {
      expect(isPreviewableUrl(href)).toBe(false);
    }
    expect(isPreviewableUrl('http://8.8.8.8/')).toBe(true); // public IP is fine
  });

  it('rejects loopback / ULA / link-local IPv6 literals and mapped privates', () => {
    for (const href of [
      'http://[::1]/',
      'http://[::]/',
      'http://[fc00::1]/',
      'http://[fd12:3456::1]/',
      'http://[fe80::1]/',
      'http://[::ffff:127.0.0.1]/',
    ]) {
      expect(isPreviewableUrl(href)).toBe(false);
    }
  });
});

describe('fetchLinkPreview', () => {
  it('NEVER issues a fetch for an unsafe / non-same-origin target', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,x',
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:9200/',
      'https://user:pass@example.com/',
      'http://[::1]/',
    ]) {
      expect(await fetchLinkPreview(href)).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('only ever fetches the same-origin /linkpreview endpoint', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ title: 'ok' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await fetchLinkPreview('https://example.com/page?x=1&y=2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requested = String(fetchMock.mock.calls[0]?.[0]);
    expect(requested).toBe(`/linkpreview?url=${encodeURIComponent('https://example.com/page?x=1&y=2')}`);
    // No absolute/cross-origin URL is ever passed to fetch.
    expect(requested.startsWith('/linkpreview?')).toBe(true);
    expect(/^https?:\/\//.test(requested)).toBe(false);
  });


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

  it('does not permanently cache transient failures — retries after a network error', async () => {
    const good = { title: 'Later', description: '', image: '', site: '' };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new TypeError('network down');
      })
      .mockImplementationOnce(async () => new Response(JSON.stringify(good), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchLinkPreview('https://flaky.example')).toBeNull();
    expect(await fetchLinkPreview('https://flaky.example')).toEqual({
      url: 'https://flaky.example',
      title: 'Later',
      description: '',
      image: '',
      site: '',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries after a non-ok (5xx) response instead of caching it', async () => {
    const good = { title: 'Recovered', description: '', image: '', site: '' };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => new Response('nope', { status: 503 }))
      .mockImplementationOnce(async () => new Response(JSON.stringify(good), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchLinkPreview('https://blip.example')).toBeNull();
    expect(await fetchLinkPreview('https://blip.example')).toMatchObject({ title: 'Recovered' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches a legitimate empty-metadata result — no retry storm', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchLinkPreview('https://empty2.example')).toBeNull();
    expect(await fetchLinkPreview('https://empty2.example')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
