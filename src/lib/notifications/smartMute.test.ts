// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { matchesSmartMute, parseSmartMute } from './smartMute';

describe('smartMute', () => {
  it('matches keywords and muted nicks', () => {
    const rules = parseSmartMute({
      keywords: ['crypto airdrop'],
      mutedNicks: ['NoisyBot'],
      muteSystemNoise: true,
    });
    expect(matchesSmartMute(rules, { text: 'Free CRYPTO AIRDROP now', from: 'alice', kind: 'mention' })).toBe(true);
    expect(matchesSmartMute(rules, { text: 'hello', from: 'noisybot', kind: 'dm' })).toBe(true);
    expect(matchesSmartMute(rules, { text: 'joined', from: 'x', kind: 'system' })).toBe(true);
    expect(matchesSmartMute(rules, { text: 'hello', from: 'bob', kind: 'dm' })).toBe(false);
  });
});
