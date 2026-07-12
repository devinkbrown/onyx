// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * DiscordBotImportControls.test.tsx — integration tests for the bot-token
 * Discord importer UI (Roadmap v1.0 "Torii", full-guild snapshot): enter token +
 * Server ID → enumerate the guild's channels + pull each one's scrollback and
 * pins over the (stubbed) same-origin proxy → preview → confirm → merged into the
 * vault. Also pins the two load-bearing contracts: the MESSAGE-CONTENT-intent
 * failure surfaces loudly, and the token is zeroed from the input at end-of-run.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { DiscordBotImportControls } from './HistoryImportControls';
import { loadRecent, _resetVaultForTests } from '@/lib/vault/historyVault';

/** Typed fetch signature so `mock.calls[i]` carries the [url, init] tuple. */
type FetchFn = (...args: Parameters<typeof fetch>) => Promise<Response>;

function fakeRes(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response;
}

function restMsg(id: string, content: string): Record<string, unknown> {
  return {
    id,
    type: 0,
    // Recent, so it falls inside the control's 365-day import window.
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    content,
    author: { username: 'alice', global_name: 'Alice' },
    attachments: [],
    embeds: [],
  };
}

/**
 * A guild-aware fake fetch: routes the enumeration (channels/roles/emojis) and
 * each channel's messages + pins. `messages` maps channelId → one message page,
 * `pins` maps channelId → pin items ({ pinned_at, message }).
 */
function guildFetch(
  channels: Record<string, unknown>[],
  messages: Record<string, unknown[]>,
  pins: Record<string, unknown[]> = {},
): ReturnType<typeof vi.fn<FetchFn>> {
  return vi.fn<FetchFn>(async (input) => {
    const url = String(input);
    if (url.includes('/guilds/') && url.endsWith('/channels')) return fakeRes(200, channels);
    if (url.includes('/guilds/')) return fakeRes(200, []); // roles + emojis
    const pin = url.match(/channels\/(\d+)\/messages\/pins/);
    if (pin) return fakeRes(200, { items: pins[pin[1]!] ?? [], has_more: false });
    const msg = url.match(/channels\/(\d+)\/messages/);
    if (msg) return fakeRes(200, messages[msg[1]!] ?? []);
    return fakeRes(404, {});
  });
}

async function enterAndFetch(token: string, guild: string): Promise<void> {
  fireEvent.input(screen.getByLabelText('Bot token'), { target: { value: token } });
  fireEvent.input(screen.getByLabelText('Server ID'), { target: { value: guild } });
  fireEvent.click(screen.getByRole('button', { name: 'Fetch history' }));
}

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  _resetVaultForTests();
  cleanup();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DiscordBotImportControls', () => {
  it('walks a guild over the proxy, previews, then merges into the vault', async () => {
    const channels = [{ id: '100', name: 'general', type: 0, position: 0 }];
    const fetchMock = guildFetch(channels, { '100': [restMsg('200', 'hello'), restMsg('201', 'world')] });
    vi.stubGlobal('fetch', fetchMock);

    render(() => <DiscordBotImportControls />);
    await enterAndFetch('super-secret-token', '9');

    await screen.findByText(/Ready to import 2 messages across 1 channel/, undefined, { timeout: 4000 });
    // The first call enumerates the guild's channels over the same-origin proxy.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/discord-import/guilds/9/channels');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bot super-secret-token');

    fireEvent.click(screen.getByRole('button', { name: 'Import into vault' }));
    await screen.findByText(/Imported 2 messages into 1 channel/);
    const stored = await loadRecent('#general');
    expect(stored.map((m) => m.text)).toEqual(['hello', 'world']);
  });

  it('includes a pinned message from the pins endpoint, deduped by id', async () => {
    const channels = [{ id: '100', name: 'general', type: 0, position: 0 }];
    const fetchMock = guildFetch(
      channels,
      { '100': [restMsg('200', 'live')] },
      // One dup of the scrollback (id 200) + one distinct pin (id 50).
      {
        '100': [
          { pinned_at: '2025-06-01T00:00:00.000Z', message: restMsg('200', 'live') },
          { pinned_at: '2025-05-01T00:00:00.000Z', message: restMsg('50', 'a pinned note') },
        ],
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    render(() => <DiscordBotImportControls />);
    await enterAndFetch('tok', '9');

    await screen.findByText(/Ready to import 2 messages across 1 channel/, undefined, { timeout: 4000 });
    await screen.findByText(/1 pinned message included/);
    fireEvent.click(screen.getByRole('button', { name: 'Import into vault' }));
    await screen.findByText(/Imported 2 messages/);
    const stored = await loadRecent('#general');
    expect(stored.map((m) => m.text).sort()).toEqual(['a pinned note', 'live']);
  });

  it('fails loudly with the exact MESSAGE CONTENT INTENT fix when content is stripped', async () => {
    const channels = [{ id: '100', name: 'general', type: 0, position: 0 }];
    const stripped = Array.from({ length: 3 }, (_, i) => ({
      id: String(300 - i),
      type: 0,
      timestamp: '2025-06-01T10:00:00.000Z',
      content: '',
      attachments: [],
      embeds: [],
      author: { username: 'alice' },
    }));
    vi.stubGlobal('fetch', guildFetch(channels, { '100': stripped }));

    render(() => <DiscordBotImportControls />);
    await enterAndFetch('tok', '9');

    await screen.findByText(/MESSAGE CONTENT INTENT/, undefined, { timeout: 4000 });
    expect(screen.queryByRole('button', { name: 'Import into vault' })).toBeNull();
  });

  it('zeroes the bot token from the input at end-of-run (token contract)', async () => {
    const channels = [{ id: '100', name: 'general', type: 0, position: 0 }];
    vi.stubGlobal('fetch', guildFetch(channels, { '100': [restMsg('200', 'hi')] }));

    render(() => <DiscordBotImportControls />);
    const tokenInput = screen.getByLabelText('Bot token') as HTMLInputElement;
    await enterAndFetch('leak-me-not', '9');

    await screen.findByText(/Ready to import/, undefined, { timeout: 4000 });
    // The signal was cleared in the finally block, emptying the bound input.
    expect(tokenInput.value).toBe('');
  });

  it('rejects a non-numeric Server ID without any fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(() => <DiscordBotImportControls />);
    await enterAndFetch('tok', 'not-a-snowflake');

    await screen.findByText(/turn on Developer Mode/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
