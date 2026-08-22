// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  compareMessagesInboxRecency,
  messagesInboxActivityMs,
  sortMessagesInbox,
} from './messagesInbox';

const older = new Date('2026-08-20T12:00:00.000Z');
const newer = new Date('2026-08-22T18:00:00.000Z');

describe('messagesInbox recency', () => {
  it('ranks newer last-message activity above older, ignoring nick alpha', () => {
    const zebra = { nick: 'zebra', messages: [{ time: newer }] };
    const alpha = { nick: 'alpha', messages: [{ time: older }] };

    expect(messagesInboxActivityMs(zebra)).toBeGreaterThan(messagesInboxActivityMs(alpha));
    expect(compareMessagesInboxRecency(zebra, alpha)).toBeLessThan(0);
    expect(sortMessagesInbox([alpha, zebra]).map((row) => row.nick)).toEqual([
      'zebra',
      'alpha',
    ]);
  });

  it('uses lastSeen when the conversation has no loaded messages', () => {
    const recent = { nick: 'mira', lastSeen: newer };
    const stale = { nick: 'ada', lastSeen: older };

    expect(sortMessagesInbox([stale, recent]).map((row) => row.nick)).toEqual([
      'mira',
      'ada',
    ]);
  });

  it('takes the later of last message and lastSeen', () => {
    const bySeen = {
      nick: 'seen',
      lastSeen: newer,
      messages: [{ time: older }],
    };
    const byMessage = {
      nick: 'msg',
      lastSeen: older,
      messages: [{ time: newer }],
    };
    const stale = { nick: 'stale', lastSeen: older, messages: [{ time: older }] };

    expect(messagesInboxActivityMs(bySeen)).toBe(newer.getTime());
    expect(messagesInboxActivityMs(byMessage)).toBe(newer.getTime());
    expect(sortMessagesInbox([stale, byMessage, bySeen]).map((row) => row.nick)).toEqual([
      'msg',
      'seen',
      'stale',
    ]);
  });

  it('does not use nick alpha as the primary sort', () => {
    const rows = [
      { nick: 'ada', messages: [{ time: older }] },
      { nick: 'zoe', messages: [{ time: newer }] },
      { nick: 'mia', messages: [{ time: older }] },
    ];
    const nicks = sortMessagesInbox(rows).map((row) => row.nick);
    expect(nicks[0]).toBe('zoe');
    expect(nicks.slice(1)).not.toEqual(['ada', 'mia', 'zoe']);
    expect(nicks).not.toEqual(['ada', 'mia', 'zoe']);
  });

  it('tie-breaks equal recency by nick without making alpha the sort', () => {
    const rows = [
      { nick: 'zeta', messages: [{ time: newer }] },
      { nick: 'alpha', messages: [{ time: newer }] },
      { nick: 'old', messages: [{ time: older }] },
    ];
    expect(sortMessagesInbox(rows).map((row) => row.nick)).toEqual([
      'alpha',
      'zeta',
      'old',
    ]);
  });

  it('sorts unknown activity after known activity and does not mutate input', () => {
    const known = { nick: 'zeta', messages: [{ time: older }] };
    const unknown = { nick: 'alpha' };
    const source = [unknown, known];
    expect(sortMessagesInbox(source).map((row) => row.nick)).toEqual([
      'zeta',
      'alpha',
    ]);
    expect(source.map((row) => row.nick)).toEqual(['alpha', 'zeta']);
  });

  it('ignores invalid dates and keeps closed nicks out when that set is supplied', () => {
    const invalid = { nick: 'broken', messages: [{ time: new Date('not-a-date') }] };
    const closed = { nick: 'gone', lastSeen: newer };
    const open = { nick: 'here', lastSeen: older };
    expect(messagesInboxActivityMs(invalid)).toBe(0);
    expect(
      sortMessagesInbox([closed, open, invalid], new Set(['gone'])).map((row) => row.nick),
    ).toEqual(['here', 'broken']);
  });
});
