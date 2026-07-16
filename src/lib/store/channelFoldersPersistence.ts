// SPDX-License-Identifier: AGPL-3.0-or-later

export interface PersistedChannelFolder {
  id: string;
  name: string;
  channels: string[];
  collapsed: boolean;
}

export const DEFAULT_CHANNEL_FOLDERS: readonly PersistedChannelFolder[] = Object.freeze([
  Object.freeze({ id: 'default', name: 'TEXT CHANNELS', channels: [], collapsed: false }),
]);

const MAX_STORAGE_LENGTH = 512 * 1024;
const MAX_FOLDERS = 32;
const MAX_FOLDER_ID_LENGTH = 128;
const MAX_FOLDER_NAME_LENGTH = 128;
const MAX_CHANNELS_PER_FOLDER = 256;
const MAX_CHANNEL_LENGTH = 256;

function freshDefaults(): PersistedChannelFolder[] {
  return DEFAULT_CHANNEL_FOLDERS.map((folder) => ({ ...folder, channels: [...folder.channels] }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Restore folders without trusting valid-but-wrong-shape localStorage JSON. */
export function parseChannelFolders(raw: string | null): PersistedChannelFolder[] {
  if (!raw) return freshDefaults();
  if (raw.length > MAX_STORAGE_LENGTH) return freshDefaults();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return freshDefaults();
  }
  if (!Array.isArray(parsed)) return freshDefaults();

  const folders: PersistedChannelFolder[] = [];
  const folderIds = new Set<string>();
  const claimedChannels = new Set<string>();
  for (const value of parsed) {
    if (folders.length >= MAX_FOLDERS) break;
    if (!isRecord(value)) continue;
    const { id, name } = value;
    if (
      typeof id !== 'string'
      || id.length === 0
      || id.length > MAX_FOLDER_ID_LENGTH
      || folderIds.has(id)
      || typeof name !== 'string'
      || name.trim().length === 0
      || name.length > MAX_FOLDER_NAME_LENGTH
      || !Array.isArray(value.channels)
    ) continue;

    const channels: string[] = [];
    for (const channel of value.channels) {
      if (channels.length >= MAX_CHANNELS_PER_FOLDER) break;
      if (typeof channel !== 'string' || channel.length === 0 || channel.length > MAX_CHANNEL_LENGTH) {
        continue;
      }
      const key = channel.toLocaleLowerCase('en');
      if (claimedChannels.has(key)) continue;
      claimedChannels.add(key);
      channels.push(channel);
    }

    folderIds.add(id);
    folders.push({
      id,
      name,
      channels,
      collapsed: value.collapsed === true,
    });
  }

  return folders.length > 0 ? folders : freshDefaults();
}
