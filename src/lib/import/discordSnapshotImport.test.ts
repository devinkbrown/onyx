// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest';
import {
  DiscordRestClient,
  DiscordImportError,
  DISCORD_AUTH_MESSAGE,
  DISCORD_MISSING_CONTENT_INTENT_MESSAGE,
  isSnowflake,
  snowflakeToMs,
  normalizeRestMessage,
  normalizeDiscordChannelExport,
  looksLikeMissingContentIntent,
  replaceCustomEmoji,
  runDiscordChannelImport,
  runDiscordGuildImport,
} from './discordSnapshotImport';
import { parseDiscordExport } from './discordImport';

// ── Test doubles ────────────────────────────────────────────────────────────

/** Build a fetch-Response stand-in with controllable status/headers/body. */
function fakeRes(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response;
}

/**
 * A Discord snowflake for a given epoch-ms time (inverse of snowflakeToMs), so
 * pagination cutoff tests can pin message ages deterministically.
 */
function snowflakeForMs(ms: number): string {
  return String((BigInt(Math.floor(ms)) - 1420070400000n) << 22n);
}

/** A minimal REST message with real content (so intent-detection passes). */
function restMsg(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: 0,
    timestamp: '2024-01-01T00:00:00.000Z',
    content: 'hello',
    author: { username: 'alice', global_name: 'Alice' },
    attachments: [],
    ...over,
  };
}

const noSleep = () => Promise.resolve();

/** Typed fetch signature so `mock.calls[i]` carries the [url, init] tuple. */
type FetchFn = (...args: Parameters<typeof fetch>) => Promise<Response>;

// ── snowflake helpers ────────────────────────────────────────────────────────

describe('snowflake helpers', () => {
  it('validates 1–20 digit ids and rejects everything else', () => {
    expect(isSnowflake('0')).toBe(true);
    expect(isSnowflake('12345678901234567890')).toBe(true);
    expect(isSnowflake('')).toBe(false);
    expect(isSnowflake('123456789012345678901')).toBe(false); // 21 digits
    expect(isSnowflake('12a')).toBe(false);
    expect(isSnowflake('../etc')).toBe(false);
  });

  it('decodes a snowflake to its creation ms and round-trips', () => {
    const ms = Date.UTC(2022, 0, 1);
    const id = snowflakeForMs(ms);
    expect(snowflakeToMs(id)).toBe(ms);
    expect(Number.isNaN(snowflakeToMs('nope'))).toBe(true);
  });
});

// ── normalization → parseDiscordExport ───────────────────────────────────────

describe('normalizeRestMessage', () => {
  it('maps REST fields onto the DiscordChatExporter row shape', () => {
    const row = normalizeRestMessage(
      restMsg('100', {
        type: 19,
        content: 'reply body',
        edited_timestamp: '2024-01-02T00:00:00.000Z',
        attachments: [{ url: 'https://cdn.example/a.png' }, { noturl: 1 }],
        reactions: [{ count: 3, emoji: { name: '🔥', id: null } }],
        message_reference: { message_id: '99' },
        author: { username: 'bob', global_name: 'Bob B' },
      }),
    );
    expect(row).toMatchObject({
      id: '100',
      type: 'Reply',
      content: 'reply body',
      timestampEdited: '2024-01-02T00:00:00.000Z',
      attachments: [{ url: 'https://cdn.example/a.png' }],
      reactions: [{ emoji: { name: '🔥' }, count: 3 }],
      reference: { messageId: '99' },
      author: { name: 'Bob B' },
    });
  });

  it('prefers global_name, falls back to username, then unknown', () => {
    expect(normalizeRestMessage(restMsg('1', { author: { username: 'u' } }))?.author).toEqual({ name: 'u' });
    expect(normalizeRestMessage(restMsg('1', { author: {} }))?.author).toEqual({ name: 'unknown' });
    expect(normalizeRestMessage(42)).toBeNull();
  });

  it('feeds parseDiscordExport a shape it fully transforms', () => {
    const rawMessages = [
      restMsg('200', { id: '200', content: 'first', timestamp: '2024-03-01T10:00:00.000Z' }),
      restMsg('201', {
        id: '201',
        type: 19,
        content: 'a reply',
        timestamp: '2024-03-01T10:05:00.000Z',
        edited_timestamp: '2024-03-01T10:06:00.000Z',
        message_reference: { message_id: '200' },
        attachments: [{ url: 'https://cdn.example/pic.jpg' }],
        reactions: [{ count: 2, emoji: { name: '👍' } }],
      }),
    ];
    const channelExport = normalizeDiscordChannelExport('555', 'general', rawMessages);
    const parsed = parseDiscordExport(channelExport);
    expect(parsed).not.toBeNull();
    const target = parsed!.snapshot.targets[0]!;
    expect(target.target).toBe('#general');
    expect(target.messages).toHaveLength(2);
    const reply = target.messages[1]!;
    expect(reply.from).toBe('Alice');
    expect(reply.text).toContain('a reply');
    expect(reply.text).toContain('https://cdn.example/pic.jpg');
    expect(reply.edited).toBe(true);
    expect(reply.replyTo?.text).toContain('first');
    expect(reply.reactions?.[0]?.emoji).toBe('👍');
  });
});

// ── MESSAGE CONTENT intent detection ─────────────────────────────────────────

describe('looksLikeMissingContentIntent', () => {
  it('flags a page where every message is stripped on all three axes', () => {
    const stripped = [
      { id: '1', content: '', attachments: [], embeds: [] },
      { id: '2', content: '', attachments: [], embeds: [] },
    ];
    expect(looksLikeMissingContentIntent(stripped)).toBe(true);
  });

  it('does not flag a page with real content, attachments, or embeds', () => {
    expect(looksLikeMissingContentIntent([restMsg('1')])).toBe(false);
    expect(
      looksLikeMissingContentIntent([{ id: '1', content: '', attachments: [{ url: 'x' }], embeds: [] }]),
    ).toBe(false);
    expect(
      looksLikeMissingContentIntent([{ id: '1', content: '', attachments: [], embeds: [{ type: 'rich' }] }]),
    ).toBe(false);
    expect(looksLikeMissingContentIntent([])).toBe(false);
  });
});

// ── DiscordRestClient: pagination / throttle / rate-limit / abort ────────────

describe('DiscordRestClient', () => {
  it('rejects a non-snowflake channel id before any fetch', async () => {
    const fetchImpl = vi.fn();
    const client = new DiscordRestClient({ token: 't', fetchImpl });
    await expect(client.getChannelMessages('../evil')).rejects.toBeInstanceOf(DiscordImportError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the Bot token on the Authorization header and hits the same-origin proxy', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => fakeRes(200, [restMsg('1')]));
    const client = new DiscordRestClient({ token: 'SECRET_TOKEN', fetchImpl, sleep: noSleep });
    await client.getChannelMessages('123');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('/discord-import/channels/123/messages?limit=100');
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bot SECRET_TOKEN');
  });

  it('waits the minInterval floor between requests', async () => {
    const sleep = vi.fn(noSleep);
    const fetchImpl = vi.fn(async () => fakeRes(200, [restMsg('1')]));
    const client = new DiscordRestClient({
      token: 't',
      fetchImpl,
      sleep,
      now: () => 0, // frozen clock: after req 1, nextAllowedAt = 300; req 2 must wait 300
      minIntervalMs: 300,
    });
    await client.getChannelMessages('123');
    await client.getChannelMessages('123', '1');
    expect(sleep).toHaveBeenCalledWith(300);
  });

  it('sleeps and re-enqueues on 429, honoring max(Retry-After, body.retry_after)', async () => {
    const sleep = vi.fn(noSleep);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeRes(429, { retry_after: 2 }, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(fakeRes(200, [restMsg('1')]));
    const client = new DiscordRestClient({ token: 't', fetchImpl, sleep, random: () => 0 });
    const out = await client.getChannelMessages('123');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000); // body.retry_after (2s) > header (1s)
    expect(out).toHaveLength(1);
  });

  it('honors X-RateLimit-Remaining==0 by waiting Reset-After before the next request', async () => {
    const sleep = vi.fn(noSleep);
    const fetchImpl = vi.fn(async () =>
      fakeRes(200, [restMsg('1')], { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '5' }),
    );
    const client = new DiscordRestClient({ token: 't', fetchImpl, sleep, now: () => 0, minIntervalMs: 10 });
    await client.getChannelMessages('123');
    await client.getChannelMessages('123', '1');
    expect(sleep).toHaveBeenCalledWith(5000);
  });
});

// ── runDiscordChannelImport: end-to-end orchestration ────────────────────────

describe('runDiscordChannelImport', () => {
  it('paginates backward with before=oldest-id and stops on a short page', async () => {
    const pageA = Array.from({ length: 100 }, (_, i) => restMsg(String(1000 - i))); // newest-first
    const pageB = Array.from({ length: 40 }, (_, i) => restMsg(String(900 - i)));
    const fetchImpl = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(fakeRes(200, pageA))
      .mockResolvedValueOnce(fakeRes(200, pageB));
    const res = await runDiscordChannelImport({
      token: 't',
      channelId: '42',
      channelName: 'general',
      fetchImpl,
      sleep: noSleep,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Second call must page before the oldest id of page A (id '901', its last element).
    expect(fetchImpl.mock.calls[1]![0]).toBe('/discord-import/channels/42/messages?limit=100&before=901');
    expect(res.fetched).toBe(140);
    expect(res.reachedStart).toBe(true);
    expect(res.result.summary.messages).toBe(140);
  });

  it('stops paginating once the oldest fetched message crosses the sinceDays cutoff', async () => {
    const now = Date.now();
    const oldMs = now - 40 * 24 * 60 * 60 * 1000; // ~40 days old → beyond a 30-day cutoff
    const page = Array.from({ length: 100 }, () =>
      restMsg(snowflakeForMs(oldMs), { timestamp: new Date(oldMs).toISOString() }),
    );
    const fetchImpl = vi.fn(async () => fakeRes(200, page));
    const res = await runDiscordChannelImport({
      token: 't',
      channelId: '42',
      sinceDays: 30,
      fetchImpl,
      sleep: noSleep,
    });
    // A full page (100) would otherwise page again, but the cutoff halts it.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.reachedStart).toBe(false);
  });

  it('resolves reply quotes from a newest-first page (oldest→newest re-ordering)', async () => {
    // Discord returns messages newest-first; the reply (id 2) precedes its
    // parent (id 1). Only correct re-ordering lets parseDiscordExport resolve
    // the quote — a regression guard for the collect-order fix.
    const ts = new Date(Date.now() - 60_000).toISOString();
    const page = [
      restMsg('2', { id: '2', type: 19, content: 'the reply', timestamp: ts, message_reference: { message_id: '1' } }),
      restMsg('1', { id: '1', content: 'the parent', timestamp: ts }),
    ];
    const fetchImpl = vi.fn(async () => fakeRes(200, page));
    const res = await runDiscordChannelImport({ token: 't', channelId: '42', fetchImpl, sleep: noSleep });
    const messages = res.result.snapshot.targets[0]!.messages;
    const reply = messages.find((m) => m.text === 'the reply')!;
    expect(reply.replyTo?.text).toContain('the parent');
  });

  it('ABORTS on 401 without retrying', async () => {
    const fetchImpl = vi.fn(async () => fakeRes(401, { message: '401: Unauthorized' }));
    await expect(
      runDiscordChannelImport({ token: 'bad', channelId: '42', fetchImpl, sleep: noSleep }),
    ).rejects.toMatchObject({ kind: 'auth', message: DISCORD_AUTH_MESSAGE });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('ABORTS on 403 without retrying', async () => {
    const fetchImpl = vi.fn(async () => fakeRes(403, {}));
    await expect(
      runDiscordChannelImport({ token: 'x', channelId: '42', fetchImpl, sleep: noSleep }),
    ).rejects.toMatchObject({ kind: 'auth' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails LOUDLY with the exact fix when the first page is all empty (missing intent)', async () => {
    const stripped = Array.from({ length: 100 }, (_, i) => ({
      id: String(500 - i),
      type: 0,
      timestamp: '2024-01-01T00:00:00.000Z',
      content: '',
      attachments: [],
      embeds: [],
      author: { username: 'alice' },
    }));
    const fetchImpl = vi.fn(async () => fakeRes(200, stripped));
    await expect(
      runDiscordChannelImport({ token: 't', channelId: '42', fetchImpl, sleep: noSleep }),
    ).rejects.toMatchObject({ kind: 'empty-content', message: DISCORD_MISSING_CONTENT_INTENT_MESSAGE });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // detected on page 1, no further paging
  });

  it('respects an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => fakeRes(200, [restMsg('1')]));
    await expect(
      runDiscordChannelImport({ token: 't', channelId: '42', fetchImpl, signal: controller.signal, sleep: noSleep }),
    ).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never leaks the bot token into the produced snapshot', async () => {
    const token = 'MTA_super_secret_token.ABCDEF';
    const fetchImpl = vi.fn(async () => fakeRes(200, [restMsg('1')]));
    const res = await runDiscordChannelImport({ token, channelId: '42', fetchImpl, sleep: noSleep });
    expect(JSON.stringify(res.result.snapshot)).not.toContain(token);
    expect(JSON.stringify(res.result.snapshot)).not.toContain('Bot ');
  });
});

// ── custom-emoji shortcode rewriting ─────────────────────────────────────────

describe('replaceCustomEmoji', () => {
  it('rewrites <:name:id> and animated <a:name:id> to :name:', () => {
    expect(replaceCustomEmoji('gg <:pog:12345> and <a:wave:67890>!')).toBe('gg :pog: and :wave:!');
  });

  it('leaves plain text and non-emoji angle brackets untouched', () => {
    expect(replaceCustomEmoji('no emoji here')).toBe('no emoji here');
    expect(replaceCustomEmoji('a < b and c > d')).toBe('a < b and c > d');
  });

  it('is applied to content inside normalizeRestMessage', () => {
    expect(normalizeRestMessage(restMsg('1', { content: 'nice <:fire:999>' }))?.content).toBe('nice :fire:');
  });
});

// ── DiscordRestClient: guild + pins endpoints ────────────────────────────────

describe('DiscordRestClient guild/pins endpoints', () => {
  it('hits the guild routes and returns their arrays', async () => {
    const fetchImpl = vi.fn<FetchFn>(async (input) => {
      const url = String(input);
      if (url.endsWith('/channels')) return fakeRes(200, [{ id: '10', type: 0 }]);
      if (url.endsWith('/roles')) return fakeRes(200, [{ id: 'r1' }, { id: 'r2' }]);
      if (url.endsWith('/emojis')) return fakeRes(200, [{ id: 'e1' }]);
      return fakeRes(404, {});
    });
    const client = new DiscordRestClient({ token: 't', fetchImpl, sleep: noSleep });
    expect(await client.getGuildChannels('9')).toHaveLength(1);
    expect(await client.getGuildRoles('9')).toHaveLength(2);
    expect(await client.getGuildEmojis('9')).toHaveLength(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('/discord-import/guilds/9/channels');
  });

  it('rejects a non-snowflake guild id before any fetch', async () => {
    const fetchImpl = vi.fn();
    const client = new DiscordRestClient({ token: 't', fetchImpl });
    await expect(client.getGuildChannels('../evil')).rejects.toBeInstanceOf(DiscordImportError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads the pins page and follows the ISO before cursor', async () => {
    const fetchImpl = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(
        fakeRes(200, { items: [{ pinned_at: '2024-02-01T00:00:00.000Z', message: restMsg('2') }], has_more: true }),
      )
      .mockResolvedValueOnce(
        fakeRes(200, { items: [{ pinned_at: '2024-01-01T00:00:00.000Z', message: restMsg('1') }], has_more: false }),
      );
    const client = new DiscordRestClient({ token: 't', fetchImpl, sleep: noSleep });
    const first = await client.getChannelPins('10');
    expect(first.hasMore).toBe(true);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('/discord-import/channels/10/messages/pins?limit=50');
    const second = await client.getChannelPins('10', '2024-02-01T00:00:00.000Z');
    expect(second.hasMore).toBe(false);
    // The ISO cursor is URL-encoded on the wire (`:` → %3A), matching the proxy.
    expect(String(fetchImpl.mock.calls[1]![0])).toBe(
      '/discord-import/channels/10/messages/pins?limit=50&before=2024-02-01T00%3A00%3A00.000Z',
    );
  });
});

// ── runDiscordGuildImport: full-guild snapshot orchestration ──────────────────

/** Guild channel record with the fields the walk narrows. */
interface RawGuildChannel {
  id: string;
  name: string;
  type: number;
  position: number;
}

interface GuildFetchConfig {
  channels: RawGuildChannel[];
  roles?: unknown[];
  emojis?: unknown[];
  /** channelId → array of message pages served in order (each newest-first). */
  messages?: Record<string, unknown[][]>;
  /** channelId → pin items ({ pinned_at, message }) served on one pins page. */
  pins?: Record<string, unknown[]>;
}

/** A URL-routing fake fetch that models the guild REST surface deterministically. */
function makeGuildFetch(cfg: GuildFetchConfig): ReturnType<typeof vi.fn<FetchFn>> {
  const msgCursor: Record<string, number> = {};
  return vi.fn<FetchFn>(async (input) => {
    const path = String(input).slice('/discord-import/'.length);
    const qIdx = path.indexOf('?');
    const pathname = qIdx >= 0 ? path.slice(0, qIdx) : path;

    if (pathname.startsWith('guilds/')) {
      if (pathname.endsWith('/channels')) return fakeRes(200, cfg.channels);
      if (pathname.endsWith('/roles')) return fakeRes(200, cfg.roles ?? []);
      if (pathname.endsWith('/emojis')) return fakeRes(200, cfg.emojis ?? []);
    }
    const pinMatch = pathname.match(/^channels\/(\d+)\/messages\/pins$/);
    if (pinMatch) return fakeRes(200, { items: cfg.pins?.[pinMatch[1]!] ?? [], has_more: false });
    const msgMatch = pathname.match(/^channels\/(\d+)\/messages$/);
    if (msgMatch) {
      const id = msgMatch[1]!;
      const pages = cfg.messages?.[id] ?? [[]];
      const idx = msgCursor[id] ?? 0;
      msgCursor[id] = idx + 1;
      return fakeRes(200, pages[idx] ?? []);
    }
    return fakeRes(404, {});
  });
}

describe('runDiscordGuildImport', () => {
  it('enumerates channels, filters to text/announcement/forum, drops categories + roles', async () => {
    const channels: RawGuildChannel[] = [
      { id: '10', name: 'general', type: 0, position: 1 },
      { id: '11', name: 'announcements', type: 5, position: 0 },
      { id: '12', name: 'ideas', type: 15, position: 2 },
      { id: '13', name: 'Lounge', type: 2, position: 3 }, // voice → dropped, not counted
      { id: '14', name: 'Text Rooms', type: 4, position: 4 }, // category → counted + dropped
    ];
    const messages = {
      '10': [[restMsg('100', { timestamp: '2024-03-01T00:00:00.000Z' })]],
      '11': [[restMsg('110', { timestamp: '2024-03-02T00:00:00.000Z' })]],
      '12': [[restMsg('120', { timestamp: '2024-03-03T00:00:00.000Z' })]],
    };
    const fetchImpl = makeGuildFetch({ channels, roles: [{ id: 'r1' }, { id: 'r2' }], emojis: [{ id: 'e1' }], messages });
    const res = await runDiscordGuildImport({ token: 't', guildId: '9', fetchImpl, sleep: noSleep });

    expect(res.channelsScanned).toBe(3);
    expect(res.channelsImported).toBe(3);
    expect(res.categoriesSkipped).toBe(1);
    expect(res.rolesSkipped).toBe(2);
    expect(res.emojisSkipped).toBe(1);
    expect(res.result.summary.messages).toBe(3);
    expect(res.result.snapshot.targets.map((t) => t.target).sort()).toEqual(['#announcements', '#general', '#ideas']);
  });

  it('paginates each channel with before=oldest-id', async () => {
    const pageA = Array.from({ length: 100 }, (_, i) => restMsg(String(1000 - i)));
    const pageB = Array.from({ length: 5 }, (_, i) => restMsg(String(900 - i)));
    const fetchImpl = makeGuildFetch({
      channels: [{ id: '10', name: 'general', type: 0, position: 0 }],
      messages: { '10': [pageA, pageB] },
    });
    const res = await runDiscordGuildImport({ token: 't', guildId: '9', fetchImpl, sleep: noSleep });
    expect(res.fetched).toBe(105);
    const calls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(calls).toContain('/discord-import/channels/10/messages?limit=100&before=901');
  });

  it('pulls pins and merges them as ordinary messages, deduped by id', async () => {
    const scroll = [restMsg('100', { content: 'live', timestamp: '2024-03-01T00:00:00.000Z' })];
    const pins = [
      // Same id as a scrollback message → must NOT double-import.
      { pinned_at: '2024-02-01T00:00:00.000Z', message: restMsg('100', { timestamp: '2024-03-01T00:00:00.000Z' }) },
      // A distinct, older pinned message → imported.
      { pinned_at: '2024-01-01T00:00:00.000Z', message: restMsg('50', { content: 'old pin', timestamp: '2024-01-01T00:00:00.000Z' }) },
    ];
    const fetchImpl = makeGuildFetch({
      channels: [{ id: '10', name: 'general', type: 0, position: 0 }],
      messages: { '10': [scroll] },
      pins: { '10': pins },
    });
    const res = await runDiscordGuildImport({ token: 't', guildId: '9', fetchImpl, sleep: noSleep });
    expect(res.pinsImported).toBe(1);
    expect(res.result.summary.messages).toBe(2);
    expect(fetchImpl.mock.calls.map((c) => String(c[0]))).toContain('/discord-import/channels/10/messages/pins?limit=50');
  });

  it('keeps a channel\'s scrollback when only its pins endpoint fails', async () => {
    // Pins are decoration: a 500 on the pins endpoint must not drop the channel.
    const fetchImpl = vi.fn<FetchFn>(async (input) => {
      const url = String(input);
      if (url.includes('guilds/9/channels')) return fakeRes(200, [{ id: '10', name: 'general', type: 0, position: 0 }]);
      if (url.includes('guilds/9/')) return fakeRes(200, []);
      if (url.includes('/messages/pins')) return fakeRes(500, { message: 'boom' });
      if (url.includes('/messages')) return fakeRes(200, [restMsg('100', { content: 'kept' })]);
      return fakeRes(404, {});
    });
    const res = await runDiscordGuildImport({ token: 't', guildId: '9', fetchImpl, sleep: noSleep });
    expect(res.channelsImported).toBe(1);
    expect(res.channelsFailed).toBe(0);
    expect(res.pinsImported).toBe(0);
    expect(res.result.summary.messages).toBe(1);
  });

  it('skips a channel that fails to read but imports the readable ones', async () => {
    const channels: RawGuildChannel[] = [
      { id: '10', name: 'ok', type: 0, position: 0 },
      { id: '11', name: 'locked', type: 0, position: 1 },
    ];
    const fetchImpl = vi.fn<FetchFn>(async (input) => {
      const url = String(input);
      if (url.includes('guilds/9/channels')) return fakeRes(200, channels);
      if (url.includes('guilds/9/')) return fakeRes(200, []);
      if (url.startsWith('/discord-import/channels/11/')) return fakeRes(403, {}); // per-channel denial
      if (url.startsWith('/discord-import/channels/10/messages/pins')) return fakeRes(200, { items: [], has_more: false });
      if (url.startsWith('/discord-import/channels/10/messages')) return fakeRes(200, [restMsg('100')]);
      return fakeRes(404, {});
    });
    const res = await runDiscordGuildImport({ token: 't', guildId: '9', fetchImpl, sleep: noSleep });
    expect(res.channelsImported).toBe(1);
    expect(res.channelsFailed).toBe(1);
    expect(res.result.summary.messages).toBe(1);
  });

  it('aborts the WHOLE run when channel enumeration is unauthorized', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => fakeRes(401, {}));
    await expect(
      runDiscordGuildImport({ token: 'bad', guildId: '9', fetchImpl, sleep: noSleep }),
    ).rejects.toMatchObject({ kind: 'auth', message: DISCORD_AUTH_MESSAGE });
  });

  it('fails loudly with missing-intent when the first readable channel is all-stripped', async () => {
    const stripped = Array.from({ length: 100 }, (_, i) => ({
      id: String(500 - i),
      type: 0,
      timestamp: '2024-01-01T00:00:00.000Z',
      content: '',
      attachments: [],
      embeds: [],
      author: { username: 'a' },
    }));
    const fetchImpl = makeGuildFetch({
      channels: [{ id: '10', name: 'general', type: 0, position: 0 }],
      messages: { '10': [stripped] },
    });
    await expect(
      runDiscordGuildImport({ token: 't', guildId: '9', fetchImpl, sleep: noSleep }),
    ).rejects.toMatchObject({ kind: 'empty-content', message: DISCORD_MISSING_CONTENT_INTENT_MESSAGE });
  });

  it('respects an already-aborted signal before any fetch', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<FetchFn>(async () => fakeRes(200, []));
    await expect(
      runDiscordGuildImport({ token: 't', guildId: '9', fetchImpl, signal: controller.signal, sleep: noSleep }),
    ).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns an honest empty result when the guild has no readable text channels', async () => {
    const fetchImpl = makeGuildFetch({ channels: [{ id: '14', name: 'cat', type: 4, position: 0 }] });
    const res = await runDiscordGuildImport({ token: 't', guildId: '9', fetchImpl, sleep: noSleep });
    expect(res.channelsScanned).toBe(0);
    expect(res.categoriesSkipped).toBe(1);
    expect(res.result.summary.messages).toBe(0);
    expect(res.result.snapshot.targets).toHaveLength(0);
  });

  it('rejects a non-snowflake guild id up front', async () => {
    const fetchImpl = vi.fn<FetchFn>();
    await expect(
      runDiscordGuildImport({ token: 't', guildId: 'not-an-id', fetchImpl, sleep: noSleep }),
    ).rejects.toMatchObject({ kind: 'network' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never leaks the bot token into the produced guild snapshot', async () => {
    const token = 'MTA_guild_secret.XYZ';
    const fetchImpl = makeGuildFetch({
      channels: [{ id: '10', name: 'general', type: 0, position: 0 }],
      messages: { '10': [[restMsg('1')]] },
      pins: { '10': [{ pinned_at: '2024-01-01T00:00:00.000Z', message: restMsg('2', { content: 'pinned' }) }] },
    });
    const res = await runDiscordGuildImport({ token, guildId: '9', fetchImpl, sleep: noSleep });
    const json = JSON.stringify(res.result.snapshot);
    expect(json).not.toContain(token);
    expect(json).not.toContain('Bot ');
  });
});
