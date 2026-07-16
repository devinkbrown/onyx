// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  MAX_REVIEW_HISTORY_INPUT_ENTRIES,
  MAX_REVIEW_HISTORY_NAME_LENGTH,
  MAX_REVIEW_HISTORY_PREVIEW_LENGTH,
  clearReviewHistory,
  latestReviewForTarget,
  mergeReviewHistory,
  parseReviewHistoryEntries,
  planReviewedAnchorRecall,
  readReviewHistory,
  recordReviewHistory,
  REVIEW_HISTORY_KEY,
  subscribeReviewHistory,
  type ReviewHistoryEntry,
} from './reviewHistory';

function entry(target: string, reviewedAt: string, firstMessageId = `${target}-m`): ReviewHistoryEntry {
  return {
    target,
    name: target,
    kind: target.startsWith('#') ? 'channel' : 'dm',
    firstMessageId,
    firstAt: '2026-07-09T00:00:00.000Z',
    reviewedAt,
    messageCount: 2,
    mentionCount: 1,
    preview: `preview ${target}`,
  };
}

describe('reviewHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  test('reads newest valid entries and ignores corrupted storage', () => {
    localStorage.setItem(REVIEW_HISTORY_KEY, 'not json');
    expect(readReviewHistory()).toEqual([]);

    localStorage.setItem(REVIEW_HISTORY_KEY, JSON.stringify([
      entry('#old', '2026-07-09T00:00:00.000Z'),
      { target: '#broken' },
      entry('#new', '2026-07-09T00:05:00.000Z'),
    ]));

    expect(readReviewHistory().map((item) => item.target)).toEqual(['#new', '#old']);
  });

  test('records, deduplicates by target and first message, and caps history', () => {
    for (let i = 0; i < 7; i += 1) {
      recordReviewHistory(entry(`#room-${i}`, `2026-07-09T00:0${i}:00.000Z`));
    }
    recordReviewHistory(entry('#room-6', '2026-07-09T00:09:00.000Z'));

    expect(readReviewHistory().map((item) => item.target)).toEqual([
      '#room-6',
      '#room-5',
      '#room-4',
      '#room-3',
      '#room-2',
    ]);
    expect(readReviewHistory()).toHaveLength(5);
  });

  test('returns the latest review for a target and optional kind', () => {
    recordReviewHistory(entry('#General', '2026-07-09T00:00:00.000Z', 'old'));
    recordReviewHistory(entry('#general', '2026-07-09T00:05:00.000Z', 'new'));
    recordReviewHistory({ ...entry('Kai', '2026-07-09T00:06:00.000Z'), kind: 'dm' });

    expect(latestReviewForTarget('#GENERAL', 'channel')?.firstMessageId).toBe('new');
    expect(latestReviewForTarget('#general', 'dm')).toBeNull();
    expect(latestReviewForTarget('kai')?.kind).toBe('dm');
  });

  test('parses and merges portable review history entries', () => {
    recordReviewHistory(entry('#general', '2026-07-09T00:00:00.000Z', 'same'));

    expect(parseReviewHistoryEntries([{ target: '#broken' }, entry('#alpha', '2026-07-09T00:02:00.000Z')]).map((item) => item.target)).toEqual(['#alpha']);

    const result = mergeReviewHistory([
      entry('#general', '2026-07-09T00:05:00.000Z', 'same'),
      entry('#beta', '2026-07-09T00:04:00.000Z'),
      { target: '#broken' },
    ]);

    expect(result).toEqual({ imported: 2, total: 2 });
    expect(readReviewHistory().map((item) => [item.target, item.firstMessageId, item.reviewedAt])).toEqual([
      ['#general', 'same', '2026-07-09T00:05:00.000Z'],
      ['#beta', '#beta-m', '2026-07-09T00:04:00.000Z'],
    ]);
  });

  test('sanitizes display text and canonical timestamps while dropping extra payloads', () => {
    const parsed = parseReviewHistoryEntries([{
      ...entry('#general', '2026-07-09T00:05:00Z', 'exact-id'),
      name: '  General\nRoom  ',
      firstAt: '2026-07-09T00:00:00Z',
      preview: '  reviewed\twithout\nsecrets  ',
      text: 'must not survive',
      sessionToken: 'must not survive either',
    }]);

    expect(parsed).toEqual([{
      target: '#general',
      name: 'General Room',
      kind: 'channel',
      firstMessageId: 'exact-id',
      firstAt: '2026-07-09T00:00:00.000Z',
      reviewedAt: '2026-07-09T00:05:00.000Z',
      messageCount: 2,
      mentionCount: 1,
      preview: 'reviewed without secrets',
    }]);
    expect(JSON.stringify(parsed)).not.toContain('sessionToken');
  });

  test('bounds input before sorting and rejects oversized strings', () => {
    const oversized = Array.from(
      { length: MAX_REVIEW_HISTORY_INPUT_ENTRIES + 64 },
      (_, index) => entry(
        `#room-${index}`,
        new Date(Date.UTC(2026, 6, 9, 0, 0, index)).toISOString(),
      ),
    );
    oversized[MAX_REVIEW_HISTORY_INPUT_ENTRIES] = entry(
      '#outside-bound',
      '2026-07-10T00:00:00.000Z',
    );
    const sort = vi.spyOn(Array.prototype, 'sort');

    const parsed = parseReviewHistoryEntries(oversized);

    expect(parsed.some((item) => item.target === '#outside-bound')).toBe(false);
    expect(sort.mock.instances).not.toHaveLength(0);
    expect(sort.mock.instances.every((instance) =>
      (instance as unknown[]).length <= MAX_REVIEW_HISTORY_INPUT_ENTRIES,
    )).toBe(true);

    expect(parseReviewHistoryEntries([
      { ...entry(`#${'a'.repeat(128)}`, '2026-07-09T00:00:00.000Z') },
      { ...entry('#name', '2026-07-09T00:00:01.000Z'), name: 'n'.repeat(MAX_REVIEW_HISTORY_NAME_LENGTH + 1) },
      { ...entry('#preview', '2026-07-09T00:00:02.000Z'), preview: 'p'.repeat(MAX_REVIEW_HISTORY_PREVIEW_LENGTH + 1) },
      { ...entry('#message', '2026-07-09T00:00:03.000Z'), firstMessageId: 'm'.repeat(513) },
    ])).toEqual([]);
  });

  test('rejects malformed identity fields, kinds, and non-finite or invalid counts', () => {
    const base = entry('#valid', '2026-07-09T00:05:00.000Z');
    const invalid = [
      { ...base, target: '#bad room' },
      { ...base, target: '#bad,room' },
      { ...base, kind: 'dm' },
      { ...base, kind: 'thread' },
      { ...base, firstMessageId: ' trimmed ' },
      { ...base, firstMessageId: 'bad\u0000id' },
      { ...base, name: '' },
      { ...base, messageCount: Number.NaN },
      { ...base, messageCount: Number.POSITIVE_INFINITY },
      { ...base, messageCount: -1 },
      { ...base, messageCount: 1.5 },
      { ...base, mentionCount: Number.NaN },
      { ...base, mentionCount: 3 },
    ];

    expect(parseReviewHistoryEntries(invalid)).toEqual([]);
  });

  test('rejects malformed reviewed timestamps but preserves exact-id recall for bad firstAt', () => {
    const base = entry('#general', '2026-07-09T00:05:00.000Z', 'exact-id');
    expect(parseReviewHistoryEntries([
      { ...base, reviewedAt: 'not-a-date' },
      { ...base, reviewedAt: '2026-02-30T00:00:00.000Z' },
      { ...base, reviewedAt: '2026-07-09T00:05:00+00:00' },
      { ...base, reviewedAt: 'x'.repeat(10_000) },
    ])).toEqual([]);

    const parsed = parseReviewHistoryEntries([{ ...base, firstAt: 'not-a-date' }]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.firstAt).toBe('');
    expect(planReviewedAnchorRecall(parsed[0])).toEqual({
      kind: 'channel',
      target: '#general',
      messageId: 'exact-id',
      at: null,
    });
  });

  test('deduplicates case-insensitive target collisions by newest review and orders ties', () => {
    const parsed = parseReviewHistoryEntries([
      { ...entry('#General', '2026-07-09T00:01:00.000Z', 'same'), preview: 'older' },
      { ...entry('#general', '2026-07-09T00:03:00.000Z', 'same'), preview: 'newer' },
      entry('#zeta', '2026-07-09T00:02:00.000Z'),
      entry('#alpha', '2026-07-09T00:02:00.000Z'),
    ]);

    expect(parsed.map((item) => [item.target, item.preview])).toEqual([
      ['#general', 'newer'],
      ['#alpha', 'preview #alpha'],
      ['#zeta', 'preview #zeta'],
    ]);
  });

  test('reports no imported rows when durable storage rejects a merge', () => {
    recordReviewHistory(entry('#local', '2026-07-09T00:01:00.000Z'));
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota');
    });

    const result = mergeReviewHistory([
      entry('#portable', '2026-07-09T00:02:00.000Z'),
    ]);

    expect(result).toEqual({ imported: 0, total: 1 });
    expect(readReviewHistory().map((item) => item.target)).toEqual(['#local']);
    expect(recordReviewHistory(entry('#optimistic', '2026-07-09T00:03:00.000Z')))
      .toEqual(readReviewHistory());
  });

  test('clears empty and populated reviewed-anchor state with verified publication', () => {
    const listener = vi.fn();
    const stop = subscribeReviewHistory(listener);
    try {
      expect(clearReviewHistory()).toEqual({ success: true, cleared: 0, remaining: 0 });
      expect(listener).toHaveBeenLastCalledWith([]);

      recordReviewHistory(entry('#one', '2026-07-09T00:01:00.000Z'));
      recordReviewHistory(entry('#two', '2026-07-09T00:02:00.000Z'));
      listener.mockClear();

      expect(clearReviewHistory()).toEqual({ success: true, cleared: 2, remaining: 0 });
      expect(localStorage.getItem(REVIEW_HISTORY_KEY)).toBeNull();
      expect(readReviewHistory()).toEqual([]);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenLastCalledWith([]);
    } finally {
      stop();
    }
  });

  test('does not claim reviewed anchors were cleared when storage removal fails', () => {
    recordReviewHistory(entry('#retained', '2026-07-09T00:01:00.000Z'));
    const listener = vi.fn();
    const stop = subscribeReviewHistory(listener);
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked');
    });

    try {
      expect(clearReviewHistory()).toEqual({ success: false, cleared: 0, remaining: 1 });
      expect(readReviewHistory().map((item) => item.target)).toEqual(['#retained']);
      expect(localStorage.getItem(REVIEW_HISTORY_KEY)).not.toBeNull();
      expect(listener).toHaveBeenLastCalledWith(readReviewHistory());
    } finally {
      stop();
    }
  });

  test('plans exact reviewed-anchor recall and fails closed on malformed fields', () => {
    expect(planReviewedAnchorRecall(entry('#general', '2026-07-09T00:05:00.000Z', 'exact-id'))).toEqual({
      kind: 'channel',
      target: '#general',
      messageId: 'exact-id',
      at: new Date('2026-07-09T00:00:00.000Z'),
    });

    expect(planReviewedAnchorRecall({
      ...entry('#general', '2026-07-09T00:05:00.000Z', 'exact-id'),
      firstAt: 'not-a-date',
    })).toEqual({
      kind: 'channel',
      target: '#general',
      messageId: 'exact-id',
      at: null,
    });
    expect(planReviewedAnchorRecall({
      ...entry('#general', '2026-07-09T00:05:00.000Z', 'exact-id'),
      firstAt: '2026-07-09T00:00:00Z',
    })?.at).toEqual(new Date('2026-07-09T00:00:00.000Z'));

    expect(planReviewedAnchorRecall({
      ...entry('#general', '2026-07-09T00:05:00.000Z'),
      firstMessageId: ' ',
    })).toBeNull();
    expect(planReviewedAnchorRecall({
      ...entry('#general', '2026-07-09T00:05:00.000Z'),
      kind: 'dm',
    })).toBeNull();
    expect(planReviewedAnchorRecall({ target: '#general' })).toBeNull();
  });
});
