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
  runDiscordChannelImport,
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
