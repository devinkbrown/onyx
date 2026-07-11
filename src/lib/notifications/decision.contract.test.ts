// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { classifyNotification, type CalmContext } from './calmMode';
import {
  shouldNotify as shouldNotifyForChannelMode,
  type NotifyLevel,
} from './channelNotifyMode';
import { shouldNotify, type NotifyDecisionInput } from './decision';

const ACTIVE_INPUT: NotifyDecisionInput = {
  kind: 'mention',
  isSelf: false,
  pushEnabled: true,
  soundEnabled: true,
  dnd: false,
  permission: 'granted',
  pageVisible: false,
  appFocused: false,
  nowMs: 20_000,
};

const AMBIENT_CONTEXT: CalmContext = {
  isMention: false,
  isFollowed: false,
  isDirect: false,
  isBoost: false,
};

function input(overrides: Partial<NotifyDecisionInput> = {}): NotifyDecisionInput {
  return { ...ACTIVE_INPUT, ...overrides };
}

function context(overrides: Partial<CalmContext> = {}): CalmContext {
  return { ...AMBIENT_CONTEXT, ...overrides };
}

describe('notification decision contract', () => {
  describe('shouldNotify base rules', () => {
    it('notifies for mentions and DMs when the app is inactive', () => {
      expect(shouldNotify(input({ kind: 'mention' }))).toMatchObject({
        desktop: true,
        sound: true,
        desktopReason: 'ok',
        soundReason: 'ok',
      });

      expect(shouldNotify(input({ kind: 'dm' }))).toMatchObject({
        desktop: true,
        sound: true,
        desktopReason: 'ok',
        soundReason: 'ok',
      });
    });

    it('suppresses mentions and DMs during do not disturb', () => {
      for (const kind of ['mention', 'dm'] as const) {
        expect(shouldNotify(input({ kind, dnd: true }))).toMatchObject({
          desktop: false,
          sound: false,
          desktopReason: 'dnd',
          soundReason: 'dnd',
        });
      }
    });

    it('never notifies for our own echoed messages', () => {
      expect(shouldNotify(input({ kind: 'mention', isSelf: true }))).toMatchObject({
        desktop: false,
        sound: false,
        desktopReason: 'self',
        soundReason: 'self',
      });

      expect(shouldNotify(input({ kind: 'dm', isSelf: true }))).toMatchObject({
        desktop: false,
        sound: false,
        desktopReason: 'self',
        soundReason: 'self',
      });
    });

    it('keeps muted targets silent even for alert kinds', () => {
      expect(shouldNotify(input({ kind: 'mention', muted: true }))).toMatchObject({
        desktop: false,
        sound: false,
        desktopReason: 'muted',
        soundReason: 'muted',
      });
    });

    it('blocks non-alert notification kinds before later alert gates', () => {
      expect(shouldNotify(input({
        kind: 'system',
        isSelf: true,
        muted: true,
        dnd: true,
      }))).toMatchObject({
        desktop: false,
        sound: false,
        desktopReason: 'not-message-alert',
        soundReason: 'not-message-alert',
      });
    });

    it('defaults missing optional throttle timestamps to unthrottled', () => {
      expect(shouldNotify(input({
        lastDesktopAtMs: undefined,
        lastSoundAtMs: undefined,
      }))).toMatchObject({
        desktop: true,
        sound: true,
      });
    });

    it('uses the default desktop and sound throttle boundaries', () => {
      expect(shouldNotify(input({ nowMs: 20_000, lastDesktopAtMs: 14_001 }))).toMatchObject({
        desktop: false,
        desktopReason: 'throttled',
        sound: true,
        soundReason: 'ok',
      });

      expect(shouldNotify(input({ nowMs: 20_000, lastDesktopAtMs: 14_000 }))).toMatchObject({
        desktop: true,
        desktopReason: 'ok',
      });

      expect(shouldNotify(input({ nowMs: 20_000, lastSoundAtMs: 18_501 }))).toMatchObject({
        desktop: true,
        desktopReason: 'ok',
        sound: false,
        soundReason: 'throttled',
      });

      expect(shouldNotify(input({ nowMs: 20_000, lastSoundAtMs: 18_500 }))).toMatchObject({
        sound: true,
        soundReason: 'ok',
      });
    });

    it('fails closed for malformed boundary input that is missing the alert kind', () => {
      const missingKind = {
        isSelf: false,
        pushEnabled: true,
        soundEnabled: true,
        dnd: false,
        permission: 'granted',
        pageVisible: false,
        appFocused: false,
        nowMs: 20_000,
      } as unknown as NotifyDecisionInput;

      expect(shouldNotify(missingKind)).toMatchObject({
        desktop: false,
        sound: false,
        desktopReason: 'not-message-alert',
        soundReason: 'not-message-alert',
      });
    });

    it('fails closed for malformed boundary input missing enablement toggles', () => {
      const missingToggles = {
        kind: 'mention',
        isSelf: false,
        dnd: false,
        permission: 'granted',
        pageVisible: false,
        appFocused: false,
        nowMs: 20_000,
      } as unknown as NotifyDecisionInput;

      expect(shouldNotify(missingToggles)).toMatchObject({
        desktop: false,
        sound: false,
        desktopReason: 'disabled',
        soundReason: 'disabled',
      });
    });
  });

  describe('per-channel notification modes', () => {
    const levels = new Map<string, NotifyLevel>([
      ['#all', 'all'],
      ['#mentions', 'mentions'],
      ['#muted', 'none'],
      ['', 'none'],
    ]);

    it('honors all, mentions, and mute levels', () => {
      expect(shouldNotifyForChannelMode(levels, '#all', false)).toBe(true);
      expect(shouldNotifyForChannelMode(levels, '#all', true)).toBe(true);

      expect(shouldNotifyForChannelMode(levels, '#mentions', false)).toBe(false);
      expect(shouldNotifyForChannelMode(levels, '#mentions', true)).toBe(true);

      expect(shouldNotifyForChannelMode(levels, '#muted', false)).toBe(false);
      expect(shouldNotifyForChannelMode(levels, '#muted', true)).toBe(false);
    });

    it('keeps an explicitly muted empty channel silent', () => {
      expect(shouldNotifyForChannelMode(levels, '', false)).toBe(false);
      expect(shouldNotifyForChannelMode(levels, '', true)).toBe(false);
    });

    it('uses the documented all default for an unknown channel', () => {
      expect(shouldNotifyForChannelMode(levels, '#unknown', false)).toBe(true);
      expect(shouldNotifyForChannelMode(levels, '#unknown', true)).toBe(true);
    });
  });

  describe('calm mode classification', () => {
    it('keeps mentions and DMs as notify in the calm preset', () => {
      expect(classifyNotification('calm', context({ isMention: true }))).toBe('notify');
      expect(classifyNotification('calm', context({ isDirect: true }))).toBe('notify');
    });

    it('downgrades calm ambient activity while preserving followed-channel badges', () => {
      expect(classifyNotification('calm', context())).toBe('silent');
      expect(classifyNotification('calm', context({ isFollowed: true }))).toBe('badge');
    });

    it('orders mention and DM above followed-channel handling', () => {
      expect(classifyNotification('calm', context({
        isMention: true,
        isFollowed: true,
      }))).toBe('notify');

      expect(classifyNotification('calm', context({
        isDirect: true,
        isFollowed: true,
      }))).toBe('notify');
    });

    it('orders followed activity above ambient activity across non-calm presets', () => {
      expect(classifyNotification('regular', context())).toBe('badge');
      expect(classifyNotification('regular', context({ isFollowed: true }))).toBe('notify');

      expect(classifyNotification('power', context())).toBe('notify');
      expect(classifyNotification('power', context({ isFollowed: true }))).toBe('notify');
    });
  });
});
