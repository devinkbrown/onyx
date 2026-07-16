// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { buildVoiceRoomStatus } from './PresenceRibbon';

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

  it('matches lowercase speaking state to a display-cased participant', () => {
    const status = buildVoiceRoomStatus({
      participants: ['Alice'],
      speakingNicks: new Set(['alice']),
      mutedNicks: new Set<string>(),
      raisedHands: new Set<string>(),
      currentCall: false,
      localMuted: false,
      localDeafened: false,
      localCameraOn: false,
      localScreenshareActive: false,
      localCaptionsEnabled: false,
    });

    expect(status.label).toBe('Alice speaking');
    expect(status.ariaStatus).toBe('Alice is speaking');
  });

  it('matches mixed-case raised-hand and mute state without changing display casing', () => {
    const raised = buildVoiceRoomStatus({
      participants: ['Bob'],
      speakingNicks: new Set<string>(),
      mutedNicks: new Set<string>(),
      raisedHands: new Set(['bOB']),
      currentCall: false,
      localMuted: false,
      localDeafened: false,
      localCameraOn: false,
      localScreenshareActive: false,
      localCaptionsEnabled: false,
    });
    const muted = buildVoiceRoomStatus({
      participants: ['Carol'],
      speakingNicks: new Set<string>(),
      mutedNicks: new Set(['CAROL']),
      raisedHands: new Set<string>(),
      currentCall: false,
      localMuted: false,
      localDeafened: false,
      localCameraOn: false,
      localScreenshareActive: false,
      localCaptionsEnabled: false,
    });

    expect(raised.label).toBe('Bob raised');
    expect(raised.ariaStatus).toBe('Bob has a hand raised');
    expect(muted.label).toBe('1 muted');
    expect(muted.ariaStatus).toBe('1 person is muted');
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
