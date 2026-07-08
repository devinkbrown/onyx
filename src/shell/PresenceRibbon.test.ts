import { describe, expect, it } from 'vitest';

import type { ChannelUser } from '@/lib/irc/types';
import { buildFacepile } from './PresenceRibbon';

function member(nick: string, modes: string[] = [], away = false): ChannelUser {
  return {
    nick,
    modes: new Set(modes),
    away,
  };
}

describe('buildFacepile', () => {
  it('caps visible members and reports overflow', () => {
    const model = buildFacepile([
      member('zed'),
      member('owner', ['q']),
      member('op', ['o']),
      member('voice', ['v']),
      member('alice'),
      member('bob'),
      member('charlie'),
      member('dana'),
    ]);

    expect(model.total).toBe(8);
    expect(model.overflow).toBe(2);
    expect(model.visible.map((entry) => entry.nick)).toEqual([
      'owner',
      'op',
      'voice',
      'alice',
      'bob',
      'charlie',
    ]);
  });

  it('preserves owner and away presentation flags', () => {
    const model = buildFacepile([
      member('founder', ['Q']),
      member('idle', [], true),
    ]);

    expect(model.visible).toEqual([
      { nick: 'founder', owner: true, away: false },
      { nick: 'idle', owner: false, away: true },
    ]);
    expect(model.overflow).toBe(0);
  });
});
