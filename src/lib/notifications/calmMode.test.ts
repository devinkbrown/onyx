import { beforeEach, describe, expect, it } from 'vitest';

import {
  CALM_PRESETS,
  classifyNotification,
  loadCalmPreset,
  setCalmPreset,
  type CalmContext,
  type CalmPreset,
  type NotifTier,
} from './calmMode';

const STORAGE_KEY = 'onyx:calm';
const QUIET_CONTEXT: CalmContext = {
  isMention: false,
  isFollowed: false,
  isDirect: false,
  isBoost: false,
};

function context(overrides: Partial<CalmContext>): CalmContext {
  return { ...QUIET_CONTEXT, ...overrides };
}

describe('calm notification mode', () => {
  beforeEach(() => localStorage.clear());

  describe('classifyNotification', () => {
    const cases: readonly {
      name: string;
      preset: CalmPreset;
      ctx: CalmContext;
      expected: NotifTier;
    }[] = [
      { name: 'calm mentions notify', preset: 'calm', ctx: context({ isMention: true }), expected: 'notify' },
      { name: 'calm DMs notify', preset: 'calm', ctx: context({ isDirect: true }), expected: 'notify' },
      { name: 'calm followed conversations badge', preset: 'calm', ctx: context({ isFollowed: true }), expected: 'badge' },
      { name: 'calm ambient chatter stays silent', preset: 'calm', ctx: QUIET_CONTEXT, expected: 'silent' },
      { name: 'regular mentions notify', preset: 'regular', ctx: context({ isMention: true }), expected: 'notify' },
      { name: 'regular DMs notify', preset: 'regular', ctx: context({ isDirect: true }), expected: 'notify' },
      { name: 'regular followed conversations notify', preset: 'regular', ctx: context({ isFollowed: true }), expected: 'notify' },
      { name: 'regular ambient chatter badges', preset: 'regular', ctx: QUIET_CONTEXT, expected: 'badge' },
      { name: 'power mentions notify', preset: 'power', ctx: context({ isMention: true }), expected: 'notify' },
      { name: 'power DMs notify', preset: 'power', ctx: context({ isDirect: true }), expected: 'notify' },
      { name: 'power followed conversations notify', preset: 'power', ctx: context({ isFollowed: true }), expected: 'notify' },
      { name: 'power ambient chatter notifies', preset: 'power', ctx: QUIET_CONTEXT, expected: 'notify' },
    ];

    for (const entry of cases) {
      it(entry.name, () => {
        expect(classifyNotification(entry.preset, entry.ctx)).toBe(entry.expected);
      });
    }

    for (const preset of CALM_PRESETS) {
      it(`keeps boosts silent for ${preset}`, () => {
        expect(classifyNotification(preset, context({
          isBoost: true,
          isDirect: true,
          isFollowed: true,
          isMention: true,
        }))).toBe('silent');
      });
    }
  });

  describe('loadCalmPreset', () => {
    it('returns regular when storage is empty', () => {
      expect(loadCalmPreset()).toBe('regular');
    });

    it('returns regular when the stored value is invalid', () => {
      localStorage.setItem(STORAGE_KEY, 'urgent');
      expect(loadCalmPreset()).toBe('regular');
    });
  });

  describe('setCalmPreset', () => {
    it('roundtrips through localStorage', () => {
      setCalmPreset('power');

      expect(localStorage.getItem(STORAGE_KEY)).toBe('power');
      expect(loadCalmPreset()).toBe('power');
    });
  });
});
