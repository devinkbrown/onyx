// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CHANNEL_FOLDERS,
  parseChannelFolders,
} from './channelFoldersPersistence';

describe('channel-folder persistence boundary', () => {
  it('returns fresh defaults for missing, malformed, and wrong root shapes', () => {
    for (const raw of [null, '', '{', '{}', 'null', '"folders"', '7', '[]']) {
      const folders = parseChannelFolders(raw);
      expect(folders).toEqual(DEFAULT_CHANNEL_FOLDERS);
      expect(folders).not.toBe(DEFAULT_CHANNEL_FOLDERS);
      expect(folders[0]?.channels).not.toBe(DEFAULT_CHANNEL_FOLDERS[0]?.channels);
    }
  });

  it('preserves valid folders and normalizes collapsed to an explicit boolean', () => {
    expect(parseChannelFolders(JSON.stringify([
      { id: 'default', name: 'TEXT CHANNELS', channels: ['#root'], collapsed: true },
      { id: 'work', name: 'Work', channels: ['#ops'], collapsed: 'yes' },
    ]))).toEqual([
      { id: 'default', name: 'TEXT CHANNELS', channels: ['#root'], collapsed: true },
      { id: 'work', name: 'Work', channels: ['#ops'], collapsed: false },
    ]);
  });

  it('drops malformed folders and prevents duplicate ids or channel assignments', () => {
    expect(parseChannelFolders(JSON.stringify([
      { id: 'one', name: 'One', channels: ['#Root', '#one'], collapsed: false },
      { id: 'one', name: 'Duplicate id', channels: ['#dup'], collapsed: false },
      { id: 'two', name: 'Two', channels: ['#root', '#two', 7], collapsed: false },
      { id: '', name: 'No id', channels: [], collapsed: false },
      { id: 'empty-name', name: '   ', channels: [], collapsed: false },
      { id: 'not-array', name: 'Bad', channels: {}, collapsed: false },
    ]))).toEqual([
      { id: 'one', name: 'One', channels: ['#Root', '#one'], collapsed: false },
      { id: 'two', name: 'Two', channels: ['#two'], collapsed: false },
    ]);
  });

  it('bounds folder, channel, field, and serialized sizes', () => {
    const manyFolders = Array.from({ length: 40 }, (_, index) => ({
      id: `folder-${index}`,
      name: `Folder ${index}`,
      channels: Array.from({ length: 300 }, (_unused, channel) => `#room-${index}-${channel}`),
      collapsed: false,
    }));
    const folders = parseChannelFolders(JSON.stringify(manyFolders));
    expect(folders).toHaveLength(32);
    expect(folders[0]?.channels).toHaveLength(256);
    expect(parseChannelFolders(JSON.stringify([
      { id: 'x'.repeat(129), name: 'long id', channels: [], collapsed: false },
      { id: 'long-name', name: 'x'.repeat(129), channels: [], collapsed: false },
      { id: 'valid', name: 'Valid', channels: ['x'.repeat(257), '#ok'], collapsed: false },
    ]))).toEqual([{ id: 'valid', name: 'Valid', channels: ['#ok'], collapsed: false }]);
    expect(parseChannelFolders(`"${'x'.repeat(512 * 1024)}"`)).toEqual(DEFAULT_CHANNEL_FOLDERS);
  });
});
