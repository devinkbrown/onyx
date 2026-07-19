// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  callSecurityUsesPadlock,
  resolveCallSecurity,
  type CallSecurityAffordance,
} from './callSecurity';

function expectNoPadlock(affordance: CallSecurityAffordance | null): void {
  expect(affordance).not.toBeNull();
  expect(affordance!.usesPadlock).toBe(false);
  expect(affordance!.icon).not.toBe('lock');
  expect(callSecurityUsesPadlock(affordance)).toBe(false);
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
    expectNoPadlock(affordance);
  });

  it('never shows a padlock when media E2EE flags are absent or false', () => {
    for (const input of [
      { callState: 'in_call' as const },
      { callState: 'in_call' as const, mediaE2eeActive: false },
      { callState: 'in_call' as const, mediaE2eeActive: false, mediaE2eeDegraded: false },
      { callState: 'ringing_out' as const },
      { callState: 'ringing_in' as const },
    ]) {
      expectNoPadlock(resolveCallSecurity(input));
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
      expectNoPadlock(affordance);
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
    expect(callSecurityUsesPadlock(affordance)).toBe(true);
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
    expectNoPadlock(affordance);
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
    expectNoPadlock(affordance);
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
    expectNoPadlock(affordance);
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
  });

  it('prioritizes insecure over E2EE when not on stage', () => {
    const affordance = resolveCallSecurity({
      callState: 'in_call',
      transportInsecure: true,
      mediaE2eeActive: true,
    });
    expect(affordance?.level).toBe('insecure');
    expectNoPadlock(affordance);
  });
});
