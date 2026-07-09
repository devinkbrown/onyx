import { describe, expect, it } from 'vitest';

import type { ChannelUser } from '@/lib/irc/types';
import { buildFacepile, buildVoiceRoomStatus } from './PresenceRibbon';

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

describe('buildVoiceRoomStatus', () => {
  it('summarizes active speakers and local device health', () => {
    const status = buildVoiceRoomStatus({
      participants: ['alice', 'bob'],
      speakingNicks: new Set(['alice']),
      mutedNicks: new Set<string>(),
      raisedHands: new Set<string>(),
      currentCall: true,
      localMuted: true,
      localDeafened: false,
      localCameraOn: false,
      localScreenshareActive: true,
      localCaptionsEnabled: false,
    });

    expect(status.label).toBe('alice speaking · muted, sharing');
    expect(status.ariaStatus).toContain('alice is speaking');
    expect(status.ariaStatus).toContain('your microphone is muted');
    expect(status.ariaStatus).toContain('you are sharing your screen');
  });

  it('falls back to listener, raised-hand, and peer mute states', () => {
    expect(buildVoiceRoomStatus({
      participants: ['alice', 'bob'],
      speakingNicks: new Set<string>(),
      mutedNicks: new Set<string>(),
      raisedHands: new Set<string>(),
      currentCall: true,
      localMuted: false,
      localDeafened: false,
      localCameraOn: false,
      localScreenshareActive: false,
      localCaptionsEnabled: false,
    }).label).toBe('listening');

    expect(buildVoiceRoomStatus({
      participants: ['alice', 'bob'],
      speakingNicks: new Set<string>(),
      mutedNicks: new Set<string>(),
      raisedHands: new Set(['bob']),
      currentCall: false,
      localMuted: false,
      localDeafened: false,
      localCameraOn: false,
      localScreenshareActive: false,
      localCaptionsEnabled: false,
    }).label).toBe('bob raised');

    expect(buildVoiceRoomStatus({
      participants: ['alice', 'bob'],
      speakingNicks: new Set<string>(),
      mutedNicks: new Set(['alice', 'bob']),
      raisedHands: new Set<string>(),
      currentCall: false,
      localMuted: false,
      localDeafened: false,
      localCameraOn: false,
      localScreenshareActive: false,
      localCaptionsEnabled: false,
    }).label).toBe('2 muted');
  });
});
