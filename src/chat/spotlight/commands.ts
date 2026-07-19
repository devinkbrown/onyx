// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createMemo, createSignal, onCleanup, onMount, type Accessor } from 'solid-js';
import { backgroundOptions, type BackgroundId } from '@/backgrounds';
import { getState, selectDeviceMemoryOwner, useStore } from '@/lib/store';
import type { State } from '@/lib/store/store';
import { applyThemeToDom, THEME_IDS, THEMES, type ThemeId } from '@/theme';
import { saveRecent, type RecentTarget } from '@/lib/commands/registry';
import {
  openPreferences,
  preferences,
  setPreference,
  type Density,
  type Width,
} from '@/lib/prefs/preferences';
import {
  openMessageSearchWithQuery,
  setVaultMode,
  toggleVaultMode,
  vaultSearchMode,
  type VaultSearchMode,
} from '@/shell/search/useMessageSearch';
import {
  languageLabel,
  setTranslationTarget,
  TRANSLATION_TARGETS,
} from '@/lib/intelligence/translateMessage';
import {
  planReviewedAnchorRecall,
  readReviewHistory,
} from '@/lib/notifications/reviewHistory';
import { aiPolicyBadgeText } from '@/shell/AiPolicyBadge';
import type { AiPolicy } from '@/lib/irc/aiPolicyProp';
import {
  readClientExtensionActions,
  recordClientExtensionActionRun,
  type ClientExtensionAction,
} from '@/lib/extensions/clientActions';
import {
  deviceMemoryOwnerKey,
  type DeviceMemoryOwner,
} from '@/lib/deviceMemoryOwner';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import { useSpotlight } from './useSpotlight';
import { parseTimeExpr } from './timeGrammar';
import { isSchedulable, parseDateTimeLocal } from '@/lib/schedule/scheduleTime';

export type SpotlightSection = 'Channels' | 'DMs' | 'People' | 'Actions';

export type SpotlightCommand = {
  id: string;
  section: SpotlightSection;
  title: string;
  hint?: string;
  keywords?: string[];
  run: () => void | Promise<void>;
};

type CommandState = Pick<State, 'channels' | 'dms' | 'server' | 'ourNick' | 'networkName' | 'activeView' | 'showMemberList' | 'voice'>;

const BACKGROUND_STORAGE_KEY = 'onyx:bg';
const SPOTLIGHT_INPUT_ID = 'onyx-spotlight-input';

const JUMP_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function normalizeChannel(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  // Preserve already-typed channel types (`#`, `&`, …). Only bare names get a
  // default `#` prefix — never rewrite `&ops` into `#&ops`.
  if (trimmed.startsWith('#') || trimmed.startsWith('&')) return trimmed;
  return `#${trimmed}`;
}

function activeTarget(state: Pick<State, 'activeView'>): string | null {
  const view = state.activeView;
  if (view.kind === 'channel') return view.channel;
  if (view.kind === 'dm') return view.nick;
  return null;
}

function saveRecentForCapturedOwner(
  target: Omit<RecentTarget, 'at'>,
  capturedOwner: DeviceMemoryOwner | null,
): void {
  const currentOwner = selectDeviceMemoryOwner(getState());
  if (
    !capturedOwner
    || !currentOwner
    || deviceMemoryOwnerKey(capturedOwner) !== deviceMemoryOwnerKey(currentOwner)
  ) return;
  saveRecent(target, capturedOwner);
}

function activeTargetLabel(state: Pick<State, 'activeView'>): string {
  const view = state.activeView;
  if (view.kind === 'channel') return view.channel;
  if (view.kind === 'dm') return `@${view.nick}`;
  return '';
}

function timeExprFromQuery(query: string): string | null {
  const trimmed = query.trim();
  if (trimmed.toLowerCase().startsWith('at:')) return trimmed.slice(3).trim();
  if (trimmed.startsWith('@')) return trimmed.slice(1).trim();
  return null;
}

function commandArg(query: string, command: string): string | null {
  const trimmed = query.trim();
  const prefix = `${command} `;
  return trimmed.toLowerCase().startsWith(prefix) ? trimmed.slice(prefix.length).trim() : null;
}

function exactCommand(query: string, ...commands: string[]): boolean {
  const normalized = query.trim().toLowerCase();
  return commands.some((command) => normalized === command);
}

function splitAtKeyword(value: string): { before: string; after: string } | null {
  const match = /^(.+?)\s+at\s+(.+)$/i.exec(value.trim());
  if (!match) return null;
  const before = match[1]?.trim() ?? '';
  const after = match[2]?.trim() ?? '';
  return before && after ? { before, after } : null;
}

function parseTargetedTimeArg(value: string): { target: string; expr: string } | null {
  const trimmed = value.trim();
  const match = /^([#&][^\s,]+)\s+(.+)$/i.exec(trimmed);
  if (!match) return null;
  const expr = match[2]?.trim() ?? '';
  if (!expr) return null;
  return {
    target: normalizeChannel(match[1] ?? ''),
    expr,
  };
}

/**
 * Docs teach channel-first forms: `#general at: last friday` and
 * `#general at yesterday 3pm`. Distinct from `at #general <expr>` (verb-first)
 * and from `at: <expr>` (active conversation). Requires whitespace after
 * `at`/`at:` so `at:last` fails closed.
 */
function parseChannelFirstTimeArg(query: string): { target: string; expr: string } | null {
  const match = /^([#&][^\s,]+)\s+at:?\s+(.+)$/i.exec(query.trim());
  if (!match) return null;
  const expr = match[2]?.trim() ?? '';
  if (!expr) return null;
  return {
    target: normalizeChannel(match[1] ?? ''),
    expr,
  };
}

function parseMuteDuration(expr: string): { ms: number; label: string } | null {
  const match = expr.trim().match(/^(\d{1,3})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value <= 0) return null;
  const unit = match[2]!.toLowerCase();
  const multiplier =
    unit.startsWith('m') ? 60_000 :
    unit.startsWith('h') ? 3_600_000 :
    86_400_000;
  const ms = value * multiplier;
  if (ms > 7 * 86_400_000) return null;
  const noun =
    multiplier === 60_000 ? 'minute' :
    multiplier === 3_600_000 ? 'hour' :
    'day';
  return { ms, label: `${value} ${noun}${value === 1 ? '' : 's'}` };
}

type ScheduleParse = { epoch: number; text: string; label: string };

/**
 * Parse a `schedule <when>: <text>` argument into a strictly-future send time
 * and the message body. `<when>` is either a relative duration (`15m`, `in 2h`,
 * `2d` — reusing `parseMuteDuration`) or an absolute datetime-local string
 * (`2026-07-12T15:00`). The split matches the FIRST colon that is followed by
 * whitespace, so the internal colons of a clock/ISO time (never followed by
 * whitespace) stay in `<when>`. Fails closed — returns null on an empty body or
 * any time that `isSchedulable`/`parseDateTimeLocal` will not trust (past,
 * too-near, or absurdly far). `now` is injected so the caller can test with a
 * fixed clock.
 */
function parseScheduleArg(arg: string, now: number): ScheduleParse | null {
  const match = /^(.+?):\s+([\s\S]+)$/.exec(arg.trim());
  if (!match) return null;

  const whenRaw = (match[1] ?? '').trim();
  const text = (match[2] ?? '').trim();
  // Refuse slash commands: a scheduled "/part" replayed into a future session
  // would execute a command, not send a message (mirrors the composer's guard).
  if (!whenRaw || !text || text.startsWith('/')) return null;

  const relative = parseMuteDuration(whenRaw.replace(/^in\s+/i, '').trim());
  if (relative) {
    const epoch = now + relative.ms;
    return isSchedulable(epoch, now) ? { epoch, text, label: `in ${relative.label}` } : null;
  }

  const absolute = parseDateTimeLocal(whenRaw, now);
  if (absolute !== null) {
    return { epoch: absolute, text, label: JUMP_TIME_FORMATTER.format(absolute) };
  }

  return null;
}

function parseDensityArg(value: string): Density | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'compact' || normalized === 'cozy' || normalized === 'roomy') return normalized;
  if (normalized === 'dense') return 'compact';
  if (normalized === 'reader') return 'roomy';
  return null;
}

function parseVaultMode(value: string): VaultSearchMode | null {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'hybrid' ||
    normalized === 'combined' ||
    normalized === 'both' ||
    normalized === 'blend' ||
    normalized === 'mixed'
  ) {
    return 'hybrid';
  }
  if (
    normalized === 'semantic' ||
    normalized === 'related' ||
    normalized === 'similar' ||
    normalized === 'tokens'
  ) {
    return 'semantic';
  }
  if (normalized === 'exact' || normalized === 'literal' || normalized === 'text' || normalized === 'substring') {
    return 'exact';
  }
  return null;
}

/** Human-facing label per vault mode; also the order the bare `vault` verb cycles. */
const VAULT_MODE_LABEL: Record<VaultSearchMode, string> = {
  hybrid: 'hybrid (text, then related terms)',
  exact: 'exact text',
  semantic: 'related terms (token similarity)',
};

/** Mirrors the hook's VAULT_MODE_CYCLE (hybrid → exact → semantic) so the toggle title names the next step. */
const NEXT_VAULT_MODE: Record<VaultSearchMode, VaultSearchMode> = {
  hybrid: 'exact',
  exact: 'semantic',
  semantic: 'hybrid',
};

function vaultModeTitle(mode: VaultSearchMode): string {
  if (mode === 'hybrid') return 'Search device memory by text, then related terms';
  if (mode === 'semantic') return 'Search device memory by related terms';
  return 'Search device memory by exact text';
}

const AWAY_CLEAR_WORDS = new Set(['off', 'clear', 'back', 'none', 'reset', 'here', 'available']);

const TRANSLATE_CLEAR_WORDS = new Set(['off', 'none', 'clear', 'reset', 'browser', 'default', 'stop']);

function resolveTranslateTarget(value: string): { code: string; clear: boolean } | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (TRANSLATE_CLEAR_WORDS.has(normalized)) return { code: '', clear: true };

  for (const code of TRANSLATION_TARGETS) {
    if (code === normalized || languageLabel(code).toLowerCase() === normalized) {
      return { code, clear: false };
    }
  }
  if (normalized.length >= 3) {
    for (const code of TRANSLATION_TARGETS) {
      if (languageLabel(code).toLowerCase().startsWith(normalized)) return { code, clear: false };
    }
  }
  return null;
}

function parseWidthArg(value: string): Width | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'full' || normalized === 'wide') return 'full';
  if (normalized === 'measured' || normalized === 'measure' || normalized === 'narrow') return 'measured';
  return null;
}

function readSpotlightQuery(): string {
  if (typeof document === 'undefined') return '';
  const input = document.getElementById(SPOTLIGHT_INPUT_ID);
  return input instanceof HTMLInputElement ? input.value : '';
}

function timeJumpCommands(state: CommandState, query: string): SpotlightCommand[] {
  const commands: SpotlightCommand[] = [];
  const atArg = commandArg(query, 'at');
  // Verb-first (`at #room <expr>`) or channel-first (`#room at: <expr>`).
  const targetTime =
    (atArg ? parseTargetedTimeArg(atArg) : null) ?? parseChannelFirstTimeArg(query);
  if (targetTime) {
    const at = parseTimeExpr(targetTime.expr);
    if (!at) return [];

    commands.push({
      id: `action:time-jump:${targetTime.target.toLowerCase()}:${at.toISOString()}`,
      section: 'Actions',
      title: `Jump ${targetTime.target} to ${JUMP_TIME_FORMATTER.format(at)}`,
      hint: 'time grammar',
      keywords: [query.trim(), targetTime.target, targetTime.expr, 'at', 'jump time history'],
      run: () => {
        const current = getState();
        current.joinChannel(targetTime.target);
        current.navigate({ kind: 'channel', channel: targetTime.target });
        current.travelTo(targetTime.target, at);
      },
    });
    return commands;
  }

  const expr = atArg ?? timeExprFromQuery(query);
  if (!expr) return [];

  const target = activeTarget(state);
  if (!target) return [];

  const at = parseTimeExpr(expr);
  if (!at) return [];

  return [
    {
      id: `action:time-jump:${target}:${at.toISOString()}`,
      section: 'Actions',
      title: `Jump to ${JUMP_TIME_FORMATTER.format(at)}`,
      hint: activeTargetLabel(state),
      keywords: [query.trim(), expr, 'at', 'jump time history'],
      run: () => {
        const current = getState();
        const currentTarget = activeTarget(current);
        if (!currentTarget) return;
        current.travelTo(currentTarget, at);
      },
    },
  ];
}

type ChannelSnapshot = CommandState['channels'] extends Map<string, infer C> ? C : never;

/** Choose the channel to catch up on: the active room if it has unread, else the busiest. */
function pickCatchUpChannel(state: CommandState): ChannelSnapshot | null {
  const unread = Array.from(state.channels.values()).filter((channel) => channel.unread > 0);
  if (unread.length === 0) return null;

  const view = state.activeView;
  if (view.kind === 'channel') {
    const active = state.channels.get(view.channel.toLowerCase());
    if (active && active.unread > 0) return active;
  }

  return unread
    .slice()
    .sort((a, b) => b.unread - a.unread || a.name.localeCompare(b.name))[0]!;
}

function countUnread(state: CommandState): { channels: number; dms: number; total: number } {
  let channels = 0;
  let dms = 0;
  for (const channel of state.channels.values()) {
    if (channel.unread > 0 || channel.highlights > 0) channels += 1;
  }
  for (const conversation of state.dms.values()) {
    if (conversation.unread > 0 || conversation.highlights > 0) dms += 1;
  }
  return { channels, dms, total: channels + dms };
}

/**
 * Catch-up family: a contextual "jump to first unread" for the busiest room and a
 * "mark all read" sweep. Both surface only when there is something to do and dispatch
 * exclusively through existing store actions.
 *
 * Gaps (no new store action added):
 *  - There is no dedicated "scroll to the first-unread message" action. `navigate`
 *    calls `captureUnreadDivider` before it marks the room read, so the rendered
 *    "new messages" divider is preserved — that divider is the catch-up landing spot.
 *  - There is no atomic `markAllRead`/`clearAllUnread`. Mark-all-read loops the
 *    existing per-target `markRead` (+ `markChannelRead` for the badge maps).
 */
function catchUpCommands(state: CommandState, query: string): SpotlightCommand[] {
  const commands: SpotlightCommand[] = [];
  const target = pickCatchUpChannel(state);

  if (target) {
    const name = target.name;
    commands.push({
      id: `action:catch-up:${name.toLowerCase()}`,
      section: 'Actions',
      title: `Catch up — jump to first unread in ${name}`,
      hint: `${target.unread} unread`,
      keywords: [
        query.trim(),
        'catch up',
        'catchup',
        'unread',
        'first unread',
        'new messages',
        'jump',
        name,
      ],
      run: () => {
        const current = getState();
        current.joinChannel(name);
        current.navigate({ kind: 'channel', channel: name });
      },
    });
  }

  const unread = countUnread(state);
  if (unread.total > 0) {
    const conversations = `${unread.total} conversation${unread.total === 1 ? '' : 's'}`;
    commands.push({
      id: 'action:mark-all-read',
      section: 'Actions',
      title: 'Mark all read',
      hint: `Clear unread in ${conversations}`,
      keywords: [
        query.trim(),
        'mark all read',
        'mark read',
        'clear unread',
        'read all',
        'dismiss unread',
        'catch up',
      ],
      run: () => {
        const current = getState();
        for (const channel of current.channels.values()) {
          if (channel.unread > 0 || channel.highlights > 0) {
            current.markRead(channel.name);
            current.markChannelRead(channel.name);
          }
        }
        for (const conversation of current.dms.values()) {
          if (conversation.unread > 0 || conversation.highlights > 0) {
            current.markRead(conversation.nick);
          }
        }
      },
    });
  }

  return commands;
}

/**
 * Device-local reviewed anchors are already capped and ordered by
 * `readReviewHistory`. Keep that order so Spotlight presents the newest recall
 * first. Planning is repeated at run time so malformed imported state can
 * never turn into a time-travel request.
 */
function reviewedAnchorCommands(): SpotlightCommand[] {
  const owner = selectDeviceMemoryOwner(getState());
  if (!owner) return [];
  return readReviewHistory(owner).flatMap<SpotlightCommand>((entry) => {
    const plan = planReviewedAnchorRecall(entry);
    if (!plan) return [];
    const preview = entry.preview.replace(/\s+/g, ' ').trim().slice(0, 180);
    const name = entry.name.replace(/\s+/g, ' ').trim().slice(0, 128);

    return [{
      id: `review:${plan.kind}:${plan.target.toLowerCase()}:${plan.messageId}`,
      section: 'Actions',
      title: `Reopen reviewed ${name || plan.target}`,
      hint: preview || 'saved on this device',
      keywords: [
        'review',
        'reviewed',
        'recall',
        plan.target,
        name,
        preview,
        plan.messageId,
      ],
      run: () => {
        const currentPlan = planReviewedAnchorRecall(entry);
        if (!currentPlan) return;

        const current = getState();
        current.openVaultResult(currentPlan.target, currentPlan.messageId);
        if (currentPlan.at) {
          current.travelTo(currentPlan.target, currentPlan.at, currentPlan.messageId);
        }
      },
    }];
  });
}

function vaultToggleCommand(query: string): SpotlightCommand {
  const current = vaultSearchMode();
  const next = NEXT_VAULT_MODE[current];
  return {
    id: 'grammar:vault:toggle',
    section: 'Actions',
    title: `Switch vault search to ${VAULT_MODE_LABEL[next]}`,
    hint: `vault search · now ${current}`,
    keywords: [
      query.trim(),
      'vault',
      'search mode',
      'hybrid',
      'semantic',
      'exact',
      'toggle',
      'cycle',
      'meaning',
      'recall',
    ],
    run: () => toggleVaultMode(),
  };
}

function channelAiPolicy(channel: unknown): AiPolicy {
  return (channel as { aiPolicy?: AiPolicy } | null | undefined)?.aiPolicy ?? 'open';
}

function grammarCommands(state: CommandState, query: string): SpotlightCommand[] {
  const commands: SpotlightCommand[] = [];
  const gotoArg = commandArg(query, 'goto') ?? commandArg(query, 'join') ?? commandArg(query, 'open');
  if (gotoArg) {
    const timed = splitAtKeyword(gotoArg);
    const channel = normalizeChannel(timed?.before ?? gotoArg);
    if (channel.length > 1) {
      const known = state.channels.get(channel.toLowerCase());
      const at = timed ? parseTimeExpr(timed.after) : null;
      commands.push({
        id: at
          ? `grammar:goto-time:${channel.toLowerCase()}:${at.toISOString()}`
          : `grammar:goto:${channel.toLowerCase()}`,
        section: 'Actions',
        title: at
          ? `Go to ${known?.name ?? channel} at ${JUMP_TIME_FORMATTER.format(at)}`
          : known ? `Go to ${known.name}` : `Join ${channel}`,
        hint: at ? 'time grammar' : known ? channelHint(known) : 'channel',
        keywords: [query.trim(), 'goto', 'join', 'open', 'go to', channel, timed?.after ?? ''],
        run: () => {
          const current = getState();
          current.joinChannel(known?.name ?? channel);
          current.navigate({ kind: 'channel', channel: known?.name ?? channel });
          if (at) current.travelTo(known?.name ?? channel, at);
        },
      });
    }
  }

  const partArg = commandArg(query, 'part') ?? commandArg(query, 'leave');
  if (partArg) {
    const channel = normalizeChannel(partArg);
    if (channel.length > 1) {
      const name = state.channels.get(channel.toLowerCase())?.name ?? channel;
      commands.push({
        id: `grammar:part:${channel.toLowerCase()}`,
        section: 'Actions',
        title: `Leave ${name}`,
        hint: 'part channel',
        keywords: [query.trim(), 'part', 'leave', 'close channel', 'exit channel', name],
        run: () => getState().partChannel(name),
      });
    }
  } else if (exactCommand(query, 'part', 'leave')) {
    const active = state.activeView.kind === 'channel' ? state.activeView.channel : null;
    if (active) {
      commands.push({
        id: `grammar:part:${active.toLowerCase()}`,
        section: 'Actions',
        title: `Leave ${active}`,
        hint: 'part current channel',
        keywords: [query.trim(), 'part', 'leave', 'close channel', 'exit channel', active],
        run: () => {
          const current = getState();
          const view = current.activeView;
          if (view.kind === 'channel') current.partChannel(view.channel);
        },
      });
    }
  }

  const unreadArg = commandArg(query, 'unread');
  if (unreadArg) {
    const channel = normalizeChannel(unreadArg);
    if (channel.length > 1) {
      const known = state.channels.get(channel.toLowerCase());
      if (known && known.unread > 0) {
        const name = known.name;
        commands.push({
          id: `grammar:unread:${channel.toLowerCase()}`,
          section: 'Actions',
          title: `Jump to first unread in ${name}`,
          hint: `${known.unread} unread`,
          keywords: [query.trim(), 'unread', 'first unread', 'new messages', 'catch up', 'jump', name],
          run: () => {
            const current = getState();
            current.joinChannel(name);
            current.navigate({ kind: 'channel', channel: name });
          },
        });
      }
    }
  }

  const starArg = commandArg(query, 'star') ?? commandArg(query, 'favorite') ?? commandArg(query, 'favourite');
  if (starArg) {
    const channel = normalizeChannel(starArg);
    if (channel.length > 1) {
      const name = state.channels.get(channel.toLowerCase())?.name ?? channel;
      commands.push({
        id: `grammar:star:${channel.toLowerCase()}`,
        section: 'Actions',
        title: `Star ${name}`,
        hint: 'favorite channel',
        keywords: [query.trim(), 'star', 'favorite', 'favourite', 'pin channel', 'bookmark', name],
        run: () => getState().starChannel(name),
      });
    }
  }

  const unstarArg = commandArg(query, 'unstar') ?? commandArg(query, 'unfavorite') ?? commandArg(query, 'unfavourite');
  if (unstarArg) {
    const channel = normalizeChannel(unstarArg);
    if (channel.length > 1) {
      const name = state.channels.get(channel.toLowerCase())?.name ?? channel;
      commands.push({
        id: `grammar:unstar:${channel.toLowerCase()}`,
        section: 'Actions',
        title: `Unstar ${name}`,
        hint: 'favorite channel',
        keywords: [query.trim(), 'unstar', 'unfavorite', 'unfavourite', 'remove star', name],
        run: () => getState().unstarChannel(name),
      });
    }
  }

  const dmArg = commandArg(query, 'dm');
  if (dmArg) {
    const nick = dmArg.replace(/^@/, '').trim();
    if (/^[^\s,]{1,64}$/.test(nick)) {
      const known = state.dms.get(nick.toLowerCase());
      commands.push({
        id: `grammar:dm:${nick.toLowerCase()}`,
        section: 'Actions',
        title: `Open DM with ${known?.nick ?? nick}`,
        hint: known ? dmHint(known) : '@nick',
        keywords: [query.trim(), 'dm', 'message', nick],
        run: () => getState().navigate({ kind: 'dm', nick: known?.nick ?? nick }),
      });
    }
  }

  const scheduleArg = commandArg(query, 'schedule') ?? commandArg(query, 'send later');
  if (scheduleArg) {
    const target = activeTarget(state);
    const parsed = target ? parseScheduleArg(scheduleArg, Date.now()) : null;
    if (target && parsed) {
      commands.push({
        id: `grammar:schedule:${target.toLowerCase()}:${parsed.epoch}`,
        section: 'Actions',
        title: `Schedule message to ${activeTargetLabel(state)} · ${parsed.label}`,
        hint: 'send later',
        keywords: [query.trim(), 'schedule', 'send later', 'remind', 'queue', 'later', target],
        run: () => {
          const current = getState();
          const dest = activeTarget(current);
          // Re-validate against the wall clock at run time so a stale relative
          // time (typed, then left sitting) can never queue a past instant.
          if (!dest || !isSchedulable(parsed.epoch, Date.now())) return;
          current.scheduleMessage(dest, parsed.text, parsed.epoch);
        },
      });
    }
  }

  const muteArg = commandArg(query, 'mute');
  if (muteArg) {
    if (/^(off|clear|cancel)$/i.test(muteArg)) {
      commands.push({
        id: 'grammar:mute:off',
        section: 'Actions',
        title: 'Turn off do not disturb',
        hint: 'notifications',
        keywords: [query.trim(), 'mute', 'unmute', 'do not disturb', 'off'],
        run: () => {
          const current = getState();
          current.setDndEnabled(false);
          current.setDndUntil(null);
        },
      });
      return commands;
    }

    const duration = parseMuteDuration(muteArg);
    if (duration) {
      commands.push({
        id: `grammar:mute:${duration.label}`,
        section: 'Actions',
        title: `Mute notifications for ${duration.label}`,
        hint: 'Do not disturb',
        keywords: [query.trim(), 'mute', 'do not disturb', duration.label],
        run: () => {
          const current = getState();
          current.setDndEnabled(false);
          current.setDndUntil(Date.now() + duration.ms);
        },
      });
    }
  }

  if (exactCommand(query, 'unmute', 'dnd off', 'quiet off')) {
    commands.push({
      id: 'grammar:dnd:off',
      section: 'Actions',
      title: 'Turn off do not disturb',
      hint: 'notifications',
      keywords: [query.trim(), 'unmute', 'dnd off', 'quiet off'],
      run: () => {
        const current = getState();
        current.setDndEnabled(false);
        current.setDndUntil(null);
      },
    });
  }

  if (exactCommand(query, 'dnd on', 'quiet on', 'do not disturb')) {
    commands.push({
      id: 'grammar:dnd:on',
      section: 'Actions',
      title: 'Turn on do not disturb',
      hint: 'notifications',
      keywords: [query.trim(), 'dnd on', 'quiet on', 'mute'],
      run: () => getState().setDndEnabled(true),
    });
  }

  const awayArg = commandArg(query, 'away');
  if (awayArg !== null && !AWAY_CLEAR_WORDS.has(awayArg.toLowerCase())) {
    commands.push({
      id: 'grammar:away:set',
      section: 'Actions',
      title: `Set away — ${awayArg}`,
      hint: 'presence',
      keywords: [query.trim(), 'away', 'afk', 'brb', 'status', awayArg],
      run: () => getState().setAway(awayArg),
    });
  } else if (
    exactCommand(query, 'back', 'unaway') ||
    (awayArg !== null && AWAY_CLEAR_WORDS.has(awayArg.toLowerCase()))
  ) {
    commands.push({
      id: 'grammar:away:clear',
      section: 'Actions',
      title: 'Clear away status',
      hint: 'presence',
      keywords: [query.trim(), 'away off', 'back', 'here', 'available', 'unaway', 'afk'],
      run: () => getState().unsetAway(),
    });
  }

  if (exactCommand(query, 'focus', 'focus mode', 'zen')) {
    commands.push({
      id: 'grammar:focus:toggle',
      section: 'Actions',
      title: 'Toggle focus mode',
      hint: 'distraction-free',
      keywords: [query.trim(), 'focus', 'focus mode', 'distraction free', 'zen', 'minimize'],
      run: () => getState().toggleFocusMode(),
    });
  }

  if (exactCommand(query, 'home', 'go home')) {
    commands.push({
      id: 'grammar:home',
      section: 'Actions',
      title: 'Go home',
      hint: 'catch-up',
      keywords: [query.trim(), 'home', 'catch up'],
      run: () => getState().navigate({ kind: 'home' }),
    });
  }

  const searchArg = commandArg(query, 'search') ?? commandArg(query, 'find');
  if (searchArg) {
    commands.push({
      id: `grammar:search:${searchArg.toLowerCase()}`,
      section: 'Actions',
      title: `Search messages for “${searchArg}”`,
      hint: activeTargetLabel(state) || 'current conversation',
      keywords: [query.trim(), 'search', 'find', searchArg],
      run: () => openMessageSearchWithQuery(searchArg),
    });
  }

  const vaultArg = commandArg(query, 'vault');
  if (vaultArg !== null) {
    const mode = parseVaultMode(vaultArg);
    if (mode) {
      commands.push({
        id: `grammar:vault:${mode}`,
        section: 'Actions',
        title: vaultModeTitle(mode),
        hint: 'vault search',
        keywords: [
          query.trim(),
          'vault',
          'search mode',
          'hybrid',
          'combined',
          'semantic',
          'exact',
          'meaning',
          'literal',
          'rag',
          'recall',
          'device memory',
          mode,
        ],
        run: () => setVaultMode(mode),
      });
    } else {
      commands.push(vaultToggleCommand(query));
    }
  } else if (exactCommand(query, 'vault', 'vault search', 'vault mode', 'semantic search')) {
    commands.push(vaultToggleCommand(query));
  }

  const translateArg =
    commandArg(query, 'translate') ?? commandArg(query, 'translation') ?? commandArg(query, 'language');
  if (translateArg !== null) {
    const resolved = resolveTranslateTarget(translateArg);
    if (resolved?.clear) {
      commands.push({
        id: 'grammar:translate:clear',
        section: 'Actions',
        title: 'Clear translation — use browser default',
        hint: 'on-device translation',
        keywords: [query.trim(), 'translate', 'translation', 'language', 'off', 'clear', 'reset', 'default'],
        run: () => setTranslationTarget(''),
      });
    } else if (resolved) {
      const label = languageLabel(resolved.code);
      commands.push({
        id: `grammar:translate:${resolved.code}`,
        section: 'Actions',
        title: `Translate messages to ${label}`,
        hint: 'on-device translation',
        keywords: [query.trim(), 'translate', 'translation', 'language', 'lang', resolved.code, label],
        run: () => setTranslationTarget(resolved.code),
      });
    }
  }

  const readerArg = commandArg(query, 'reader');
  if (readerArg || exactCommand(query, 'reader')) {
    const normalized = (readerArg ?? 'toggle').trim().toLowerCase();
    const enabled = normalized === 'on' || normalized === 'yes'
      ? true
      : normalized === 'off' || normalized === 'no'
        ? false
        : null;
    commands.push({
      id: `grammar:reader:${enabled === null ? 'toggle' : String(enabled)}`,
      section: 'Actions',
      title: enabled === null ? 'Toggle reader mode' : `${enabled ? 'Turn on' : 'Turn off'} reader mode`,
      hint: 'reading projection',
      keywords: [query.trim(), 'reader', 'reader mode', 'projection'],
      run: () => setPreference('readerMode', enabled ?? !preferencesSnapshot().readerMode),
    });
  }

  const densityArg = commandArg(query, 'density');
  if (densityArg) {
    const density = parseDensityArg(densityArg);
    if (density) {
      commands.push({
        id: `grammar:density:${density}`,
        section: 'Actions',
        title: `Set density to ${density}`,
        hint: 'projection',
        keywords: [query.trim(), 'density', 'compact', 'cozy', 'roomy', density],
        run: () => setPreference('density', density),
      });
    }
  }

  const widthArg = commandArg(query, 'width');
  if (widthArg) {
    const width = parseWidthArg(widthArg);
    if (width) {
      commands.push({
        id: `grammar:width:${width}`,
        section: 'Actions',
        title: `Set conversation width to ${width}`,
        hint: 'reading measure',
        keywords: [query.trim(), 'width', 'measure', 'full', 'measured', width],
        run: () => setPreference('width', width),
      });
    }
  }

  const motionArg = commandArg(query, 'motion');
  if (motionArg) {
    const normalized = motionArg.trim().toLowerCase();
    const reduceMotion = normalized === 'still' || normalized === 'off' || normalized === 'reduced'
      ? true
      : normalized === 'animated' || normalized === 'on'
        ? false
        : null;
    if (reduceMotion !== null) {
      commands.push({
        id: `grammar:motion:${reduceMotion ? 'still' : 'animated'}`,
        section: 'Actions',
        title: reduceMotion ? 'Use still motion mode' : 'Use animated motion mode',
        hint: 'accessibility',
        keywords: [query.trim(), 'motion', 'animation', 'still', 'animated'],
        run: () => setPreference('reduceMotion', reduceMotion),
      });
    }
  }

  if (exactCommand(query, 'preferences', 'prefs', 'settings')) {
    commands.push({
      id: 'grammar:preferences',
      section: 'Actions',
      title: 'Open preferences',
      hint: 'panel',
      keywords: [query.trim(), 'preferences', 'prefs', 'settings'],
      run: () => openPreferences(),
    });
  }

  if (exactCommand(query, 'shortcuts', 'keyboard')) {
    commands.push({
      id: 'grammar:shortcuts',
      section: 'Actions',
      title: 'Open keyboard shortcuts',
      hint: '?',
      keywords: [query.trim(), 'shortcuts', 'keyboard', 'keys'],
      run: () => getState().openKeyboardShortcuts(),
    });
  }

  return commands;
}

function preferencesSnapshot() {
  return preferences();
}

function navigateTo(path: string): void {
  if (typeof window === 'undefined') return;

  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function applyTheme(id: ThemeId): void {
  applyThemeToDom(id);
  getState().setTheme(id);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('onyx:theme-change', { detail: { id } }));
  }
}

function applyBackground(id: BackgroundId): void {
  try {
    localStorage.setItem(BACKGROUND_STORAGE_KEY, id);
  } catch {
    /* storage unavailable */
  }

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.onyxBackground = id;
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('onyx:background-change', { detail: { id } }));
  }
}

/**
 * Build a shareable IRC URL to a channel from the connected node's own URL
 * (`ircs://host:port`). The channel — including its `#`/`&` sigil — is
 * percent-encoded so the sigil cannot be mistaken for a URL fragment and the
 * link round-trips unambiguously (`ircs://host:port/%23channel`). Returns null
 * when there is no node URL or channel to build from, so callers fail closed.
 */
function channelLink(serverUrl: string | undefined, channel: string): string | null {
  if (!serverUrl || !channel) return null;
  const base = serverUrl.replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(channel)}`;
}

async function copyText(text: string): Promise<void> {
  await writeClipboardText(text);
}

function runClientExtensionAction(
  action: ClientExtensionAction,
  owner: DeviceMemoryOwner,
): void | Promise<void> {
  const expectedOwnerKey = deviceMemoryOwnerKey(owner);
  const currentOwner = selectDeviceMemoryOwner(getState());
  if (!expectedOwnerKey || !currentOwner || deviceMemoryOwnerKey(currentOwner) !== expectedOwnerKey) {
    return;
  }

  if (action.capability === 'open-url' && action.url) {
    if (typeof window === 'undefined') return;
    try {
      window.open(action.url, '_blank', 'noopener,noreferrer');
      // Browsers intentionally return null for `noopener` even when a new tab
      // opened, so the most accurate observable success boundary is that the
      // dispatch itself did not throw.
      recordClientExtensionActionRun(action, owner);
    } catch {
      // A failed dispatch is not an action run and must not enter the audit.
    }
    return;
  }
  if (action.capability === 'copy-text' && action.text) {
    return writeClipboardText(action.text).then((copied) => {
      if (copied) recordClientExtensionActionRun(action, owner);
    });
  }
}

function clientExtensionCommands(owner: DeviceMemoryOwner | null): SpotlightCommand[] {
  if (!owner) return [];
  return readClientExtensionActions(owner).map((action) => ({
    id: `extension:${action.id}`,
    section: 'Actions',
    title: action.title,
    hint: action.hint,
    keywords: ['extension', action.capability, ...action.keywords],
    run: () => runClientExtensionAction(action, owner),
  }));
}

function channelHint(channel: CommandState['channels'] extends Map<string, infer C> ? C : never): string {
  const parts = [`${channel.users.size} users`];
  if (channel.unread > 0) parts.push(`${channel.unread} unread`);
  if (channel.topic) parts.push(channel.topic);
  return parts.join(' · ');
}

function dmHint(dm: CommandState['dms'] extends Map<string, infer D> ? D : never): string {
  const parts = [];
  if (dm.account) parts.push(dm.account);
  if (dm.away) parts.push('away');
  if (dm.unread > 0) parts.push(`${dm.unread} unread`);
  return parts.join(' · ');
}

function baseActionCommands(state: CommandState): SpotlightCommand[] {
  const nodeAddress = state.server?.url ?? '';
  const inVoice = state.voice.callState !== 'idle';
  const activeChannel = state.activeView.kind === 'channel' ? state.activeView.channel : null;
  const aiPolicy = activeChannel ? channelAiPolicy(state.channels.get(activeChannel)) : 'open';
  const activeChannelLink = activeChannel ? channelLink(state.server?.url, activeChannel) : null;

  return [
    {
      id: 'action-browse-channels',
      section: 'Actions',
      title: 'Browse channels',
      hint: 'Every public channel on the network (LIST)',
      keywords: ['channels', 'browse', 'list', 'discover', 'directory'],
      run: () => getState().openChannelBrowser(),
    },
    {
      id: 'action:join-channel',
      section: 'Actions',
      title: 'Join channel...',
      hint: 'Open a channel by name',
      keywords: ['channel', 'join', 'irc'],
      run: () => {
        const raw = typeof window === 'undefined' ? '' : window.prompt('Join channel', '#');
        const channel = normalizeChannel(raw ?? '');
        if (!channel) return;

        const current = getState();
        current.joinChannel(channel);
        current.navigate({ kind: 'channel', channel });
      },
    },
    {
      id: 'action:appearance',
      section: 'Actions',
      title: 'Appearance — theme & background',
      hint: 'panel',
      keywords: ['theme', 'background', 'customize', 'appearance', 'color', 'dark', 'light'],
      run: () => getState().openAppearance(),
    },
    {
      id: 'action:preferences',
      section: 'Actions',
      title: 'Preferences — display & behaviour',
      hint: 'panel',
      keywords: ['preferences', 'settings', 'density', 'font', 'size', 'width', 'motion', 'events', 'display', 'behaviour', 'behavior'],
      run: () => openPreferences(),
    },
    {
      id: 'action:theme-studio',
      section: 'Actions',
      title: 'Open Theme Studio',
      hint: '/appearance/',
      keywords: ['theme', 'studio', 'custom', 'tokens', 'editor', 'create theme'],
      run: () => navigateTo('/appearance/'),
    },
    {
      id: 'action:toggle-member-list',
      section: 'Actions',
      title: state.showMemberList ? 'Hide member list' : 'Show member list',
      hint: 'Alt+M',
      keywords: ['members', 'sidebar', 'panel', 'people', 'list'],
      run: () => getState().toggleMemberList(),
    },
    {
      id: 'action:focus-composer',
      section: 'Actions',
      title: 'Focus composer',
      hint: 'Alt+Enter',
      keywords: ['compose', 'type', 'message', 'input', 'chat'],
      run: () => {
        const el = typeof document !== 'undefined'
          ? document.querySelector<HTMLElement>('[data-composer-input]')
          : null;
        el?.focus();
      },
    },
    {
      id: 'action:scheduled-messages',
      section: 'Actions',
      title: 'Scheduled messages',
      hint: 'Open the send-later queue',
      keywords: ['scheduled', 'schedule', 'send later', 'queue', 'remind', 'pending', 'later'],
      run: () => getState().openScheduledMessages(),
    },
    {
      id: 'action:jump-to-date',
      section: 'Actions',
      title: 'Jump to date…',
      hint: activeTarget(state) ? `${activeTargetLabel(state)} · g d` : 'g d',
      keywords: [
        'jump',
        'date',
        'time',
        'travel',
        'history',
        'scrubber',
        'at',
        'moment',
        'calendar',
        'goto date',
        'jump to date',
      ],
      run: () => getState().openJumpToDate(),
    },
    ...(activeChannel && aiPolicy !== 'open'
      ? [
          {
            id: 'action:ai-policy',
            section: 'Actions' as SpotlightSection,
            title: `AI policy: ${aiPolicyBadgeText(aiPolicy).label} · ${activeChannel}`,
            hint: aiPolicyBadgeText(aiPolicy).description,
            keywords: ['ai', 'ai policy', 'policy', 'no-ai', 'local only', 'local-only', 'assistant', 'model', 'privacy', activeChannel],
            run: () => openPreferences(),
          },
        ]
      : []),
    ...(!inVoice && activeChannel
      ? [
          {
            id: 'action:start-voice',
            section: 'Actions' as SpotlightSection,
            title: 'Start voice in current channel',
            hint: activeChannel,
            keywords: ['voice', 'audio', 'call', 'join'],
            run: () => {
              const current = getState();
              const view = current.activeView;
              if (view.kind === 'channel') {
                void current.joinVoiceChannel(view.channel, false);
              }
            },
          },
          {
            id: 'action:start-video',
            section: 'Actions' as SpotlightSection,
            title: 'Start video in current channel',
            hint: activeChannel,
            keywords: ['video', 'camera', 'call', 'join'],
            run: () => {
              const current = getState();
              const view = current.activeView;
              if (view.kind === 'channel') {
                void current.joinVoiceChannel(view.channel, true);
              }
            },
          },
        ]
      : []),
    {
      id: 'action:disconnect',
      section: 'Actions',
      title: 'Disconnect',
      hint: state.networkName || state.server?.name || 'Current node',
      keywords: ['quit', 'close', 'server', 'node'],
      run: () => getState().disconnect(),
    },
    {
      id: 'action:copy-node-address',
      section: 'Actions',
      title: 'Copy node address',
      hint: nodeAddress || 'No node connected',
      keywords: ['copy', 'server', 'url', 'address', 'node'],
      run: () => copyText(getState().server?.url ?? ''),
    },
    ...(activeChannel && activeChannelLink
      ? [
          {
            id: 'action:copy-channel-link',
            section: 'Actions' as SpotlightSection,
            title: 'Copy channel link',
            hint: activeChannelLink,
            keywords: ['copy', 'link', 'channel', 'share', 'invite', 'url', activeChannel],
            run: () => {
              const current = getState();
              const view = current.activeView;
              if (view.kind !== 'channel') return;
              const link = channelLink(current.server?.url, view.channel);
              if (link) return copyText(link);
            },
          },
        ]
      : []),
  ];
}

/**
 * Build "People" commands — members of the active channel who aren't already
 * in the DMs list. Provides a fast way to jump to a DM with anyone you can see.
 */
function peopleCommands(
  state: CommandState,
  memoryOwner: DeviceMemoryOwner | null,
): SpotlightCommand[] {
  const view = state.activeView;
  if (view.kind !== 'channel') return [];

  const channel = state.channels.get(view.channel);
  if (!channel) return [];

  const dmNicks = new Set(Array.from(state.dms.keys()).map((n) => n.toLowerCase()));

  return Array.from(channel.users.values())
    .filter((user) => !dmNicks.has(user.nick.toLowerCase()))
    .sort((a, b) => a.nick.localeCompare(b.nick))
    .map<SpotlightCommand>((user) => ({
      id: `people:${user.nick.toLowerCase()}`,
      section: 'People',
      title: `Message ${user.nick}`,
      hint: user.account ? `@${user.account}` : undefined,
      keywords: [user.nick, user.account ?? '', 'dm', 'message', 'people'],
      run: () => {
        saveRecentForCapturedOwner(
          { id: `people:${user.nick.toLowerCase()}`, label: `Message ${user.nick}`, section: 'People' },
          memoryOwner,
        );
        getState().navigate({ kind: 'dm', nick: user.nick });
      },
    }));
}

export function buildCommands(state: CommandState = getState(), query = ''): SpotlightCommand[] {
  const memoryOwner = selectDeviceMemoryOwner(state);
  const seenChannels = new Set<string>();
  const channels = Array.from(state.channels.values())
    .filter((channel) => {
      const key = channel.name.toLowerCase();
      if (seenChannels.has(key)) return false;
      seenChannels.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map<SpotlightCommand>((channel) => ({
      id: `channel:${channel.name.toLowerCase()}`,
      section: 'Channels',
      title: `Go to ${channel.name}`,
      hint: channelHint(channel),
      keywords: [channel.name, channel.name.replace(/^#/, ''), channel.topic],
      run: () => {
        const current = getState();
        saveRecentForCapturedOwner(
          { id: `channel:${channel.name.toLowerCase()}`, label: `Go to ${channel.name}`, section: 'Channels' },
          memoryOwner,
        );
        current.joinChannel(channel.name);
        current.navigate({ kind: 'channel', channel: channel.name });
      },
    }));

  const dms = Array.from(state.dms.values())
    .sort((a, b) => a.nick.localeCompare(b.nick))
    .map<SpotlightCommand>((dm) => ({
      id: `dm:${dm.nick.toLowerCase()}`,
      section: 'DMs',
      title: `Open DM with ${dm.nick}`,
      hint: dmHint(dm),
      keywords: [dm.nick, dm.account ?? '', 'direct message', 'dm'],
      run: () => {
        saveRecentForCapturedOwner(
          { id: `dm:${dm.nick.toLowerCase()}`, label: `Open DM with ${dm.nick}`, section: 'DMs' },
          memoryOwner,
        );
        getState().navigate({ kind: 'dm', nick: dm.nick });
      },
    }));

  const themeCommands = THEME_IDS.map<SpotlightCommand>((id) => ({
    id: `theme:${id}`,
    section: 'Actions',
    title: `Switch theme: ${THEMES[id].label}`,
    hint: THEMES[id].description,
    keywords: ['theme', id, THEMES[id].label],
    run: () => applyTheme(id),
  }));

  const backgroundCommands = backgroundOptions.map<SpotlightCommand>((option) => ({
    id: `background:${option.id}`,
    section: 'Actions',
    title: `Switch background: ${option.label}`,
    hint: option.kind,
    keywords: ['background', option.id, option.label, option.kind],
    run: () => applyBackground(option.id as BackgroundId),
  }));

  return [
    ...grammarCommands(state, query),
    ...timeJumpCommands(state, query),
    ...reviewedAnchorCommands(),
    ...catchUpCommands(state, query),
    ...channels,
    ...dms,
    ...peopleCommands(state, memoryOwner),
    ...baseActionCommands(state),
    ...clientExtensionCommands(memoryOwner),
    ...themeCommands,
    ...backgroundCommands,
  ];
}

export function useCommands(): Accessor<SpotlightCommand[]> {
  const spotlight = useSpotlight();
  const [query, setQuery] = createSignal('');
  const state = useStore(
    (store) => ({
      channels: store.channels,
      dms: store.dms,
      server: store.server,
      ourNick: store.ourNick,
      networkName: store.networkName,
      activeView: store.activeView,
      showMemberList: store.showMemberList,
      voice: store.voice,
    }),
    (a, b) => (
      a.channels === b.channels &&
      a.dms === b.dms &&
      a.server === b.server &&
      a.ourNick === b.ourNick &&
      a.networkName === b.networkName &&
      a.activeView === b.activeView &&
      a.showMemberList === b.showMemberList &&
      a.voice === b.voice
    ),
  );

  onMount(() => {
    const handleInput = (event: Event): void => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.id === SPOTLIGHT_INPUT_ID) {
        setQuery(target.value);
      }
    };

    document.addEventListener('input', handleInput);
    onCleanup(() => document.removeEventListener('input', handleInput));
  });

  createEffect(() => {
    if (!spotlight.isOpen()) {
      setQuery('');
      return;
    }

    queueMicrotask(() => setQuery(readSpotlightQuery()));
  });

  const commands = createMemo(() => buildCommands(state(), query()));
  return commands;
}
