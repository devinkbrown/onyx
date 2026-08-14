// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pure moderation action drafts: normalize, validate, and describe a review
 * before any store action or IRC command is sent.
 */

export const MODERATION_ACTION_KINDS = [
  'kick',
  'ban',
  'unban',
  'op',
  'deop',
  'voice',
  'devoice',
] as const;

export type ModerationActionKind = (typeof MODERATION_ACTION_KINDS)[number];

export const MAX_MODERATION_CHANNEL_LENGTH = 256;
export const MAX_MODERATION_NICK_LENGTH = 50;
export const MAX_MODERATION_MASK_LENGTH = 512;
export const MAX_MODERATION_REASON_LENGTH = 200;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;
const CHANNEL_PREFIX = /^[#&]/u;

export type ModerationActionDraft =
  | {
      kind: 'kick';
      channel: string;
      target: string;
      reason?: string;
    }
  | {
      kind: 'ban';
      channel: string;
      target?: string;
      mask?: string;
      reason?: string;
    }
  | {
      kind: 'unban';
      channel: string;
      mask: string;
    }
  | {
      kind: 'op' | 'deop' | 'voice' | 'devoice';
      channel: string;
      target: string;
    };

export type NormalizedModerationAction =
  | {
      kind: 'kick';
      channel: string;
      target: string;
      reason?: string;
    }
  | {
      kind: 'ban';
      channel: string;
      target?: string;
      mask: string;
      reason?: string;
    }
  | {
      kind: 'unban';
      channel: string;
      mask: string;
    }
  | {
      kind: 'op' | 'deop' | 'voice' | 'devoice';
      channel: string;
      target: string;
    };

export type ModerationActionContext = {
  actorNick: string;
};

export type ModerationReviewCopy = {
  title: string;
  summary: string;
  confirmLabel: string;
  impact: string;
};

export type ModerationActionValidation =
  | { ok: true; action: NormalizedModerationAction; review: ModerationReviewCopy }
  | { ok: false; errors: readonly string[] };

export function isModerationActionKind(value: unknown): value is ModerationActionKind {
  return typeof value === 'string'
    && (MODERATION_ACTION_KINDS as readonly string[]).includes(value);
}

export function validateModerationAction(
  draft: ModerationActionDraft,
  context: ModerationActionContext,
): ModerationActionValidation {
  const errors: string[] = [];
  if (!isModerationActionKind(draft.kind)) {
    return { ok: false, errors: ['This action is not supported.'] };
  }

  const actor = normalizeNick(context.actorNick);
  if (!actor) errors.push('Your nickname is missing, so this action cannot be reviewed.');

  const channel = normalizeChannel(draft.channel);
  if (!channel) errors.push('Choose a valid room.');

  switch (draft.kind) {
    case 'kick': {
      const target = normalizeNick(draft.target);
      const reason = normalizeReason(draft.reason, errors);
      if (!target) errors.push('Choose someone to remove.');
      if (actor && target && sameNick(actor, target)) errors.push('You cannot moderate yourself.');
      if (errors.length > 0 || !channel || !target) return { ok: false, errors };
      const action: NormalizedModerationAction = reason
        ? { kind: 'kick', channel, target, reason }
        : { kind: 'kick', channel, target };
      return { ok: true, action, review: reviewCopy(action) };
    }
    case 'ban': {
      const target = draft.target === undefined || draft.target.trim() === ''
        ? undefined
        : normalizeNick(draft.target);
      if (draft.target !== undefined && draft.target.trim() !== '' && !target) {
        errors.push('The person to block is not a valid nickname.');
      }
      const explicitMask = draft.mask === undefined ? undefined : normalizeMask(draft.mask);
      if (draft.mask !== undefined && !explicitMask) {
        errors.push('Enter a valid block address.');
      }
      const mask = explicitMask ?? (target ? `${target}!*@*` : null);
      if (!mask) errors.push('Enter a person or a block address.');
      if (mask && isDangerousBanMask(mask)) {
        errors.push('That block would match everyone. Use a more specific address.');
      }
      const reason = normalizeReason(draft.reason, errors);
      if (actor && target && sameNick(actor, target)) errors.push('You cannot moderate yourself.');
      if (actor && mask && isSelfBanMask(actor, mask)) errors.push('You cannot moderate yourself.');
      if (errors.length > 0 || !channel || !mask) return { ok: false, errors };
      const action: NormalizedModerationAction = {
        kind: 'ban',
        channel,
        mask,
        ...(target ? { target } : {}),
        ...(reason ? { reason } : {}),
      };
      return { ok: true, action, review: reviewCopy(action) };
    }
    case 'unban': {
      const mask = normalizeMask(draft.mask);
      if (!mask) errors.push('Choose a valid block to lift.');
      if (errors.length > 0 || !channel || !mask) return { ok: false, errors };
      const action: NormalizedModerationAction = { kind: 'unban', channel, mask };
      return { ok: true, action, review: reviewCopy(action) };
    }
    case 'op':
    case 'deop':
    case 'voice':
    case 'devoice': {
      const target = normalizeNick(draft.target);
      if (!target) errors.push('Choose a valid nickname.');
      if (actor && target && sameNick(actor, target)) errors.push('You cannot moderate yourself.');
      if (errors.length > 0 || !channel || !target) return { ok: false, errors };
      const action: NormalizedModerationAction = { kind: draft.kind, channel, target };
      return { ok: true, action, review: reviewCopy(action) };
    }
    default: {
      const _exhaustive: never = draft;
      return { ok: false, errors: [`Unsupported action: ${String(_exhaustive)}`] };
    }
  }
}

export function reviewCopy(action: NormalizedModerationAction): ModerationReviewCopy {
  switch (action.kind) {
    case 'kick':
      return {
        title: 'Remove from room',
        summary: action.reason
          ? `Remove ${action.target} from ${action.channel} with the note “${action.reason}”. They can rejoin unless they are also blocked.`
          : `Remove ${action.target} from ${action.channel}. They can rejoin unless they are also blocked.`,
        confirmLabel: 'Remove from room',
        impact: 'This sends a kick. It is not undone automatically.',
      };
    case 'ban':
      return {
        title: 'Block from room',
        summary: action.target
          ? `Block ${action.target} (${action.mask}) from joining ${action.channel}.`
          : `Block ${action.mask} from joining ${action.channel}.`,
        confirmLabel: 'Block from room',
        impact: 'Matching people stay out until a moderator lifts the block.',
      };
    case 'unban':
      return {
        title: 'Lift block',
        summary: `Allow ${action.mask} to join ${action.channel} again.`,
        confirmLabel: 'Lift block',
        impact: 'This only lifts the server block. It does not restore a previous role.',
      };
    case 'op':
      return {
        title: 'Give moderator role',
        summary: `Give ${action.target} permission to manage ${action.channel}.`,
        confirmLabel: 'Give moderator role',
        impact: 'They will be able to change room rules and moderate members.',
      };
    case 'deop':
      return {
        title: 'Remove moderator role',
        summary: `Remove ${action.target}’s permission to manage ${action.channel}.`,
        confirmLabel: 'Remove moderator role',
        impact: 'They keep their membership but lose room-management tools.',
      };
    case 'voice':
      return {
        title: 'Give speak permission',
        summary: `Let ${action.target} speak in ${action.channel} while the room is moderated.`,
        confirmLabel: 'Give speak permission',
        impact: 'This only matters while the room is in moderated mode.',
      };
    case 'devoice':
      return {
        title: 'Remove speak permission',
        summary: `Stop ${action.target} from speaking in ${action.channel} while the room is moderated.`,
        confirmLabel: 'Remove speak permission',
        impact: 'This only matters while the room is in moderated mode.',
      };
    default: {
      const _exhaustive: never = action;
      return {
        title: 'Review action',
        summary: String(_exhaustive),
        confirmLabel: 'Confirm',
        impact: '',
      };
    }
  }
}

function normalizeChannel(value: string): string | null {
  if (typeof value !== 'string') return null;
  const channel = value.trim();
  if (
    !channel
    || channel.length > MAX_MODERATION_CHANNEL_LENGTH
    || !CHANNEL_PREFIX.test(channel)
    || CONTROL_CHARS.test(channel)
    || /\s/u.test(channel)
  ) return null;
  return channel;
}

function normalizeNick(value: string): string | null {
  if (typeof value !== 'string') return null;
  const nick = value.trim();
  if (
    !nick
    || nick.length > MAX_MODERATION_NICK_LENGTH
    || CONTROL_CHARS.test(nick)
    || /[\s,:*?!@]/u.test(nick)
  ) return null;
  return nick;
}

function normalizeMask(value: string): string | null {
  if (typeof value !== 'string') return null;
  const mask = value.trim();
  if (
    !mask
    || mask.length > MAX_MODERATION_MASK_LENGTH
    || CONTROL_CHARS.test(mask)
    || /\s/u.test(mask)
  ) return null;
  return mask;
}

/** True when a ban mask has no literal nick/user/host characters left. */
export function isDangerousBanMask(mask: string): boolean {
  return mask.replace(/[*?!@.]/gu, '').length === 0;
}

export function memberModerationKindsForMode(mode: string): readonly ModerationActionKind[] {
  if (mode === 'irc-ops') return ['kick', 'ban', 'op', 'deop', 'voice', 'devoice'];
  if (mode === 'advanced') return ['kick', 'ban'];
  return [];
}

function normalizeReason(value: string | undefined, errors: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (CONTROL_CHARS.test(value)) {
    errors.push('The note cannot include control characters.');
    return undefined;
  }
  const reason = value.trim();
  if (!reason) return undefined;
  if (reason.length > MAX_MODERATION_REASON_LENGTH) {
    errors.push(`Keep the note under ${MAX_MODERATION_REASON_LENGTH} characters.`);
    return undefined;
  }
  return reason;
}

function sameNick(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function isSelfBanMask(actor: string, mask: string): boolean {
  if (sameNick(actor, mask)) return true;
  const nickPart = mask.split('!')[0] ?? '';
  if (!nickPart || nickPart.includes('*') || nickPart.includes('?')) return false;
  return sameNick(actor, nickPart);
}
