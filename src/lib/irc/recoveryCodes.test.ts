// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  isRecoveryCodesCleared,
  isRecoveryCodesGenerated,
  isRecoveryCodesLoginOk,
  normalizeRecoveryCodeInput,
  parseRecoveryCodeLine,
  parseRecoveryCodesStatus,
} from './recoveryCodes';

describe('recoveryCodes', () => {
  it('parses status counts', () => {
    expect(parseRecoveryCodesStatus('RECOVERYCODES: 0 unused codes')).toEqual({ remaining: 0 });
    expect(parseRecoveryCodesStatus('RECOVERYCODES: 1 unused code')).toEqual({ remaining: 1 });
    expect(parseRecoveryCodesStatus('RECOVERYCODES: 10 unused codes')).toEqual({ remaining: 10 });
    expect(parseRecoveryCodesStatus('nope')).toBeNull();
  });

  it('parses dashed code lines', () => {
    expect(parseRecoveryCodeLine('RECOVERYCODES: 3. ABCDE-FGHIJ')).toEqual({
      index: 3,
      code: 'ABCDE-FGHIJ',
    });
    expect(parseRecoveryCodeLine('RECOVERYCODES: generated 10')).toBeNull();
  });

  it('recognizes lifecycle notices', () => {
    expect(isRecoveryCodesGenerated('RECOVERYCODES: generated 10 single-use codes — copy them now')).toBe(true);
    expect(isRecoveryCodesLoginOk('RECOVERYCODES: login ok — that code is now spent')).toBe(true);
    expect(isRecoveryCodesCleared('RECOVERYCODES: all recovery codes cleared')).toBe(true);
  });

  it('normalizes dashed input for LOGIN', () => {
    expect(normalizeRecoveryCodeInput('abCde-fghij')).toBe('ABCDEFGHIJ');
    expect(normalizeRecoveryCodeInput('  ABCDE FGH IJ ')).toBe('ABCDEFGHIJ');
  });
});
