// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  callSecurityUsesPadlock,
  mediaCryptoFlagsFromCall,
  mediaPadlockForCall,
  resolveCallSecurity,
  type CallSecurityAffordance,
  type CallSecurityInput,
} from './callSecurity';
import { deriveMediaCryptoState, mediaPadlockView } from '@/lib/media/padlockHonesty';

function expectNoPadlock(affordance: CallSecurityAffordance | null): void {
  expect(affordance).not.toBeNull();
  expect(affordance!.usesPadlock).toBe(false);
  expect(affordance!.padlock.honestPrivate).toBe(false);
  expect(affordance!.icon).not.toBe('lock');
  expect(callSecurityUsesPadlock(affordance)).toBe(false);
}

/** usesPadlock must always equal C7 honestPrivate (unify contract). */
function expectHonestyAligned(affordance: CallSecurityAffordance | null): void {
  expect(affordance).not.toBeNull();
  expect(affordance!.usesPadlock).toBe(affordance!.padlock.honestPrivate);
  if (affordance!.usesPadlock) {
    expect(affordance!.icon).toBe('lock');
    expect(affordance!.padlock.glyph).toBe('lock');
    expect(affordance!.padlock.tone).toBe('private');
  } else {
    expect(affordance!.icon).not.toBe('lock');
  }
}

describe('resolveCallSecurity', () => {
  it('returns null when the call is idle', () => {
    expect(resolveCallSecurity({ callState: 'idle' })).toBeNull();
    expect(callSecurityUsesPadlock(null)).toBe(false);
  });

  it('uses shield language for hop-protected in-call media (no padlock)', () => {
    const affordance = resolveCallSecurity({ callState: 'in_call' });

    expect(affordance).toEqual(
      expect.objectContaining({
        level: 'hop_protected',
        icon: 'shield',
        usesPadlock: false,
      }),
    );
    expect(affordance!.label).toMatch(/protected connection/i);
    expect(affordance!.detail.toLowerCase()).toContain('encrypted to this server');
    expect(affordance!.detail.toLowerCase()).toContain('server operators');
    expect(affordance!.padlock.tone).toBe('public');
    expectNoPadlock(affordance);
    expectHonestyAligned(affordance);
  });

  it('never shows a padlock when media E2EE flags are absent or false', () => {
    for (const input of [
      { callState: 'in_call' as const },
      { callState: 'in_call' as const, mediaE2eeActive: false },
      { callState: 'in_call' as const, mediaE2eeActive: false, mediaE2eeDegraded: false },
      { callState: 'ringing_out' as const },
      { callState: 'ringing_in' as const },
    ]) {
      const affordance = resolveCallSecurity(input);
      expectNoPadlock(affordance);
      expectHonestyAligned(affordance);
    }
  });

  it('shows connecting affordance while ringing', () => {
    for (const callState of ['ringing_out', 'ringing_in'] as const) {
      const affordance = resolveCallSecurity({ callState });
      expect(affordance).toEqual(
        expect.objectContaining({
          level: 'connecting',
          icon: 'spinner',
          usesPadlock: false,
        }),
      );
      expect(affordance!.label).toMatch(/connecting/i);
      expect(affordance!.padlock.tone).toBe('neutral');
      expectNoPadlock(affordance);
      expectHonestyAligned(affordance);
    }
  });

  it('allows a padlock only when media E2EE is actually active', () => {
    const affordance = resolveCallSecurity({
      callState: 'in_call',
      mediaE2eeActive: true,
    });

    expect(affordance).toEqual(
      expect.objectContaining({
        level: 'e2ee',
        icon: 'lock',
        usesPadlock: true,
      }),
    );
    expect(affordance!.label).toMatch(/end-to-end/i);
    expect(affordance!.padlock.honestPrivate).toBe(true);
    expect(callSecurityUsesPadlock(affordance)).toBe(true);
    expectHonestyAligned(affordance);
  });

  it('prefers degraded E2EE over full E2EE (open lock, not closed padlock)', () => {
    const affordance = resolveCallSecurity({
      callState: 'in_call',
      mediaE2eeActive: true,
      mediaE2eeDegraded: true,
    });

    expect(affordance).toEqual(
      expect.objectContaining({
        level: 'e2ee_degraded',
        icon: 'lock_open',
        usesPadlock: false,
      }),
    );
    expect(affordance!.padlock.glyph).toBe('shield');
    expect(affordance!.padlock.tone).toBe('partial');
    expectNoPadlock(affordance);
    expectHonestyAligned(affordance);
  });

  it('stage mode never claims private or padlock, even if E2EE flags are set', () => {
    const affordance = resolveCallSecurity({
      callState: 'in_call',
      stageMode: true,
      mediaE2eeActive: true,
    });

    expect(affordance).toEqual(
      expect.objectContaining({
        level: 'stage',
        icon: 'stage',
        usesPadlock: false,
      }),
    );
    expect(affordance!.detail.toLowerCase()).toContain('broadcast');
    expect(affordance!.padlock.honestPrivate).toBe(false);
    expectNoPadlock(affordance);
    expectHonestyAligned(affordance);
  });

  it('surfaces insecure transport without a padlock', () => {
    const affordance = resolveCallSecurity({
      callState: 'in_call',
      transportInsecure: true,
    });

    expect(affordance).toEqual(
      expect.objectContaining({
        level: 'insecure',
        icon: 'warning',
        usesPadlock: false,
      }),
    );
    expect(affordance!.padlock.tone).toBe('danger');
    expectNoPadlock(affordance);
    expectHonestyAligned(affordance);
  });

  it('prioritizes stage over insecure and E2EE', () => {
    const affordance = resolveCallSecurity({
      callState: 'in_call',
      stageMode: true,
      transportInsecure: true,
      mediaE2eeActive: true,
      mediaE2eeDegraded: true,
    });
    expect(affordance?.level).toBe('stage');
    expectNoPadlock(affordance);
    expectHonestyAligned(affordance);
  });

  it('prioritizes insecure over E2EE when not on stage', () => {
    const affordance = resolveCallSecurity({
      callState: 'in_call',
      transportInsecure: true,
      mediaE2eeActive: true,
    });
    expect(affordance?.level).toBe('insecure');
    expectNoPadlock(affordance);
    expectHonestyAligned(affordance);
  });
});

describe('padlockHonesty unify (C7)', () => {
  const cases: CallSecurityInput[] = [
    { callState: 'in_call' },
    { callState: 'in_call', mediaE2eeActive: true },
    { callState: 'in_call', mediaE2eeActive: true, mediaE2eeDegraded: true },
    { callState: 'in_call', stageMode: true, mediaE2eeActive: true },
    { callState: 'in_call', transportInsecure: true },
    { callState: 'ringing_out' },
    { callState: 'ringing_in' },
  ];

  it('usesPadlock always equals mediaPadlockView.honestPrivate', () => {
    for (const input of cases) {
      const affordance = resolveCallSecurity(input);
      const expected = mediaPadlockForCall(input);
      expect(affordance).not.toBeNull();
      expect(affordance!.usesPadlock).toBe(expected.honestPrivate);
      expect(affordance!.padlock).toEqual(expected);
    }
  });

  it('maps call flags through deriveMediaCryptoState without inventing privacy', () => {
    for (const input of cases) {
      const flags = mediaCryptoFlagsFromCall(input);
      const state = deriveMediaCryptoState(flags);
      const view = mediaPadlockView(state);
      // Closed padlock only for the full encrypted triple.
      if (view.honestPrivate) {
        expect(flags.mooringUp).toBe(true);
        expect(flags.e2eeSealed).toBe(true);
        expect(flags.mediaMacOk).toBe(true);
        expect(flags.error).toBeFalsy();
        expect(flags.connecting).toBeFalsy();
      }
    }
  });

  it('hop-only maps to relayed (public), never encrypted', () => {
    const flags = mediaCryptoFlagsFromCall({ callState: 'in_call' });
    expect(deriveMediaCryptoState(flags)).toBe('relayed');
    expect(mediaPadlockForCall({ callState: 'in_call' }).honestPrivate).toBe(false);
  });

  it('active media E2EE maps to encrypted with honestPrivate', () => {
    const input: CallSecurityInput = { callState: 'in_call', mediaE2eeActive: true };
    expect(deriveMediaCryptoState(mediaCryptoFlagsFromCall(input))).toBe('encrypted');
    expect(mediaPadlockForCall(input).honestPrivate).toBe(true);
  });
});
