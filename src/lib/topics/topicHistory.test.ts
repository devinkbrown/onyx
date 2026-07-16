// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  clearDeviceTopicHistory,
  loadTopicHistory,
  MAX_TOPIC_HISTORY_CHANNELS,
  MAX_TOPIC_HISTORY_TEXT_LENGTH,
  recordTopicHistory,
  saveTopicHistory,
  TOPIC_HISTORY_STORAGE_KEY,
} from './topicHistory';

const alice = { serverUrl: 'wss://topics.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://topics.example/ws', identity: 'bob' } as const;

describe('account-scoped channel topic history', () => {
  beforeEach(() => localStorage.clear());

  it('isolates owners and purges unsafe ownerless topic text', () => {
    localStorage.setItem(TOPIC_HISTORY_STORAGE_KEY, JSON.stringify({ '#legacy': ['Legacy secret'] }));
    expect(saveTopicHistory({ '#alice': ['Alice secret'] }, alice)).toBe(true);
    expect(saveTopicHistory({ '#bob': ['Bob secret'] }, bob)).toBe(true);

    expect(loadTopicHistory(alice)).toEqual({ '#alice': ['Alice secret'] });
    expect(loadTopicHistory(bob)).toEqual({ '#bob': ['Bob secret'] });
    expect(localStorage.getItem(TOPIC_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it('normalizes, deduplicates, and bounds channel and topic data', () => {
    let history = {};
    history = recordTopicHistory(history, ' #Private ', ' First topic ');
    history = recordTopicHistory(history, '#private', 'First topic');
    history = recordTopicHistory(history, '#private', 'x'.repeat(MAX_TOPIC_HISTORY_TEXT_LENGTH + 20));
    history = recordTopicHistory(history, 'bad room', 'rejected');
    for (let index = 0; index < MAX_TOPIC_HISTORY_CHANNELS + 20; index += 1) {
      history = recordTopicHistory(history, `#room-${index}`, `topic ${index}`);
    }

    expect(saveTopicHistory(history, alice)).toBe(true);
    const loaded = loadTopicHistory(alice);
    expect(Object.keys(loaded)).toHaveLength(MAX_TOPIC_HISTORY_CHANNELS);
    expect(loaded['#private']?.[0]).toHaveLength(MAX_TOPIC_HISTORY_TEXT_LENGTH);
    expect(loaded['#private']?.filter((topic) => topic === 'First topic')).toHaveLength(1);
    expect(loaded['bad room']).toBeUndefined();
  });

  it('clears legacy and every owner namespace for whole-device history removal', () => {
    saveTopicHistory({ '#alice': ['Alice secret'] }, alice);
    saveTopicHistory({ '#bob': ['Bob secret'] }, bob);
    localStorage.setItem(TOPIC_HISTORY_STORAGE_KEY, JSON.stringify({ '#legacy': ['Legacy'] }));

    expect(clearDeviceTopicHistory()).toBe(true);
    expect(localStorage.getItem(deviceMemoryStorageKey(TOPIC_HISTORY_STORAGE_KEY, alice)!)).toBeNull();
    expect(localStorage.getItem(deviceMemoryStorageKey(TOPIC_HISTORY_STORAGE_KEY, bob)!)).toBeNull();
    expect(localStorage.getItem(TOPIC_HISTORY_STORAGE_KEY)).toBeNull();
  });
});
