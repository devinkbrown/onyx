// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  buildPortableIdentity,
  parsePortableIdentity,
  serializePortableIdentity,
} from './portableIdentity';

describe('portable identity (C10)', () => {
  it('round-trips non-secret residence data', () => {
    const doc = buildPortableIdentity({
      preferences: { density: 'compact', e2eeDms: true },
      bookmarks: ['#root'],
      categories: { categories: [{ id: 'w', name: 'Work', channels: ['#ops'], collapsed: false, order: 0 }] },
      quietHours: { startHour: 23, endHour: 7 },
      networkHint: 'Onyx',
      now: new Date('2026-07-25T12:00:00.000Z'),
    });
    const raw = serializePortableIdentity(doc);
    const parsed = parsePortableIdentity(raw);
    expect(parsed?.preferences.density).toBe('compact');
    expect(parsed?.bookmarks).toEqual(['#root']);
    expect(parsed?.categories.categories[0]?.name).toBe('Work');
    expect(parsed?.quietHours).toEqual({ startHour: 23, endHour: 7 });
    expect(parsed?.networkHint).toBe('Onyx');
  });

  it('refuses secret-bearing or wrong-kind documents', () => {
    expect(parsePortableIdentity('{"kind":"nope","version":1}')).toBeNull();
    expect(parsePortableIdentity(JSON.stringify({
      kind: 'onyx.portable-identity',
      version: 1,
      exportedAt: new Date().toISOString(),
      privateKey: 'evil',
    }))).toBeNull();
  });
});
