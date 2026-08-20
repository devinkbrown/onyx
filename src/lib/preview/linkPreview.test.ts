// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearLinkPreviewCache,
  pickPreviewUrl,
  fetchLinkPreview,
  isPreviewableUrl,
  LINK_PREVIEW_DESCRIPTION_MAX,
  LINK_PREVIEW_HREF_SCAN_MAX,
  LINK_PREVIEW_SITE_MAX,
  LINK_PREVIEW_TITLE_MAX,
  LINK_PREVIEW_URL_MAX,
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
  it('bounds the candidate scan before URL parsing', () => {
    const hrefs = [
      ...Array.from({ length: LINK_PREVIEW_HREF_SCAN_MAX }, () => 'not a url'),
      'https://outside-the-work-cap.example',
    ];
    expect(pickPreviewUrl(hrefs)).toBeNull();
  });
  it('returns null when privacy disables linkPreviews', () => {
    expect(pickPreviewUrl(['https://example.com/a'], {
      linkPreviews: false,
      httpsOnly: true,
      blockedHosts: [],
    })).toBeNull();
  });
  it('skips http candidates under httpsOnly privacy', () => {
    expect(pickPreviewUrl(
      ['http://insecure.example/a', 'https://secure.example/b'],
      { linkPreviews: true, httpsOnly: true, blockedHosts: [] },
    )).toBe('https://secure.example/b');
  });
  it('skips blocked host suffixes under privacy prefs', () => {
    expect(pickPreviewUrl(
      ['https://app.blocked.example/x', 'https://ok.example/y'],
      { linkPreviews: true, httpsOnly: true, blockedHosts: ['blocked.example'] },
    )).toBe('https://ok.example/y');
  });
});

describe('isPreviewableUrl (SSRF defense in depth)', () => {
  it('accepts plain http(s) public web URLs', () => {
    expect(isPreviewableUrl('https://example.com/page')).toBe(true);
    expect(isPreviewableUrl('http://example.com')).toBe(true);
    expect(isPreviewableUrl('https://github.com/onyx/onyx?tab=readme')).toBe(true);
  });

  it('honors linkPreviews / httpsOnly / blockedHosts via mayUnfurlUrl when privacy is supplied', () => {
    const off = { linkPreviews: false, httpsOnly: false, blockedHosts: [] as string[] };
    const privacy = { linkPreviews: true, httpsOnly: true, blockedHosts: ['corp.example', 'evil.test'] };
    expect(isPreviewableUrl('https://example.com/page', off)).toBe(false);
    expect(isPreviewableUrl('http://example.com/page', privacy)).toBe(false);
    expect(isPreviewableUrl('https://example.com/page', privacy)).toBe(true);
    expect(isPreviewableUrl('https://intranet.corp.example/x', privacy)).toBe(false);
    expect(isPreviewableUrl('https://tracker.evil.test/x', privacy)).toBe(false);
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
      `https://example.com/${'x'.repeat(LINK_PREVIEW_URL_MAX)}`,
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

  it('rejects a trailing DNS root label used to defeat the internal-host denylist', () => {
    // Control: the bare (no-dot) host is already correctly rejected.
    expect(isPreviewableUrl('http://vault.internal/')).toBe(false);
    // A root-labeled hostname must be rejected identically — `URL` preserves
    // the trailing dot verbatim in `.hostname`, so without normalization each
    // of these previously slipped past every suffix/exact-match host check.
    expect(isPreviewableUrl('https://wiki.intranet.corp./page', {
      linkPreviews: true,
      httpsOnly: true,
      blockedHosts: ['intranet.corp'],
    })).toBe(false);
    expect(isPreviewableUrl('https://printer.intranet.local./p.png')).toBe(false);
    expect(isPreviewableUrl('https://api.svc.internal./x')).toBe(false);
    expect(isPreviewableUrl('https://localhost./x.png')).toBe(false);
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
  it('encodes adversarial absolute targets inside the same-origin preview endpoint', async () => {
    const target =
      'https://preview.example/path?redirect=http://169.254.169.254/latest/meta-data/#frag';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const requested = String(input);
      expect(requested).toMatch(/^\/linkpreview\?url=/);
      expect(requested).not.toMatch(/^https?:\/\//);

      const parsed = new URL(requested, 'https://onyx.example');
      expect(parsed.origin).toBe('https://onyx.example');
      expect(parsed.pathname).toBe('/linkpreview');
      expect(parsed.searchParams.get('url')).toBe(target);

      return new Response(JSON.stringify({ title: 'safe proxy' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLinkPreview(target)).resolves.toMatchObject({ title: 'safe proxy' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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

  it('NEVER issues a fetch when linkPreviews privacy is off', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchLinkPreview('https://example.com/page', {
      linkPreviews: false,
      httpsOnly: true,
      blockedHosts: [],
    })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never fetches a rejected non-same-origin target directly after a cached preview exists', async () => {
    const safeTarget = 'https://public.example/page';
    const unsafeTarget = 'http://169.254.169.254/latest/meta-data/';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`/linkpreview?url=${encodeURIComponent(safeTarget)}`);
      return new Response(JSON.stringify({ title: 'public' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLinkPreview(safeTarget)).resolves.toMatchObject({ title: 'public' });
    await expect(fetchLinkPreview(unsafeTarget)).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('only ever fetches the same-origin /linkpreview endpoint', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ title: 'ok' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await fetchLinkPreview('https://example.com/page?x=1&y=2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requested = String(fetchMock.mock.calls[0]?.[0]);
    expect(requested).toBe(
      `/linkpreview?url=${encodeURIComponent('https://example.com/page?x=1&y=2')}`,
    );
    // No absolute/cross-origin URL is ever passed to fetch.
    expect(requested.startsWith('/linkpreview?')).toBe(true);
    expect(/^https?:\/\//.test(requested)).toBe(false);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    });
  });

  it('routes every public target through same-origin /linkpreview instead of target origins', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ title: 'ok' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      fetchLinkPreview('https://news.example/path'),
      fetchLinkPreview('http://public.example:8080/thing?x=1#frag'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const input = String(call[0]);
      expect(input).toMatch(/^\/linkpreview\?url=/);
      expect(input).not.toMatch(/^https?:\/\/(?:news|public)\.example/);
    }
  });

  it('replays the settled module cache without issuing a second endpoint request', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ title: 'Cached', description: 'once' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const firstPromise = fetchLinkPreview('https://cache.example/page');
    const first = await firstPromise;
    const secondPromise = fetchLinkPreview('https://cache.example/page');
    const second = await secondPromise;

    expect(secondPromise).toBe(firstPromise);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('releases cached URL metadata at an owner boundary', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ title: 'Alice private title' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ title: 'Bob current title' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const url = 'https://cache.example/private?token=alice-secret';

    const alice = fetchLinkPreview(url);
    await expect(alice).resolves.toMatchObject({ title: 'Alice private title' });
    clearLinkPreviewCache();
    const bob = fetchLinkPreview(url);

    expect(bob).not.toBe(alice);
    await expect(bob).resolves.toMatchObject({ title: 'Bob current title' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('dedupes while the endpoint response is still in flight', async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn(() => pendingResponse);
    vi.stubGlobal('fetch', fetchMock);

    const first = fetchLinkPreview('https://inflight.example/page');
    const second = fetchLinkPreview('https://inflight.example/page');

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveResponse?.(new Response(JSON.stringify({ title: 'Inflight' }), { status: 200 }));
    await expect(first).resolves.toMatchObject({ title: 'Inflight' });
  });

  it('keeps in-flight dedupe and settled module cache on the same promise object', async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn(() => pendingResponse);
    vi.stubGlobal('fetch', fetchMock);

    const url = 'https://identity-cache.example/page';
    const first = fetchLinkPreview(url);
    const second = fetchLinkPreview(url);

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveResponse?.(
      new Response(JSON.stringify({ title: 'Identity', description: 'cached' }), { status: 200 }),
    );
    await expect(first).resolves.toMatchObject({ title: 'Identity' });

    const third = fetchLinkPreview(url);
    expect(third).toBe(first);
    await expect(third).resolves.toMatchObject({ description: 'cached' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('normalizes a good payload and dedupes concurrent fetches', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ title: 'Onyx', description: 'a daemon', image: '', site: 'GitHub' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([
      fetchLinkPreview('https://example.com'),
      fetchLinkPreview('https://example.com'),
    ]);
    expect(a).toEqual({ url: 'https://example.com', title: 'Onyx', description: 'a daemon', image: '', site: 'GitHub' });
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds metadata and rejects poisoned canonical/image URLs at normalization', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      url: 'http://127.0.0.1/admin',
      title: 't'.repeat(LINK_PREVIEW_TITLE_MAX + 10),
      description: 'd'.repeat(LINK_PREVIEW_DESCRIPTION_MAX + 10),
      image: 'http://169.254.169.254/latest/meta-data/',
      site: 's'.repeat(LINK_PREVIEW_SITE_MAX + 10),
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const requested = 'https://public.example/page';

    await expect(fetchLinkPreview(requested)).resolves.toEqual({
      url: requested,
      title: 't'.repeat(LINK_PREVIEW_TITLE_MAX),
      description: 'd'.repeat(LINK_PREVIEW_DESCRIPTION_MAX),
      image: '',
      site: 's'.repeat(LINK_PREVIEW_SITE_MAX),
    });
  });

  it('rejects an oversized endpoint response before JSON parsing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ title: 'x'.repeat(300_000) }),
      { status: 200 },
    )));

    await expect(fetchLinkPreview('https://oversized.example')).resolves.toBeNull();
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
