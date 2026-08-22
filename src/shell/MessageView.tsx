// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MessageView.tsx — message list for the active channel or DM.
 *
 * Features:
 * - Consecutive-author grouping (no repeated avatar/name)
 * - Server-time timestamps
 * - System events rendered subtly (join/part/quit/kick/mode/topic/nick)
 * - Autoscroll to bottom; "jump to latest" button when scrolled up
 * - Reactions as reactor-avatar stacks (Avatar primitive)
 * - Thread indicator button that opens a Sheet panel for thread replies
 * - Reply-to indicator
 *
 * SOLID IDIOMS: never destructure props; splitProps; createSignal/createMemo/
 * createEffect/onCleanup; For/Show/Switch/Match; strong a11y.
 */

import { preferences } from '@/lib/prefs/preferences';
import { listTopics, summarizeTopics } from '@/lib/search/topicFilter';
import {
  projectRoomTopicUnread,
  readTopicReadLedger,
  subscribeTopicReadLedger,
  type TopicReadMarker,
} from '@/lib/topics/topicReadLedger';
import { isValidTopicLabel, parseTopicRegistry, TOPIC_PROP } from '@/lib/topics/topics';
import { followed, isFollowed, toggleFollow } from '@/lib/notifications/followed';
import {
  peerReviewedAnchors,
  planReviewedAnchorRecall,
  readReviewHistory,
  recordReviewHistory,
  subscribeReviewHistory,
  type ReviewHistoryEntry,
} from '@/lib/notifications/reviewHistory';
import { buildSinceDigest } from '@/lib/notifications/sinceDigest';
import { aggregateMessageReactions } from '@/lib/reactions/quietBoosts';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
  splitProps,
  type JSX,
} from 'solid-js';
import {
  captureDeviceMemoryContext,
  getState,
  isDeviceMemoryContextCurrent,
  selectDeviceMemoryOwner,
  STATUS_TARGET,
  useStore,
} from '@/lib/store';
import { deviceMemoryOwnerKey, loadRecent } from '@/lib/vault/historyVault';
import { revisionsFor, type EditRevision } from '@/lib/vault/editHistory';
import { DM_EMPTY_BODY, DM_EMPTY_TITLE } from '@/lib/e2ee/dmPrivacyChrome';
import {
  lockedPlaceholderForText,
  sanitizePersistedReplyPreviewText,
} from '@/lib/e2ee/replyPrivacy';
import { ScheduledEventLine } from './ScheduledEventLine';
import { openRoomInviteShare } from './roomInviteShareState';
import type { ChatMessage } from '@/lib/irc/types';
import { Avatar } from '@/primitives/index';
import { Sheet } from '@/primitives/index';
import { formatWebhookNoticeBody } from '@/lib/integrations/webhookBlockKit';
import { MessageText } from '@/shell/message/MessageText';
import { MessageMenu } from '@/shell/message/MessageMenu';
import { ReplyIcon } from '@/shell/message/icons';
import {
  createRowGesture,
  rowGesturePointerProps,
  shouldIgnoreRowGestureClick,
} from '@/shell/message/rowGesture';
import '@/shell/message/row-gesture.css';
import { activeMessageSearchResultId, openMessageSearchWithQuery } from './search/useMessageSearch';
import { TopicFilterBar } from './TopicChip';
import { BoostBar } from './BoostBar';
import { SinceDigestCard } from './SinceDigestCard';
import {
  computeMessageWindow,
  DEFAULT_WINDOW_SIZE,
  MAX_WINDOW_ROWS,
  planUnreadNavigation,
  selectMessageAnchorIndex,
} from './messageWindow';
import { threadParentIds } from './threadIndex';
import {
  firstHourHandoffEpoch,
  firstHourComposerHint,
  isFirstHourSeen,
} from '@/lib/firstHour/firstHour';

// ── Types ────────────────────────────────────────────────────────────────────

export type MessageViewProps = {
  /** optionally passed in; falls back to store's ourNick */
  selfNick?: string;
};

const SYSTEM_TYPES = new Set(['join', 'part', 'quit', 'kick', 'mode', 'topic', 'nick', 'system', 'error']);
const READER_MEMORY_PARTICIPANTS = 4;

function clippedReplyPreview(text: string, max = 80): string {
  const safe = sanitizePersistedReplyPreviewText(text);
  return safe.length > max ? `${safe.slice(0, max)}…` : safe;
}

// Bounded-render window. The feed only builds DOM for a contiguous page of
// at most MAX_WINDOW_ROWS (default DEFAULT_WINDOW_SIZE). A deep unread /
// time-travel / search anchor becomes a two-sided page around that row —
// never a tail extension. "Show earlier" grows the trailing page up to the
// ceiling, then pages backward. Reader Start opens the first page. There is
// no Infinity / show-all path.
const BASE_WINDOW_ROWS = DEFAULT_WINDOW_SIZE;
const WINDOW_STEP_ROWS = 200;
// Delay before restoring aria-live to "polite" after a window-growth mutation.
const LIVE_RESTORE_MS = 400;

function clippedDigestPreview(text: string, max = 96): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

export type ReaderMemoryContext = {
  target: string;
  lineCount: number;
  voiceCount: number;
  topicCount: number;
  participants: string[];
  firstAt: Date;
  lastAt: Date;
};

export type ReviewedContextTrailItem = {
  id: string;
  label: 'Before' | 'After';
  from: string;
  preview: string;
};

export type ReviewedContextTrail = {
  before: ReviewedContextTrailItem | null;
  after: ReviewedContextTrailItem | null;
};

type ReviewedAnchorSource = 'visible' | 'vault' | null;

type ReviewedVaultContext = {
  ownerKey: string;
  messages: ChatMessage[];
  trail: ReviewedContextTrail | null;
  hasAnchor: boolean;
};

/** Body-line counts per skeleton row — varied so the loading state reads as
 *  real message groups rather than a uniform grid. */
const SKELETON_ROWS = [2, 1, 3, 2, 1] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(date: Date): string {
  if (preferences().clock === '12h') {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return date.toTimeString().slice(0, 5); // HH:MM
}

function clipped(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/**
 * Accessible name for a transcript row.
 *
 * Rows set `aria-label` on the article, which replaces the children's name
 * computation for assistive tech. The label must therefore:
 *  - never fall back to E2EE ciphertext (SC 1.3.1 + privacy boundary);
 *  - match MsgBody's deleted / locked / action display text;
 *  - surface pending ("queued"), edited, and mention states that the visual
 *    chrome only paints via CSS colour bars or an aria-hidden timestamp
 *    (SC 1.3.1 / 1.4.1 / 4.1.2).
 */
export function messageAccessibleLabel(msg: ChatMessage): string {
  const locked = Boolean(msg.encrypted && msg.plaintext === undefined);
  let body: string;
  if (msg.deleted || msg.redacted) {
    body = '[message deleted]';
  } else if (locked) {
    body = lockedPlaceholderForText(msg.text);
  } else if (msg.type === 'action') {
    body = `* ${msg.from} ${msg.plaintext ?? msg.text}`;
  } else {
    // Prefer decrypted plaintext; never read ciphertext when a sealed body is open.
    body = msg.encrypted
      ? (msg.plaintext ?? lockedPlaceholderForText(msg.text))
      : msg.text;
  }

  const flags: string[] = [];
  if (msg.pending) flags.push('queued');
  if (msg.edited && !msg.deleted && !msg.redacted) flags.push('edited');
  // Mentions paint a left-edge colour bar only — surface the state in text so AT
  // and non-colour users get the same "this names you" signal (SC 1.3.1 / 1.4.1).
  if (msg.highlight && !msg.deleted && !msg.redacted) flags.push('mention');
  const flagSuffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';

  return `${msg.from} at ${fmtTime(msg.time)}${flagSuffix}: ${clipped(body, 120)}`;
}

/** Human day label for the elegant date dividers. */
function dayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Per-nick tint inside the water: hue walks the cyan→azure→ice band, so every
    speaker is distinct while staying inside the active palette. */
export function nickTint(nick: string): string {
  let hash = 0;
  for (let i = 0; i < nick.length; i += 1) hash = (hash * 31 + nick.charCodeAt(i)) >>> 0;
  const hue = 186 + (hash % 46);        // 186..231 — teal-cyan through azure
  const sat = 52 + (hash % 26);         // 52..77%
  const light = 68 + ((hash >> 3) % 14); // 68..81%
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function isSystemMsg(msg: ChatMessage): boolean {
  return SYSTEM_TYPES.has(msg.type);
}

function readableMessageText(message: ChatMessage): string {
  return (message.plaintext ?? message.text).trim();
}

function isReadableMessage(message: ChatMessage): boolean {
  return !isSystemMsg(message)
    && !message.deleted
    && !message.redacted
    && readableMessageText(message).length > 0;
}

function sameAuthorGroup(a: ChatMessage, b: ChatMessage): boolean {
  if (a.from !== b.from) return false;
  if (isSystemMsg(a) || isSystemMsg(b)) return false;
  // Group consecutive messages within 5 minutes
  return Math.abs(b.time.getTime() - a.time.getTime()) < 5 * 60 * 1000;
}

/** True when `list` is already in non-decreasing server-time order. A stable
 *  sort is a fixed point on such a list, so we can return it untouched. We scan
 *  the whole list, not just the tail, because the store buffer is not globally
 *  sorted: hydrateHistory PREPENDS vault rows without sorting (store.ts
 *  `[...fresh, ...existing]`), so an out-of-order seam can sit anywhere. */
function isChronological(list: readonly ChatMessage[]): boolean {
  for (let i = 1; i < list.length; i += 1) {
    if (list[i]!.time.getTime() < list[i - 1]!.time.getTime()) return false;
  }
  return true;
}

/**
 * Order a message buffer chronologically for rendering. Live lines append in
 * arrival order (already non-decreasing), but replayed CHATHISTORY and hydrated
 * vault lines can land out of order. Fast-path the common in-order case: since a
 * stable sort is a no-op on an already-sorted list, skip the O(n log n) sort AND
 * the copy and hand back the store's own array (safe — store buffers are treated
 * as immutable, so downstream never mutates it, and returning the same reference
 * lets dependent memos short-circuit). Only when a seam is out of order do we pay
 * for a defensive stable sort — Array.sort is stable, so equal timestamps keep
 * insertion order, preserving consecutive-author grouping.
 */
export function orderChronologically(list: ChatMessage[]): ChatMessage[] {
  return isChronological(list)
    ? list
    : [...list].sort((a, b) => a.time.getTime() - b.time.getTime());
}

/** Channel-like targets include standard `#` rooms and local/`&` rooms (CHANTYPES). */
function targetLooksLikeChannel(target: string): boolean {
  const ch = target.charAt(0);
  return ch === '#' || ch === '&';
}

export function buildReaderMemoryContext(
  target: string,
  sourceMessages: readonly ChatMessage[],
  isChannel = targetLooksLikeChannel(target),
): ReaderMemoryContext | null {
  if (!isChannel) return null;

  const readable = sourceMessages.filter(isReadableMessage);
  if (readable.length === 0) return null;

  const voices: string[] = [];
  const seenVoices = new Set<string>();
  const topics = new Set<string>();
  for (const message of readable) {
    const nickKey = message.from.toLowerCase();
    if (!seenVoices.has(nickKey)) {
      seenVoices.add(nickKey);
      voices.push(message.from);
    }
    const topic = message.topic?.trim();
    if (topic) topics.add(topic.toLowerCase());
  }

  return {
    target,
    lineCount: readable.length,
    voiceCount: voices.length,
    topicCount: topics.size,
    participants: voices.slice(0, READER_MEMORY_PARTICIPANTS),
    firstAt: readable[0]!.time,
    lastAt: readable[readable.length - 1]!.time,
  };
}

function reviewedContextItem(
  message: ChatMessage | undefined,
  label: ReviewedContextTrailItem['label'],
): ReviewedContextTrailItem | null {
  if (!message || !isReadableMessage(message)) return null;
  return {
    id: message.id,
    label,
    from: message.from,
    preview: clipped(readableMessageText(message), 72),
  };
}

export function buildReviewedContextTrail(
  entry: ReviewHistoryEntry,
  sourceMessages: readonly ChatMessage[],
): ReviewedContextTrail | null {
  const anchorIndex = sourceMessages.findIndex((message) => message.id === entry.firstMessageId);
  if (anchorIndex < 0) return null;

  const before = reviewedContextItem(
    [...sourceMessages.slice(0, anchorIndex)].reverse().find(isReadableMessage),
    'Before',
  );
  const after = reviewedContextItem(
    sourceMessages.slice(anchorIndex + 1).find(isReadableMessage),
    'After',
  );

  if (!before && !after) return null;
  return { before, after };
}

export function hasReviewedAnchor(
  entry: ReviewHistoryEntry,
  sourceMessages: readonly ChatMessage[],
): boolean {
  return sourceMessages.some((message) => message.id === entry.firstMessageId);
}

export function reviewedAnchorSource(
  entry: ReviewHistoryEntry | null,
  visibleMessages: readonly ChatMessage[],
  vaultMessages: readonly ChatMessage[] | null,
): ReviewedAnchorSource {
  if (!entry) return null;
  if (hasReviewedAnchor(entry, visibleMessages)) return 'visible';
  if (vaultMessages && hasReviewedAnchor(entry, vaultMessages)) return 'vault';
  return null;
}

export function mergeReviewedContextTrails(
  primary: ReviewedContextTrail | null,
  fallback: ReviewedContextTrail | null,
): ReviewedContextTrail | null {
  if (!primary && !fallback) return null;
  const before = primary?.before ?? fallback?.before ?? null;
  const after = primary?.after ?? fallback?.after ?? null;
  return before || after ? { before, after } : null;
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralLabel}`;
}

function formatReaderMemoryRange(context: ReaderMemoryContext): string {
  const sameDay = context.firstAt.toDateString() === context.lastAt.toDateString();
  const first = context.firstAt.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const last = context.lastAt.toLocaleString(undefined, sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${first}-${last}`;
}

function reviewCountLabel(entry: ReviewHistoryEntry): string {
  const lineLabel = entry.messageCount === 1 ? 'line' : 'lines';
  const mentionLabel = entry.mentionCount === 1 ? 'mention' : 'mentions';
  const mentionPart = entry.mentionCount > 0 ? `, ${entry.mentionCount} ${mentionLabel}` : '';
  return `${entry.messageCount} ${lineLabel}${mentionPart}`;
}

function formatReviewedAt(entry: ReviewHistoryEntry): string {
  const date = new Date(entry.reviewedAt);
  if (Number.isNaN(date.getTime())) return 'reviewed';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ReaderMemoryStrip(props: {
  context: ReaderMemoryContext;
  reviewedSpan: ReviewHistoryEntry | null;
  reviewedAnchorSource: ReviewedAnchorSource;
  reviewedTrail: ReviewedContextTrail | null;
  peerReviews: readonly ReviewHistoryEntry[];
  hasUnreadBoundary: boolean;
  onJumpStart: () => void;
  onJumpUnread: () => void;
  onJumpLatest: () => void;
  onReturnHome: () => void;
  onJumpReviewed: (entry: ReviewHistoryEntry) => void;
  onJumpReviewedContext: (messageId: string) => void;
  onSearchReviewed: (entry: ReviewHistoryEntry) => void;
  onOpenPeerReview: (entry: ReviewHistoryEntry) => void;
}): JSX.Element {
  const overflow = createMemo(() =>
    Math.max(props.context.voiceCount - props.context.participants.length, 0),
  );
  const reviewedTrailItems = createMemo(() => {
    const trail = props.reviewedTrail;
    return trail ? [trail.before, trail.after].filter((item): item is ReviewedContextTrailItem => item !== null) : [];
  });

  return (
    <section class="shell-reader-memory" aria-label="Device memory context">
      <span class="shell-reader-memory__kicker">Device memory</span>
      <div class="shell-reader-memory__body">
        <strong>{props.context.target}</strong>
        <span>{plural(props.context.lineCount, 'readable line')}</span>
        <span>{plural(props.context.voiceCount, 'voice')}</span>
        <span>
          {props.context.topicCount > 0
            ? plural(props.context.topicCount, 'topic')
            : 'untagged transcript'}
        </span>
        <span>{formatReaderMemoryRange(props.context)}</span>
      </div>
      <Show when={props.context.participants.length > 0}>
        <div class="shell-reader-memory__voices" aria-label="Remembered voices">
          <For each={props.context.participants}>
            {(participant) => <span>{participant}</span>}
          </For>
          <Show when={overflow() > 0}>
            <span>+{overflow()}</span>
          </Show>
        </div>
      </Show>
      <Show when={props.reviewedSpan}>
        {(entry) => (
          <div class="shell-reader-memory__review" role="group" aria-label="Reviewed catch-up span">
            <span class="shell-reader-memory__review-label">Reviewed span</span>
            <span class="shell-reader-memory__review-meta">
              {reviewCountLabel(entry())} / {formatReviewedAt(entry())}
              <Show when={props.reviewedAnchorSource === 'vault'}>
                <span class="shell-reader-memory__review-source">saved on device</span>
              </Show>
            </span>
            <span class="shell-reader-memory__review-preview">{entry().preview}</span>
          </div>
        )}
      </Show>
      <Show when={reviewedTrailItems().length > 0}>
        <div class="shell-reader-memory__trail" role="group" aria-label="Reviewed context trail">
          <span class="shell-reader-memory__trail-label">Context trail</span>
          <div class="shell-reader-memory__trail-list">
            <For each={reviewedTrailItems()}>
              {(item) => (
                <button
                  type="button"
                  class="shell-reader-memory__trail-item"
                  onClick={() => props.onJumpReviewedContext(item.id)}
                  aria-label={`Jump to ${item.label.toLowerCase()} reviewed context`}
                >
                  <span class="shell-reader-memory__trail-side">{item.label}</span>
                  <strong>{item.from}</strong>
                  <span>{item.preview}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
      <Show when={props.peerReviews.length > 0}>
        <div class="shell-reader-memory__peers" role="group" aria-label="Other rooms reviewed recently">
          <span class="shell-reader-memory__peers-label">Other rooms</span>
          <div class="shell-reader-memory__peers-list">
            <For each={props.peerReviews}>
              {(entry) => (
                <button
                  type="button"
                  class="shell-reader-memory__peer-item"
                  onClick={() => props.onOpenPeerReview(entry)}
                  aria-label={`Open reviewed ${entry.name}${entry.kind === 'dm' ? ' direct messages' : ''}`}
                >
                  <strong>{entry.name}</strong>
                  <span>{entry.preview}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
      <nav class="shell-reader-memory__nav" aria-label="Reader transcript navigation">
        <button type="button" onClick={() => props.onJumpStart()}>Start</button>
        <Show when={props.hasUnreadBoundary}>
          <button type="button" onClick={() => props.onJumpUnread()}>New</button>
        </Show>
        <button type="button" onClick={() => props.onJumpLatest()}>Latest</button>
        <button type="button" onClick={() => props.onReturnHome()}>Home</button>
        <Show when={props.reviewedSpan}>
          {(entry) => (
            <>
              <button
                type="button"
                onClick={() => props.onJumpReviewed(entry())}
                aria-label={props.reviewedAnchorSource === 'vault'
                  ? `Load reviewed span from device memory for ${entry().target}`
                  : `Jump to reviewed span for ${entry().target}`}
              >
                {props.reviewedAnchorSource === 'vault' ? 'Load reviewed' : 'Reviewed'}
              </button>
              <button
                type="button"
                onClick={() => props.onSearchReviewed(entry())}
                aria-label={`Search reviewed text for ${entry().target}`}
              >
                Find text
              </button>
            </>
          )}
        </Show>
      </nav>
    </section>
  );
}

// ── Quiet boosts ─────────────────────────────────────────────────────────────

function boostGroupsFor(msg: ChatMessage, selfNick: string) {
  return aggregateMessageReactions(msg.reactions ?? [], selfNick);
}

// ── Thread indicator ─────────────────────────────────────────────────────────

type ThreadIndicatorProps = {
  messageId: string;
  onOpenThread: (msgId: string) => void;
};

function ThreadIndicator(props: ThreadIndicatorProps): JSX.Element {
  const [local] = splitProps(props, ['messageId', 'onOpenThread']);
  return (
    <button
      type="button"
      class="shell-thread-indicator"
      aria-label={`Open thread for message ${local.messageId}`}
      onClick={() => local.onOpenThread(local.messageId)}
    >
      <span aria-hidden="true">⌥</span>
      thread
    </button>
  );
}

// ── Message text ─────────────────────────────────────────────────────────────

type MsgBodyProps = {
  msg: ChatMessage;
  selfNick: string;
  onChannelClick?: (name: string) => void;
  /** Conversation this message is rendered in — scopes Block-Kit action targets. */
  origin: string;
};

/**
 * MsgBody — thin wrapper that handles deleted/action states then delegates
 * to the rich MessageText renderer from @/shell/message/MessageText.
 */
function MsgBody(props: MsgBodyProps): JSX.Element {
  const [local] = splitProps(props, ['msg', 'selfNick', 'onChannelClick', 'origin']);

  // An E2EE body with no decrypted plaintext yet (missing DM/room key, or
  // sealed to a different device) shows a locked placeholder; `text` stays
  // ciphertext at rest.
  const locked = createMemo(() => local.msg.encrypted && local.msg.plaintext === undefined);
  const bodyText = createMemo(() =>
    local.msg.encrypted ? (local.msg.plaintext ?? '') : local.msg.text,
  );

  const cls = createMemo(() => {
    if (local.msg.deleted || local.msg.redacted) return 'shell-msg-text shell-msg-text--deleted';
    if (locked()) return 'shell-msg-text shell-msg-text--locked';
    if (local.msg.type === 'action') return 'shell-msg-text shell-msg-text--action';
    return 'shell-msg-text';
  });

  const displayText = createMemo(() => {
    if (local.msg.deleted || local.msg.redacted) return '[message deleted]';
    if (locked()) return lockedPlaceholderForText(local.msg.text);
    if (local.msg.type === 'action') return `* ${local.msg.from} ${bodyText()}`;
    // Discord webhook JSON that arrived as NOTICE (or was vaulted raw) flattens
    // to IRC-safe text; plain notices pass through unchanged.
    if (local.msg.type === 'notice') return formatWebhookNoticeBody(bodyText());
    return bodyText();
  });

  return (
    <MessageText
      text={displayText()}
      selfNick={local.selfNick}
      onChannelClick={local.onChannelClick}
      class={cls()}
      origin={local.origin}
    />
  );
}

/** Stable empty list so useStore equality does not thrash when no history exists. */
const EMPTY_EDIT_REVISIONS: EditRevision[] = [];

/** Local-only prior bodies for messages we edited on this device. */
function EditedMarker(props: { messageId: string }): JSX.Element {
  const revisions = useStore((s): EditRevision[] => {
    const revs = revisionsFor(s.editHistory, props.messageId);
    return revs.length > 0 ? revs : EMPTY_EDIT_REVISIONS;
  });
  const [open, setOpen] = createSignal(false);
  const hasHistory = createMemo(() => revisions().length > 0);

  return (
    <span class="shell-msg-edited">
      <Show
        when={hasHistory()}
        fallback={
          <span
            class="shell-msg-edited-label"
            style={{ color: 'var(--paper-mute)', 'font-family': 'var(--font-mono)', 'font-size': '0.62rem' }}
          >
            (edited)
          </span>
        }
      >
        <button
          type="button"
          class="shell-msg-edited-btn"
          aria-expanded={open()}
          aria-controls={`edit-history-${props.messageId}`}
          title="Show local edit history"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          (edited)
        </button>
        <Show when={open()}>
          <div
            id={`edit-history-${props.messageId}`}
            class="shell-msg-edit-history"
            role="region"
            aria-label="Local edit history"
          >
            <p class="shell-msg-edit-history-note">Prior versions on this device only</p>
            <ol class="shell-msg-edit-history-list">
              <For each={revisions()}>
                {(rev) => (
                  <li class="shell-msg-edit-history-item">
                    <time
                      class="shell-msg-edit-history-ts"
                      dateTime={new Date(rev.editedAt).toISOString()}
                    >
                      {fmtTime(new Date(rev.editedAt))}
                    </time>
                    <span class="shell-msg-edit-history-body">{rev.body}</span>
                  </li>
                )}
              </For>
            </ol>
          </div>
        </Show>
      </Show>
    </span>
  );
}

// ── Thread panel content ─────────────────────────────────────────────────────

type ThreadPanelProps = {
  parentId: string;
  messages: ChatMessage[];
};

/** Visible body for thread rows — same deleted/locked/action rules as MsgBody,
 *  so the side panel never paints E2EE ciphertext or withdrawn text. */
function threadDisplayText(msg: ChatMessage): string {
  if (msg.deleted || msg.redacted) return '[message deleted]';
  if (msg.encrypted && msg.plaintext === undefined) {
    return lockedPlaceholderForText(msg.text);
  }
  if (msg.type === 'action') return `* ${msg.from} ${msg.plaintext ?? msg.text}`;
  return msg.encrypted
    ? (msg.plaintext ?? lockedPlaceholderForText(msg.text))
    : msg.text;
}

export function ThreadPanel(props: ThreadPanelProps): JSX.Element {
  const [local] = splitProps(props, ['parentId', 'messages']);

  const threadMessages = createMemo(() =>
    local.messages.filter((m) => m.replyTo?.id === local.parentId)
  );

  const parent = createMemo(() => local.messages.find((m) => m.id === local.parentId));

  return (
    <div class="shell-thread-panel">
      {/* Parent message */}
      <Show when={parent()}>
        {(p) => (
          <article
            class="shell-thread-msg"
            aria-label={`Thread parent: ${messageAccessibleLabel(p())}`}
            style={{ 'margin-bottom': '12px' }}
          >
            <div class="shell-thread-msg-meta">
              <span class="shell-thread-msg-from">{p().from}</span>
              <time dateTime={p().time.toISOString()} aria-hidden="true">{fmtTime(p().time)}</time>
            </div>
            <p class="shell-thread-msg-text">{threadDisplayText(p())}</p>
          </article>
        )}
      </Show>

      {/* Thread replies */}
      <div role="log" aria-label={`Thread replies to message ${local.parentId}`}>
        <Show
          when={threadMessages().length > 0}
          fallback={
            <p style={{ color: 'var(--paper-mute)', 'font-family': 'var(--font-mono)', 'font-size': '0.78rem' }}>
              no replies yet
            </p>
          }
        >
          <For each={threadMessages()}>
            {(msg) => (
              <article
                class="shell-thread-msg"
                aria-label={`Thread reply: ${messageAccessibleLabel(msg)}`}
              >
                <div class="shell-thread-msg-meta">
                  <span class="shell-thread-msg-from">{msg.from}</span>
                  <time dateTime={msg.time.toISOString()} aria-hidden="true">{fmtTime(msg.time)}</time>
                </div>
                <p class="shell-thread-msg-text">{threadDisplayText(msg)}</p>
              </article>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function MessageView(props: MessageViewProps): JSX.Element {
  const [local] = splitProps(props, ['selfNick']);
  const [topicReadMarkers, setTopicReadMarkers] = createSignal<readonly TopicReadMarker[]>([]);

  const activeView = useStore((s) => s.activeView);
  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);
  const serverLog = useStore((s) => s.serverLog);
  const channelProps = useStore((s) => s.channelProps);
  const channelNotify = useStore((s) => s.channelNotify);
  const highlightWords = useStore((s) => s.highlightWords);
  const activeChannelTopics = useStore((s) => s.activeChannelTopics);
  const firstUnreadId = useStore((s) => s.firstUnreadId);
  const ourNick = useStore((s) => s.ourNick);
  const collapsedNicks = useStore((s) => s.collapsedNicks);
  const canEditMessages = useStore((s) => s.canEditMessages);
  const canRedactMessages = useStore((s) => s.canRedactMessages);
  const historyLoading = useStore((s) => s.historyLoading);
  const historyExhausted = useStore((s) => s.historyExhausted);
  const forumChannels = useStore((s) => s.forumChannels);
  const memoryOwner = useStore(
    selectDeviceMemoryOwner,
    (left, right) => left?.serverUrl === right?.serverUrl && left?.identity === right?.identity,
  );
  const memoryOwnerKey = createMemo(() => {
    const owner = memoryOwner();
    return owner ? deviceMemoryOwnerKey(owner) : null;
  });
  createEffect(() => {
    const owner = memoryOwner();
    if (!owner) {
      setTopicReadMarkers([]);
      return;
    }
    setTopicReadMarkers(readTopicReadLedger(owner));
    onCleanup(subscribeTopicReadLedger((markers) => {
      setTopicReadMarkers(markers);
    }, owner));
  });

  // Device-local reviewed anchors (newest-first). Powers the current-room
  // reviewed span and the cross-room peer-review handoff chips.
  const [reviewHistory, setReviewHistory] = createSignal<readonly ReviewHistoryEntry[]>([]);
  createEffect(() => {
    const owner = memoryOwner();
    if (!owner) {
      setReviewHistory([]);
      return;
    }
    setReviewHistory(readReviewHistory(owner));
    onCleanup(subscribeReviewHistory((entries) => {
      setReviewHistory(entries);
    }, owner));
  });

  const selfNick = createMemo(() => local.selfNick ?? ourNick() ?? '');

  // ── active messages ──
  const activeTopic = createMemo((): string | null => {
    const view = activeView();
    if (view.kind !== 'channel') return null;
    return activeChannelTopics().get(view.channel.toLowerCase()) ?? null;
  });

  function openExistingTopic(topic: string | null): void {
    const view = activeView();
    if (view.kind !== 'channel') return;
    getState().openChannelConversation(view.channel, topic);
  }

  const allMessages = createMemo((): ChatMessage[] => {
    const view = activeView();
    let list: ChatMessage[] = [];
    if (view.kind === 'channel') {
      list = channels().get(view.channel)?.messages ?? [];
    } else if (view.kind === 'dm') {
      list = dms().get(view.nick.toLowerCase())?.messages ??
             dms().get(view.nick)?.messages ?? [];
    } else if (view.kind === 'status') {
      list = serverLog();
    }
    // Render chronologically. Live lines append in arrival order (already
    // sorted), but replayed CHATHISTORY / hydrated vault lines can land out of
    // order; orderChronologically stable-sorts only when a seam is out of place
    // and otherwise hands back the buffer untouched (see its doc comment).
    return orderChronologically(list);
  });

  // id → absolute index into allMessages(). Built in one O(n) pass whenever the
  // list changes so the several "is this row at/after the unread divider?"
  // checks below are O(1) lookups instead of an O(n) findIndex per candidate —
  // which made those filters O(n²) (≈160k id-compares on a 400-line vault) on
  // every message change while an unread divider was present.
  const allIndexById = createMemo((): ReadonlyMap<string, number> => {
    const list = allMessages();
    const map = new Map<string, number>();
    for (let i = 0; i < list.length; i += 1) map.set(list[i]!.id, i);
    return map;
  });

  const availableTopics = createMemo((): string[] => {
    const view = activeView();
    if (view.kind !== 'channel') return [];

    const fromRegistry = parseTopicRegistry(
      channelProps().get(view.channel.toLowerCase())?.[TOPIC_PROP],
    );
    const fromMessages = listTopics(
      allMessages().map((message) => ({
        id: message.id,
        topic: message.topic ?? null,
        at: message.time,
      })),
    );

    const topics: string[] = [];
    const seen = new Set<string>();
    for (const topic of [...fromRegistry, ...fromMessages]) {
      const key = topic.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      topics.push(topic);
    }
    return topics;
  });

  const messages = createMemo((): ChatMessage[] => {
    const topic = activeTopic();
    const collapsed = collapsedNicks();
    let list = allMessages();
    if (topic !== null) {
      const key = topic.toLowerCase();
      list = list.filter((message) => (message.topic ?? '').toLowerCase() === key);
    }
    // Device-local hide for noisy nicks (not ignore — notifications still fire).
    if (collapsed.size > 0) {
      list = list.filter((message) => {
        const from = typeof message.from === 'string' ? message.from.toLowerCase() : '';
        return !from || !collapsed.has(from);
      });
    }
    return list;
  });

  const collapsedNickList = createMemo(() =>
    [...collapsedNicks()].sort((a, b) => a.localeCompare(b, 'en')),
  );

  // One O(n) pass builds the set of parent ids that have at least one reply, so
  // each rendered row answers "has a thread?" in O(1) instead of re-scanning the
  // whole buffer per row (which is O(rows × total) and janks large channels).
  const threadParents = createMemo(() => threadParentIds(messages()));

  const followTarget = createMemo(() => {
    const view = activeView();
    if (view.kind !== 'channel') return null;
    return { channel: view.channel, topic: activeTopic() };
  });

  const followActive = createMemo(() => {
    const owner = memoryOwner();
    if (!owner) return false;
    followed(owner);
    const target = followTarget();
    return target ? isFollowed(target.channel, target.topic, owner) : false;
  });

  function toggleActiveFollow(): void {
    const target = followTarget();
    const owner = memoryOwner();
    if (!target || !owner) return;
    toggleFollow(target.channel, target.topic, owner);
  }

  const forumPinned = createMemo(() => {
    const view = activeView();
    return view.kind === 'channel' && forumChannels().has(view.channel.toLowerCase());
  });

  function toggleForumPinned(): void {
    const view = activeView();
    if (view.kind !== 'channel') return;
    getState().toggleForumChannel(view.channel);
    setForumView(true);
  }

  function followTopic(topic: string): void {
    const view = activeView();
    const owner = memoryOwner();
    if (view.kind !== 'channel' || !owner) return;
    toggleFollow(view.channel, topic, owner);
  }

  function topicFollowed(topic: string): boolean {
    const owner = memoryOwner();
    if (!owner) return false;
    followed(owner);
    const view = activeView();
    return view.kind === 'channel' && isFollowed(view.channel, topic, owner);
  }

  // ── active target for reactions/sends ──
  const activeTarget = createMemo(() => {
    const view = activeView();
    if (view.kind === 'channel') return view.channel;
    if (view.kind === 'dm') return view.nick;
    if (view.kind === 'status') return STATUS_TARGET;
    return '';
  });

  createEffect(() => {
    activeTarget();
  });

  // True while CHATHISTORY is in flight for the open target — lets the empty
  // feed show a loading skeleton instead of the "say the first thing" prompt.
  const isLoadingHistory = createMemo(() => {
    const t = activeTarget();
    if (!t) return false;
    return historyLoading().get(t.toLowerCase()) ?? false;
  });

  const firstHourSayHi = createMemo(() => {
    firstHourHandoffEpoch();
    isFirstHourSeen();
    return firstHourComposerHint();
  });

  // ── unread divider ──
  // The id of the message the "new messages" boundary sits above. Captured when
  // the conversation was opened (store.captureUnreadDivider) so it stays put
  // while you read, marking where you left off.
  const viewUnreadDividerId = useStore((s) => s.viewUnreadDividerId);
  const unreadDividerId = createMemo(() => {
    const t = activeTarget();
    if (!t) return null;
    return viewUnreadDividerId().get(t.toLowerCase()) ?? null;
  });

  // This stays accurate while the bounded list pages, filters, or hydrates:
  // every value comes from the active store target rather than mounted rows.
  const conversationBrief = createMemo(() => {
    const view = activeView();
    const target = activeTarget();
    const topic = activeTopic();
    const unread = view.kind === 'channel'
      ? channels().get(view.channel)?.unread ?? 0
      : view.kind === 'dm'
        ? dms().get(view.nick.toLowerCase())?.unread ?? dms().get(view.nick)?.unread ?? 0
        : 0;
    const label = view.kind === 'status' ? 'Network activity' : target;
    const detail = isLoadingHistory()
      ? 'Loading history'
      : unread > 0
        ? `${unread} unread${topic ? ' in room' : ''}`
        : unreadDividerId()
          ? 'Unread boundary saved'
          : 'Caught up';
    return { label, topic, detail, kind: view.kind };
  });

  const topicUnreadCounts = createMemo((): ReadonlyMap<string, number> => {
    const all = allMessages();
    const view = activeView();
    if (view.kind !== 'channel') return new Map<string, number>();
    const key = view.channel.toLowerCase();
    const boundaryId = unreadDividerId() ?? firstUnreadId().get(key) ?? null;
    const boundaryIndex = boundaryId
      ? all.findIndex((message) => message.id === boundaryId)
      : all.length;
    const notify = channelNotify().get(key) ?? 'all';
    const ourKey = selfNick().toLowerCase();
    const words = highlightWords()
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean);
    const isHighlight = (message: ChatMessage): boolean => {
      if (message.highlight || /@(everyone|here)\b/i.test(message.text)) return true;
      const lower = message.text.toLowerCase();
      return words.some((word) => lower.includes(word));
    };
    return projectRoomTopicUnread(view.channel, all, topicReadMarkers(), {
      fallbackBoundaryIndex: boundaryIndex < 0 ? all.length : boundaryIndex,
      isExcludedMessage: (message) => {
        if (isSystemMsg(message) || message.from.toLowerCase() === ourKey || notify === 'none') return true;
        if (notify !== 'mentions') return false;
        return !isHighlight(message);
      },
      isHighlightMessage: isHighlight,
    }).unreadByTopic;
  });

  const sinceDigest = createMemo(() => {
    const dividerId = unreadDividerId();
    if (!dividerId) return null;
    if (activeView().kind !== 'channel') return null;
    const channel = activeTarget();
    if (!channel) return null;
    const indexById = allIndexById();
    const dividerIndex = indexById.get(dividerId) ?? -1;
    if (dividerIndex < 0) return null;
    const divider = allMessages()[dividerIndex]!;
    const visibleUnread = messages().filter(
      (message) => (indexById.get(message.id) ?? -1) >= dividerIndex,
    );
    const since = new Date(divider.time.getTime() - 1);
    const digest = buildSinceDigest(
      visibleUnread
        .filter((message) => !isSystemMsg(message) && message.time.getTime() > since.getTime())
        .map((message) => ({
          channel,
          nick: message.from,
          at: message.time,
          isMention: !!message.highlight,
          text: message.plaintext ?? message.text,
        })),
      since,
      { maxChannels: 1 },
    );
    return digest.totalMessages > 0 ? digest : null;
  });

  const readerMemoryContext = createMemo(() => {
    const prefs = preferences();
    if (!prefs.readerMode || !prefs.localHistory) return null;
    return buildReaderMemoryContext(activeTarget(), messages(), activeView().kind === 'channel');
  });
  const readerReviewedSpan = createMemo(() => {
    const context = readerMemoryContext();
    if (!context) return null;
    // Prefer the reactive review-history signal so peer/current chips stay in
    // sync without a second storage read on every render.
    return reviewHistory().find((entry) =>
      entry.kind === 'channel' && entry.target.toLowerCase() === context.target.toLowerCase(),
    ) ?? null;
  });
  const readerPeerReviews = createMemo(() => {
    const context = readerMemoryContext();
    return context ? peerReviewedAnchors(reviewHistory(), context.target) : [];
  });
  const [readerVaultContext] = createResource(
    () => {
      const entry = readerReviewedSpan();
      const owner = memoryOwner();
      return entry && owner ? { target: entry.target, firstMessageId: entry.firstMessageId, owner } : null;
    },
    async (key): Promise<ReviewedVaultContext> => {
      const localMessages = await loadRecent(key.target, 80, key.owner);
      const entry: ReviewHistoryEntry = {
        target: key.target,
        name: key.target,
        kind: 'channel',
        firstMessageId: key.firstMessageId,
        firstAt: '',
        reviewedAt: '',
        messageCount: 0,
        mentionCount: 0,
        preview: '',
      };
      return {
        ownerKey: deviceMemoryOwnerKey(key.owner) ?? '',
        messages: localMessages,
        trail: buildReviewedContextTrail(entry, localMessages),
        hasAnchor: hasReviewedAnchor(entry, localMessages),
      };
    },
    // Reader-memory hydration is an additive local projection. Seed an empty
    // value and read `latest` so a slow IndexedDB transaction cannot suspend
    // the live conversation shell during a mode/view change.
    { initialValue: null },
  );
  const readerHydratedTrail = createMemo(() => {
    const entry = readerReviewedSpan();
    return entry ? buildReviewedContextTrail(entry, messages()) : null;
  });
  const ownedReaderVaultContext = createMemo(() => {
    const context = readerVaultContext.latest;
    return context?.ownerKey === memoryOwnerKey() ? context : null;
  });
  const readerAnchorSource = createMemo(() => {
    const entry = readerReviewedSpan();
    const visibleMessages = messages();
    if (entry && ownedReaderVaultContext()?.hasAnchor && !hasReviewedAnchor(entry, visibleMessages)) return 'vault';
    return reviewedAnchorSource(entry, visibleMessages, null);
  });
  const readerReviewedTrail = createMemo(() =>
    mergeReviewedContextTrails(readerHydratedTrail(), ownedReaderVaultContext()?.trail ?? null),
  );

  // ── scroll state ──
  let feedEl!: HTMLDivElement;
  const [atBottom, setAtBottom] = createSignal(true);

  // ── bounded render window ──
  // windowSize is the finite render capacity (never Infinity). pageStart is an
  // explicit historical page origin (Reader Start / earlier paging). Reset both
  // to the live trailing page on every conversation switch.
  const [windowSize, setWindowSize] = createSignal<number>(BASE_WINDOW_ROWS);
  const [pageStart, setPageStart] = createSignal<number | null>(null);
  // After the user explicitly pages or jumps to latest, do not let a leftover
  // unread divider steal the window back. Fresh conversation opens still use it.
  const [ignoreUnreadAnchor, setIgnoreUnreadAnchor] = createSignal(false);
  // One-shot unread handoff: Reader New / Review may force the divider into
  // the window even while a historical pageStart is active.
  const [forceUnreadNav, setForceUnreadNav] = createSignal(false);
  // aria-live mode for the feed. Flipped to "off" while older rows enter the DOM
  // (window growth / conversation switch / history replay / page replace) so
  // those mutations are never re-announced, then restored to "polite" for
  // genuine new tail arrivals while the trailing window is active.
  const [liveMode, setLiveMode] = createSignal<'polite' | 'off'>('polite');
  let liveRestoreTimer: ReturnType<typeof setTimeout> | undefined;

  function muteLiveForWindowChange(): void {
    setLiveMode('off');
    if (liveRestoreTimer) clearTimeout(liveRestoreTimer);
    liveRestoreTimer = setTimeout(() => setLiveMode('polite'), LIVE_RESTORE_MS);
  }

  function resetToTrailingWindow(): void {
    setPageStart(null);
    setWindowSize(BASE_WINDOW_ROWS);
  }

  function resetFeedToConversation(): void {
    resetToTrailingWindow();
    setIgnoreUnreadAnchor(false);
  }

  function prefersInstantScroll(): boolean {
    if (preferences().reduceMotion) return true;
    try {
      return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  // Tap-to-reveal action bar (touch): id of the row whose action bar is showing.
  // Declared here so the conversation-switch effect below can clear it.
  const [revealedId, setRevealedId] = createSignal<string | null>(null);

  // Count of messages that arrived while scrolled away from the bottom, so the
  // jump-to-latest pill can say "N new" instead of a bare arrow. lastSeenCount is
  // the message count as of the last time we were pinned to the bottom.
  const [unreadBelow, setUnreadBelow] = createSignal(0);
  let lastSeenCount = 0;

  function checkScroll(): void {
    const el = feedEl;
    if (!el) return;
    const threshold = 80;
    const visuallyAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    // A historical page that hides newer rows is never the live tail, even
    // when the user is scrolled to the bottom of the mounted slice.
    setAtBottom(visuallyAtBottom && messageWindow().hiddenAfter === 0);
  }

  function scrollToBottom(smooth = false): void {
    const el = feedEl;
    if (!el) return;
    const useSmooth = smooth && !prefersInstantScroll();
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: useSmooth ? 'smooth' : 'instant' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }

  function jumpToLatest(smooth = false): void {
    muteLiveForWindowChange();
    setIgnoreUnreadAnchor(true);
    resetToTrailingWindow();
    scrollToBottom(smooth);
    setAtBottom(true);
    lastSeenCount = messages().length;
    setUnreadBelow(0);
  }

  function scrollToReaderStart(): void {
    // First loaded page only — never Infinity. Solid's <For> reconciles
    // synchronously on the signal write, so the first row is already in the
    // DOM; scroll/focus it in the same tick.
    muteLiveForWindowChange();
    setIgnoreUnreadAnchor(true);
    setWindowSize(BASE_WINDOW_ROWS);
    setPageStart(0);
    const node = feedEl?.querySelector<HTMLElement>('[data-message-search-id]');
    node?.scrollIntoView?.({ block: 'start' });
    node?.focus?.({ preventScroll: true });
    setAtBottom(false);
  }

  // Grow the window while preserving the scroll anchor: adding older rows above
  // the viewport would otherwise jump the scroll position. Capture height/top,
  // mutate, then restore scrollTop by the height delta on the next frame.
  function preserveScrollAround(mutate: () => void): void {
    const el = feedEl;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    mutate();
    requestAnimationFrame(() => {
      if (!el) return;
      el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
      checkScroll();
    });
  }

  function showEarlierMessages(): void {
    const win = messageWindow();
    const size = windowSize();
    if (win.hiddenBefore <= 0) return;
    muteLiveForWindowChange();
    setIgnoreUnreadAnchor(true);
    const canGrowOnTail = win.hiddenAfter === 0 && size < MAX_WINDOW_ROWS;
    const nextPageStart = Math.max(0, win.start - Math.max(1, win.rendered));
    preserveScrollAround(() => {
      if (canGrowOnTail) {
        setWindowSize((n) => {
          const next = Number.isFinite(n) ? n + WINDOW_STEP_ROWS : BASE_WINDOW_ROWS;
          return Math.min(MAX_WINDOW_ROWS, Math.max(BASE_WINDOW_ROWS, next));
        });
        return;
      }
      setPageStart(nextPageStart);
    });
  }

  function nextPaint(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve());
        return;
      }
      queueMicrotask(resolve);
    });
  }

  async function settleUnreadDivider(attempts = 8): Promise<HTMLElement | null> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const node = feedEl?.querySelector<HTMLElement>('.shell-unread-divider');
      if (node) return node;
      await nextPaint();
    }
    return feedEl?.querySelector<HTMLElement>('.shell-unread-divider') ?? null;
  }

  /**
   * Shared unread handoff. Resolves the divider index before any review
   * clear, selects a bounded page around it, waits for Solid to commit the
   * replacement, then scrolls and focuses the divider. Returns false when
   * the index or DOM node cannot be handed off.
   */
  async function navigateToUnreadBoundary(): Promise<boolean> {
    const unreadId = unreadDividerId();
    if (!unreadId) return false;
    const unreadIndex = visibleIndexById().get(unreadId);
    if (unreadIndex == null) return false;
    const planned = planUnreadNavigation({
      total: messages().length,
      unreadIndex,
      windowSize: BASE_WINDOW_ROWS,
    });
    if (!planned) return false;

    muteLiveForWindowChange();
    setForceUnreadNav(true);
    setIgnoreUnreadAnchor(false);
    setWindowSize(BASE_WINDOW_ROWS);
    setPageStart(planned.window.start);

    await nextPaint();
    const node = await settleUnreadDivider();
    setForceUnreadNav(false);
    if (!node) return false;

    const behavior = prefersInstantScroll() ? 'instant' : 'smooth';
    node.scrollIntoView({ block: 'center', behavior });
    node.focus({ preventScroll: true });
    setAtBottom(false);
    return true;
  }

  async function reviewUnreadBoundary(): Promise<void> {
    const target = activeTarget();
    if (!target || activeView().kind !== 'channel') return;
    const dividerId = unreadDividerId();
    if (!dividerId) return;
    const digest = sinceDigest();
    const divider = allMessages().find((message) => message.id === dividerId) ?? null;
    const owner = memoryOwner();
    const indexById = allIndexById();
    const dividerIndex = indexById.get(dividerId) ?? -1;
    const unreadMessages = dividerIndex >= 0
      ? messages().filter(
        (message) => (indexById.get(message.id) ?? -1) >= dividerIndex && !isSystemMsg(message),
      )
      : [];
    const latest = unreadMessages[unreadMessages.length - 1];

    const handedOff = await navigateToUnreadBoundary();
    if (!handedOff) return;

    if (owner && digest && divider) {
      recordReviewHistory({
        target,
        name: target,
        kind: 'channel',
        firstMessageId: dividerId,
        firstAt: divider.time.toISOString(),
        reviewedAt: new Date().toISOString(),
        messageCount: digest.totalMessages,
        mentionCount: digest.totalMentions,
        preview: clippedDigestPreview(latest ? (latest.plaintext ?? latest.text) : target),
      }, owner);
    }
    // Clear only after the divider has been scrolled and focused. One paint
    // lets the handoff be observed before the separator leaves the DOM.
    await nextPaint();
    if (unreadDividerId() !== dividerId) return;
    getState().clearViewUnreadDivider(target);
  }

  async function jumpToReviewedSpan(entry: ReviewHistoryEntry): Promise<void> {
    const state = getState();
    const memoryContext = captureDeviceMemoryContext(state);
    if (!memoryContext) return;
    const visibleMessages = messages();
    const cachedVault = ownedReaderVaultContext();
    if (!hasReviewedAnchor(entry, visibleMessages)) {
      const localMessages = cachedVault?.messages
        ?? await loadRecent(entry.target, 80, memoryContext.owner);
      if (!isDeviceMemoryContextCurrent(memoryContext)) return;
      if (hasReviewedAnchor(entry, localMessages)) {
        state.hydrateHistory(entry.target, localMessages);
      }
    }
    state.focusMessage(entry.firstMessageId);
    const firstAt = new Date(entry.firstAt);
    if (entry.kind === 'channel' && !Number.isNaN(firstAt.getTime())) {
      state.travelTo(entry.target, firstAt);
    }
  }

  function jumpToReviewedContext(messageId: string): void {
    getState().focusMessage(messageId);
  }

  function searchReviewedSpan(entry: ReviewHistoryEntry): void {
    openMessageSearchWithQuery(entry.preview);
  }

  /** Cross-room handoff: reopen another room's reviewed anchor via exact-id travel. */
  function openPeerReviewedAnchor(entry: ReviewHistoryEntry): void {
    const plan = planReviewedAnchorRecall(entry);
    if (!plan) return;
    const state = getState();
    state.openVaultResult(plan.target, plan.messageId);
    if (plan.at) state.travelTo(plan.target, plan.at, plan.messageId);
  }

  // Autoscroll when new messages arrive and we're already at bottom
  createEffect(() => {
    // Track messages() so effect re-runs on change
    const msgs = messages();
    if (msgs.length > 0 && atBottom()) {
      // Use queueMicrotask so DOM is updated first
      queueMicrotask(() => scrollToBottom(false));
    }
  });

  // Track how many messages have arrived since we were last at the bottom. While
  // pinned to the bottom the baseline tracks the live count (nothing unread); once
  // scrolled up, anything beyond the baseline is "new below".
  createEffect(() => {
    const count = messages().length;
    if (atBottom()) {
      lastSeenCount = count;
      setUnreadBelow(0);
    } else {
      setUnreadBelow(Math.max(0, count - lastSeenCount));
    }
  });

  // On opening a conversation that has an unread boundary, land on it (where you
  // left off) instead of the bottom. Runs once per switch; an rAF lets the
  // divider boundary (captured just after navigate) and its DOM node settle, and
  // runs after the autoscroll effect's microtask so this scroll wins.
  let scrolledTarget: string | null = null;
  createEffect(() => {
    const target = activeTarget();
    unreadDividerId(); // re-track so the boundary settling re-runs the effect
    if (!target || target === scrolledTarget) return;
    scrolledTarget = target;
    setRevealedId(null);
    // Fresh conversation starts from the trailing window again.
    resetFeedToConversation();
    // Reset the "new below" baseline for the channel we just opened.
    lastSeenCount = messages().length;
    setUnreadBelow(0);
    requestAnimationFrame(() => {
      const el = feedEl?.querySelector<HTMLElement>('.shell-unread-divider');
      if (el) {
        el.scrollIntoView({ block: 'center' });
        setAtBottom(false);
      } else {
        scrollToBottom(false);
      }
    });
  });

  // ── time-travel landing (?at= deep link, vault search hits) ──
  // When the store points at a landing message (a CHATHISTORY AROUND answer,
  // or a device-memory search hit), scroll to it and pulse. The node may not
  // be in the DOM yet — an AROUND merge is still rendering, or a vault hit
  // just triggered a join + hydration — so retry against a deadline generous
  // enough to cover join + hydrate latency before giving up.
  const timeTravelLandingId = useStore((s) => s.timeTravelLandingId);
  createEffect(() => {
    const landingId = timeTravelLandingId();
    if (!landingId) return;
    const deadline = performance.now() + 3000;
    const attempt = (): void => {
      if (getState().timeTravelLandingId !== landingId) return; // superseded
      const esc = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(landingId)
        : landingId.replace(/["\\]/g, '\\$&');
      const node = feedEl?.querySelector<HTMLElement>(`[data-message-search-id="${esc}"]`);
      if (node) {
        node.scrollIntoView({ block: 'center' });
        node.focus({ preventScroll: true });
        setAtBottom(false);
        node.classList.add('shell-msg-search-pulse');
        if (typeof window !== 'undefined') {
          window.setTimeout(() => node.classList.remove('shell-msg-search-pulse'), 1400);
        }
        getState().clearTimeTravelLanding();
        return;
      }
      if (performance.now() < deadline) requestAnimationFrame(attempt);
      else getState().clearTimeTravelLanding();
    };
    requestAnimationFrame(attempt);
  });

  // ── thread panel ──
  const [threadOpen, setThreadOpen] = createSignal(false);
  const [threadParentId, setThreadParentId] = createSignal<string | null>(null);
  const [forumView, setForumView] = createSignal(false);
  const [topicDraft, setTopicDraft] = createSignal('');

  function openThread(msgId: string): void {
    setThreadParentId(msgId);
    setThreadOpen(true);
  }

  const topicSummaries = createMemo(() => summarizeTopics(
    allMessages().map((message) => ({
      id: message.id,
      topic: message.topic ?? null,
      at: message.time,
    })),
  ));

  createEffect(() => {
    const view = activeView();
    if (view.kind !== 'channel') {
      setForumView(false);
      return;
    }
    if (forumPinned() && topicSummaries().length > 0) {
      setForumView(true);
    }
  });

  function latestTopicMessage(topic: string): ChatMessage | null {
    const key = topic.toLowerCase();
    return allMessages()
      .filter((message) => (message.topic ?? '').toLowerCase() === key && !isSystemMsg(message))
      .at(-1) ?? null;
  }

  function openTopic(topic: string): void {
    openExistingTopic(topic);
    setForumView(false);
    // The forum card disappears with the forum projection. Hand focus to the
    // now-active filter chip so keyboard/screen-reader users land on the same
    // conversation instead of falling back to the document body.
    queueMicrotask(() => {
      feedEl?.parentElement
        ?.querySelector<HTMLButtonElement>('.topic-filter-bar .topic-chip.is-active')
        ?.focus();
    });
  }

  const canStartTopic = createMemo(() => isValidTopicLabel(topicDraft().trim()));

  function startTopic(event: Event): void {
    event.preventDefault();
    const topic = topicDraft().trim();
    if (!isValidTopicLabel(topic)) return;
    const view = activeView();
    if (view.kind !== 'channel') return;
    // This label does not exist yet, so the known-conversation opener would
    // correctly reject it as stale. Keep creation on the raw setter until the
    // first tagged message/registering split makes the topic discoverable.
    getState().setActiveChannelTopic(view.channel, topic);
    setForumView(false);
    setTopicDraft('');
  }

  // ── tap-to-reveal action bar (touch) ──
  // On touch devices there is no hover, so the per-message action bar (react /
  // reply / ⋯) stays hidden until the row is tapped — it would otherwise crowd
  // every line. revealedId (declared above) holds the one revealed row. Taps that
  // land on a link, button, or an active text selection are ignored so they keep
  // their normal behaviour rather than toggling the bar.
  function toggleReveal(msgId: string, event: MouseEvent): void {
    if (shouldIgnoreRowGestureClick(event)) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('a, button, input, textarea, select, [role="button"], [contenteditable="true"]')) {
      return;
    }
    const selection = typeof window !== 'undefined' ? window.getSelection?.() : null;
    if (selection && !selection.isCollapsed) return;
    setRevealedId((current) => (current === msgId ? null : msgId));
  }

  function toggleRevealFromKeyboard(msgId: string, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setRevealedId((current) => (current === msgId ? null : msgId));
  }

  // ── bounded render window ──
  // Pick one reachable id (search > time-travel > unread-in-tail-mode). Never
  // union several anchors into one huge range — that was the 60k-row bug.
  const visibleIndexById = createMemo((): ReadonlyMap<string, number> => {
    const list = messages();
    const map = new Map<string, number>();
    for (let i = 0; i < list.length; i += 1) {
      const id = list[i]?.id;
      if (id) map.set(id, i);
    }
    return map;
  });

  const anchorIndex = createMemo((): number | null => {
    const byId = visibleIndexById();
    if (byId.size === 0) return null;
    const lookup = (id: string | null | undefined): number | null => {
      if (!id) return null;
      return byId.get(id) ?? null;
    };
    return selectMessageAnchorIndex({
      searchIndex: lookup(activeMessageSearchResultId()),
      landingIndex: lookup(timeTravelLandingId()),
      unreadIndex: ignoreUnreadAnchor() && !forceUnreadNav() ? null : lookup(unreadDividerId()),
      pageStart: pageStart(),
      forceUnread: forceUnreadNav(),
    });
  });

  const messageWindow = createMemo(() =>
    computeMessageWindow({
      total: messages().length,
      windowSize: windowSize(),
      anchorIndex: anchorIndex(),
      pageStart: pageStart(),
    }),
  );

  const windowedMessages = createMemo(() => {
    const win = messageWindow();
    return messages().slice(win.start, win.end);
  });

  // Day-boundary flags for every row in the CURRENT window, computed in a
  // single O(window) pass and returned POSITIONALLY (window-relative index),
  // not keyed by message id.
  //
  // Previously each <For> row owned its own `prevMsg`/`dayBoundary`
  // createMemo pair that re-read `messageWindow()` (a fresh object literal
  // per call, messageWindow.ts:189-197) and `messages()` (a fresh array
  // reference per append). Solid's default memo equality is `===`, so every
  // inbound message invalidated both signals for EVERY rendered row — 2×
  // rendered memo re-executions and 2× rendered `Date.toDateString()` calls
  // per inbound message, recomputing the identical boundary for every row
  // but at most one. Hoisting the pass here collapses 2N per-row memo nodes
  // into this single one; each row's <Show> reads `dayBoundaryFlags()[index()]`
  // instead of re-deriving the boundary.
  //
  // Positional, NOT id-keyed: a Map keyed by `msg.id` is last-write-wins on a
  // duplicate id within one window, so two colliding rows would both read the
  // LAST write and the transcript's earlier occurrence could silently lose
  // its divider. `msg.id` is not guaranteed unique across window merges
  // (CHATHISTORY/AROUND replay, a content-derived replayEventId collision,
  // etc.), so an array indexed by window-relative position — exactly what the
  // old `index()`-based derivation used — is collision-proof by construction
  // and matches old semantics exactly.
  //
  // Row 0 in the window may have an out-of-window predecessor (win.start >
  // 0) whose day still governs whether row 0 gets a divider — that
  // predecessor is looked up once here instead of via a per-row memo.
  const dayBoundaryFlags = createMemo((): boolean[] => {
    const win = messageWindow();
    const all = messages();
    const windowed = windowedMessages();
    const flags: boolean[] = [];
    let prevDay: string | null = win.start > 0
      ? all[win.start - 1]?.time.toDateString() ?? null
      : null;
    for (const msg of windowed) {
      const day = msg.time.toDateString();
      flags.push(prevDay === null || prevDay !== day);
      prevDay = day;
    }
    return flags;
  });

  // Persist a two-sided / start page so clearing a transient landing id
  // (focusMessage / time-travel) does not snap the feed back to the tail.
  createEffect(() => {
    const win = messageWindow();
    if (win.hiddenAfter > 0 && pageStart() !== win.start) {
      setPageStart(win.start);
    }
  });

  createEffect(() => {
    if (messageWindow().hiddenAfter > 0) setAtBottom(false);
  });

  // Suppress aria-live announcements whenever the rendered slice is replaced —
  // window growth, an anchored page change, history replay, Reader Start,
  // jump-to-latest restore, or a conversation / topic switch. A genuine new
  // tail arrival on the live trailing window keeps start flat-or-rising by at
  // most the number of newly appended rows and stays announced.
  //
  // A topic-filter change is a conversation switch on a SECOND axis: activeTarget()
  // is unchanged, but messages() becomes a different filtered set (see the memo
  // above) and <For> swaps the whole trailing window. Fold activeTopic() into
  // the guard's identity so a topic switch suppresses the log and resets the
  // trailing window exactly like a channel switch.
  let prevWindowStart = Number.POSITIVE_INFINITY;
  let prevWindowEnd = Number.POSITIVE_INFINITY;
  let prevWindowTotal = 0;
  let prevHiddenAfter = 0;
  let prevLiveTarget: string | null = null;
  let prevLiveTopic: string | null = null;
  createEffect(() => {
    const win = messageWindow();
    const start = win.start;
    const end = win.end;
    const total = messages().length;
    const target = activeTarget();
    const topic = activeTopic();
    const switched = target !== prevLiveTarget || topic !== prevLiveTopic;
    const added = total - prevWindowTotal;
    const tailArrival = !switched
      && win.hiddenAfter === 0
      && prevHiddenAfter === 0
      && start >= prevWindowStart
      && (start - prevWindowStart) <= Math.max(0, added)
      && end >= prevWindowEnd
      && (end - prevWindowEnd) <= Math.max(0, added);
    if (switched || !tailArrival) {
      // A switch (channel or topic) starts the new view from the trailing window
      // again; a pure window-growth ("show earlier") must NOT — that would undo
      // the user's own "show earlier", so only reset on an identity change.
      if (switched) resetFeedToConversation();
      if (switched || start !== prevWindowStart || end !== prevWindowEnd) {
        muteLiveForWindowChange();
      }
    }
    prevWindowStart = start;
    prevWindowEnd = end;
    prevWindowTotal = total;
    prevHiddenAfter = win.hiddenAfter;
    prevLiveTarget = target;
    prevLiveTopic = topic;
  });
  onCleanup(() => {
    if (liveRestoreTimer) clearTimeout(liveRestoreTimer);
  });

  return (
    <main class="shell-messages" aria-label="Messages">
      <section
        class="shell-conversation-brief sr-only"
        aria-label={`Current conversation: ${conversationBrief().label}${conversationBrief().topic ? `, topic ${conversationBrief().topic}` : ''}, ${conversationBrief().detail}`}
        data-conversation-kind={conversationBrief().kind}
      >
        <span class="shell-conversation-brief-kicker">Current</span>
        <span class="shell-conversation-brief-target">{conversationBrief().label}</span>
        <Show when={conversationBrief().topic}>
          {(topic) => <span class="shell-conversation-brief-topic">#{topic()}</span>}
        </Show>
        <span class="shell-conversation-brief-detail">{conversationBrief().detail}</span>
      </section>
      <Show when={activeView().kind === 'channel' && preferences().topicTools}>
        <div class="shell-topic-filter">
          <Show when={availableTopics().length > 0}>
            <TopicFilterBar
              topics={availableTopics()}
              active={activeTopic()}
              unreadCounts={topicUnreadCounts()}
              onSelect={openExistingTopic}
            />
          </Show>
          <form class="shell-topic-create" onSubmit={startTopic}>
            <label class="sr-only" for="shell-topic-create-input">New topic</label>
            <input
              id="shell-topic-create-input"
              class="shell-topic-create-input"
              value={topicDraft()}
              placeholder="new topic"
              maxlength="50"
              autocomplete="off"
              aria-label="New topic"
              onInput={(event) => setTopicDraft(event.currentTarget.value)}
            />
            <button type="submit" class="shell-topic-action" disabled={!canStartTopic()}>
              Start topic
            </button>
          </form>
          <div class="shell-topic-actions">
            <Show when={topicSummaries().length > 0}>
              <button
                type="button"
                class="shell-topic-action"
                classList={{ 'is-active': forumView() }}
                aria-pressed={forumView()}
                onClick={() => setForumView((open) => !open)}
              >
                Forum
              </button>
              <button
                type="button"
                class="shell-topic-action"
                classList={{ 'is-active': forumPinned() }}
                aria-pressed={forumPinned()}
                onClick={toggleForumPinned}
              >
                {forumPinned() ? 'Forum pinned' : 'Pin forum'}
              </button>
            </Show>
            <button
              type="button"
              class="shell-topic-follow"
              classList={{ 'is-active': followActive() }}
              aria-pressed={followActive()}
              onClick={toggleActiveFollow}
            >
              {followActive()
                ? activeTopic() ? `Following ${activeTopic()}` : 'Following room'
                : activeTopic() ? `Follow ${activeTopic()}` : 'Follow room'}
            </button>
          </div>
        </div>
      </Show>
      {/* Message feed */}
      <div
        ref={feedEl!}
        class="shell-feed"
        role="log"
        aria-live={liveMode()}
        aria-label="Message history"
        onScroll={checkScroll}
      >
        <Show when={forumView() && topicSummaries().length > 0}>
          <section class="shell-topic-forum" aria-labelledby="shell-topic-forum-title">
            <h3 id="shell-topic-forum-title" class="sr-only">Topic forum</h3>
            <For each={topicSummaries()}>
              {(summary) => {
                const latest = createMemo(() => latestTopicMessage(summary.topic));
                const unread = createMemo(() => topicUnreadCounts().get(summary.topic.toLowerCase()) ?? 0);
                return (
                  <article class="shell-topic-card">
                    <button
                      type="button"
                      class="shell-topic-card-main"
                      onClick={() => openTopic(summary.topic)}
                      aria-label={`Open topic ${summary.topic}, ${summary.count} ${summary.count === 1 ? 'message' : 'messages'}${unread() > 0 ? `, ${unread()} unread on this device` : ''}`}
                    >
                      <span class="shell-topic-card-title">#{summary.topic}</span>
                      <span class="shell-topic-card-meta">
                        <span>{summary.count} {summary.count === 1 ? 'message' : 'messages'}</span>
                        <Show when={unread() > 0}>
                          <span class="shell-topic-card-unread">{unread()} unread</span>
                        </Show>
                        <time dateTime={summary.lastAt.toISOString()} title={summary.lastAt.toLocaleString()}>
                          latest {summary.lastAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </time>
                      </span>
                      <Show when={latest()}>
                        {(message) => (
                          <span class="shell-topic-card-preview">
                            <span class="shell-topic-card-author">{message().from}</span>
                            <span>{clipped(message().plaintext ?? message().text, 110)}</span>
                          </span>
                        )}
                      </Show>
                    </button>
                    <button
                      type="button"
                      class="shell-topic-card-follow"
                      classList={{ 'is-active': topicFollowed(summary.topic) }}
                      aria-pressed={topicFollowed(summary.topic)}
                      onClick={() => followTopic(summary.topic)}
                      aria-label={`${topicFollowed(summary.topic) ? 'Unfollow' : 'Follow'} topic ${summary.topic}`}
                    >
                      {topicFollowed(summary.topic) ? 'Following' : 'Follow'}
                    </button>
                  </article>
                );
              }}
            </For>
          </section>
        </Show>
        <Show when={collapsedNickList().length > 0}>
          <div
            class="shell-collapse-banner"
            role="status"
            data-testid="collapse-banner"
          >
            <span>
              Hiding messages from{' '}
              {collapsedNickList().slice(0, 4).join(', ')}
              {collapsedNickList().length > 4
                ? ` +${collapsedNickList().length - 4}`
                : ''}
              .
            </span>
            <button
              type="button"
              class="shell-collapse-banner-btn"
              data-testid="collapse-banner-show-all"
              onClick={() => {
                for (const nick of collapsedNickList()) {
                  getState().expandNickMessages(nick);
                }
              }}
            >
              Show all
            </button>
          </div>
        </Show>
        <Show
          when={messages().length > 0}
          fallback={
            <Show
              when={isLoadingHistory()}
              fallback={
                <div
                  class="shell-feed-empty"
                  role="status"
                  data-testid="feed-empty"
                >
                  <Show when={activeView().kind === 'channel'}>
                    <Show
                      when={firstHourSayHi()}
                      fallback={
                        <>
                          <p class="shell-feed-empty-title">Still waters here</p>
                          <p class="shell-feed-empty-body">
                            Say the first thing in {activeTarget()}.
                          </p>
                        </>
                      }
                    >
                      <p class="shell-feed-empty-title">Say hi</p>
                      <p class="shell-feed-empty-body">
                        Type a first message below to join the room.
                      </p>
                    </Show>
                  </Show>
                  <Show when={activeView().kind === 'dm'}>
                    <p class="shell-feed-empty-title">{DM_EMPTY_TITLE}</p>
                    <p class="shell-feed-empty-body">
                      {DM_EMPTY_BODY}
                    </p>
                  </Show>
                  <Show when={activeView().kind === 'status'}>
                    <p class="shell-feed-empty-title">Quiet for now</p>
                    <p class="shell-feed-empty-body">
                      Connection notices will land here.
                    </p>
                  </Show>
                </div>
              }
            >
              <div class="shell-feed-loading" role="status" aria-label="Loading messages">
                <span class="sr-only">Loading messages…</span>
                <For each={SKELETON_ROWS}>
                  {(bodyLines, i) => (
                    <div class="shell-skel-row" style={{ '--skel-i': i() }}>
                      <div class="shell-skel-avatar" aria-hidden="true" />
                      <div class="shell-skel-lines" aria-hidden="true">
                        <div class="shell-skel-line shell-skel-line--name" />
                        <For each={Array.from({ length: bodyLines })}>
                          {(_, j) => (
                            <div
                              class={`shell-skel-line${j() === bodyLines - 1 ? ' shell-skel-line--short' : ''}`}
                            />
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          }
        >
          <Show when={(() => {
            const view = activeView();
            if (view.kind !== 'channel') return false;
            // Only claim "the very beginning" when the window actually reaches
            // the top of the loaded transcript — otherwise older rows are merely
            // hidden behind the "earlier messages" affordance.
            if (messageWindow().hiddenBefore > 0) return false;
            return historyExhausted().get(view.channel.toLowerCase()) === true;
          })()}>
            <div class="shell-channel-intro" data-testid="channel-intro">
              <span class="shell-channel-intro-glyph" aria-hidden="true">
                {activeView().kind === 'channel'
                  ? ((activeView() as { kind: 'channel'; channel: string }).channel.charAt(0) || '#')
                  : '#'}
              </span>
              <h2 class="shell-channel-intro-title">
                {activeView().kind === 'channel' ? (activeView() as { kind: 'channel'; channel: string }).channel : ''}
              </h2>
              <p class="shell-channel-intro-note">
                This is the very beginning of the conversation.
              </p>
              <ScheduledEventLine channel={(activeView() as { kind: 'channel'; channel: string }).channel} />
            </div>
          </Show>
          <Show when={sinceDigest()}>
            {(digest) => (
              <div class="shell-since-digest-card">
                <SinceDigestCard digest={digest()} onReviewUnread={reviewUnreadBoundary} />
              </div>
            )}
          </Show>
          <Show when={readerMemoryContext()}>
            {(context) => (
              <ReaderMemoryStrip
                context={context()}
                reviewedSpan={readerReviewedSpan()}
                reviewedAnchorSource={readerAnchorSource()}
                reviewedTrail={readerReviewedTrail()}
                peerReviews={readerPeerReviews()}
                hasUnreadBoundary={unreadDividerId() !== null}
                onJumpStart={scrollToReaderStart}
                onJumpUnread={() => { void navigateToUnreadBoundary(); }}
                onJumpLatest={() => jumpToLatest(true)}
                onReturnHome={() => getState().navigate({ kind: 'home' })}
                onJumpReviewed={jumpToReviewedSpan}
                onJumpReviewedContext={jumpToReviewedContext}
                onSearchReviewed={searchReviewedSpan}
                onOpenPeerReview={openPeerReviewedAnchor}
              />
            )}
          </Show>
          <Show when={messageWindow().hiddenBefore > 0}>
            <div class="shell-feed-earlier">
              <button
                type="button"
                class="shell-feed-earlier-btn"
                onClick={showEarlierMessages}
                aria-label={`Show earlier messages (${messageWindow().hiddenBefore} not shown)`}
              >
                <span aria-hidden="true">↑</span>
                earlier messages
                <span class="shell-feed-earlier-count">{messageWindow().hiddenBefore}</span>
              </button>
            </div>
          </Show>
          <For each={windowedMessages()}>
            {(msg, index) => {
              // index() is window-relative; recover the absolute position so
              // continuation grouping stays correct across the window's top
              // edge (the row just above the first visible one may be hidden
              // but still governs grouping).
              //
              // This memo DOES still re-execute once per rendered row per
              // inbound message (messageWindow()/messages() are fresh
              // references every append, same as before the day-boundary
              // fix) — what changed is that its RESULT is `===`-stable
              // across those re-executions, so the downstream `isContinuation`
              // memo below does not re-fire and the DOM does not move. The
              // day-boundary fix removed roughly half the per-row pure-
              // computation churn (the dayBoundary half), not all of it.
              // Folding this prevMsg/isContinuation pair into the same
              // hoisted single-pass memo as dayBoundaryFlags is the next
              // available win here, not yet done.
              const prevMsg = createMemo(() => {
                const absIdx = messageWindow().start + index();
                return absIdx > 0 ? messages()[absIdx - 1] ?? null : null;
              });

              const isContinuation = createMemo(() => {
                const prev = prevMsg();
                if (!prev) return false;
                return sameAuthorGroup(prev, msg);
              });

              // Elegant date boundary — a hairline with a floating day chip.
              // O(1) positional lookup into the single-pass dayBoundaryFlags
              // array (see above) instead of a per-row memo re-deriving it
              // from prevMsg(). Indexed by window-relative `index()` — NOT
              // by `msg.id` — so a duplicate id within one window cannot
              // collapse two rows onto the same flag.
              const dayEl = (
                <Show when={dayBoundaryFlags()[index()]}>
                  <div class="shell-day-divider" role="separator" aria-label={dayLabel(msg.time)}>
                    <span class="shell-day-divider-label">{dayLabel(msg.time)}</span>
                  </div>
                </Show>
              );

              // "New messages" boundary, rendered above the captured divider message.
              const dividerEl = (
                <Show when={msg.id === unreadDividerId()}>
                  <div
                    class="shell-unread-divider"
                    role="separator"
                    aria-label="New messages"
                    tabIndex={-1}
                  >
                    <span class="shell-unread-divider-label">New messages</span>
                  </div>
                </Show>
              );

              // System message
              if (isSystemMsg(msg)) {
                return (
                  <>
                    {dayEl}
                    {dividerEl}
                    <div
                      class={[
                        'shell-msg-system',
                        activeMessageSearchResultId() === msg.id ? 'shell-msg-search-current' : '',
                      ].filter(Boolean).join(' ')}
                    data-message-search-id={msg.id}
                    data-event={msg.type}
                    role="article"
                    tabIndex={-1}
                    aria-label={msg.text}
                    >
                      {msg.text}
                    </div>
                  </>
                );
              }

              const isHighlight = createMemo(() => !!msg.highlight);
              const boostGroups = createMemo(() => boostGroupsFor(msg, selfNick()));
              const hasBoosts = createMemo(() => boostGroups().length > 0);
              const toggleBoost = (emoji: string): void => {
                getState().addReaction(activeTarget(), msg.id, emoji);
              };
              const hasThread = createMemo(() => {
                // A message has a thread if there's at least one reply to it.
                // O(1) lookup into the prebuilt parent-id set (see threadParents).
                return threadParents().has(msg.id);
              });
              // Per-row overflow-menu open state, so a right-click anywhere on
              // the row opens the same ⋯ menu the action bar exposes.
              const [menuOpen, setMenuOpen] = createSignal(false);
              const openMenuFromRow = (e: MouseEvent): void => {
                e.preventDefault();
                setMenuOpen(true);
              };
              const rowGesture = createRowGesture({
                onSwipeReply: () => {
                  getState().setReplyingTo(msg);
                },
                onLongPressMenu: () => {
                  setRevealedId(msg.id);
                  setMenuOpen(true);
                },
              });
              onCleanup(() => rowGesture.dispose());
              const gestureProps = rowGesturePointerProps(rowGesture);

              // Continuation/full-header grouping is reactive so keyed rows
              // update when prepend/delete changes their predecessor.
              return (
                <>
                {dayEl}
                {dividerEl}
                <Show
                  when={isContinuation()}
                  fallback={
                    <div
                      class={[
                        'shell-msg-group',
                        isHighlight() ? 'shell-msg-group--highlight' : '',
                        revealedId() === msg.id ? 'shell-msg-revealed' : '',
                        activeMessageSearchResultId() === msg.id ? 'shell-msg-search-current' : '',
                        msg.pending ? 'shell-msg-pending' : '',
                      ].filter(Boolean).join(' ')}
                      data-message-search-id={msg.id}
                      role="article"
                      tabIndex={0}
                      aria-label={messageAccessibleLabel(msg)}
                      onContextMenu={openMenuFromRow}
                      onClick={(e) => toggleReveal(msg.id, e)}
                      onKeyDown={(e) => toggleRevealFromKeyboard(msg.id, e)}
                      onPointerDown={gestureProps.onPointerDown}
                      onPointerMove={gestureProps.onPointerMove}
                      onPointerUp={gestureProps.onPointerUp}
                      onPointerCancel={gestureProps.onPointerCancel}
                    >
                      <span class="shell-msg-swipe-affordance" aria-hidden="true">
                        <ReplyIcon class="shell-msg-swipe-affordance-icon" />
                      </span>
                      <MessageMenu
                        msg={msg}
                        target={activeTarget()}
                        selfNick={selfNick()}
                        canEdit={canEditMessages()}
                        canRedact={canRedactMessages()}
                        menuOpen={menuOpen()}
                        onMenuOpenChange={setMenuOpen}
                      />
                      <div class="shell-msg-avatar" style={{ '--nick-tint': nickTint(msg.from) }} aria-hidden="true">
                        <Avatar
                          name={msg.from}
                          size="sm"
                          owner={msg.from === selfNick()}
                          aria-hidden="true"
                        />
                      </div>
                      <div class="shell-msg-body">
                        <div class="shell-msg-meta">
                          <span class="shell-msg-author" style={{ color: nickTint(msg.from) }}>{msg.from}</span>
                          <time
                            class="shell-msg-ts"
                            dateTime={msg.time.toISOString()}
                            aria-hidden="true"
                          >
                            {fmtTime(msg.time)}
                          </time>
                          <Show when={msg.pending}>
                            <span class="shell-msg-pending-mark" aria-hidden="true">Queued</span>
                          </Show>
                          <Show when={msg.edited}>
                            <EditedMarker messageId={msg.id} />
                          </Show>
                        </div>
                        <Show when={msg.replyTo}>
                          {(rt) => (
                            <div class="shell-msg-reply" aria-label={`Replying to ${rt().from}`}>
                              <span class="shell-msg-reply-from">{rt().from}</span>
                              <span>{clippedReplyPreview(rt().text)}</span>
                            </div>
                          )}
                        </Show>
                        <MsgBody msg={msg} selfNick={selfNick()} onChannelClick={(name) => getState().navigate({ kind: 'channel', channel: name })} origin={activeTarget()} />
                        <Show when={hasBoosts()}>
                          <div class="shell-boosts">
                            <BoostBar boosts={boostGroups()} onBoost={toggleBoost} />
                          </div>
                        </Show>
                        <Show when={hasThread()}>
                          <ThreadIndicator messageId={msg.id} onOpenThread={openThread} />
                        </Show>
                      </div>
                    </div>
                  }
                >
                  <div
                    class={[
                      'shell-msg-cont',
                      isHighlight() ? 'shell-msg-cont--highlight' : '',
                      revealedId() === msg.id ? 'shell-msg-revealed' : '',
                      activeMessageSearchResultId() === msg.id ? 'shell-msg-search-current' : '',
                      msg.pending ? 'shell-msg-pending' : '',
                    ].filter(Boolean).join(' ')}
                    data-message-search-id={msg.id}
                    role="article"
                    tabIndex={0}
                    aria-label={messageAccessibleLabel(msg)}
                    onContextMenu={openMenuFromRow}
                    onClick={(e) => toggleReveal(msg.id, e)}
                    onKeyDown={(e) => toggleRevealFromKeyboard(msg.id, e)}
                    onPointerDown={gestureProps.onPointerDown}
                    onPointerMove={gestureProps.onPointerMove}
                    onPointerUp={gestureProps.onPointerUp}
                    onPointerCancel={gestureProps.onPointerCancel}
                  >
                    <span class="shell-msg-swipe-affordance" aria-hidden="true">
                      <ReplyIcon class="shell-msg-swipe-affordance-icon" />
                    </span>
                    <span class="shell-msg-cont-ts" aria-hidden="true">
                      {fmtTime(msg.time)}
                      <Show when={msg.pending}>
                        <span class="shell-msg-pending-mark">Queued</span>
                      </Show>
                    </span>
                    <MessageMenu
                      msg={msg}
                      target={activeTarget()}
                      selfNick={selfNick()}
                      canEdit={canEditMessages()}
                      canRedact={canRedactMessages()}
                      menuOpen={menuOpen()}
                      onMenuOpenChange={setMenuOpen}
                    />
                    <div class="shell-msg-cont-body">
                      <Show when={msg.replyTo}>
                        {(rt) => (
                          <div class="shell-msg-reply" aria-label={`Replying to ${rt().from}`}>
                            <span class="shell-msg-reply-from">{rt().from}</span>
                            <span>{clippedReplyPreview(rt().text)}</span>
                          </div>
                        )}
                      </Show>
                      <MsgBody msg={msg} selfNick={selfNick()} onChannelClick={(name) => getState().navigate({ kind: 'channel', channel: name })} origin={activeTarget()} />
                      <Show when={hasBoosts()}>
                        <div class="shell-boosts">
                          <BoostBar boosts={boostGroups()} onBoost={toggleBoost} />
                        </div>
                      </Show>
                      <Show when={hasThread()}>
                        <ThreadIndicator messageId={msg.id} onOpenThread={openThread} />
                      </Show>
                    </div>
                  </div>
                </Show>
                </>
              );
            }}
          </For>
        </Show>
      </div>

      {/* Jump to latest button — shows the new-message count when scrolled up. */}
      <Show when={!atBottom() || messageWindow().hiddenAfter > 0}>
        <button
          type="button"
          class="shell-jump-latest"
          classList={{ 'shell-jump-latest--unread': unreadBelow() > 0 }}
          onClick={() => jumpToLatest(true)}
          aria-label={
            unreadBelow() > 0
              ? `${unreadBelow()} new message${unreadBelow() === 1 ? '' : 's'} below — jump to latest`
              : messageWindow().hiddenAfter > 0
                ? `Jump to latest — ${messageWindow().hiddenAfter} newer messages not shown`
                : 'Jump to latest messages'
          }
        >
          <Show when={unreadBelow() > 0} fallback={<span>Jump to latest</span>}>
            <span class="shell-jump-latest-count">{unreadBelow()}</span>
            <span>new</span>
            <span aria-hidden="true">↓</span>
          </Show>
        </button>
      </Show>

      {/* Thread side panel */}
      <Sheet
        open={threadOpen()}
        title="Thread"
        description="Replies to this message"
        onOpenChange={setThreadOpen}
        closeLabel="Close thread"
      >
        <Show when={threadParentId()}>
          {(pid) => (
            <ThreadPanel
              parentId={pid()}
              messages={messages()}
            />
          )}
        </Show>
      </Sheet>
    </main>
  );
}
