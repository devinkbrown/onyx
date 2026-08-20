// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  MAX_MODERATION_CHANNEL_LENGTH,
  MAX_MODERATION_MASK_LENGTH,
  MAX_MODERATION_NICK_LENGTH,
  MAX_MODERATION_REASON_LENGTH,
  isDangerousBanMask,
  isModerationActionKind,
  memberModerationKindsForMode,
  reviewCopy,
  validateModerationAction,
  type ModerationActionDraft,
  type NormalizedModerationAction,
} from './actionModel';

const actor = { actorNick: 'Ada' };

function expectOk(draft: ModerationActionDraft) {
  const result = validateModerationAction(draft, actor);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result;
}

function expectErrors(draft: ModerationActionDraft, pattern: RegExp) {
  const result = validateModerationAction(draft, actor);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected rejection');
  expect(result.errors.join(' ')).toMatch(pattern);
}

describe('validateModerationAction', () => {
  it('normalizes kick, ban, unban, op, and voice drafts', () => {
    expect(expectOk({ kind: 'kick', channel: ' #garden ', target: ' bob ' }).action).toEqual({
      kind: 'kick',
      channel: '#garden',
      target: 'bob',
    });
    expect(expectOk({
      kind: 'kick',
      channel: '#garden',
      target: 'bob',
      reason: '  please slow down  ',
    }).action).toEqual({
      kind: 'kick',
      channel: '#garden',
      target: 'bob',
      reason: 'please slow down',
    });
    expect(expectOk({ kind: 'ban', channel: '#garden', target: 'bob' }).action).toEqual({
      kind: 'ban',
      channel: '#garden',
      target: 'bob',
      mask: 'bob!*@*',
    });
    expect(expectOk({ kind: 'ban', channel: '#garden', mask: '  bad!*@*  ' }).action).toEqual({
      kind: 'ban',
      channel: '#garden',
      mask: 'bad!*@*',
    });
    expect(expectOk({ kind: 'unban', channel: '#garden', mask: ' bad!*@* ' }).action).toEqual({
      kind: 'unban',
      channel: '#garden',
      mask: 'bad!*@*',
    });
    expect(expectOk({ kind: 'op', channel: '#garden', target: 'bob' }).action.kind).toBe('op');
    expect(expectOk({ kind: 'deop', channel: '#garden', target: 'bob' }).action.kind).toBe('deop');
    expect(expectOk({ kind: 'voice', channel: '#garden', target: 'bob' }).action.kind).toBe('voice');
    expect(expectOk({ kind: 'devoice', channel: '#garden', target: 'bob' }).action.kind).toBe('devoice');
  });

  it('rejects blank channel, target, mask, and whitespace-only reason as invalid input', () => {
    expectErrors({ kind: 'kick', channel: '   ', target: 'bob' }, /valid room/);
    expectErrors({ kind: 'kick', channel: '#garden', target: '   ' }, /someone to remove/);
    expectErrors({ kind: 'unban', channel: '#garden', mask: '   ' }, /valid block/);
    expectErrors({ kind: 'ban', channel: '#garden' }, /person or a block/);
    const blankReason = validateModerationAction({
      kind: 'kick',
      channel: '#garden',
      target: 'bob',
      reason: '   ',
    }, actor);
    expect(blankReason.ok).toBe(true);
    if (blankReason.ok) expect(blankReason.action).not.toHaveProperty('reason');
  });

  it('rejects control characters in every user-authored field', () => {
    expectErrors({ kind: 'kick', channel: '#gar\nden', target: 'bob' }, /valid room/);
    expectErrors({ kind: 'kick', channel: '#garden', target: 'bo\u0007b' }, /someone to remove/);
    expectErrors({ kind: 'ban', channel: '#garden', mask: 'bad\u0000!*@*' }, /valid block address/);
    expectErrors({
      kind: 'kick',
      channel: '#garden',
      target: 'bob',
      reason: 'no\u0007bells',
    }, /control characters/);
  });

  it('rejects self targets for kick, ban, op, and voice, including nick-shaped masks', () => {
    expectErrors({ kind: 'kick', channel: '#garden', target: 'ADA' }, /cannot moderate yourself/);
    expectErrors({ kind: 'ban', channel: '#garden', target: 'ada' }, /cannot moderate yourself/);
    expectErrors({ kind: 'ban', channel: '#garden', mask: 'Ada!*@*' }, /cannot moderate yourself/);
    expectErrors({ kind: 'op', channel: '#garden', target: 'Ada' }, /cannot moderate yourself/);
    expectErrors({ kind: 'voice', channel: '#garden', target: 'ada' }, /cannot moderate yourself/);
    expectErrors({ kind: 'ban', channel: '#garden', mask: '*!*@*' }, /match everyone/);
    expectErrors({ kind: 'ban', channel: '#garden', mask: '*' }, /match everyone/);
    expectErrors({ kind: 'ban', channel: '#garden', mask: '*!*@*.*' }, /match everyone/);
    expect(isDangerousBanMask('bad!*@*')).toBe(false);
    const liftSelf = validateModerationAction({ kind: 'unban', channel: '#garden', mask: 'Ada!*@*' }, actor);
    expect(liftSelf.ok).toBe(true);
    const liftWildcard = validateModerationAction({ kind: 'unban', channel: '#garden', mask: '*!*@*' }, actor);
    expect(liftWildcard.ok).toBe(true);
  });

  it('exposes Advanced kick/ban controls and keeps role changes in Network Ops', () => {
    expect(memberModerationKindsForMode('standard')).toEqual([]);
    expect(memberModerationKindsForMode('advanced')).toEqual(['kick', 'ban']);
    expect(memberModerationKindsForMode('network-ops')).toEqual([
      'kick', 'ban', 'op', 'deop', 'voice', 'devoice',
    ]);
  });

  it('rejects invalid rooms, nicknames, masks, and oversized notes', () => {
    expectErrors({ kind: 'kick', channel: 'garden', target: 'bob' }, /valid room/);
    expectErrors({ kind: 'kick', channel: `#${'x'.repeat(MAX_MODERATION_CHANNEL_LENGTH)}`, target: 'bob' }, /valid room/);
    expectErrors({ kind: 'kick', channel: '#garden', target: 'bo b' }, /someone to remove/);
    expectErrors({ kind: 'kick', channel: '#garden', target: 'x'.repeat(MAX_MODERATION_NICK_LENGTH + 1) }, /someone to remove/);
    expectErrors({ kind: 'ban', channel: '#garden', mask: `bad${'x'.repeat(MAX_MODERATION_MASK_LENGTH)}!*@*` }, /valid block address/);
    expectErrors({
      kind: 'kick',
      channel: '#garden',
      target: 'bob',
      reason: 'n'.repeat(MAX_MODERATION_REASON_LENGTH + 1),
    }, /200 characters/);
  });

  it('rejects a missing actor nickname and unknown kinds', () => {
    const noActor = validateModerationAction({ kind: 'kick', channel: '#garden', target: 'bob' }, { actorNick: '  ' });
    expect(noActor.ok).toBe(false);
    expect(isModerationActionKind('tempBan')).toBe(false);
    expect(isModerationActionKind('kick')).toBe(true);
    const unknown = validateModerationAction(
      { kind: 'tempBan', channel: '#garden', target: 'bob' } as unknown as ModerationActionDraft,
      actor,
    );
    expect(unknown.ok).toBe(false);
  });

  it('builds plain-language review copy for every kind', () => {
    const kinds: NormalizedModerationAction[] = [
      { kind: 'kick', channel: '#garden', target: 'bob', reason: 'spam' },
      { kind: 'ban', channel: '#garden', target: 'bob', mask: 'bob!*@*' },
      { kind: 'unban', channel: '#garden', mask: 'bob!*@*' },
      { kind: 'op', channel: '#garden', target: 'bob' },
      { kind: 'deop', channel: '#garden', target: 'bob' },
      { kind: 'voice', channel: '#garden', target: 'bob' },
      { kind: 'devoice', channel: '#garden', target: 'bob' },
    ];
    for (const action of kinds) {
      const copy = reviewCopy(action);
      expect(copy.title.length).toBeGreaterThan(3);
      expect(copy.summary).toContain('#garden');
      expect(copy.confirmLabel.length).toBeGreaterThan(3);
      expect(copy.impact.length).toBeGreaterThan(3);
      expect(copy.title).not.toMatch(/\bMODE\b|\bKICK\b|\+o\b/u);
    }
  });
});
