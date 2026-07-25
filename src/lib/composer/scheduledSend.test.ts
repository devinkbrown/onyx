// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  MAX_SCHEDULED_MESSAGES,
  MAX_SCHEDULED_TEXT_LENGTH,
  cancelScheduled,
  canScheduleAt,
  canScheduleChannel,
  createScheduledSend,
  dueScheduled,
  enqueueScheduled,
  type ScheduledMessageOwner,
} from './scheduledSend';

const OWNER: ScheduledMessageOwner = {
  serverUrl: 'wss://example.test',
  identity: 'alice',
};

describe('scheduledSend (store-shaped queue)', () => {
  it('enqueues and releases due items when connected', () => {
    const now = 1_000_000;
    const item = createScheduledSend({
      channel: '#root',
      text: 'later',
      sendAt: now + 60_000,
      owner: OWNER,
      now,
      id: 'a',
    })!;
    const queue = enqueueScheduled([], item)!;
    expect(dueScheduled(queue, now, true).due).toHaveLength(0);
    expect(dueScheduled(queue, now + 60_000, true).due[0]?.text).toBe('later');
    expect(cancelScheduled(queue, 'a')).toEqual([]);
  });

  it('holds past-due rows while offline (store offline invariant)', () => {
    const now = 1_000_000;
    const item = createScheduledSend({
      channel: '#root',
      text: 'held',
      sendAt: now - 1,
      owner: OWNER,
      id: 'past',
    })!;
    const queue = enqueueScheduled([], item)!;
    const offline = dueScheduled(queue, now, false);
    expect(offline.due).toEqual([]);
    expect(offline.remaining).toEqual([item]);
  });

  it('rejects bad channel, empty text, and non-integer sendAt', () => {
    expect(createScheduledSend({
      channel: 'room with spaces',
      text: 'a',
      sendAt: 100,
      owner: OWNER,
    })).toBeNull();
    expect(createScheduledSend({
      channel: '#x',
      text: '   ',
      sendAt: 100,
      owner: OWNER,
    })).toBeNull();
    expect(createScheduledSend({
      channel: '#x',
      text: 'a',
      sendAt: 1.5,
      owner: OWNER,
    })).toBeNull();
    expect(createScheduledSend({
      channel: '#x',
      text: 'a\nb',
      sendAt: 100,
      owner: OWNER,
    })?.text).toBe('a\nb');
  });

  it('preserves text body without trimming (parser parity)', () => {
    const row = createScheduledSend({
      channel: '  #root  ',
      text: '  keep spacing  ',
      sendAt: 5_000,
      owner: null,
      id: 's1',
    });
    expect(row).toEqual({
      id: 's1',
      channel: '#root',
      text: '  keep spacing  ',
      sendAt: 5_000,
      owner: null,
    });
  });

  it('caps the queue and rejects duplicate ids', () => {
    const base = createScheduledSend({
      channel: '#root',
      text: 'one',
      sendAt: 1,
      owner: OWNER,
      id: 'dup',
    })!;
    const once = enqueueScheduled([], base)!;
    expect(enqueueScheduled(once, base)).toBeNull();

    let queue = once;
    for (let i = 1; i < MAX_SCHEDULED_MESSAGES; i += 1) {
      const next = enqueueScheduled(queue, {
        ...base,
        id: `id-${i}`,
        text: `m${i}`,
        sendAt: i + 1,
      });
      expect(next).not.toBeNull();
      queue = next!;
    }
    expect(queue).toHaveLength(MAX_SCHEDULED_MESSAGES);
    expect(enqueueScheduled(queue, {
      ...base,
      id: 'overflow',
      text: 'nope',
      sendAt: 99_999,
    })).toBeNull();
  });

  it('exposes the same channel/sendAt guards the store uses', () => {
    expect(canScheduleChannel('#root')).toBe(true);
    expect(canScheduleChannel('#one,#two')).toBe(false);
    expect(canScheduleChannel(':bad')).toBe(false);
    expect(canScheduleAt(1)).toBe(true);
    expect(canScheduleAt(0)).toBe(false);
    expect(canScheduleAt(Number.NaN)).toBe(false);
    expect(MAX_SCHEDULED_TEXT_LENGTH).toBeGreaterThan(4_000);
  });
});
