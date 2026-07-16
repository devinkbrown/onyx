// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  MAX_TOPIC_READ_ENTRIES,
  MAX_TOPIC_READ_LEDGER_STORAGE_CHARS,
  MAX_TOPIC_READ_MESSAGES,
  MAX_TOPIC_READ_PARSE_ENTRIES,
  TOPIC_READ_LEDGER_KEY,
  clearAllTopicReads,
  clearChannelTopicReads,
  clearDeviceTopicReads,
  countUnreadByTopic,
  markAllTopicsRead,
  markTopicRead,
  mergeTopicReadLedger,
  parseTopicReadLedger,
  projectRoomTopicUnread,
  readTopicReadLedger,
  readTopicReadMarker,
  subscribeTopicReadLedger,
  type TopicReadMessage,
} from './topicReadLedger';

const at = (milliseconds: number): Date => new Date(milliseconds);

const message = (
  id: string,
  topic: string | null,
  milliseconds: number,
  system = false,
): TopicReadMessage & { system: boolean } => ({
  id,
  topic,
  time: at(milliseconds),
  system,
});

describe('topic read ledger', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('isolates Alice and Bob cursors and same-tab publications from legacy state', () => {
    const alice = { serverUrl: 'wss://topics.example/ws', identity: 'alice' } as const;
    const bob = { serverUrl: 'wss://topics.example/ws', identity: 'bob' } as const;
    const aliceListener = vi.fn();
    const bobListener = vi.fn();
    const stopAlice = subscribeTopicReadLedger(aliceListener, alice);
    const stopBob = subscribeTopicReadLedger(bobListener, bob);

    markTopicRead('#secret', 'roadmap', { id: 'legacy', time: at(10) });
    markTopicRead('#secret', 'roadmap', { id: 'alice', time: at(20) }, alice);
    markTopicRead('#secret', 'roadmap', { id: 'bob', time: at(30) }, bob);

    expect(readTopicReadMarker('#secret', 'roadmap', alice)?.lastReadMessageId).toBe('alice');
    expect(readTopicReadMarker('#secret', 'roadmap', bob)?.lastReadMessageId).toBe('bob');
    expect(readTopicReadMarker('#secret', 'roadmap')?.lastReadMessageId).toBe('legacy');
    expect(aliceListener).toHaveBeenCalledTimes(1);
    expect(bobListener).toHaveBeenCalledTimes(1);
    stopAlice();
    stopBob();
  });

  it('lets the whole-device history wipe clear every owner scope and publish each removal', () => {
    const alice = { serverUrl: 'wss://topics.example/ws', identity: 'alice' } as const;
    const bob = { serverUrl: 'wss://topics.example/ws', identity: 'bob' } as const;
    const aliceListener = vi.fn();
    const bobListener = vi.fn();
    const stopAlice = subscribeTopicReadLedger(aliceListener, alice);
    const stopBob = subscribeTopicReadLedger(bobListener, bob);

    markTopicRead('#secret', 'roadmap', { id: 'legacy', time: at(10) });
    markTopicRead('#secret', 'roadmap', { id: 'alice', time: at(20) }, alice);
    markTopicRead('#secret', 'roadmap', { id: 'bob', time: at(30) }, bob);
    localStorage.setItem(`${TOPIC_READ_LEDGER_KEY}:unrelated`, 'keep');
    aliceListener.mockClear();
    bobListener.mockClear();

    expect(clearDeviceTopicReads()).toBe(true);
    expect(readTopicReadLedger()).toEqual([]);
    expect(readTopicReadLedger(alice)).toEqual([]);
    expect(readTopicReadLedger(bob)).toEqual([]);
    expect(localStorage.getItem(`${TOPIC_READ_LEDGER_KEY}:unrelated`)).toBe('keep');
    expect(aliceListener).toHaveBeenCalledWith([]);
    expect(bobListener).toHaveBeenCalledWith([]);
    stopAlice();
    stopBob();
  });

  it('persists only normalized channel/topic read metadata', () => {
    expect(markTopicRead('  #General ', ' Release Train ', {
      id: 'msg-42',
      time: at(1_000),
      text: 'must never be persisted',
      from: 'alice',
    })).toMatchObject({
      channel: '#general',
      topic: 'release train',
      lastReadMessageId: 'msg-42',
      lastReadAt: 1_000,
    });

    expect(JSON.parse(localStorage.getItem(TOPIC_READ_LEDGER_KEY) ?? 'null')).toEqual([{
      channel: '#general',
      topic: 'release train',
      lastReadMessageId: 'msg-42',
      lastReadAt: 1_000,
    }]);
  });

  it('looks up channel and topic case-insensitively', () => {
    markTopicRead('#General', 'RoadMap', { id: 'm1', time: at(100) });

    expect(readTopicReadMarker('#GENERAL', 'roadmap')).toMatchObject({
      channel: '#general',
      topic: 'roadmap',
      lastReadMessageId: 'm1',
    });
  });

  it('rejects malformed storage, invalid fields, extra payloads, and duplicate older entries', () => {
    localStorage.setItem(TOPIC_READ_LEDGER_KEY, JSON.stringify([
      null,
      'entry',
      { channel: '#ok', topic: 'topic', lastReadMessageId: 'old', lastReadAt: 10 },
      { channel: '#OK', topic: 'TOPIC', lastReadMessageId: 'new', lastReadAt: 20, text: 'drop me' },
      { channel: '#bad channel', topic: 'topic', lastReadMessageId: 'm', lastReadAt: 30 },
      { channel: '#ok', topic: 'bad\u0001topic', lastReadMessageId: 'm', lastReadAt: 30 },
      { channel: '#ok', topic: 'topic-2', lastReadMessageId: '', lastReadAt: 30 },
      { channel: '#ok', topic: 'topic-3', lastReadMessageId: 'm', lastReadAt: -1 },
      { channel: '#ok', topic: 'topic-4', lastReadMessageId: 'm', lastReadAt: Number.MAX_VALUE },
    ]));

    expect(readTopicReadLedger()).toEqual([{
      channel: '#ok',
      topic: 'topic',
      lastReadMessageId: 'new',
      lastReadAt: 20,
    }]);

    localStorage.setItem(TOPIC_READ_LEDGER_KEY, '{not json');
    expect(readTopicReadLedger()).toEqual([]);
    localStorage.setItem(TOPIC_READ_LEDGER_KEY, JSON.stringify({ entries: [] }));
    expect(readTopicReadLedger()).toEqual([]);
  });

  it('rejects oversized owner storage before parsing', () => {
    const owner = { serverUrl: 'wss://topics.example/ws', identity: 'alice' };
    const key = deviceMemoryStorageKey(TOPIC_READ_LEDGER_KEY, owner)!;
    localStorage.setItem(key, `[${'x'.repeat(MAX_TOPIC_READ_LEDGER_STORAGE_CHARS)}]`);
    const parse = vi.spyOn(JSON, 'parse');

    expect(readTopicReadLedger(owner)).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });

  it('fails closed when storage reads and writes throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked');
    });
    expect(readTopicReadLedger()).toEqual([]);

    vi.restoreAllMocks();
    const listener = vi.fn();
    const stop = subscribeTopicReadLedger(listener);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota');
    });
    expect(markTopicRead('#room', 'topic', { id: 'm1', time: at(10) })).toBeNull();
    expect(listener).toHaveBeenLastCalledWith([]);
    stop();
  });

  it('does not publish or report a false clear when storage retains the ledger', () => {
    markTopicRead('#room', 'topic', { id: 'm1', time: at(10) });
    const listener = vi.fn();
    const stop = subscribeTopicReadLedger(listener);
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked');
    });

    expect(clearAllTopicReads()).toBe(false);
    expect(readTopicReadMarker('#room', 'topic')?.lastReadMessageId).toBe('m1');
    expect(listener).toHaveBeenLastCalledWith([{
      channel: '#room',
      topic: 'topic',
      lastReadMessageId: 'm1',
      lastReadAt: 10,
    }]);
    stop();
  });

  it('does not treat a retained malformed key as a verified clear', () => {
    localStorage.setItem(TOPIC_READ_LEDGER_KEY, '{malformed');
    const listener = vi.fn();
    const stop = subscribeTopicReadLedger(listener);
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked');
    });

    expect(clearAllTopicReads()).toBe(false);
    expect(localStorage.getItem(TOPIC_READ_LEDGER_KEY)).toBe('{malformed');
    expect(listener).toHaveBeenLastCalledWith([]);
    stop();
  });

  it('publishes an empty metadata snapshot only after a verified clear', () => {
    markTopicRead('#room', 'alpha', { id: 'm1', time: at(10) });
    const listener = vi.fn();
    const stop = subscribeTopicReadLedger(listener);

    expect(clearAllTopicReads()).toBe(true);
    expect(localStorage.getItem(TOPIC_READ_LEDGER_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith([]);
    stop();
  });

  it('retains the 256 newest markers with deterministic tie ordering', () => {
    const entries = Array.from({ length: MAX_TOPIC_READ_ENTRIES + 8 }, (_, index) => ({
      channel: '#room',
      topic: `topic-${String(index).padStart(3, '0')}`,
      lastReadMessageId: `m-${index}`,
      lastReadAt: index < 4 ? 500 : index,
    }));
    localStorage.setItem(TOPIC_READ_LEDGER_KEY, JSON.stringify(entries.reverse()));

    const ledger = readTopicReadLedger();
    expect(ledger).toHaveLength(MAX_TOPIC_READ_ENTRIES);
    expect(ledger[0]?.lastReadAt).toBe(500);
    expect(ledger.at(-1)?.lastReadAt).toBe(12);

    const ties = [
      { channel: '#z', topic: 'z', lastReadMessageId: 'm2', lastReadAt: 9_999 },
      { channel: '#a', topic: 'z', lastReadMessageId: 'm2', lastReadAt: 9_999 },
      { channel: '#a', topic: 'a', lastReadMessageId: 'm2', lastReadAt: 9_999 },
    ];
    localStorage.setItem(TOPIC_READ_LEDGER_KEY, JSON.stringify(ties));
    expect(readTopicReadLedger().map((entry) => `${entry.channel}/${entry.topic}`)).toEqual([
      '#a/a',
      '#a/z',
      '#z/z',
    ]);
  });

  it('sanitizes and bounds untrusted portable cursor metadata', () => {
    const entries = Array.from({ length: MAX_TOPIC_READ_ENTRIES + 8 }, (_, index) => ({
      channel: index === 0 ? ' #ROOM ' : '#room',
      topic: ` Topic ${String(index).padStart(3, '0')} `,
      lastReadMessageId: `m-${index}`,
      lastReadAt: index + 1,
      text: `plaintext-${index}`,
      password: `secret-${index}`,
    }));
    entries.push(
      {
        channel: '#bad room',
        topic: 'invalid',
        lastReadMessageId: 'bad',
        lastReadAt: 10_000,
        text: 'drop',
        password: 'drop',
      },
      {
        channel: '#room',
        topic: 'topic 263',
        lastReadMessageId: 'older-duplicate',
        lastReadAt: 1,
        text: 'drop',
        password: 'drop',
      },
    );

    const parsed = parseTopicReadLedger(entries);

    expect(parsed).toHaveLength(MAX_TOPIC_READ_ENTRIES);
    expect(parsed[0]).toEqual({
      channel: '#room',
      topic: 'topic 263',
      lastReadMessageId: 'm-263',
      lastReadAt: 264,
    });
    expect(parsed.at(-1)?.lastReadAt).toBe(9);
    expect(JSON.stringify(parsed)).not.toContain('plaintext');
    expect(JSON.stringify(parsed)).not.toContain('secret');
  });

  it('bounds untrusted ledger inspection before dedupe and sorting', () => {
    let highestRead = -1;
    const oversized = new Proxy(
      Array.from({ length: MAX_TOPIC_READ_PARSE_ENTRIES + 50 }, (_, index) => ({
        channel: '#room',
        topic: `topic ${index}`,
        lastReadMessageId: `m-${index}`,
        lastReadAt: index,
      })),
      {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^\d+$/.test(property)) {
            highestRead = Math.max(highestRead, Number(property));
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );

    const parsed = parseTopicReadLedger(oversized);

    expect(parsed).toHaveLength(MAX_TOPIC_READ_ENTRIES);
    expect(highestRead).toBe(MAX_TOPIC_READ_PARSE_ENTRIES - 1);
    expect(parsed[0]?.lastReadMessageId).toBe(`m-${MAX_TOPIC_READ_PARSE_ENTRIES - 1}`);
  });

  it('merges only advancing cursors and publishes the committed same-tab ledger', () => {
    markTopicRead('#room', 'local newer', { id: 'local-30', time: at(30) });
    markTopicRead('#room', 'import newer', { id: 'local-10', time: at(10) });
    markTopicRead('#room', 'same time', { id: 'local-exact', time: at(20) });
    const listener = vi.fn();
    const stop = subscribeTopicReadLedger(listener);

    const result = mergeTopicReadLedger([
      { channel: '#ROOM', topic: 'LOCAL NEWER', lastReadMessageId: 'import-20', lastReadAt: 20 },
      { channel: '#room', topic: 'import newer', lastReadMessageId: 'import-40', lastReadAt: 40 },
      { channel: '#room', topic: 'same time', lastReadMessageId: 'import-ambiguous', lastReadAt: 20 },
      { channel: '#room', topic: 'new topic', lastReadMessageId: 'import-50', lastReadAt: 50 },
    ]);

    expect(result).toEqual({ imported: 2, total: 4 });
    expect(readTopicReadMarker('#room', 'local newer')?.lastReadMessageId).toBe('local-30');
    expect(readTopicReadMarker('#room', 'import newer')?.lastReadMessageId).toBe('import-40');
    expect(readTopicReadMarker('#room', 'same time')?.lastReadMessageId).toBe('local-exact');
    expect(readTopicReadMarker('#room', 'new topic')?.lastReadMessageId).toBe('import-50');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(readTopicReadLedger());
    stop();
  });

  it('does not move a topic backward, but uses a new id at the same timestamp', () => {
    markTopicRead('#room', 'alpha', { id: 'newer', time: at(200) });
    expect(markTopicRead('#room', 'alpha', { id: 'older', time: at(100) })?.lastReadMessageId).toBe('newer');
    expect(markTopicRead('#room', 'alpha', { id: 'same-time-later', time: at(200) })?.lastReadMessageId).toBe('same-time-later');
  });

  it('marks each topic at its latest non-system message in bounded array order', () => {
    const messages = [
      message('a1', 'Alpha', 100),
      message('b1', 'Beta', 100),
      message('a2', 'alpha', 100),
      message('b-system', 'beta', 200, true),
      message('b2', 'BETA', 150),
      message('loose', null, 300),
    ];

    const next = markAllTopicsRead('#Room', messages, (item) => item.system);
    expect(next).toEqual([
      { channel: '#room', topic: 'beta', lastReadMessageId: 'b2', lastReadAt: 150 },
      { channel: '#room', topic: 'alpha', lastReadMessageId: 'a2', lastReadAt: 100 },
    ]);
  });

  it('only considers the bounded suffix when marking every topic', () => {
    const messages = Array.from({ length: MAX_TOPIC_READ_MESSAGES + 1 }, (_, index) =>
      message(`m${index}`, index === 0 ? 'too-old' : 'visible', index),
    );

    markAllTopicsRead('#room', messages, () => false);
    expect(readTopicReadMarker('#room', 'too-old')).toBeNull();
    expect(readTopicReadMarker('#room', 'visible')?.lastReadMessageId).toBe(`m${MAX_TOPIC_READ_MESSAGES}`);
  });

  it('clears one normalized channel without affecting another, then clears all', () => {
    markTopicRead('#One', 'alpha', { id: 'a', time: at(10) });
    markTopicRead('#one', 'beta', { id: 'b', time: at(20) });
    markTopicRead('#two', 'alpha', { id: 'c', time: at(30) });

    expect(clearChannelTopicReads(' #ONE ')).toBe(2);
    expect(readTopicReadLedger()).toEqual([
      { channel: '#two', topic: 'alpha', lastReadMessageId: 'c', lastReadAt: 30 },
    ]);
    expect(clearAllTopicReads()).toBe(true);
    expect(readTopicReadLedger()).toEqual([]);
    expect(localStorage.getItem(TOPIC_READ_LEDGER_KEY)).toBeNull();
  });

  it('notifies metadata-only subscribers, isolates listener failures, and cleans up', () => {
    const first = vi.fn((markers: readonly { topic: string }[]) => {
      const firstMarker = markers[0];
      if (firstMarker) firstMarker.topic = 'listener mutation';
      throw new Error('listener failure');
    });
    const second = vi.fn();
    const stopFirst = subscribeTopicReadLedger(first);
    const stopSecond = subscribeTopicReadLedger(second);

    markTopicRead('#room', 'secret planning', {
      id: 'm1',
      time: at(10),
      text: 'not listener data',
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith([{
      channel: '#room',
      topic: 'secret planning',
      lastReadMessageId: 'm1',
      lastReadAt: 10,
    }]);

    stopFirst();
    stopSecond();
    markTopicRead('#room', 'secret planning', { id: 'm2', time: at(20) });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('sanitizes cross-tab storage notifications before publishing them', () => {
    const listener = vi.fn();
    const stop = subscribeTopicReadLedger(listener);
    window.dispatchEvent(new StorageEvent('storage', {
      key: TOPIC_READ_LEDGER_KEY,
      newValue: JSON.stringify([{
        channel: '#ROOM',
        topic: 'Alpha',
        lastReadMessageId: 'm1',
        lastReadAt: 10,
        text: 'not published',
      }]),
    }));

    expect(listener).toHaveBeenCalledWith([{
      channel: '#room',
      topic: 'alpha',
      lastReadMessageId: 'm1',
      lastReadAt: 10,
    }]);
    stop();
  });
});

describe('countUnreadByTopic', () => {
  const isSystem = (item: TopicReadMessage & { system?: boolean }): boolean => item.system === true;

  it('uses exact marker ids so equal timestamps and interleaved topics stay ordered', () => {
    const messages = [
      message('a1', 'Alpha', 100),
      message('b1', 'Beta', 100),
      message('a2', 'alpha', 100),
      message('b2', 'beta', 100),
      message('a-system', 'alpha', 110, true),
      message('a3', 'ALPHA', 120),
    ];
    const markers = [
      { channel: '#room', topic: 'alpha', lastReadMessageId: 'a1', lastReadAt: 100 },
      { channel: '#room', topic: 'beta', lastReadMessageId: 'b1', lastReadAt: 100 },
    ];

    expect(countUnreadByTopic('#ROOM', messages, markers, {
      fallbackBoundaryIndex: 0,
      isSystemMessage: isSystem,
    })).toEqual(new Map([
      ['alpha', 2],
      ['beta', 1],
    ]));
  });

  it('falls back safely when a stored marker id has left the message window', () => {
    const messages = [
      message('equal-a', 'alpha', 100),
      message('equal-b', 'alpha', 100),
      message('newer', 'alpha', 101),
    ];
    const markers = [
      { channel: '#room', topic: 'alpha', lastReadMessageId: 'missing', lastReadAt: 100 },
    ];

    // Equal timestamps remain unread because their order relative to the
    // missing marker cannot be proven; only strictly older rows are read-safe.
    expect(countUnreadByTopic('#room', messages, markers, {
      fallbackBoundaryIndex: messages.length,
      isSystemMessage: isSystem,
    }).get('alpha')).toBe(3);
  });

  it('uses a caller boundary for uninitialized topics and clamps an unsafe boundary', () => {
    const messages = [
      message('a1', 'alpha', 10),
      message('b1', 'beta', 20),
      message('a2', 'alpha', 30),
      message('b2', 'beta', 40),
    ];

    expect(countUnreadByTopic('#room', messages, [], {
      fallbackBoundaryIndex: 2,
      isSystemMessage: isSystem,
    })).toEqual(new Map([
      ['alpha', 1],
      ['beta', 1],
    ]));

    expect(countUnreadByTopic('#room', messages, [], {
      fallbackBoundaryIndex: Number.NaN,
      isSystemMessage: isSystem,
    })).toEqual(new Map());
  });

  it('ignores unlabelled, malformed, and caller-excluded system messages', () => {
    const messages = [
      message('loose', null, 10),
      message('empty', '', 20),
      message('bad-topic', 'bad\u0001topic', 30),
      message('system', 'alpha', 40, true),
      message('visible', 'alpha', 50),
      { id: '', topic: 'alpha', time: at(60), system: false },
    ];

    expect(countUnreadByTopic('#room', messages, [], {
      fallbackBoundaryIndex: 0,
      isSystemMessage: isSystem,
    })).toEqual(new Map([['alpha', 1]]));
  });

  it('isolates a throwing system-message predicate by excluding that row', () => {
    const messages = [message('m1', 'alpha', 10), message('m2', 'alpha', 20)];
    expect(countUnreadByTopic('#room', messages, [], {
      fallbackBoundaryIndex: 0,
      isSystemMessage: (item) => {
        if (item.id === 'm1') throw new Error('bad predicate');
        return false;
      },
    })).toEqual(new Map([['alpha', 1]]));
  });
});

describe('projectRoomTopicUnread', () => {
  type ProjectedMessage = TopicReadMessage & { highlight: boolean; system: boolean };

  const projectedMessage = (
    id: string,
    topic: string | null,
    milliseconds: number,
    options: Partial<Pick<ProjectedMessage, 'highlight' | 'system'>> = {},
  ): ProjectedMessage => ({
    id,
    topic,
    time: at(milliseconds),
    highlight: options.highlight ?? false,
    system: options.system ?? false,
  });

  const project = (
    messages: readonly ProjectedMessage[],
    markers: readonly unknown[],
    fallbackBoundaryIndex: number,
  ) => projectRoomTopicUnread('#ROOM', messages, markers, {
    fallbackBoundaryIndex,
    isExcludedMessage: (item) => item.system,
    isHighlightMessage: (item) => item.highlight,
  });

  it('aggregates named and untagged unread rows against their correct boundaries', () => {
    const messages = [
      projectedMessage('a-read', 'Alpha', 100),
      projectedMessage('loose-read', null, 100),
      projectedMessage('b-unread', 'Beta', 100),
      projectedMessage('loose-unread', null, 110, { highlight: true }),
      projectedMessage('a-unread', 'ALPHA', 120, { highlight: true }),
      projectedMessage('excluded', 'beta', 130, { highlight: true, system: true }),
    ];
    const markers = [{
      channel: '#room',
      topic: 'alpha',
      lastReadMessageId: 'a-read',
      lastReadAt: 100,
    }];

    const result = project(messages, markers, 2);
    expect(result.unreadByTopic).toEqual(new Map([
      ['beta', 1],
      ['alpha', 1],
    ]));
    expect(result.untaggedUnread).toBe(1);
    expect(result.totalUnread).toBe(3);
    expect(result.highlightCount).toBe(2);
    expect(result.earliestUnreadMessageId).toBe('b-unread');
  });

  it('uses exact ids and source order to disambiguate equal-time topic rows', () => {
    const messages = [
      projectedMessage('a1', 'alpha', 100),
      projectedMessage('b1', 'beta', 100),
      projectedMessage('a2', 'alpha', 100),
      projectedMessage('b2', 'beta', 100),
    ];
    const markers = [
      { channel: '#room', topic: 'alpha', lastReadMessageId: 'a1', lastReadAt: 100 },
      { channel: '#room', topic: 'beta', lastReadMessageId: 'b1', lastReadAt: 100 },
    ];

    const result = project(messages, markers, 0);
    expect(result.unreadByTopic).toEqual(new Map([
      ['alpha', 1],
      ['beta', 1],
    ]));
    expect(result.totalUnread).toBe(2);
    expect(result.earliestUnreadMessageId).toBe('a2');
  });

  it('keeps equal-time rows unread when an exact marker has left the window', () => {
    const messages = [
      projectedMessage('same-a', 'alpha', 100),
      projectedMessage('same-b', 'alpha', 100),
      projectedMessage('newer', 'alpha', 101),
    ];
    const markers = [{
      channel: '#room',
      topic: 'alpha',
      lastReadMessageId: 'missing',
      lastReadAt: 100,
    }];

    const result = project(messages, markers, 0);
    expect(result.unreadByTopic).toEqual(new Map([['alpha', 3]]));
    expect(result.totalUnread).toBe(3);
    expect(result.earliestUnreadMessageId).toBe('same-a');
  });

  it('keeps the room boundary as a lower bound when a topic marker is older', () => {
    const messages = [
      projectedMessage('a-read-marker', 'alpha', 100),
      projectedMessage('a-after-marker-before-room', 'alpha', 110, { highlight: true }),
      projectedMessage('room-boundary', null, 120),
      projectedMessage('a-after-room', 'alpha', 130, { highlight: true }),
    ];
    const markers = [{
      channel: '#room',
      topic: 'alpha',
      lastReadMessageId: 'a-read-marker',
      lastReadAt: 100,
    }];

    const result = project(messages, markers, 2);
    expect(result.unreadByTopic).toEqual(new Map([['alpha', 1]]));
    expect(result.untaggedUnread).toBe(1);
    expect(result.totalUnread).toBe(2);
    expect(result.highlightCount).toBe(1);
    expect(result.earliestUnreadMessageId).toBe('room-boundary');
  });

  it('fails closed for malformed rows, boundaries, markers, and caller predicates', () => {
    const messages: ProjectedMessage[] = [
      projectedMessage('before-boundary', null, 10),
      projectedMessage('predicate-throws', 'alpha', 20),
      projectedMessage('highlight-throws', 'alpha', 30, { highlight: true }),
      projectedMessage('untagged', '', 40),
      projectedMessage('bad-topic', 'bad\u0001topic', 50, { highlight: true }),
      { ...projectedMessage('bad-time', 'alpha', 60), time: new Date(Number.NaN) },
    ];
    const result = projectRoomTopicUnread('#room', messages, [
      { channel: '#room', topic: 'alpha', lastReadMessageId: '', lastReadAt: 20 },
      { channel: '#room', topic: 'alpha', lastReadMessageId: 'old', lastReadAt: -1 },
    ], {
      fallbackBoundaryIndex: 0,
      isExcludedMessage: (item) => {
        if (item.id === 'predicate-throws') throw new Error('classifier failed');
        return false;
      },
      isHighlightMessage: (item) => {
        if (item.id === 'highlight-throws') throw new Error('classifier failed');
        return item.highlight;
      },
    });

    expect(result).toEqual({
      unreadByTopic: new Map([['alpha', 1]]),
      untaggedUnread: 1,
      totalUnread: 2,
      highlightCount: 0,
      earliestUnreadMessageId: 'before-boundary',
    });
    expect(project(messages, [], Number.NaN)).toEqual({
      unreadByTopic: new Map(),
      untaggedUnread: 0,
      totalUnread: 0,
      highlightCount: 0,
      earliestUnreadMessageId: null,
    });
    expect(projectRoomTopicUnread('room', messages, [], {
      fallbackBoundaryIndex: 0,
      isExcludedMessage: () => false,
      isHighlightMessage: () => false,
    })).toEqual({
      unreadByTopic: new Map(),
      untaggedUnread: 0,
      totalUnread: 0,
      highlightCount: 0,
      earliestUnreadMessageId: null,
    });
  });

  it('bounds the projection to the newest message suffix', () => {
    const messages = Array.from({ length: MAX_TOPIC_READ_MESSAGES + 1 }, (_, index) =>
      projectedMessage(`m${index}`, null, index),
    );

    const result = project(messages, [], 0);
    expect(result.untaggedUnread).toBe(MAX_TOPIC_READ_MESSAGES);
    expect(result.totalUnread).toBe(MAX_TOPIC_READ_MESSAGES);
    expect(result.earliestUnreadMessageId).toBe('m1');
  });
});
