// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from 'vitest';
import { buildQuietActivity } from './quietActivity';

const now = new Date('2026-07-09T00:00:00.000Z').getTime();
const ch = (name: string, unread = 0, highlights = 0, topic = '') => ({
  name,
  unread,
  highlights,
  topic,
});

describe('buildQuietActivity', () => {
  test('includes recently active read rooms', () => {
    const out = buildQuietActivity(
      [ch('#read', 0, 0, 'calm room')],
      new Map([['#read', now - 5 * 60 * 1000]]),
      now,
    );

    expect(out).toEqual([
      { name: '#read', topic: 'calm room', lastActivity: now - 5 * 60 * 1000 },
    ]);
  });

  test('excludes unread, mentioned, unknown, and stale rooms', () => {
    const out = buildQuietActivity(
      [
        ch('#unread', 1),
        ch('#mentioned', 0, 1),
        ch('#unknown'),
        ch('#stale'),
        ch('#fresh'),
      ],
      new Map([
        ['#stale', now - 25 * 60 * 60 * 1000],
        ['#fresh', now - 10_000],
      ]),
      now,
    );

    expect(out.map((item) => item.name)).toEqual(['#fresh']);
  });

  test('sorts by newest activity and honors the limit', () => {
    const out = buildQuietActivity(
      [ch('#old'), ch('#new'), ch('#middle')],
      new Map([
        ['#old', now - 30_000],
        ['#new', now - 5_000],
        ['#middle', now - 10_000],
      ]),
      now,
      { limit: 2 },
    );

    expect(out.map((item) => item.name)).toEqual(['#new', '#middle']);
  });
});
