// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  MAX_SCHEDULED_MESSAGES,
  parseScheduledMessages,
  selectDueMessages,
  type ScheduledMessage,
} from './dispatch';

const NOW = 1_000_000;

function msg(id: string, sendAt: number): ScheduledMessage {
  return { id, channel: '#root', text: `t-${id}`, sendAt };
}

describe('selectDueMessages', () => {
  it('returns nothing due for an empty queue', () => {
    expect(selectDueMessages([], NOW, true)).toEqual({ due: [], pending: [] });
  });

  it('marks a past-due entry due when connected', () => {
    const a = msg('a', NOW - 1);
    const { due, pending } = selectDueMessages([a], NOW, true);
    expect(due).toEqual([a]);
    expect(pending).toEqual([]);
  });

  it('treats sendAt === now as due (boundary)', () => {
    const a = msg('a', NOW);
    expect(selectDueMessages([a], NOW, true).due).toEqual([a]);
  });

  it('keeps a future entry pending', () => {
    const a = msg('a', NOW + 1);
    const { due, pending } = selectDueMessages([a], NOW, true);
    expect(due).toEqual([]);
    expect(pending).toEqual([a]);
  });

  it('splits a mixed queue', () => {
    const past = msg('past', NOW - 500);
    const now = msg('now', NOW);
    const future = msg('future', NOW + 500);
    const { due, pending } = selectDueMessages([past, now, future], NOW, true);
    expect(due).toEqual([past, now]);
    expect(pending).toEqual([future]);
  });

  it('holds EVERYTHING while offline — even past-due entries', () => {
    const past = msg('past', NOW - 5_000);
    const future = msg('future', NOW + 5_000);
    const { due, pending } = selectDueMessages([past, future], NOW, false);
    expect(due).toEqual([]);
    expect(pending).toEqual([past, future]);
  });

  it('does not mutate the input array', () => {
    const input = [msg('a', NOW - 1), msg('b', NOW + 1)];
    const snapshot = [...input];
    selectDueMessages(input, NOW, true);
    expect(input).toEqual(snapshot);
    // pending is a fresh array, not the input reference.
    expect(selectDueMessages(input, NOW, false).pending).not.toBe(input);
  });

  it('returns fresh arrays without cloning message objects for idempotent retries', () => {
    const past = msg('past', NOW - 1);
    const future = msg('future', NOW + 1);
    const input = [past, future] as const;

    const first = selectDueMessages(input, NOW, true);
    const second = selectDueMessages(input, NOW, true);

    expect(first).toEqual(second);
    expect(first.due).not.toBe(second.due);
    expect(first.pending).not.toBe(second.pending);
    expect(first.due[0]).toBe(past);
    expect(first.pending[0]).toBe(future);
  });
});

describe('parseScheduledMessages', () => {
  it('rejects malformed and valid-but-wrong root shapes', () => {
    for (const raw of [null, '', '{', '{}', 'null', '"queue"', '7']) {
      expect(parseScheduledMessages(raw)).toEqual([]);
    }
  });

  it('keeps valid entries sorted without mutating message text', () => {
    expect(parseScheduledMessages(JSON.stringify([
      { id: 'later', channel: '#root', text: '  keep spacing  ', sendAt: 2_000 },
      { id: 'first', channel: '#onyx', text: 'hello', sendAt: 1_000 },
    ]))).toEqual([
      { id: 'first', channel: '#onyx', text: 'hello', sendAt: 1_000 },
      { id: 'later', channel: '#root', text: '  keep spacing  ', sendAt: 2_000 },
    ]);
  });

  it('drops invalid fields and duplicate ids instead of poisoning dispatch', () => {
    const valid = { id: 'one', channel: '#root', text: 'hello', sendAt: 1_000 };
    expect(parseScheduledMessages(JSON.stringify([
      valid,
      { ...valid, channel: '#other', sendAt: 2_000 },
      { ...valid, id: '', sendAt: 3_000 },
      { ...valid, id: 'bad-channel', channel: 1, sendAt: 3_000 },
      { ...valid, id: 'empty', text: '   ', sendAt: 3_000 },
      { ...valid, id: 'nan', sendAt: null },
      { ...valid, id: 'fraction', sendAt: 1.5 },
      { ...valid, id: 'negative', sendAt: -1 },
    ]))).toEqual([valid]);
  });

  it('bounds the restored queue', () => {
    const raw = JSON.stringify(Array.from({ length: 300 }, (_, index) => ({
      id: `id-${index}`,
      channel: '#root',
      text: `message ${index}`,
      sendAt: index + 1,
    })));
    expect(parseScheduledMessages(raw)).toHaveLength(MAX_SCHEDULED_MESSAGES);
    expect(parseScheduledMessages(`"${'x'.repeat(2 * 1024 * 1024)}"`)).toEqual([]);
  });
});
