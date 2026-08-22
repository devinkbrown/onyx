// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  FORMATION_WINDOW_MS,
  emptyFormationMemory,
  listKnownNames,
  missingHeadline,
  selectFormationStrip,
  type FormationChannel,
  type FormationLoopInput,
  type FormationMember,
  type FormationMemorySnapshot,
} from './formationLoop';

const NOW = Date.parse('2026-08-22T18:00:00.000Z');

function member(nick: string, modes: string[] = [], hasChat = false): FormationMember {
  return { nick, modes, hasChat };
}

function room(
  name: string,
  members: FormationMember[],
  createdAtMs: number | null = NOW - 3_600_000,
): FormationChannel {
  return { name, createdAtMs, members };
}

function input(over: Partial<FormationLoopInput> = {}): FormationLoopInput {
  return {
    nowMs: NOW,
    connected: true,
    ourNick: 'me',
    channels: [room('#lounge', [member('me', ['Q'])])],
    pendingJoin: null,
    memory: emptyFormationMemory(),
    ...over,
  };
}

function memory(over: Partial<FormationMemorySnapshot['rooms'][string]> & { channel?: string } = {}): FormationMemorySnapshot {
  const channel = over.channel ?? '#lounge';
  return {
    rooms: {
      [channel.toLowerCase()]: {
        firstSeenAt: over.firstSeenAt ?? NOW - 60_000,
        role: over.role ?? 'founder',
        firstJoiner: over.firstJoiner ?? null,
        expectedNicks: over.expectedNicks ?? [],
      },
    },
    inviteChannel: null,
  };
}

describe('formation copy helpers', () => {
  it('names only the people it was given', () => {
    expect(listKnownNames([])).toBe('');
    expect(listKnownNames(['Alex'])).toBe('Alex');
    expect(listKnownNames(['Alex', 'Sam'])).toBe('Alex and Sam');
  });

  it('uses the 3-person waiting headline without inventing a fourth', () => {
    expect(missingHeadline(2)).toBe("2 of 3 haven't opened this");
    expect(missingHeadline(1)).toBe("1 of 3 hasn't opened this");
  });
});

describe('selectFormationStrip — founder waiting', () => {
  it('nags a founder who is the only member of a room younger than 48h', () => {
    const strip = selectFormationStrip(input());
    expect(strip).toMatchObject({
      kind: 'waiting',
      channel: '#lounge',
      present: 1,
      missing: 2,
      canReshare: true,
      headline: "2 of 3 haven't opened this",
      detail: 'Just you in #lounge so far.',
    });
    expect(strip?.knownNames).toEqual([]);
  });

  it('treats the only member as a founder even without +Q', () => {
    const strip = selectFormationStrip(input({
      channels: [room('#kitchen', [member('me')])],
    }));
    expect(strip?.channel).toBe('#kitchen');
    expect(strip?.headline).toBe("2 of 3 haven't opened this");
  });

  it('names expected invitees only when they are remembered, never invented', () => {
    const strip = selectFormationStrip(input({
      memory: memory({ expectedNicks: ['Alex', 'Sam'] }),
    }));
    expect(strip?.detail).toBe("Alex and Sam haven't opened this.");
    expect(strip?.knownNames).toEqual([]);
  });

  it('hides after 3 people have actually shown up', () => {
    expect(selectFormationStrip(input({
      channels: [room('#lounge', [member('me', ['Q']), member('alex'), member('sam')])],
    }))).toBeNull();
  });

  it('hides rooms older than 48 hours', () => {
    expect(selectFormationStrip(input({
      channels: [room('#lounge', [member('me', ['Q'])], NOW - FORMATION_WINDOW_MS - 1)],
    }))).toBeNull();
  });

  it('does not invent a 48h window when the room has no creation time', () => {
    expect(selectFormationStrip(input({
      channels: [room('#lounge', [member('me', ['Q'])], null)],
    }))).toBeNull();
  });

  it('can age a room from remembered first-seen when 329 has not arrived', () => {
    const strip = selectFormationStrip(input({
      channels: [room('#lounge', [member('me', ['Q'])], null)],
      memory: memory({ firstSeenAt: NOW - 3_600_000 }),
    }));
    expect(strip?.headline).toBe("2 of 3 haven't opened this");
  });

  it('does not nag when disconnected or when we do not have a nick', () => {
    expect(selectFormationStrip(input({ connected: false }))).toBeNull();
    expect(selectFormationStrip(input({ ourNick: '' }))).toBeNull();
  });

  it('does not invent occupancy for a busy old room we merely joined', () => {
    expect(selectFormationStrip(input({
      channels: [room('#root', [
        member('me'),
        member('op', ['o']),
        member('voice', ['v']),
      ], NOW - 10 * 60 * 60 * 1000)],
    }))).toBeNull();
  });
});

describe('selectFormationStrip — first join', () => {
  it('names the person who just showed up', () => {
    const strip = selectFormationStrip(input({
      channels: [room('#lounge', [member('me', ['Q']), member('Alex')])],
      memory: memory({ firstJoiner: 'Alex' }),
    }));
    expect(strip).toMatchObject({
      kind: 'first-join',
      headline: 'Alex is here — say the thing you invited them for.',
      detail: "1 of 3 hasn't opened this",
      canReshare: true,
    });
    expect(strip?.knownNames).toEqual(['Alex']);
  });

  it('falls back to the waiting line once that person has spoken', () => {
    const strip = selectFormationStrip(input({
      channels: [room('#lounge', [member('me', ['Q']), member('Alex', [], true)])],
      memory: memory({ firstJoiner: 'Alex' }),
    }));
    expect(strip?.kind).toBe('waiting');
    expect(strip?.headline).toBe("1 of 3 hasn't opened this");
    expect(strip?.detail).toBe('Alex is here.');
  });
});

describe('selectFormationStrip — joiner', () => {
  it('asks a joiner to say hi to the founder when invite context exists', () => {
    const strip = selectFormationStrip(input({
      ourNick: 'alex',
      pendingJoin: '#lounge',
      channels: [room('#lounge', [member('Mira', ['Q']), member('alex')])],
      memory: { rooms: {}, inviteChannel: '#lounge' },
    }));
    expect(strip).toMatchObject({
      kind: 'joiner',
      headline: 'Say hi to Mira',
      detail: 'They invited you to #lounge.',
      canReshare: false,
    });
  });

  it('does not invent an inviter name when the founder is unknown', () => {
    const strip = selectFormationStrip(input({
      ourNick: 'alex',
      pendingJoin: '#lounge',
      channels: [room('#lounge', [member('host'), member('alex')])],
    }));
    expect(strip?.headline).toBe('Say hi to the person who invited you');
    expect(strip?.knownNames).toEqual([]);
  });

  it('stays quiet without invite context', () => {
    expect(selectFormationStrip(input({
      ourNick: 'alex',
      channels: [room('#lounge', [member('Mira', ['Q']), member('alex')])],
    }))).toBeNull();
  });

  it('hides the joiner greeting after they have said something', () => {
    expect(selectFormationStrip(input({
      ourNick: 'alex',
      pendingJoin: '#lounge',
      channels: [room('#lounge', [member('Mira', ['Q']), member('alex', [], true)])],
    }))).toBeNull();
  });
});
