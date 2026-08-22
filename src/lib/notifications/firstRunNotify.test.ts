// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FIRST_RUN_NOTIFY_LEDE,
  FIRST_RUN_NOTIFY_TITLE,
  NOTIFY_FIRST_RUN_DISMISS_KEY,
  NOTIFY_FIRST_SEND_KEY,
  canClaimClosedTabPush,
  dismissNotifyAsk,
  firstRunNotifyCopy,
  hasNotifyFirstSend,
  isIosSafariLike,
  isNotifyAskDismissed,
  markNotifyFirstSend,
  resetFirstRunNotifyState,
  shouldOfferFirstRunNotify,
} from './firstRunNotify';

describe('first-run notify decision', () => {
  beforeEach(() => {
    localStorage.clear();
    resetFirstRunNotifyState();
  });

  afterEach(() => {
    resetFirstRunNotifyState();
    localStorage.clear();
  });

  it('does not offer on first paint — no send yet', () => {
    const base = {
      sent: false,
      dismissed: false,
      permission: 'default' as const,
      surface: 'browser' as const,
      hostNotifications: false,
      ios: false,
      standalone: false,
    };
    expect(shouldOfferFirstRunNotify(base)).toBe(false);
    expect(shouldOfferFirstRunNotify({ ...base, sent: true })).toBe(true);
  });

  it('offers only after a send, once, when permission is still default', () => {
    const base = {
      sent: true,
      dismissed: false,
      permission: 'default' as const,
      surface: 'browser' as const,
      hostNotifications: false,
      ios: false,
      standalone: false,
    };
    expect(shouldOfferFirstRunNotify(base)).toBe(true);
    expect(shouldOfferFirstRunNotify({ ...base, dismissed: true })).toBe(false);
    expect(shouldOfferFirstRunNotify({ ...base, permission: 'granted' })).toBe(false);
    expect(shouldOfferFirstRunNotify({ ...base, permission: 'denied' })).toBe(false);
    expect(shouldOfferFirstRunNotify({ ...base, permission: 'unsupported' })).toBe(false);
  });

  it('does not ask on the Zig host when native notifications are false', () => {
    expect(shouldOfferFirstRunNotify({
      sent: true,
      dismissed: false,
      permission: 'default',
      surface: 'zig-desktop',
      hostNotifications: false,
      ios: false,
      standalone: false,
    })).toBe(false);
    expect(shouldOfferFirstRunNotify({
      sent: true,
      dismissed: false,
      permission: 'default',
      surface: 'zig-desktop',
      hostNotifications: true,
      ios: false,
      standalone: false,
    })).toBe(true);
  });

  it('iOS tab does not claim push; Home Screen standalone may', () => {
    expect(isIosSafariLike({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe(true);
    expect(isIosSafariLike({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' })).toBe(true);
    expect(isIosSafariLike({ platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIosSafariLike({ userAgent: 'Mozilla/5.0 Chrome/126.0.0.0 Mobile Safari/537.36' })).toBe(false);

    expect(canClaimClosedTabPush({ ios: true, standalone: false })).toBe(false);
    expect(canClaimClosedTabPush({ ios: true, standalone: true })).toBe(true);
    expect(canClaimClosedTabPush({ ios: false, standalone: false })).toBe(true);

    expect(firstRunNotifyCopy({ ios: true, standalone: false })).toBeNull();
    expect(firstRunNotifyCopy({ ios: true, standalone: true })).toEqual({
      title: FIRST_RUN_NOTIFY_TITLE,
      lede: FIRST_RUN_NOTIFY_LEDE,
    });

    expect(shouldOfferFirstRunNotify({
      sent: true,
      dismissed: false,
      permission: 'default',
      surface: 'browser',
      hostNotifications: false,
      ios: true,
      standalone: false,
    })).toBe(false);
    expect(shouldOfferFirstRunNotify({
      sent: true,
      dismissed: false,
      permission: 'default',
      surface: 'pwa',
      hostNotifications: false,
      ios: true,
      standalone: true,
    })).toBe(true);
  });

  it('persists first send and dismiss under onyx: keys', () => {
    expect(hasNotifyFirstSend()).toBe(false);
    expect(isNotifyAskDismissed()).toBe(false);

    markNotifyFirstSend();
    dismissNotifyAsk();

    expect(hasNotifyFirstSend()).toBe(true);
    expect(isNotifyAskDismissed()).toBe(true);
    expect(localStorage.getItem(NOTIFY_FIRST_SEND_KEY)).toBe('1');
    expect(localStorage.getItem(NOTIFY_FIRST_RUN_DISMISS_KEY)).toBe('1');

    markNotifyFirstSend();
    dismissNotifyAsk();
    expect(localStorage.getItem(NOTIFY_FIRST_SEND_KEY)).toBe('1');
  });

  it('dismissed stays dismissed', () => {
    markNotifyFirstSend();
    dismissNotifyAsk();
    expect(shouldOfferFirstRunNotify({
      sent: hasNotifyFirstSend(),
      dismissed: isNotifyAskDismissed(),
      permission: 'default',
      surface: 'browser',
      hostNotifications: false,
      ios: false,
      standalone: false,
    })).toBe(false);
  });
});
