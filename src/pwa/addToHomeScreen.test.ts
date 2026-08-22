// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';

import {
  A2HS_CHROMIUM_LEDE,
  A2HS_DISMISS_KEY,
  A2HS_IOS_LEDE,
  A2HS_IOS_PUSH,
  A2HS_SENT_KEY,
  A2HS_SESSION_KEY,
  A2HS_TITLE,
  A2HS_VISIT_KEY,
  a2hsCopyFor,
  captureBeforeInstallPrompt,
  conversationHasSentMessage,
  detectA2hsPlatform,
  dismissAddToHomeScreen,
  hasHomeScreenEngagement,
  hasSentHomeScreenMessage,
  isA2hsDismissed,
  isIosSafariLike,
  isRealSentMessage,
  isReturningHomeScreenVisit,
  markHomeScreenMessageSent,
  peekCapturedInstallPrompt,
  rememberHomeScreenVisit,
  requestHomeScreenAdd,
  resetAddToHomeScreenState,
  shouldOfferAddToHomeScreen,
  startBeforeInstallPromptCapture,
  stateHasJoinedRoom,
  stateHasSentMessage,
} from './addToHomeScreen';

function message(type: ChatMessage['type'], from = 'me'): Pick<ChatMessage, 'type' | 'from'> {
  return { type, from };
}

function promptEvent(prompt = vi.fn(async () => {})) {
  return {
    preventDefault: vi.fn(),
    prompt,
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  };
}

describe('Add to Home Screen decision', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetAddToHomeScreenState();
  });

  afterEach(() => {
    resetAddToHomeScreenState();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('does not offer on first paint — no engagement yet', () => {
    expect(shouldOfferAddToHomeScreen({
      engaged: hasHomeScreenEngagement({
        sent: false,
        returning: false,
        joinedRoom: false,
      }),
      dismissed: false,
      standalone: false,
      surface: 'browser',
      platform: 'chromium',
      hasCapturedPrompt: true,
    })).toBe(false);
  });

  it('does not treat a first-visit joined room as engagement without a sent message', () => {
    expect(hasHomeScreenEngagement({
      sent: false,
      returning: false,
      joinedRoom: true,
    })).toBe(false);
    expect(shouldOfferAddToHomeScreen({
      engaged: false,
      dismissed: false,
      standalone: false,
      surface: 'browser',
      platform: 'ios',
      hasCapturedPrompt: false,
    })).toBe(false);
  });

  it('allows the courtesy after a sent message or a later visit with a room joined', () => {
    const chromium = {
      dismissed: false,
      standalone: false,
      surface: 'browser' as const,
      platform: 'chromium' as const,
      hasCapturedPrompt: true,
    };
    expect(shouldOfferAddToHomeScreen({
      ...chromium,
      engaged: hasHomeScreenEngagement({ sent: true, returning: false, joinedRoom: false }),
    })).toBe(true);
    expect(shouldOfferAddToHomeScreen({
      ...chromium,
      engaged: hasHomeScreenEngagement({ sent: false, returning: true, joinedRoom: true }),
    })).toBe(true);
    expect(shouldOfferAddToHomeScreen({
      ...chromium,
      engaged: hasHomeScreenEngagement({ sent: false, returning: true, joinedRoom: false }),
    })).toBe(false);
  });

  it('counts only our real chat as a sent message — not joins or someone else', () => {
    expect(isRealSentMessage(message('msg'))).toBe(true);
    expect(isRealSentMessage(message('action'))).toBe(true);
    expect(isRealSentMessage(message('whisper'))).toBe(true);
    expect(isRealSentMessage(message('join'))).toBe(false);
    expect(conversationHasSentMessage([message('join', 'me'), message('msg', 'bob')], 'me')).toBe(false);
    expect(conversationHasSentMessage([message('msg', 'Me')], 'me')).toBe(true);
    expect(stateHasSentMessage({
      ourNick: 'me',
      channels: new Map([['#room', { messages: [message('join', 'me')] }]]),
      dms: new Map(),
    })).toBe(false);
    expect(stateHasSentMessage({
      ourNick: 'me',
      channels: new Map(),
      dms: new Map([['bob', { messages: [message('msg', 'me')] }]]),
    })).toBe(true);
    expect(stateHasJoinedRoom({ channels: new Map() })).toBe(false);
    expect(stateHasJoinedRoom({ channels: new Map([['#room', {}]]) })).toBe(true);
  });

  it('captures beforeinstallprompt and never auto-prompts', async () => {
    const event = promptEvent();
    const stop = startBeforeInstallPromptCapture(window);
    const native = new Event('beforeinstallprompt');
    Object.assign(native, event);
    window.dispatchEvent(native);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.prompt).not.toHaveBeenCalled();
    expect(peekCapturedInstallPrompt()).toBe(native);

    captureBeforeInstallPrompt(event);
    expect(event.prompt).not.toHaveBeenCalled();

    stop();
  });

  it('iOS copy is Share → Add to Home Screen and never claims beforeinstallprompt', () => {
    expect(detectA2hsPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe('ios');
    expect(isIosSafariLike({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' })).toBe(true);
    expect(isIosSafariLike({ platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(detectA2hsPlatform({ userAgent: 'Mozilla/5.0 Chrome/126.0.0.0 Mobile Safari/537.36' })).toBe('chromium');

    const ios = a2hsCopyFor('ios');
    const chrome = a2hsCopyFor('chromium');
    const surfaces = [A2HS_TITLE, ios.lede, ios.detail, chrome.lede].join('\n');

    expect(ios.lede).toBe(A2HS_IOS_LEDE);
    expect(ios.detail).toBe(A2HS_IOS_PUSH);
    expect(chrome.lede).toBe(A2HS_CHROMIUM_LEDE);
    expect(surfaces).toMatch(/Add to Home Screen/);
    expect(surfaces).toMatch(/Share/);
    expect(surfaces).toMatch(/Home Screen web app/);
    expect(surfaces).toMatch(/not from a Safari tab/);
    expect(surfaces).not.toMatch(/beforeinstallprompt/i);
    expect(surfaces).not.toMatch(/install the app/i);
    expect(surfaces).not.toMatch(/TestFlight|App Store|Play Store|DMG/i);
  });

  it('iOS can be offered without a captured prompt; other browsers cannot', () => {
    const base = {
      engaged: true,
      dismissed: false,
      standalone: false,
      surface: 'browser' as const,
    };
    expect(shouldOfferAddToHomeScreen({
      ...base,
      platform: 'ios',
      hasCapturedPrompt: false,
    })).toBe(true);
    expect(shouldOfferAddToHomeScreen({
      ...base,
      platform: 'chromium',
      hasCapturedPrompt: false,
    })).toBe(false);
    expect(shouldOfferAddToHomeScreen({
      ...base,
      platform: 'other',
      hasCapturedPrompt: false,
    })).toBe(false);
  });

  it('never offers in an installed PWA, desktop host, or after dismiss', () => {
    const engaged = {
      engaged: true,
      dismissed: false,
      standalone: false,
      surface: 'browser' as const,
      platform: 'ios' as const,
      hasCapturedPrompt: false,
    };
    expect(shouldOfferAddToHomeScreen({ ...engaged, standalone: true })).toBe(false);
    expect(shouldOfferAddToHomeScreen({ ...engaged, surface: 'pwa' })).toBe(false);
    expect(shouldOfferAddToHomeScreen({ ...engaged, surface: 'zig-desktop' })).toBe(false);
    expect(shouldOfferAddToHomeScreen({ ...engaged, dismissed: true })).toBe(false);
  });

  it('persists dismiss and sent-message memory under onyx: keys', () => {
    expect(isA2hsDismissed()).toBe(false);
    expect(hasSentHomeScreenMessage()).toBe(false);

    markHomeScreenMessageSent();
    dismissAddToHomeScreen();

    expect(hasSentHomeScreenMessage()).toBe(true);
    expect(isA2hsDismissed()).toBe(true);
    expect(localStorage.getItem(A2HS_SENT_KEY)).toBe('1');
    expect(localStorage.getItem(A2HS_DISMISS_KEY)).toBe('1');
  });

  it('treats a later browser session as a returning visit', () => {
    expect(rememberHomeScreenVisit()).toBe(false);
    expect(isReturningHomeScreenVisit()).toBe(false);
    expect(rememberHomeScreenVisit()).toBe(false);
    expect(sessionStorage.getItem(A2HS_SESSION_KEY)).toBe('1');
    expect(localStorage.getItem(A2HS_VISIT_KEY)).toBe('1');

    sessionStorage.clear();
    expect(rememberHomeScreenVisit()).toBe(true);
    expect(isReturningHomeScreenVisit()).toBe(true);
  });

  it('prompts only from requestHomeScreenAdd and then stays dismissed', async () => {
    const event = promptEvent();
    captureBeforeInstallPrompt(event);
    expect(event.prompt).not.toHaveBeenCalled();

    await expect(requestHomeScreenAdd()).resolves.toBe('accepted');
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(peekCapturedInstallPrompt()).toBeNull();
    expect(isA2hsDismissed()).toBe(true);
    expect(localStorage.getItem(A2HS_DISMISS_KEY)).toBe('1');
  });
});
