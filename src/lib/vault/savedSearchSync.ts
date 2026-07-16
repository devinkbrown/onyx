// SPDX-License-Identifier: AGPL-3.0-or-later

export type SavedSearchSyncReason = 'save' | 'delete' | 'clear' | 'import';

export interface SavedSearchSyncChange {
  revision: number;
  reason: SavedSearchSyncReason;
  count: number;
}

interface SavedSearchSyncMessage extends SavedSearchSyncChange {
  version: 1;
  source: string;
}

interface BroadcastChannelAdapter {
  postMessage(message: unknown): void;
  close(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

interface StorageAdapter {
  setItem(key: string, value: string): void;
}

interface StorageEventTargetAdapter {
  addEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
  removeEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
}

export interface SavedSearchSyncOptions {
  sourceId?: string;
  createBroadcastChannel?: (name: string) => BroadcastChannelAdapter | null;
  storage?: StorageAdapter | null;
  storageEventTarget?: StorageEventTargetAdapter | null;
}

export interface SavedSearchSync {
  publish(change: SavedSearchSyncChange): void;
  close(): void;
}

export const SAVED_SEARCH_SYNC_CHANNEL = 'onyx:saved-searches:v1';
export const SAVED_SEARCH_SYNC_STORAGE_KEY = 'onyx:saved-searches:sync:v1';
const MAX_SYNC_MESSAGE_LENGTH = 512;
const MAX_TRACKED_SOURCES = 32;
const MAX_SYNC_COUNT = 50;
const SOURCE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MESSAGE_KEYS = ['count', 'reason', 'revision', 'source', 'version'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReason(value: unknown): value is SavedSearchSyncReason {
  return value === 'save' || value === 'delete' || value === 'clear' || value === 'import';
}

function parseMessage(value: unknown): SavedSearchSyncMessage | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== MESSAGE_KEYS.length || keys.some((key, index) => key !== MESSAGE_KEYS[index])) {
    return null;
  }
  if (value.version !== 1 || typeof value.source !== 'string' || !SOURCE_RE.test(value.source)) {
    return null;
  }
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) <= 0) return null;
  if (!isReason(value.reason)) return null;
  if (!Number.isSafeInteger(value.count) || (value.count as number) < 0 || (value.count as number) > MAX_SYNC_COUNT) {
    return null;
  }
  return value as unknown as SavedSearchSyncMessage;
}

function sourceId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the non-cryptographic tab-identity fallback. It is only
    // an echo-suppression token, never a credential or authorization boundary.
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function defaultBroadcastChannel(name: string): BroadcastChannelAdapter | null {
  try {
    if (typeof BroadcastChannel !== 'function') return null;
    return new BroadcastChannel(name) as BroadcastChannelAdapter;
  } catch {
    return null;
  }
}

function defaultStorage(): StorageAdapter | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function defaultStorageEventTarget(): StorageEventTargetAdapter | null {
  return typeof window !== 'undefined'
    ? window as unknown as StorageEventTargetAdapter
    : null;
}

/**
 * Metadata-only invalidation transport. BroadcastChannel and `storage` events
 * are both same-origin browser primitives; consumers reread IndexedDB after a
 * valid message, so query text and search results never cross this channel.
 */
export function createSavedSearchSync(
  onRemoteChange: (change: SavedSearchSyncChange) => void,
  options: SavedSearchSyncOptions = {},
): SavedSearchSync {
  const ownSource = options.sourceId && SOURCE_RE.test(options.sourceId)
    ? options.sourceId
    : sourceId();
  const createChannel = options.createBroadcastChannel ?? defaultBroadcastChannel;
  let channel: BroadcastChannelAdapter | null = null;
  try {
    channel = createChannel(SAVED_SEARCH_SYNC_CHANNEL);
  } catch {
    // Constructor support can be advertised while blocked by browser policy.
  }
  const storage = channel
    ? null
    : options.storage === undefined ? defaultStorage() : options.storage;
  const storageEventTarget = channel
    ? null
    : options.storageEventTarget === undefined
      ? defaultStorageEventTarget()
      : options.storageEventTarget;
  const lastRevisionBySource = new Map<string, number>();
  let closed = false;

  const receive = (raw: unknown): void => {
    if (closed) return;
    let message: SavedSearchSyncMessage | null;
    try {
      message = parseMessage(raw);
    } catch {
      return;
    }
    if (!message || message.source === ownSource) return;
    const previous = lastRevisionBySource.get(message.source) ?? 0;
    if (message.revision <= previous) return;

    // LRU-bound the per-tab replay filter so hostile unique-source floods can
    // never grow module memory without limit.
    lastRevisionBySource.delete(message.source);
    lastRevisionBySource.set(message.source, message.revision);
    if (lastRevisionBySource.size > MAX_TRACKED_SOURCES) {
      const oldest = lastRevisionBySource.keys().next().value as string | undefined;
      if (oldest) lastRevisionBySource.delete(oldest);
    }

    try {
      onRemoteChange({
        revision: message.revision,
        reason: message.reason,
        count: message.count,
      });
    } catch {
      // A subscriber cannot poison the cross-tab transport.
    }
  };

  const onMessage = (event: MessageEvent<unknown>): void => receive(event.data);
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== SAVED_SEARCH_SYNC_STORAGE_KEY || !event.newValue) return;
    if (event.newValue.length > MAX_SYNC_MESSAGE_LENGTH) return;
    try {
      receive(JSON.parse(event.newValue));
    } catch {
      // Ignore malformed or partially-written fallback metadata.
    }
  };

  channel?.addEventListener('message', onMessage);
  storageEventTarget?.addEventListener('storage', onStorage);

  return {
    publish(change): void {
      if (closed) return;
      const message = parseMessage({
        version: 1,
        source: ownSource,
        revision: change.revision,
        reason: change.reason,
        count: change.count,
      });
      if (!message) return;
      if (channel) {
        try {
          channel.postMessage(message);
        } catch {
          // Best-effort invalidation; the verified IndexedDB commit still wins.
        }
        return;
      }
      if (!storage) return;
      try {
        storage.setItem(SAVED_SEARCH_SYNC_STORAGE_KEY, JSON.stringify(message));
      } catch {
        // Private mode/quota can disable localStorage; same-tab listeners remain.
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      channel?.removeEventListener('message', onMessage);
      storageEventTarget?.removeEventListener('storage', onStorage);
      try {
        channel?.close();
      } catch {
        // Closing is best-effort during module/test teardown.
      }
      lastRevisionBySource.clear();
    },
  };
}
