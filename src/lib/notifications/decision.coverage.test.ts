// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { classifyNotification, type CalmContext, type CalmPreset, type NotifTier } from './calmMode';
import {
  channelNotifyMode,
  shouldNotify as shouldNotifyForChannel,
  type NotifyLevel,
} from './channelNotifyMode';
import { shouldNotify, type NotifyDecision, type NotifyDecisionInput, type NotifyKind } from './decision';
import { buildQuietActivity, type QuietChannelLike } from './quietActivity';
import { applyIncomingUnread, markViewedRead, totalMentions, type IncomingUnreadInput } from './readState';

const ACTIVE_ALERT: NotifyDecisionInput = {
  kind: 'mention',
  isSelf: false,
  pushEnabled: true,
  soundEnabled: true,
  dnd: false,
  permission: 'granted',
  pageVisible: false,
  appFocused: false,
  nowMs: 100_000,
};

const QUIET_CONTEXT: CalmContext = {
  isMention: false,
  isFollowed: false,
  isDirect: false,
  isBoost: false,
};

function decisionInput(overrides: Partial<NotifyDecisionInput> = {}): NotifyDecisionInput {
  return { ...ACTIVE_ALERT, ...overrides };
}

function quietContext(overrides: Partial<CalmContext> = {}): CalmContext {
  return { ...QUIET_CONTEXT, ...overrides };
}

function channel(name: string, overrides: Partial<QuietChannelLike> = {}): QuietChannelLike {
  return {
    name,
    topic: '',
    unread: 0,
    highlights: 0,
    ...overrides,
  };
}

describe('notification decision coverage', () => {
  describe('shouldNotify decision boundaries', () => {
    const alertKinds: readonly NotifyKind[] = ['mention', 'dm', 'follow'];

    for (const kind of alertKinds) {
      it(`allows ${kind} when inactive and all gates are open`, () => {
        expect(shouldNotify(decisionInput({ kind }))).toEqual({
          desktop: true,
          sound: true,
          desktopReason: 'ok',
          soundReason: 'ok',
        });
      });
    }

    const baseBlockCases: readonly {
      name: string;
      overrides: Partial<NotifyDecisionInput>;
      reason: NotifyDecision['desktopReason'];
    }[] = [
      {
        name: 'non-alert system events win over every later blocker',
        overrides: { kind: 'system', isSelf: true, muted: true, pageVisible: true, appFocused: true, dnd: true },
        reason: 'not-message-alert',
      },
      {
        name: 'non-alert error events are not message alerts',
        overrides: { kind: 'error' },
        reason: 'not-message-alert',
      },
      {
        name: 'self echoes win over mute, focus, and dnd',
        overrides: { isSelf: true, muted: true, pageVisible: true, appFocused: true, dnd: true },
        reason: 'self',
      },
      {
        name: 'mute wins over focus and dnd',
        overrides: { muted: true, pageVisible: true, appFocused: true, dnd: true },
        reason: 'muted',
      },
      {
        name: 'focus wins over dnd when the user is actively looking',
        overrides: { pageVisible: true, appFocused: true, dnd: true },
        reason: 'focused',
      },
      {
        name: 'dnd blocks otherwise eligible inactive alerts',
        overrides: { dnd: true },
        reason: 'dnd',
      },
    ];

    for (const entry of baseBlockCases) {
      it(entry.name, () => {
        expect(shouldNotify(decisionInput(entry.overrides))).toMatchObject({
          desktop: false,
          sound: false,
          desktopReason: entry.reason,
          soundReason: entry.reason,
        });
      });
    }

    const inactiveCases: readonly {
      name: string;
      pageVisible: boolean;
      appFocused: boolean;
      expectedReason: NotifyDecision['desktopReason'];
    }[] = [
      { name: 'visible and focused is active', pageVisible: true, appFocused: true, expectedReason: 'focused' },
      { name: 'visible but unfocused is inactive', pageVisible: true, appFocused: false, expectedReason: 'ok' },
      { name: 'hidden but focused is inactive', pageVisible: false, appFocused: true, expectedReason: 'ok' },
      { name: 'hidden and unfocused is inactive', pageVisible: false, appFocused: false, expectedReason: 'ok' },
    ];

    for (const entry of inactiveCases) {
      it(entry.name, () => {
        const decision = shouldNotify(decisionInput({
          pageVisible: entry.pageVisible,
          appFocused: entry.appFocused,
        }));

        expect(decision.desktopReason).toBe(entry.expectedReason);
        expect(decision.soundReason).toBe(entry.expectedReason);
        expect(decision.desktop).toBe(entry.expectedReason === 'ok');
        expect(decision.sound).toBe(entry.expectedReason === 'ok');
      });
    }

    const desktopGateCases: readonly {
      name: string;
      overrides: Partial<NotifyDecisionInput>;
      reason: NotifyDecision['desktopReason'];
    }[] = [
      { name: 'push disabled blocks desktop only', overrides: { pushEnabled: false }, reason: 'disabled' },
      { name: 'unsupported desktop notifications block desktop only', overrides: { permission: 'unsupported' }, reason: 'unsupported' },
      { name: 'default permission blocks desktop only', overrides: { permission: 'default' }, reason: 'permission' },
      { name: 'denied permission blocks desktop only', overrides: { permission: 'denied' }, reason: 'permission' },
    ];

    for (const entry of desktopGateCases) {
      it(entry.name, () => {
        expect(shouldNotify(decisionInput(entry.overrides))).toMatchObject({
          desktop: false,
          sound: true,
          desktopReason: entry.reason,
          soundReason: 'ok',
        });
      });
    }

    it('blocks sound without blocking desktop when only sound is disabled', () => {
      expect(shouldNotify(decisionInput({ soundEnabled: false }))).toEqual({
        desktop: true,
        sound: false,
        desktopReason: 'ok',
        soundReason: 'disabled',
      });
    });

    it('applies custom throttle windows at the exact less-than boundary', () => {
      expect(shouldNotify(decisionInput({
        nowMs: 1000,
        lastDesktopAtMs: 900,
        desktopThrottleMs: 100,
        lastSoundAtMs: 901,
        soundThrottleMs: 100,
      }))).toMatchObject({
        desktop: true,
        sound: false,
        desktopReason: 'ok',
        soundReason: 'throttled',
      });

      expect(shouldNotify(decisionInput({
        nowMs: 1000,
        lastDesktopAtMs: 901,
        desktopThrottleMs: 100,
        lastSoundAtMs: 900,
        soundThrottleMs: 100,
      }))).toMatchObject({
        desktop: false,
        sound: true,
        desktopReason: 'throttled',
        soundReason: 'ok',
      });
    });

    it('treats zero throttle windows as unthrottled even for same-millisecond events', () => {
      expect(shouldNotify(decisionInput({
        nowMs: 5000,
        lastDesktopAtMs: 5000,
        desktopThrottleMs: 0,
        lastSoundAtMs: 5000,
        soundThrottleMs: 0,
      }))).toMatchObject({
        desktop: true,
        sound: true,
        desktopReason: 'ok',
        soundReason: 'ok',
      });
    });

    it('fails closed when the alert kind is an unrecognized string', () => {
      const malformed = decisionInput({ kind: 'NOTICE' as NotifyKind });

      expect(shouldNotify(malformed)).toMatchObject({
        desktop: false,
        sound: false,
        desktopReason: 'not-message-alert',
        soundReason: 'not-message-alert',
      });
    });
  });

  describe('calm mode preset gating', () => {
    const cases: readonly {
      preset: CalmPreset;
      ctx: CalmContext;
      expected: NotifTier;
    }[] = [
      { preset: 'calm', ctx: quietContext(), expected: 'silent' },
      { preset: 'calm', ctx: quietContext({ isFollowed: true }), expected: 'badge' },
      { preset: 'calm', ctx: quietContext({ isMention: true }), expected: 'notify' },
      { preset: 'calm', ctx: quietContext({ isDirect: true }), expected: 'notify' },
      { preset: 'regular', ctx: quietContext(), expected: 'badge' },
      { preset: 'regular', ctx: quietContext({ isFollowed: true }), expected: 'notify' },
      { preset: 'regular', ctx: quietContext({ isMention: true }), expected: 'notify' },
      { preset: 'regular', ctx: quietContext({ isDirect: true }), expected: 'notify' },
      { preset: 'power', ctx: quietContext(), expected: 'notify' },
      { preset: 'power', ctx: quietContext({ isFollowed: true }), expected: 'notify' },
      { preset: 'power', ctx: quietContext({ isMention: true }), expected: 'notify' },
      { preset: 'power', ctx: quietContext({ isDirect: true }), expected: 'notify' },
    ];

    for (const entry of cases) {
      it(`${entry.preset} maps ${JSON.stringify(entry.ctx)} to ${entry.expected}`, () => {
        expect(classifyNotification(entry.preset, entry.ctx)).toBe(entry.expected);
      });
    }

    for (const preset of ['calm', 'regular', 'power'] as const) {
      it(`boosts stay silent under ${preset} even when every notify flag is present`, () => {
        expect(classifyNotification(preset, quietContext({
          isBoost: true,
          isDirect: true,
          isFollowed: true,
          isMention: true,
        }))).toBe('silent');
      });
    }

    it('handles a malformed empty context without throwing', () => {
      const malformed = {} as CalmContext;

      expect(classifyNotification('calm', malformed)).toBe('silent');
      expect(classifyNotification('regular', malformed)).toBe('badge');
      expect(classifyNotification('power', malformed)).toBe('notify');
    });
  });

  describe('per-channel notification decisions', () => {
    const levels = new Map<string, NotifyLevel>([
      ['#general', 'all'],
      ['#mentions', 'mentions'],
      ['#muted', 'none'],
      ['', 'none'],
    ]);

    const cases: readonly {
      channelName: string;
      isMention: boolean;
      expectedMode: 'all' | 'mentions' | 'mute';
      expectedNotify: boolean;
    }[] = [
      { channelName: '#GENERAL', isMention: false, expectedMode: 'all', expectedNotify: true },
      { channelName: '#general', isMention: true, expectedMode: 'all', expectedNotify: true },
      { channelName: '#Mentions', isMention: false, expectedMode: 'mentions', expectedNotify: false },
      { channelName: '#mentions', isMention: true, expectedMode: 'mentions', expectedNotify: true },
      { channelName: '#Muted', isMention: false, expectedMode: 'mute', expectedNotify: false },
      { channelName: '#muted', isMention: true, expectedMode: 'mute', expectedNotify: false },
      { channelName: '#unset', isMention: false, expectedMode: 'all', expectedNotify: true },
      { channelName: '', isMention: true, expectedMode: 'mute', expectedNotify: false },
    ];

    for (const entry of cases) {
      it(`${entry.channelName || '<empty>'} ${entry.isMention ? 'mention' : 'ambient'} honors ${entry.expectedMode}`, () => {
        expect(channelNotifyMode(levels, entry.channelName)).toBe(entry.expectedMode);
        expect(shouldNotifyForChannel(levels, entry.channelName, entry.isMention)).toBe(entry.expectedNotify);
      });
    }
  });

  describe('quiet activity decisions', () => {
    const nowMs = 2_000_000;

    it('includes the exact max-age boundary and excludes one millisecond older', () => {
      const output = buildQuietActivity(
        [
          channel('#boundary', { topic: '  trimmed  ' }),
          channel('#stale'),
          channel('#missing'),
        ],
        new Map([
          ['#boundary', nowMs - 60_000],
          ['#stale', nowMs - 60_001],
        ]),
        nowMs,
        { maxAgeMs: 60_000 },
      );

      expect(output).toEqual([
        { name: '#boundary', topic: 'trimmed', lastActivity: nowMs - 60_000 },
      ]);
    });

    it('filters unread and highlighted rooms before sorting quiet activity', () => {
      const output = buildQuietActivity(
        [
          channel('#quiet-old'),
          channel('#unread-newer', { unread: 1 }),
          channel('#highlight-newer', { highlights: 1 }),
          channel('#quiet-new'),
        ],
        new Map([
          ['#quiet-old', nowMs - 20_000],
          ['#unread-newer', nowMs - 1000],
          ['#highlight-newer', nowMs - 2000],
          ['#quiet-new', nowMs - 3000],
        ]),
        nowMs,
      );

      expect(output.map((item) => item.name)).toEqual(['#quiet-new', '#quiet-old']);
    });

    it('normalizes channel lookup, sorts ties by name, and applies the limit after sorting', () => {
      const output = buildQuietActivity(
        [
          channel('#Zulu'),
          channel('#Alpha'),
          channel('#Later'),
          channel('#Dropped'),
        ],
        new Map([
          ['#zulu', nowMs - 5000],
          ['#alpha', nowMs - 5000],
          ['#later', nowMs - 1000],
          ['#dropped', nowMs - 6000],
        ]),
        nowMs,
        { limit: 3 },
      );

      expect(output.map((item) => item.name)).toEqual(['#Later', '#Alpha', '#Zulu']);
    });
  });

  describe('read state unread counters', () => {
    const unreadInput: IncomingUnreadInput = {
      unread: 7,
      mentions: 2,
      firstUnreadId: 'm-first',
      messageId: 'm-next',
      isMention: true,
      isActive: false,
    };

    it('preserves counters when skipUnread is set for an inactive target', () => {
      expect(applyIncomingUnread({ ...unreadInput, skipUnread: true })).toEqual({
        unread: 7,
        mentions: 2,
        firstUnreadId: 'm-first',
      });
    });

    it('active targets reset counters even when skipUnread is also set', () => {
      expect(applyIncomingUnread({ ...unreadInput, isActive: true, skipUnread: true })).toEqual({
        unread: 0,
        mentions: 0,
        firstUnreadId: null,
      });
    });

    it('starts the divider at the first unread id and only increments mentions for mentions', () => {
      expect(applyIncomingUnread({
        unread: 0,
        mentions: 0,
        firstUnreadId: null,
        messageId: 'm-start',
        isMention: false,
        isActive: false,
      })).toEqual({
        unread: 1,
        mentions: 0,
        firstUnreadId: 'm-start',
      });

      expect(applyIncomingUnread({
        unread: 1,
        mentions: 0,
        firstUnreadId: 'm-start',
        messageId: 'm-mention',
        isMention: true,
        isActive: false,
      })).toEqual({
        unread: 2,
        mentions: 1,
        firstUnreadId: 'm-start',
      });
    });

    it('marks a viewed target read while retaining the divider anchor and timestamp', () => {
      expect(markViewedRead({
        unread: 3,
        mentions: 1,
        firstUnreadId: null,
      }, 44_444)).toEqual({
        unread: 0,
        mentions: 0,
        firstUnreadId: null,
        dividerId: null,
        lastReadAtMs: 44_444,
      });
    });

    it('totals sparse mention maps including zero values', () => {
      expect(totalMentions({
        '#alpha': 0,
        '#beta': 3,
        '#gamma': 2,
      })).toBe(5);
    });
  });
});
