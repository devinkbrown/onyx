// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * channelStats.test.ts — the slug must stay byte-faithful to the server's
 * `slugify` (chanstats.zig) or the per-channel stats file 404s. These vectors
 * mirror the pinned ones in onyx-stats/src/lib/slug.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { channelToSlug, fetchChannelPulse } from './channelStats';

describe('channelToSlug (byte-faithful to the server)', () => {
  it('strips one sigil and neutralises unsafe/traversal bytes', () => {
    expect(channelToSlug('#root')).toBe('root');
    expect(channelToSlug('#foo/bar')).toBe('foo_bar');
    expect(channelToSlug('#../etc/passwd')).toBe('_._etc_passwd');
    expect(channelToSlug('&.hidden')).toBe('_hidden');
    expect(channelToSlug('#')).toBe('');
  });

  it('lowercases, keeps [.-_], replaces spaces/specials, no trimming', () => {
    expect(channelToSlug('#Foo Bar')).toBe('foo_bar');
    expect(channelToSlug('#dev.ops_team-1')).toBe('dev.ops_team-1');
    expect(channelToSlug('#  spaced  ')).toBe('__spaced__');
    expect(channelToSlug('#!!!')).toBe('___');
  });

  it('maps each non-ASCII byte to an underscore (per-byte, like the server)', () => {
    expect(channelToSlug('#café')).toBe('caf__'); // é = 2 UTF-8 bytes
  });

  it('strips only one leading sigil and keeps the 128-byte server cap', () => {
    expect(channelToSlug('##root')).toBe('_root');
    expect(channelToSlug(`#${'A'.repeat(140)}`)).toBe('a'.repeat(128));
  });

  it('returns empty for empty input', () => {
    expect(channelToSlug('')).toBe('');
  });
});

describe('fetchChannelPulse', () => {
  afterEach(() => vi.unstubAllGlobals());

  const okResponse = (body: unknown, headers?: HeadersInit) =>
    new Response(JSON.stringify(body), { status: 200, headers });

  it('fetches the slug file and normalizes a 24-hour histogram', async () => {
    const hours = Array.from({ length: 24 }, (_, i) => (i === 20 ? 5 : 0));
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ hours, totals: { messages: 42 } }));
    vi.stubGlobal('fetch', fetchMock);

    const pulse = await fetchChannelPulse('#root');
    expect(fetchMock).toHaveBeenCalledWith('/stats/data/root.json', expect.anything());
    expect(pulse?.hours).toEqual(hours);
    expect(pulse?.total).toBe(42);
  });

  it('returns null on a non-24-length or missing histogram', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ hours: [1, 2, 3] })));
    expect(await fetchChannelPulse('#root')).toBeNull();
  });

  it('returns null on a 404 or a throw (dev servers have no /stats)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));
    expect(await fetchChannelPulse('#root')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await fetchChannelPulse('#root')).toBeNull();
  });

  it('falls back to summing hours when totals are absent', async () => {
    const hours = Array.from({ length: 24 }, () => 2);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ hours })));
    const pulse = await fetchChannelPulse('#root');
    expect(pulse?.total).toBe(48);
  });

  it('floors positive hour counts and clamps negative or non-number counts to zero', async () => {
    const hours = Array.from({ length: 24 }, (_, i) => {
      if (i === 0) return 3.9;
      if (i === 1) return -1;
      if (i === 2) return '9';
      return 0;
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ hours })));

    const pulse = await fetchChannelPulse('#root');

    expect(pulse?.hours.slice(0, 4)).toEqual([3, 0, 0, 0]);
    expect(pulse?.total).toBe(3);
  });

  it('bounds non-finite and hostile counts before rendering the heatline', async () => {
    const hours = Array.from({ length: 24 }, (_, i) => {
      if (i === 0) return Number.POSITIVE_INFINITY;
      if (i === 1) return 2_000_000_000_000;
      return 0;
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({
      hours,
      totals: { messages: Number.POSITIVE_INFINITY },
    })));

    const pulse = await fetchChannelPulse('#root');

    expect(pulse?.hours[0]).toBe(0);
    expect(pulse?.hours[1]).toBe(1_000_000_000_000);
    expect(pulse?.total).toBe(1_000_000_000_000);
  });

  it('rejects a response declared over the shared public-feed byte ceiling', async () => {
    const hours = Array.from({ length: 24 }, () => 0);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(
      { hours },
      { 'content-length': String(256 * 1024 + 1) },
    )));

    await expect(fetchChannelPulse('#root')).resolves.toBeNull();
  });

  it('returns null before fetching when the channel cannot produce a slug', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchChannelPulse('#')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
