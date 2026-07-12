// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * DiscordBotImportControls.test.tsx — integration tests for the bot-token
 * Discord importer UI: enter token + channel id → fetch over the (stubbed)
 * same-origin proxy → preview → confirm → merged into the vault. Also pins the
 * two load-bearing contracts: the MESSAGE-CONTENT-intent failure surfaces
 * loudly, and the token is zeroed from the input at end-of-run.
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

async function enterAndFetch(token: string, channel: string): Promise<void> {
  fireEvent.input(screen.getByLabelText('Bot token'), { target: { value: token } });
  fireEvent.input(screen.getByLabelText('Channel id'), { target: { value: channel } });
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
  it('fetches a channel over the proxy, previews, then merges into the vault', async () => {
    const fetchMock = vi.fn<FetchFn>(async () => fakeRes(200, [restMsg('200', 'hello'), restMsg('201', 'world')]));
    vi.stubGlobal('fetch', fetchMock);

    render(() => <DiscordBotImportControls />);
    await enterAndFetch('super-secret-token', '100');

    await screen.findByText(/Ready to import 2 messages/);
    // The client hit the same-origin proxy with the Bot token.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/discord-import/channels/100/messages?limit=100');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bot super-secret-token');

    fireEvent.click(screen.getByRole('button', { name: 'Import into vault' }));
    await screen.findByText(/Imported 2 messages into 1 channel/);
    const stored = await loadRecent('#100');
    expect(stored.map((m) => m.text)).toEqual(['hello', 'world']);
  });

  it('fails loudly with the exact MESSAGE CONTENT INTENT fix when content is stripped', async () => {
    const stripped = Array.from({ length: 3 }, (_, i) => ({
      id: String(300 - i),
      type: 0,
      timestamp: '2025-06-01T10:00:00.000Z',
      content: '',
      attachments: [],
      embeds: [],
      author: { username: 'alice' },
    }));
    vi.stubGlobal('fetch', vi.fn(async () => fakeRes(200, stripped)));

    render(() => <DiscordBotImportControls />);
    await enterAndFetch('tok', '100');

    await screen.findByText(/MESSAGE CONTENT INTENT/);
    expect(screen.queryByRole('button', { name: 'Import into vault' })).toBeNull();
  });

  it('zeroes the bot token from the input at end-of-run (token contract)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeRes(200, [restMsg('200', 'hi')])));

    render(() => <DiscordBotImportControls />);
    const tokenInput = screen.getByLabelText('Bot token') as HTMLInputElement;
    await enterAndFetch('leak-me-not', '100');

    await screen.findByText(/Ready to import/);
    // The signal was cleared in the finally block, emptying the bound input.
    expect(tokenInput.value).toBe('');
  });

  it('rejects a non-numeric channel id without any fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(() => <DiscordBotImportControls />);
    await enterAndFetch('tok', 'not-a-snowflake');

    await screen.findByText(/turn on Developer Mode/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
