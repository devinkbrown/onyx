// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, test } from 'vitest';
import {
  latestReviewForTarget,
  mergeReviewHistory,
  parseReviewHistoryEntries,
  readReviewHistory,
  recordReviewHistory,
  REVIEW_HISTORY_KEY,
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
});
