// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  FORMATION_COPY,
  FORMATION_INVITE_TARGET,
  FORMATION_WINDOW_HOURS,
  addFormationInvitee,
  browseMemberLabel,
  buildCreateRoomTopic,
  canFinishCreateRoom,
  formatHangLabel,
  isSoftLaunchRoom,
  nextSaturdayHang,
  normalizeCreateRoomName,
  removeFormationInvitee,
  sanitizeCreateInvitee,
  sanitizeCreateRoomTopic,
  suggestedFirstLine,
  visibleBrowseRooms,
} from './createRoomFormation';

describe('normalizeCreateRoomName', () => {
  it('prefixes a bare name and lowercases it', () => {
    expect(normalizeCreateRoomName(' Friends ')).toBe('#friends');
    expect(normalizeCreateRoomName('#Root')).toBe('#root');
    expect(normalizeCreateRoomName('&Ops')).toBe('&ops');
  });

  it('rejects empty, spaces, commas, and bare prefixes', () => {
    expect(normalizeCreateRoomName('')).toBeNull();
    expect(normalizeCreateRoomName('my room')).toBeNull();
    expect(normalizeCreateRoomName('#bad,chan')).toBeNull();
    expect(normalizeCreateRoomName('#')).toBeNull();
  });
});

describe('sanitizeCreateRoomTopic', () => {
  it('trims a short topic and allows empty', () => {
    expect(sanitizeCreateRoomTopic('  Weekly reads  ')).toBe('Weekly reads');
    expect(sanitizeCreateRoomTopic('   ')).toBe('');
  });

  it('rejects control characters and oversized topics', () => {
    expect(sanitizeCreateRoomTopic('hi\u0007there')).toBeNull();
    expect(sanitizeCreateRoomTopic('x'.repeat(301))).toBeNull();
  });
});

describe('create-room finish gate', () => {
  it('refuses to finish until the founder shares or copies an invite', () => {
    expect(canFinishCreateRoom({ sharedInvite: false })).toBe(false);
    expect(canFinishCreateRoom({ sharedInvite: true })).toBe(true);
  });
});

describe('formation invitees', () => {
  it('caps the seat list at three distinct people', () => {
    expect(FORMATION_INVITE_TARGET).toBe(3);
    expect(FORMATION_WINDOW_HOURS).toBe(48);
    expect(FORMATION_COPY).toMatch(/3 people/i);

    let seats: string[] = [];
    seats = addFormationInvitee(seats, ' Ada ') ?? seats;
    seats = addFormationInvitee(seats, 'ada') ?? seats;
    seats = addFormationInvitee(seats, 'Bea') ?? seats;
    seats = addFormationInvitee(seats, 'Cyd') ?? seats;
    expect(addFormationInvitee(seats, 'Dee')).toEqual(['Ada', 'Bea', 'Cyd']);
    expect(seats).toEqual(['Ada', 'Bea', 'Cyd']);
    expect(removeFormationInvitee(seats, 'bea')).toEqual(['Ada', 'Cyd']);
  });

  it('rejects unsafe invitee nicks', () => {
    expect(sanitizeCreateInvitee('bad nick')).toBeNull();
    expect(sanitizeCreateInvitee('evil,comma')).toBeNull();
    expect(sanitizeCreateInvitee('ok_user')).toBe('ok_user');
  });
});

describe('soft-launch browse', () => {
  const rows = [
    { name: '#general', count: 5, topic: 'Launch room' },
    { name: '#random', count: 1, topic: 'Off-topic' },
    { name: '#empty', count: 0, topic: '' },
  ];

  it('hides one-member rooms from the default hall directory', () => {
    expect(visibleBrowseRooms(rows, '')).toEqual([
      { name: '#general', count: 5, topic: 'Launch room' },
    ]);
    expect(isSoftLaunchRoom({ count: 1 })).toBe(true);
    expect(isSoftLaunchRoom({ count: 2 })).toBe(false);
    expect(browseMemberLabel({ count: 1 })).toBe('Just started');
    expect(browseMemberLabel({ count: 5 })).toBe('5 users');
  });

  it('lets search find a just-started room without inventing a lively count', () => {
    expect(visibleBrowseRooms(rows, 'off-topic')).toEqual([
      { name: '#random', count: 1, topic: 'Off-topic' },
    ]);
    expect(browseMemberLabel({ count: 1 })).not.toMatch(/lively|active|hot/i);
  });
});

describe('first line, skin topic, and next Saturday hang', () => {
  it('seeds a first line from the optional skin', () => {
    expect(suggestedFirstLine('friends')).toBe('hey — this is our room');
    expect(suggestedFirstLine('club')).toMatch(/Saturday/i);
    expect(suggestedFirstLine(null)).toBe('hey — this is our room');
  });

  it('builds a topic from skin, custom line, and hang without control chars', () => {
    expect(buildCreateRoomTopic({
      skin: 'club',
      topic: ' Weekly reads ',
      hangLabel: 'Saturday 4:00 PM',
    })).toBe('Club hang · Weekly reads · Next hang: Saturday 4:00 PM');
    expect(buildCreateRoomTopic({ topic: '' })).toBe('');
    expect(buildCreateRoomTopic({ topic: 'hi\u0007' })).toBeNull();
  });

  it('picks the upcoming Saturday afternoon, not a past slot', () => {
    const thursday = new Date('2026-08-20T12:00:00');
    const hang = nextSaturdayHang(thursday, 16, 0);
    expect(hang.getDay()).toBe(6);
    expect(hang.getHours()).toBe(16);
    expect(formatHangLabel(hang)).toMatch(/Saturday/i);

    const saturdayEvening = new Date('2026-08-22T18:00:00');
    const next = nextSaturdayHang(saturdayEvening, 16, 0);
    expect(next.getTime()).toBeGreaterThan(saturdayEvening.getTime());
    expect(next.getDay()).toBe(6);
  });
});
