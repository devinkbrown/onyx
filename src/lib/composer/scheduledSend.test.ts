// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  cancelScheduled,
  createScheduledSend,
  dueScheduled,
  enqueueScheduled,
} from './scheduledSend';

describe('scheduledSend', () => {
  it('enqueues and releases due items', () => {
    const now = 1_000_000;
    const item = createScheduledSend({
      target: '#root',
      text: 'later',
      dueAt: now + 60_000,
      now,
      id: 'a',
    })!;
    const queue = enqueueScheduled([], item)!;
    expect(dueScheduled(queue, now).due).toHaveLength(0);
    expect(dueScheduled(queue, now + 60_000).due[0]?.text).toBe('later');
    expect(cancelScheduled(queue, 'a')).toEqual([]);
  });

  it('rejects past due and control characters', () => {
    expect(createScheduledSend({ target: '#x', text: 'a', dueAt: 1, now: 10 })).toBeNull();
    expect(createScheduledSend({ target: '#x', text: 'a\nb', dueAt: 100, now: 1 })).toBeNull();
  });
});
