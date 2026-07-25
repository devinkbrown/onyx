// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { deriveMediaCryptoState, mediaPadlockView } from './padlockHonesty';
import {
  mediaCryptoFlagsFromCall,
  mediaPadlockForCall,
  resolveCallSecurity,
} from '@/lib/cadence-media/callSecurity';

describe('media padlock honesty (C7)', () => {
  it('only marks honestPrivate when fully encrypted', () => {
    expect(mediaPadlockView('encrypted').honestPrivate).toBe(true);
    expect(mediaPadlockView('relayed').honestPrivate).toBe(false);
    expect(mediaPadlockView('authenticated-only').glyph).toBe('shield');
  });

  it('derives fail-open public when flags incomplete', () => {
    expect(deriveMediaCryptoState({ mooringUp: true, e2eeSealed: true, mediaMacOk: true })).toBe('encrypted');
    expect(deriveMediaCryptoState({ mediaMacOk: true })).toBe('authenticated-only');
    expect(deriveMediaCryptoState({ mooringUp: false })).toBe('relayed');
    expect(deriveMediaCryptoState({ error: true })).toBe('error');
  });

  it('call security chip padlock is gated by this honesty table', () => {
    // Hop-only in-call → relayed → never private.
    expect(mediaPadlockForCall({ callState: 'in_call' }).honestPrivate).toBe(false);
    expect(resolveCallSecurity({ callState: 'in_call' })!.usesPadlock).toBe(false);

    // Full media E2EE → encrypted → private lock permitted.
    const e2ee = { callState: 'in_call' as const, mediaE2eeActive: true };
    expect(deriveMediaCryptoState(mediaCryptoFlagsFromCall(e2ee))).toBe('encrypted');
    expect(mediaPadlockForCall(e2ee).honestPrivate).toBe(true);
    expect(resolveCallSecurity(e2ee)!.usesPadlock).toBe(true);

    // Degraded room → authenticated-only → no closed padlock.
    const degraded = {
      callState: 'in_call' as const,
      mediaE2eeActive: true,
      mediaE2eeDegraded: true,
    };
    expect(deriveMediaCryptoState(mediaCryptoFlagsFromCall(degraded))).toBe('authenticated-only');
    expect(mediaPadlockForCall(degraded).honestPrivate).toBe(false);
    expect(resolveCallSecurity(degraded)!.usesPadlock).toBe(false);
  });
});
