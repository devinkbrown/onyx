// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChatMessage } from '@/lib/irc/types';
import { resetPreferences, setPreference } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import { RoomMediaIndex } from './RoomMediaIndex';

const loadRecentMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/vault/historyVault', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/vault/historyVault')>()),
  loadRecentWithStatus: loadRecentMock,
}));

const initialState = store.getInitialState();

function chat(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    time: new Date('2026-08-22T12:00:00Z'),
    from: 'ada',
    text: '',
    type: 'msg',
    target: '#harbour',
    ...overrides,
  };
}

function seedRoom(messages: ChatMessage[]): void {
  const channel: Channel = {
    name: '#harbour',
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages,
  };
  store.setState({
    ...initialState,
    activeView: { kind: 'channel', channel: '#harbour' },
    channels: new Map([['#harbour', channel]]),
  });
}

describe('RoomMediaIndex', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    resetPreferences();
    loadRecentMock.mockReset();
    loadRecentMock.mockResolvedValue({ messages: [], status: 'complete' });
  });

  afterEach(() => {
    cleanup();
    resetPreferences();
    vi.restoreAllMocks();
  });

  it('filters this-device history into Pictures, Files, and Links', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    seedRoom([
      chat({
        id: 'pic',
        text: '[file: harbour.png] 120 KB https://cdn.example/harbour.png',
      }),
      chat({
        id: 'doc',
        text: '[file: notes.pdf] 12.0 KB https://cdn.example/notes.pdf',
      }),
      chat({
        id: 'url',
        text: 'read https://news.example/story',
      }),
    ]);

    render(() => (
      <RoomMediaIndex target="#harbour" open={true} onOpenChange={() => {}} />
    ));

    expect(screen.getByRole('dialog', { name: 'Pictures, files, and links' })).toBeInTheDocument();
    expect(screen.getByTestId('room-media-index-context')).toHaveTextContent('Conversation media #harbour');
    expect(screen.getByLabelText(/Conversation media index provenance: This device/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pictures' })).toHaveAttribute('aria-selected', 'true');
    const item = screen.getByRole('button', { name: 'Load external picture from cdn.example' }).closest('li')!;
    expect(item.querySelector('img')).toBeNull();
    expect(item.querySelector('[src]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Jump to picture harbour.png' })).toBeInTheDocument();
    expect(item.querySelector('button')?.parentElement?.closest('button')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Load external picture from cdn.example' }));
    const picture = item.querySelector('img')!;
    expect(picture).toHaveAttribute('src', 'https://cdn.example/harbour.png');
    expect(picture).toHaveAttribute('referrerpolicy', 'no-referrer');
    fireEvent.error(picture);
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/ledger/i)).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(screen.getByRole('button', { name: 'Jump to file notes.pdf' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Links' }));
    expect(screen.getByRole('link', { name: /news\.example/ })).toHaveAttribute(
      'href',
      'https://news.example/story',
    );
    expect(screen.getByText('news.example')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps same-origin pictures automatic while keeping Jump outside the preview control', () => {
    const href = new URL('/uploads/harbour.png', window.location.href).toString();
    seedRoom([chat({ id: 'local-picture', text: `[file: harbour.png] 120 KB ${href}` })]);

    render(() => <RoomMediaIndex target="#harbour" open={true} onOpenChange={() => {}} />);

    const item = screen.getByRole('button', { name: 'Jump to picture harbour.png' }).closest('li')!;
    expect(item.querySelector('img')).toHaveAttribute('src', href);
    expect(item.querySelector('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.queryByRole('button', { name: /Load external picture/i })).toBeNull();
    expect(item.querySelectorAll('button')).toHaveLength(1);
  });

  it.each([
    ['disabled link previews', 'https://cdn.example.test/disabled.png', () => setPreference('linkPreviews', false)],
    ['blocked hosts', 'https://cdn.example.test/blocked.png', () => setPreference('blockedHosts', ['cdn.example.test'])],
    ['http disallowed by policy', 'http://cdn.example.test/insecure.png', () => setPreference('httpsOnly', true)],
  ] as const)('keeps %s pictures inert without a resource or consent control', (_caseName, href, configure) => {
    configure();
    seedRoom([chat({ id: 'policy-picture', text: href })]);

    render(() => <RoomMediaIndex target="#harbour" open={true} onOpenChange={() => {}} />);

    const item = screen.getByRole('button', { name: 'Jump to picture Picture' }).closest('li')!;
    expect(item.querySelector('img')).toBeNull();
    expect(item.querySelector('[src]')).toBeNull();
    expect(item.querySelector('.room-media-index-picture-load')).toBeNull();
    expect(screen.getByRole('button', { name: 'Jump to picture Picture' })).toBeInTheDocument();
  });

  it('uses tab-scoped empty copy and does not paint a ledger', async () => {
    seedRoom([]);
    render(() => (
      <RoomMediaIndex target="#harbour" open={true} onOpenChange={() => {}} />
    ));
    expect(await screen.findByText('No pictures from this conversation are on this device.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(await screen.findByText('No files from this conversation are on this device.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Links' }));
    expect(await screen.findByText('No links from this conversation are on this device.')).toBeInTheDocument();
    expect(screen.queryByText(/ledger/i)).toBeNull();
  });

  it('shows loading copy instead of an empty tab while device history is pending', async () => {
    let resolveLoad: (messages: ChatMessage[]) => void = () => {};
    loadRecentMock.mockImplementation(() => new Promise((resolve) => {
      resolveLoad = (messages) => resolve({ messages, status: 'complete' });
    }));

    seedRoom([]);
    render(() => (
      <RoomMediaIndex target="#harbour" open={true} onOpenChange={() => {}} />
    ));

    expect(await screen.findByRole('status')).toHaveTextContent('Loading media from this device…');
    expect(screen.queryByText('No pictures from this conversation are on this device.')).toBeNull();

    resolveLoad([]);
    expect(await screen.findByText('No pictures from this conversation are on this device.')).toBeInTheDocument();
  });

  it('shows a retry action after device history fails and refetches', async () => {
    let attempt = 0;
    loadRecentMock.mockImplementation(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error('vault unavailable'))
        : Promise.resolve({ messages: [chat({
          id: 'retry-picture',
          text: '[file: recovered.png] 12 KB https://cdn.example/recovered.png',
        })], status: 'complete' as const });
    });

    seedRoom([]);
    render(() => (
      <RoomMediaIndex target="#harbour" open={true} onOpenChange={() => {}} />
    ));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Device history is unavailable. Showing media from the live conversation and any history recovered.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(loadRecentMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: 'Jump to picture recovered.png' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps live media visible when device history fails', async () => {
    loadRecentMock.mockRejectedValue(new Error('vault unavailable'));
    seedRoom([chat({
      id: 'live-picture',
      text: '[file: live.png] 12 KB https://cdn.example/live.png',
    })]);

    render(() => (
      <RoomMediaIndex target="#harbour" open={true} onOpenChange={() => {}} />
    ));

    expect(await screen.findByRole('button', { name: 'Jump to picture live.png' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('live conversation and any history recovered');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('explains partial recovery while keeping recovered media usable', async () => {
    loadRecentMock.mockResolvedValue({
      messages: [chat({ id: 'partial', text: 'https://recovered.example/story' })],
      status: 'partial',
    });
    seedRoom([]);
    render(() => <RoomMediaIndex target="#harbour" open={true} onOpenChange={() => {}} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('history recovered so far');
    fireEvent.click(screen.getByRole('tab', { name: 'Links' }));
    expect(await screen.findByRole('link', { name: /recovered\.example/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('keeps long names and URLs discoverable beyond visual truncation', async () => {
    const longName = 'a-very-long-filename-that-should-remain-readable-to-assistive-technology.pdf';
    const longUrl = 'https://example.com/a/path/with/a/very/long/identifier/that/is-truncated-visually';
    seedRoom([
      chat({ id: 'long-file', text: `[file: ${longName}] 2 KB https://cdn.example/${longName}` }),
      chat({ id: 'long-link', text: longUrl }),
    ]);
    render(() => <RoomMediaIndex target="#harbour" open={true} onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(await screen.findByTitle(longName)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Links' }));
    const link = await screen.findByRole('link', { name: /example\.com/ });
    expect(link).toHaveAttribute('title', longUrl);
  });

  it('does not flash the previous room while the target history reloads', async () => {
    let resolveNext: (messages: ChatMessage[]) => void = () => {};
    loadRecentMock
      .mockResolvedValueOnce({ messages: [chat({ id: 'old-history', text: 'https://old.example/item' })], status: 'complete' as const })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNext = () => resolve({ messages: [], status: 'complete' }); }));
    const [target, setTarget] = createSignal('#harbour');

    render(() => (
      <RoomMediaIndex target={target()} open={true} onOpenChange={() => {}} />
    ));
    fireEvent.click(screen.getByRole('tab', { name: 'Links' }));
    expect(await screen.findByRole('link', { name: /old\.example/ })).toBeInTheDocument();

    setTarget('#new-room');
    expect(screen.queryByRole('link', { name: /old\.example/ })).toBeNull();
    resolveNext([]);
    expect(await screen.findByText('No pictures from this conversation are on this device.')).toBeInTheDocument();
  });

  it('keeps the selected tab when retry recovers that tab’s device history', async () => {
    let attempt = 0;
    loadRecentMock.mockImplementation(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error('vault unavailable'))
        : Promise.resolve({ messages: [chat({ id: 'retry-link', text: 'read https://recovered.example/story' })], status: 'complete' as const });
    });

    seedRoom([]);
    render(() => (
      <RoomMediaIndex target="#harbour" open={true} onOpenChange={() => {}} />
    ));

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('tab', { name: 'Links' }));
    expect(screen.getByRole('tab', { name: 'Links' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('link', { name: /recovered\.example/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Links' })).toHaveAttribute('aria-selected', 'true');
  });

  it('does not paint stale owner history after the device-memory owner changes', async () => {
    let resolveAlice: (result: { messages: ChatMessage[]; status: 'complete' }) => void = () => {};
    const aliceRead = new Promise<{ messages: ChatMessage[]; status: 'complete' }>((resolve) => {
      resolveAlice = resolve;
    });
    loadRecentMock.mockImplementation((_target: string, _limit: number, owner?: { identity: string }) => (
      owner?.identity === 'alice'
        ? aliceRead
        : Promise.resolve({
          messages: [chat({ id: 'bob-picture', text: '[file: bob.png] 1 KB https://bob.example/picture.png' })],
          status: 'complete' as const,
        })
    ));
    seedRoom([]);
    store.setState({
      ourNick: 'alice',
      server: {
        id: 'room-media-alice',
        name: 'Onyx',
        network: 'Onyx',
        url: 'wss://room-media-alice.example',
        icon: '',
        nick: 'alice',
        account: 'alice',
        connected: true,
      },
    });

    render(() => <RoomMediaIndex target="#harbour" open={true} onOpenChange={() => {}} />);
    expect(loadRecentMock).toHaveBeenCalledWith(
      '#harbour',
      expect.any(Number),
      { serverUrl: 'wss://room-media-alice.example', identity: 'alice' },
    );

    store.setState({
      ourNick: 'bob',
      server: {
        id: 'room-media-bob',
        name: 'Onyx',
        network: 'Onyx',
        url: 'wss://room-media-bob.example',
        icon: '',
        nick: 'bob',
        account: 'bob',
        connected: true,
      },
    });

    expect(await screen.findByRole('button', { name: 'Jump to picture bob.png' })).toBeInTheDocument();
    expect(loadRecentMock).toHaveBeenLastCalledWith(
      '#harbour',
      expect.any(Number),
      { serverUrl: 'wss://room-media-bob.example', identity: 'bob' },
    );
    resolveAlice({
      messages: [chat({ id: 'alice-picture', text: '[file: alice.png] 1 KB https://alice.example/picture.png' })],
      status: 'complete',
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Jump to picture alice.png' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Jump to picture bob.png' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Load external picture from alice.example' })).toBeNull();
    });
  });

  it('does not import unfurl or gallery write APIs', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sources = [
      readFileSync(join(here, 'RoomMediaIndex.tsx'), 'utf8'),
      readFileSync(join(here, '../lib/upload/roomMediaIndex.ts'), 'utf8'),
    ].join('\n');
    expect(sources).not.toMatch(
      /from\s+['"][^'"]*saveMedia['"]|fetchLinkPreview|saveMediaFromUserGesture/iu,
    );
  });
});
