// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { resolveCallPrivacy } from './callPrivacy';

describe('resolveCallPrivacy', () => {
  it('returns null when idle', () => {
    expect(resolveCallPrivacy({ callState: 'idle' })).toBeNull();
  });

  it('describes hop-only in-call media without a padlock or epoch code', () => {
    const details = resolveCallPrivacy({ callState: 'in_call' });
    expect(details).not.toBeNull();
    expect(details!.level).toBe('hop_protected');
    expect(details!.usesPadlock).toBe(false);
    expect(details!.serverCanAccessMedia).toBe(true);
    expect(details!.epochCode).toBeNull();
    expect(details!.summary.toLowerCase()).toContain('encrypted to this server');
    expect(details!.summary.toLowerCase()).toContain('server operators');
  });

  it('marks server-inaccessible media only when media E2EE is active', () => {
    const details = resolveCallPrivacy({
      callState: 'in_call',
      mediaE2eeActive: true,
    });
    expect(details!.level).toBe('e2ee');
    expect(details!.usesPadlock).toBe(true);
    expect(details!.serverCanAccessMedia).toBe(false);
    expect(details!.epochCode).toBeNull(); // reserved until exporter ships
  });

  it('never invents an epoch code for stage or connecting states', () => {
    for (const input of [
      { callState: 'ringing_in' as const },
      { callState: 'in_call' as const, stageMode: true },
      { callState: 'in_call' as const, transportInsecure: true },
    ]) {
      const details = resolveCallPrivacy(input);
      expect(details!.epochCode).toBeNull();
      expect(details!.usesPadlock).toBe(false);
    }
  });
});
