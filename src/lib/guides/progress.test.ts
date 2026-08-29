// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  GUIDE_PROGRESS_STORAGE_KEY,
  guideProgressSummary,
  readGuideProgress,
  writeGuideProgress,
} from './progress';

const STEPS = ['join', 'invite', 'messages'] as const;

describe('guide progress', () => {
  it('keeps only known, distinct completed steps and identifies the next one', () => {
    const progress = guideProgressSummary(STEPS, new Set(['invite', 'unknown']));

    expect(progress.complete).toBe(1);
    expect(progress.total).toBe(3);
    expect(progress.nextId).toBe('join');
    expect(progress.done).toBe(false);
  });

  it('reports completion only when every required step is complete', () => {
    const progress = guideProgressSummary(STEPS, new Set(STEPS));

    expect(progress.complete).toBe(3);
    expect(progress.nextId).toBeNull();
    expect(progress.done).toBe(true);
  });

  it('reads a bounded valid local progress record and ignores malformed values', () => {
    const storage = new Map<string, string>();
    storage.set(GUIDE_PROGRESS_STORAGE_KEY, JSON.stringify(['join', 'join', 'unknown', 7]));
    const api = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    };

    expect([...readGuideProgress(api, STEPS)]).toEqual(['join']);
    storage.set(GUIDE_PROGRESS_STORAGE_KEY, '{not json');
    expect([...readGuideProgress(api, STEPS)]).toEqual([]);
  });

  it('persists only allowed completed ids and does not require browser globals', () => {
    const writes: Array<[string, string]> = [];
    const storage = {
      getItem: () => null,
      setItem: (key: string, value: string) => writes.push([key, value]),
    };

    writeGuideProgress(storage, STEPS, new Set(['messages', 'unknown', 'join']));

    expect(writes).toEqual([[
      GUIDE_PROGRESS_STORAGE_KEY,
      JSON.stringify(['join', 'messages']),
    ]]);
  });
});
