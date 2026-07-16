// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import {
  SAVED_SEARCH_SYNC_CHANNEL,
  SAVED_SEARCH_SYNC_STORAGE_KEY,
  createSavedSearchSync,
  type SavedSearchSyncChange,
} from './savedSearchSync';

type MessageListener = (event: MessageEvent<unknown>) => void;

class FakeBroadcastChannel {
  readonly listeners = new Set<MessageListener>();
  closed = false;

  constructor(
    readonly name: string,
    private readonly hub: FakeBroadcastHub,
  ) {}

  addEventListener(_type: 'message', listener: MessageListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: MessageListener): void {
    this.listeners.delete(listener);
  }

  postMessage(message: unknown): void {
    this.hub.broadcast(this, message);
  }

  emit(message: unknown): void {
    for (const listener of this.listeners) listener({ data: message } as MessageEvent<unknown>);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }
}

class FakeBroadcastHub {
  readonly channels: FakeBroadcastChannel[] = [];
  readonly messages: unknown[] = [];

  create = (name: string): FakeBroadcastChannel => {
    const channel = new FakeBroadcastChannel(name, this);
    this.channels.push(channel);
    return channel;
  };

  broadcast(sender: FakeBroadcastChannel, message: unknown): void {
    this.messages.push(message);
    for (const channel of this.channels) {
      if (channel !== sender && !channel.closed && channel.name === sender.name) channel.emit(message);
    }
  }
}

type StorageListener = (event: StorageEvent) => void;

class FakeStorageTarget {
  readonly listeners = new Set<StorageListener>();

  addEventListener(_type: 'storage', listener: StorageListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'storage', listener: StorageListener): void {
    this.listeners.delete(listener);
  }

  emit(key: string, newValue: string): void {
    for (const listener of this.listeners) listener({ key, newValue } as StorageEvent);
  }
}

class FakeStorageHub {
  readonly tabs: Array<{ target: FakeStorageTarget; storage: { setItem(key: string, value: string): void } }> = [];

  createTab() {
    const target = new FakeStorageTarget();
    const tab = {
      target,
      storage: {
        setItem: (key: string, value: string): void => {
          for (const peer of this.tabs) {
            if (peer !== tab) peer.target.emit(key, value);
          }
        },
      },
    };
    this.tabs.push(tab);
    return tab;
  }
}

describe('saved-search cross-tab sync', () => {
  it('invalidates a second logical tab with metadata only and no echo loop', () => {
    const hub = new FakeBroadcastHub();
    const tabAChanges: SavedSearchSyncChange[] = [];
    const tabBChanges: SavedSearchSyncChange[] = [];
    const tabA = createSavedSearchSync((change) => tabAChanges.push(change), {
      sourceId: 'tab-alpha',
      createBroadcastChannel: hub.create,
      storage: null,
      storageEventTarget: null,
    });
    const tabB = createSavedSearchSync((change) => tabBChanges.push(change), {
      sourceId: 'tab-bravo',
      createBroadcastChannel: hub.create,
      storage: null,
      storageEventTarget: null,
    });

    tabA.publish({ revision: 1, reason: 'save', count: 1 });

    expect(hub.channels.map((channel) => channel.name)).toEqual([
      SAVED_SEARCH_SYNC_CHANNEL,
      SAVED_SEARCH_SYNC_CHANNEL,
    ]);
    expect(tabAChanges).toEqual([]);
    expect(tabBChanges).toEqual([{ revision: 1, reason: 'save', count: 1 }]);
    expect(hub.messages).toHaveLength(1);
    expect(hub.messages[0]).toEqual({
      version: 1,
      source: 'tab-alpha',
      revision: 1,
      reason: 'save',
      count: 1,
    });
    expect(JSON.stringify(hub.messages[0])).not.toMatch(/query|result|label|search text/i);

    tabB.publish({ revision: 1, reason: 'delete', count: 1 });
    expect(tabAChanges).toEqual([{ revision: 1, reason: 'delete', count: 1 }]);
    expect(hub.messages).toHaveLength(2);

    tabA.close();
    tabB.close();
    expect(hub.channels.every((channel) => channel.closed && channel.listeners.size === 0)).toBe(true);
    tabA.publish({ revision: 2, reason: 'clear', count: 0 });
    expect(hub.messages).toHaveLength(2);
  });

  it('ignores self, stale, replayed, extra-field, and malformed message floods', () => {
    const hub = new FakeBroadcastHub();
    const onRemote = vi.fn();
    const sync = createSavedSearchSync(onRemote, {
      sourceId: 'tab-alpha',
      createBroadcastChannel: hub.create,
      storage: null,
      storageEventTarget: null,
    });
    const channel = hub.channels[0]!;
    const valid = { version: 1, source: 'tab-bravo', revision: 2, reason: 'clear', count: 0 };

    channel.emit({ ...valid, source: 'tab-alpha' });
    channel.emit(valid);
    channel.emit({ ...valid, revision: 1 });
    channel.emit(valid);
    const malformed = [
      null,
      [],
      { ...valid, query: 'must never cross the channel' },
      { ...valid, version: 2 },
      { ...valid, source: 'x' },
      { ...valid, revision: Number.MAX_VALUE },
      { ...valid, reason: 'replace' },
      { ...valid, count: 51 },
    ];
    for (let index = 0; index < 250; index += 1) channel.emit(malformed[index % malformed.length]);

    expect(onRemote).toHaveBeenCalledTimes(1);
    expect(onRemote).toHaveBeenCalledWith({ revision: 2, reason: 'clear', count: 0 });
    sync.close();
  });

  it('falls back to same-origin storage events when BroadcastChannel is unsupported', () => {
    const hub = new FakeStorageHub();
    const adapterA = hub.createTab();
    const adapterB = hub.createTab();
    const tabAChanges: SavedSearchSyncChange[] = [];
    const tabBChanges: SavedSearchSyncChange[] = [];
    const tabA = createSavedSearchSync((change) => tabAChanges.push(change), {
      sourceId: 'tab-alpha',
      createBroadcastChannel: () => null,
      storage: adapterA.storage,
      storageEventTarget: adapterA.target,
    });
    const tabB = createSavedSearchSync((change) => tabBChanges.push(change), {
      sourceId: 'tab-bravo',
      createBroadcastChannel: () => null,
      storage: adapterB.storage,
      storageEventTarget: adapterB.target,
    });

    tabA.publish({ revision: 4, reason: 'import', count: 3 });

    expect(tabAChanges).toEqual([]);
    expect(tabBChanges).toEqual([{ revision: 4, reason: 'import', count: 3 }]);
    adapterB.target.emit(SAVED_SEARCH_SYNC_STORAGE_KEY, 'x'.repeat(513));
    adapterB.target.emit('unrelated-key', JSON.stringify({ version: 1 }));
    expect(tabBChanges).toHaveLength(1);

    tabB.close();
    tabA.publish({ revision: 5, reason: 'clear', count: 0 });
    expect(tabBChanges).toHaveLength(1);
    tabA.close();
  });

  it('remains a safe no-op when both cross-tab APIs are unavailable', () => {
    const sync = createSavedSearchSync(vi.fn(), {
      sourceId: 'tab-alpha',
      createBroadcastChannel: () => null,
      storage: null,
      storageEventTarget: null,
    });

    expect(() => sync.publish({ revision: 1, reason: 'save', count: 1 })).not.toThrow();
    expect(() => sync.close()).not.toThrow();
    expect(() => sync.publish({ revision: 2, reason: 'clear', count: 0 })).not.toThrow();
  });
});
