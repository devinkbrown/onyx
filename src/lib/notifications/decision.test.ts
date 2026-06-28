import { describe, expect, it } from 'vitest';

import { shouldNotify } from './decision';

const base = {
  kind: 'mention' as const,
  isSelf: false,
  pushEnabled: true,
  soundEnabled: true,
  dnd: false,
  permission: 'granted' as const,
  pageVisible: false,
  appFocused: false,
  nowMs: 10_000,
};

describe('shouldNotify', () => {
  it('allows desktop and sound for mentions while the app is inactive', () => {
    expect(shouldNotify(base)).toMatchObject({
      desktop: true,
      sound: true,
      desktopReason: 'ok',
      soundReason: 'ok',
    });
  });

  it('allows DM alerts through the same inactive path', () => {
    expect(shouldNotify({ ...base, kind: 'dm' })).toMatchObject({
      desktop: true,
      sound: true,
    });
  });

  it('suppresses alerts while focused', () => {
    expect(shouldNotify({ ...base, pageVisible: true, appFocused: true })).toMatchObject({
      desktop: false,
      sound: false,
      desktopReason: 'focused',
      soundReason: 'focused',
    });
  });

  it('suppresses desktop notification when permission is denied but still allows sound', () => {
    expect(shouldNotify({ ...base, permission: 'denied' })).toMatchObject({
      desktop: false,
      sound: true,
      desktopReason: 'permission',
      soundReason: 'ok',
    });
  });

  it('suppresses notification and sound during do not disturb', () => {
    expect(shouldNotify({ ...base, dnd: true })).toMatchObject({
      desktop: false,
      sound: false,
      desktopReason: 'dnd',
      soundReason: 'dnd',
    });
  });

  it('does not notify for our own echoed message', () => {
    expect(shouldNotify({ ...base, isSelf: true })).toMatchObject({
      desktop: false,
      sound: false,
      desktopReason: 'self',
      soundReason: 'self',
    });
  });

  it('throttles desktop and sound independently', () => {
    expect(shouldNotify({
      ...base,
      lastDesktopAtMs: 9500,
      lastSoundAtMs: 9500,
      desktopThrottleMs: 1000,
      soundThrottleMs: 800,
    })).toMatchObject({
      desktop: false,
      sound: false,
      desktopReason: 'throttled',
      soundReason: 'throttled',
    });
  });
});
