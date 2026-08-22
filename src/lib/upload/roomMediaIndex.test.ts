// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import { ENVELOPE_PREFIX } from '@/lib/e2ee/dmCipher';
import type { ChatMessage } from '@/lib/irc/types';
import { fetchLinkPreview } from '@/lib/preview/linkPreview';
import {
  ROOM_MEDIA_EMPTY,
  indexRoomMedia,
  itemsForFilter,
  linkDomain,
  mergeRoomHistory,
  readableMessageBody,
} from './roomMediaIndex';

vi.mock('@/lib/preview/linkPreview', () => ({
  fetchLinkPreview: vi.fn(() => {
    throw new Error('Links tab must not fetch dest previews');
  }),
}));

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides.id ?? 'm1',
    time: overrides.time ?? new Date('2026-08-22T12:00:00Z'),
    from: overrides.from ?? 'ada',
    text: overrides.text ?? '',
    type: overrides.type ?? 'msg',
    target: overrides.target ?? '#harbour',
    ...overrides,
  };
}

describe('roomMediaIndex', () => {
  it('filters this-device history into Pictures, Files, and Links', () => {
    const index = indexRoomMedia([
      message({
        id: 'pic',
        text: 'dusk\n[file: harbour.png] 120 KB https://cdn.example/harbour.png',
      }),
      message({
        id: 'doc',
        text: '[file: notes.pdf] 12.0 KB https://cdn.example/notes.pdf',
      }),
      message({
        id: 'url',
        text: 'see https://news.example/story',
      }),
      message({
        id: 'join',
        type: 'join',
        text: 'ada joined',
      }),
    ]);

    expect(index.pictures).toEqual([
      expect.objectContaining({
        kind: 'picture',
        href: 'https://cdn.example/harbour.png',
        name: 'harbour.png',
        sizeLabel: '120 KB',
        messageId: 'pic',
      }),
    ]);
    expect(index.files).toEqual([
      expect.objectContaining({
        kind: 'file',
        href: 'https://cdn.example/notes.pdf',
        name: 'notes.pdf',
        messageId: 'doc',
      }),
    ]);
    expect(index.links).toEqual([
      expect.objectContaining({
        kind: 'link',
        href: 'https://news.example/story',
        domain: 'news.example',
        messageId: 'url',
      }),
    ]);
    expect(itemsForFilter(index, 'pictures')).toHaveLength(1);
    expect(itemsForFilter(index, 'files')).toHaveLength(1);
    expect(itemsForFilter(index, 'links')).toHaveLength(1);
    expect(ROOM_MEDIA_EMPTY.pictures).toMatch(/on this device/i);
    expect(ROOM_MEDIA_EMPTY.pictures.split('.').filter(Boolean)).toHaveLength(1);
  });

  it('shows the real domain and never unfurls or fetches dest og:image', () => {
    const index = indexRoomMedia([
      message({ text: 'https://www.example.com:8443/path?q=1' }),
    ]);
    expect(index.links[0]?.domain).toBe('www.example.com');
    expect(linkDomain('https://cdn.example/a.png')).toBe('cdn.example');
    expect(fetchLinkPreview).not.toHaveBeenCalled();
  });

  it('does not index locked E2EE bodies or ciphertext as links', () => {
    const locked = message({
      id: 'locked',
      encrypted: true,
      text: `${ENVELOPE_PREFIX}not-a-url`,
    });
    expect(readableMessageBody(locked)).toBeNull();
    expect(indexRoomMedia([locked]).links).toEqual([]);

    const opened = message({
      id: 'open',
      encrypted: true,
      text: `${ENVELOPE_PREFIX}cipher`,
      plaintext: 'https://friends.example/note',
    });
    expect(indexRoomMedia([opened]).links[0]?.domain).toBe('friends.example');
  });

  it('lets live transcript win over vault rows with the same id', () => {
    const vault = message({ id: 'same', text: 'https://old.example' });
    const live = message({
      id: 'same',
      text: 'https://new.example',
      plaintext: 'https://new.example',
    });
    const merged = mergeRoomHistory([live], [vault]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe('https://new.example');
  });
});
