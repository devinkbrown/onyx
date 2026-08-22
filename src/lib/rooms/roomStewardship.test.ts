// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  MAX_CO_ADMINS,
  STEWARDSHIP_COPY,
  acceptTransfer,
  actorIsOwner,
  canAddCoAdmin,
  canCompleteTransfer,
  canDeleteRoom,
  isConsumerStewardshipRoom,
  lastMemberLeaveDissolves,
  listCoAdmins,
  listOwners,
  membersCanInvite,
  offerTransfer,
  rejectThirdCoAdmin,
  transferModeCommands,
  typedNameMatchesRoom,
  type StewardMember,
} from './roomStewardship';

function member(nick: string, modes: string[] = []): StewardMember {
  return { nick, modes };
}

const room: StewardMember[] = [
  member('alice', ['Q', 'q']),
  member('bob', ['o']),
  member('cara', ['o']),
  member('drew'),
  member('erin'),
];

describe('consumer room size', () => {
  it('is the 3–30 band where members can invite', () => {
    expect(isConsumerStewardshipRoom(2)).toBe(false);
    expect(isConsumerStewardshipRoom(3)).toBe(true);
    expect(isConsumerStewardshipRoom(30)).toBe(true);
    expect(isConsumerStewardshipRoom(31)).toBe(false);
    expect(membersCanInvite(8)).toBe(true);
    expect(membersCanInvite(31)).toBe(false);
  });
});

describe('one owner, two co-admins', () => {
  it('reads owner and helpers from existing roster ranks', () => {
    expect(listOwners(room)).toEqual(['alice']);
    expect(listCoAdmins(room)).toEqual(['bob', 'cara']);
    expect(actorIsOwner(room, 'alice')).toBe(true);
    expect(actorIsOwner(room, 'bob')).toBe(false);
  });

  it('cannot add a third co-admin', () => {
    expect(MAX_CO_ADMINS).toBe(2);
    expect(canAddCoAdmin(['bob', 'cara'])).toBe(false);
    expect(rejectThirdCoAdmin(room, 'alice', 'drew')).toEqual({
      ok: false,
      reason: STEWARDSHIP_COPY.thirdCoAdmin,
    });
  });

  it('lets the owner add a helper when a seat is free', () => {
    const open = [member('alice', ['q']), member('bob', ['o']), member('drew')];
    expect(rejectThirdCoAdmin(open, 'alice', 'drew')).toEqual({ ok: true, nick: 'drew' });
    expect(rejectThirdCoAdmin(open, 'bob', 'drew').ok).toBe(false);
  });
});

describe('accept-to-take transfer', () => {
  it('waits for accept before any owner rank is granted', () => {
    const offered = offerTransfer({
      current: null,
      channel: '#harbor',
      from: 'alice',
      to: 'drew',
      members: room,
    });
    expect(offered).toMatchObject({ from: 'alice', to: 'drew', accepted: false });
    expect(canCompleteTransfer(offered)).toBe(false);
    expect(transferModeCommands(offered, room)).toBeNull();

    const accepted = acceptTransfer({
      current: offered,
      channel: '#harbor',
      acceptor: 'drew',
    });
    expect(accepted?.accepted).toBe(true);
    expect(canCompleteTransfer(accepted)).toBe(true);
    expect(transferModeCommands(accepted, room)).toEqual({
      commands: [
        { modes: '+q', nick: 'drew' },
        { modes: '-q', nick: 'alice' },
      ],
      founderRemains: true,
    });
  });

  it('does not let a bystander accept, and does not pick a successor', () => {
    const offered = offerTransfer({
      current: null,
      channel: '#harbor',
      from: 'alice',
      to: 'drew',
      members: room,
    });
    expect(acceptTransfer({
      current: offered,
      channel: '#harbor',
      acceptor: 'erin',
    })).toBeNull();
    expect(offerTransfer({
      current: null,
      channel: '#harbor',
      from: 'alice',
      to: 'alice',
      members: room,
    })).toBeNull();
  });
});

describe('delete requires the room name', () => {
  it('refuses delete until the typed name matches', () => {
    expect(typedNameMatchesRoom('harbor', '#harbor')).toBe(true);
    expect(typedNameMatchesRoom('#Harbor', '#harbor')).toBe(true);
    expect(typedNameMatchesRoom('#other', '#harbor')).toBe(false);
    expect(canDeleteRoom({ actorIsOwner: true, typedName: '', room: '#harbor' })).toBe(false);
    expect(canDeleteRoom({ actorIsOwner: true, typedName: '#harbor', room: '#harbor' })).toBe(true);
    expect(canDeleteRoom({ actorIsOwner: false, typedName: '#harbor', room: '#harbor' })).toBe(false);
  });
});

describe('last member leave', () => {
  it('dissolves when the last person leaves', () => {
    expect(lastMemberLeaveDissolves(1)).toBe(true);
    expect(lastMemberLeaveDissolves(2)).toBe(false);
  });
});
