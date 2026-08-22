// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChatMessage } from '@/lib/irc/types';
import { store } from '@/lib/store/store';
import { RoomMediaIndex } from './RoomMediaIndex';

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
  });

  afterEach(() => {
    cleanup();
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
    expect(screen.getByRole('tab', { name: 'Pictures' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Jump to picture harbour.png' })).toBeInTheDocument();
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

  it('uses one empty sentence and does not paint a ledger', () => {
    seedRoom([]);
    render(() => (
      <RoomMediaIndex target="#harbour" open={true} onOpenChange={() => {}} />
    ));
    expect(screen.getByText('No pictures from this conversation are on this device.')).toBeInTheDocument();
    expect(screen.queryByText(/ledger/i)).toBeNull();
  });

  it('does not import unfurl or gallery write APIs', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sources = [
      readFileSync(join(here, 'RoomMediaIndex.tsx'), 'utf8'),
      readFileSync(join(here, '../lib/upload/roomMediaIndex.ts'), 'utf8'),
      readFileSync(join(here, '../lib/upload/saveMedia.ts'), 'utf8'),
    ].join('\n');
    expect(sources).not.toMatch(/fetchLinkPreview|linkpreview|og:image|saveToPhotos|MediaStore|gallery/i);
  });
});
