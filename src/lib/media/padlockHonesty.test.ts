// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { deriveMediaCryptoState, mediaPadlockView } from './padlockHonesty';

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
});
