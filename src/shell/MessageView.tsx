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
import { suggestTopic } from '@/lib/topics/suggestTopic';
import { bucketUnreadByTopic, isValidTopicLabel, parseTopicRegistry, TOPIC_PROP } from '@/lib/topics/topics';
import { followed, isFollowed, toggleFollow } from '@/lib/notifications/followed';
import {
  latestReviewForTarget,
  recordReviewHistory,
  type ReviewHistoryEntry,
} from '@/lib/notifications/reviewHistory';
import { buildSinceDigest } from '@/lib/notifications/sinceDigest';
import { aggregateBoosts } from '@/lib/reactions/quietBoosts';
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
import { useStore, getState, STATUS_TARGET } from '@/lib/store';
import { loadRecent } from '@/lib/vault/historyVault';
import { LOCKED_PLACEHOLDER } from '@/lib/e2ee/dmCipher';
import { ScheduledEventLine } from './ScheduledEventLine';
import type { ChatMessage } from '@/lib/irc/types';
import { Avatar } from '@/primitives/index';
import { Sheet } from '@/primitives/index';
import { MessageText } from '@/shell/message/MessageText';
import { MessageMenu } from '@/shell/message/MessageMenu';
import { activeMessageSearchResultId, openMessageSearchWithQuery } from './search/useMessageSearch';
import { TopicChip, TopicFilterBar } from './TopicChip';
import { BoostBar } from './BoostBar';
import { SinceDigestCard } from './SinceDigestCard';
import { computeMessageWindow } from './messageWindow';
import { threadParentIds } from './threadIndex';

// ── Types ────────────────────────────────────────────────────────────────────

export type MessageViewProps = {
  /** optionally passed in; falls back to store's ourNick */
  selfNick?: string;
};

const SYSTEM_TYPES = new Set(['join', 'part', 'quit', 'kick', 'mode', 'topic', 'nick', 'system', 'error']);
const READER_MEMORY_PARTICIPANTS = 4;

// Bounded-render window. The feed only builds DOM for the trailing
// BASE_WINDOW_ROWS most-recent rows (plus any anchor an unread divider /
// time-travel landing / search hit forces into view). "Show earlier" grows the
// window by WINDOW_STEP_ROWS at a time. This caps DOM subtree count on large
// channels (VAULT_KEEP=400 + live tail) without touching the store.
const BASE_WINDOW_ROWS = 120;
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

function messageAccessibleLabel(msg: ChatMessage): string {
  const text = msg.plaintext ?? msg.text;
  return `${msg.from} at ${fmtTime(msg.time)}: ${clipped(text, 120)}`;
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

export function buildReaderMemoryContext(
  target: string,
  sourceMessages: readonly ChatMessage[],
): ReaderMemoryContext | null {
  if (!target.startsWith('#')) return null;

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
  hasUnreadBoundary: boolean;
  onJumpStart: () => void;
  onJumpUnread: () => void;
  onJumpLatest: () => void;
  onReturnHome: () => void;
  onJumpReviewed: (entry: ReviewHistoryEntry) => void;
  onJumpReviewedContext: (messageId: string) => void;
  onSearchReviewed: (entry: ReviewHistoryEntry) => void;
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
  return aggregateBoosts(
    (msg.reactions ?? []).flatMap((reaction) =>
      reaction.users.map((from) => ({ emoji: reaction.emoji, from })),
    ),
    selfNick,
  );
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
};

/**
 * MsgBody — thin wrapper that handles deleted/action states then delegates
 * to the rich MessageText renderer from @/shell/message/MessageText.
 */
function MsgBody(props: MsgBodyProps): JSX.Element {
  const [local] = splitProps(props, ['msg', 'selfNick', 'onChannelClick']);

  // An E2EE DM with no decrypted plaintext yet (no key, or sent to a different
  // device) shows a locked placeholder; `text` is always the ciphertext.
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
    if (locked()) return LOCKED_PLACEHOLDER;
    if (local.msg.type === 'action') return `* ${local.msg.from} ${bodyText()}`;
    return bodyText();
  });

  return (
    <MessageText
      text={displayText()}
      selfNick={local.selfNick}
      onChannelClick={local.onChannelClick}
      class={cls()}
    />
  );
}

type SplitTopicActionProps = {
  msg: ChatMessage;
  label: string;
  onSplit: (msg: ChatMessage, label: string) => void;
};

function SplitTopicAction(props: SplitTopicActionProps): JSX.Element {
  const [local] = splitProps(props, ['msg', 'label', 'onSplit']);

  return (
    <Show when={!local.msg.topic && local.label.length > 0}>
      <TopicChip
        label={local.label}
        onSplit={(label) => local.onSplit(local.msg, label)}
        splitAriaLabel={`Split message from ${local.msg.from} into topic ${local.label}`}
      />
    </Show>
  );
}

// ── Thread panel content ─────────────────────────────────────────────────────

type ThreadPanelProps = {
  parentId: string;
  messages: ChatMessage[];
};

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
          <article class="shell-thread-msg" aria-label={`Thread parent from ${p().from}`} style={{ 'margin-bottom': '12px' }}>
            <div class="shell-thread-msg-meta">
              <span class="shell-thread-msg-from">{p().from}</span>
              <span>{fmtTime(p().time)}</span>
            </div>
            <p class="shell-thread-msg-text">{p().text}</p>
          </article>
        )}
      </Show>

      {/* Thread replies */}
      <div role="log" aria-label={`Thread replies to message ${local.parentId}`}>
        <Show
          when={threadMessages().length > 0}
          fallback={
            <p style={{ color: 'var(--washi-mute)', 'font-family': 'var(--font-mono)', 'font-size': '0.78rem' }}>
              no replies yet
            </p>
          }
        >
          <For each={threadMessages()}>
            {(msg) => (
              <article class="shell-thread-msg" aria-label={`Thread reply from ${msg.from}`}>
                <div class="shell-thread-msg-meta">
                  <span class="shell-thread-msg-from">{msg.from}</span>
                  <span>{fmtTime(msg.time)}</span>
                </div>
                <p class="shell-thread-msg-text">{msg.text}</p>
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

  const activeView = useStore((s) => s.activeView);
  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);
  const serverLog = useStore((s) => s.serverLog);
  const channelProps = useStore((s) => s.channelProps);
  const activeChannelTopics = useStore((s) => s.activeChannelTopics);
  const ourNick = useStore((s) => s.ourNick);
  const canEditMessages = useStore((s) => s.canEditMessages);
  const historyLoading = useStore((s) => s.historyLoading);
  const historyExhausted = useStore((s) => s.historyExhausted);
  const forumChannels = useStore((s) => s.forumChannels);

  const selfNick = createMemo(() => local.selfNick ?? ourNick() ?? '');

  // ── active messages ──
  const activeTopic = createMemo((): string | null => {
    const view = activeView();
    if (view.kind !== 'channel') return null;
    return activeChannelTopics().get(view.channel.toLowerCase()) ?? null;
  });

  function setActiveTopic(topic: string | null): void {
    const view = activeView();
    if (view.kind !== 'channel') return;
    getState().setActiveChannelTopic(view.channel, topic);
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
    // Render chronologically. Live lines append in arrival order, but replayed
    // CHATHISTORY / event-playback lines (joins, parts, topics) can land after
    // the live tail — a stable sort by server time puts every event where it
    // actually happened. Array.sort is stable, so equal timestamps keep their
    // insertion order (preserving author grouping).
    return [...list].sort((a, b) => a.time.getTime() - b.time.getTime());
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
    if (topic === null) return allMessages();
    const key = topic.toLowerCase();
    return allMessages().filter((message) => (message.topic ?? '').toLowerCase() === key);
  });

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
    followed();
    const target = followTarget();
    return target ? isFollowed(target.channel, target.topic) : false;
  });

  function toggleActiveFollow(): void {
    const target = followTarget();
    if (!target) return;
    toggleFollow(target.channel, target.topic);
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
    if (view.kind !== 'channel') return;
    toggleFollow(view.channel, topic);
  }

  function topicFollowed(topic: string): boolean {
    followed();
    const view = activeView();
    return view.kind === 'channel' && isFollowed(view.channel, topic);
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

  const topicUnreadCounts = createMemo((): ReadonlyMap<string, number> => {
    const dividerId = unreadDividerId();
    if (!dividerId) return new Map<string, number>();
    const all = allMessages();
    const dividerIndex = all.findIndex((message) => message.id === dividerId);
    if (dividerIndex < 0) return new Map<string, number>();
    const rawCounts = bucketUnreadByTopic(
      all.map((message, index) => ({
        topic: message.topic ?? null,
        unread: index >= dividerIndex && !isSystemMsg(message),
      })),
    );
    const normalized = new Map<string, number>();
    for (const [topic, count] of rawCounts) {
      if (topic) normalized.set(topic.toLowerCase(), count);
    }
    return normalized;
  });

  const sinceDigest = createMemo(() => {
    const dividerId = unreadDividerId();
    if (!dividerId) return null;
    const visible = messages();
    const divider = allMessages().find((message) => message.id === dividerId);
    const channel = activeTarget();
    if (!divider || !channel || !channel.startsWith('#')) return null;
    const dividerIndex = allMessages().findIndex((message) => message.id === dividerId);
    if (dividerIndex < 0) return null;
    const visibleUnread = visible.filter((message) => {
      const index = allMessages().findIndex((candidate) => candidate.id === message.id);
      return index >= dividerIndex;
    });
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
    return buildReaderMemoryContext(activeTarget(), messages());
  });
  const readerReviewedSpan = createMemo(() => {
    const context = readerMemoryContext();
    return context ? latestReviewForTarget(context.target, 'channel') : null;
  });
  const [readerVaultContext] = createResource(
    () => {
      const entry = readerReviewedSpan();
      return entry ? { target: entry.target, firstMessageId: entry.firstMessageId } : null;
    },
    async (key): Promise<ReviewedVaultContext> => {
      const localMessages = await loadRecent(key.target, 80);
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
        messages: localMessages,
        trail: buildReviewedContextTrail(entry, localMessages),
        hasAnchor: hasReviewedAnchor(entry, localMessages),
      };
    },
  );
  const readerHydratedTrail = createMemo(() => {
    const entry = readerReviewedSpan();
    return entry ? buildReviewedContextTrail(entry, messages()) : null;
  });
  const readerAnchorSource = createMemo(() => {
    const entry = readerReviewedSpan();
    const visibleMessages = messages();
    if (entry && readerVaultContext()?.hasAnchor && !hasReviewedAnchor(entry, visibleMessages)) return 'vault';
    return reviewedAnchorSource(entry, visibleMessages, null);
  });
  const readerReviewedTrail = createMemo(() =>
    mergeReviewedContextTrails(readerHydratedTrail(), readerVaultContext()?.trail ?? null),
  );

  // ── scroll state ──
  let feedEl!: HTMLDivElement;
  const [atBottom, setAtBottom] = createSignal(true);

  // ── bounded render window ──
  // windowSize is the *minimum* trailing rows to render; an anchor can extend it
  // downward. Set to Infinity to render everything ("show all"). Reset to base
  // on every conversation switch (in the switch effect below).
  const [windowSize, setWindowSize] = createSignal<number>(BASE_WINDOW_ROWS);
  // aria-live mode for the feed. Flipped to "off" while older rows enter the DOM
  // (window growth / conversation switch / history replay) so those mutations are
  // never re-announced, then restored to "polite" for genuine new tail arrivals.
  const [liveMode, setLiveMode] = createSignal<'polite' | 'off'>('polite');

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
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < threshold);
  }

  function scrollToBottom(smooth = false): void {
    const el = feedEl;
    if (!el) return;
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }

  function scrollToReaderStart(): void {
    // "Start" means the true top of the loaded transcript, so expand the window
    // fully first. Solid's <For> reconciles synchronously on the signal write, so
    // the top row is already in the DOM — scroll to it in the same tick (keeps the
    // jump synchronous for callers/tests, no wasted frame).
    setWindowSize(Number.POSITIVE_INFINITY);
    const node = feedEl?.querySelector<HTMLElement>('[data-message-search-id]');
    node?.scrollIntoView?.({ block: 'center' });
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
    preserveScrollAround(() =>
      setWindowSize((n) => (Number.isFinite(n) ? n + WINDOW_STEP_ROWS : n)),
    );
  }

  function scrollToUnreadBoundary(): void {
    const node = feedEl?.querySelector<HTMLElement>('.shell-unread-divider');
    node?.scrollIntoView?.({ block: 'center' });
    setAtBottom(false);
  }

  function reviewUnreadBoundary(): void {
    const target = activeTarget();
    if (!target) return;
    const dividerId = unreadDividerId();
    const digest = sinceDigest();
    const divider = dividerId ? allMessages().find((message) => message.id === dividerId) : null;
    if (target.startsWith('#') && dividerId && digest && divider) {
      const dividerIndex = allMessages().findIndex((message) => message.id === dividerId);
      const unreadMessages = messages().filter((message) => {
        const index = allMessages().findIndex((candidate) => candidate.id === message.id);
        return index >= dividerIndex && !isSystemMsg(message);
      });
      const latest = unreadMessages[unreadMessages.length - 1];
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
      });
    }
    scrollToUnreadBoundary();
    getState().clearViewUnreadDivider(target);
  }

  async function jumpToReviewedSpan(entry: ReviewHistoryEntry): Promise<void> {
    const state = getState();
    const visibleMessages = messages();
    const cachedVault = readerVaultContext();
    if (!hasReviewedAnchor(entry, visibleMessages)) {
      const localMessages = cachedVault?.messages ?? await loadRecent(entry.target, 80);
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
    setWindowSize(BASE_WINDOW_ROWS);
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
    setActiveTopic(topic);
    setForumView(false);
  }

  const canStartTopic = createMemo(() => isValidTopicLabel(topicDraft().trim()));

  function startTopic(event: Event): void {
    event.preventDefault();
    const topic = topicDraft().trim();
    if (!isValidTopicLabel(topic)) return;
    setActiveTopic(topic);
    setForumView(false);
    setTopicDraft('');
  }

  function splitMessageIntoThread(message: ChatMessage, label: string): void {
    const view = activeView();
    if (view.kind !== 'channel') return;
    getState().splitTopicIntoThread(view.channel, message.id, label);
    setForumView(false);
    setRevealedId(null);
  }

  // ── tap-to-reveal action bar (touch) ──
  // On touch devices there is no hover, so the per-message action bar (react /
  // reply / ⋯) stays hidden until the row is tapped — it would otherwise crowd
  // every line. revealedId (declared above) holds the one revealed row. Taps that
  // land on a link, button, or an active text selection are ignored so they keep
  // their normal behaviour rather than toggling the bar.
  function toggleReveal(msgId: string, event: MouseEvent): void {
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
  // Any id that MUST be reachable in the DOM (so its querySelector-driven scroll
  // works and the divider is visible) becomes an anchor; the oldest present one
  // extends the window down far enough to render all of them.
  const anchorIndex = createMemo((): number | null => {
    const list = messages();
    if (list.length === 0) return null;
    const ids = [unreadDividerId(), timeTravelLandingId(), activeMessageSearchResultId()];
    let min = -1;
    for (const id of ids) {
      if (!id) continue;
      const idx = list.findIndex((m) => m.id === id);
      if (idx >= 0 && (min < 0 || idx < min)) min = idx;
    }
    return min < 0 ? null : min;
  });

  const messageWindow = createMemo(() =>
    computeMessageWindow({
      total: messages().length,
      windowSize: windowSize(),
      anchorIndex: anchorIndex(),
    }),
  );

  const windowedMessages = createMemo(() => messages().slice(messageWindow().start));

  // Suppress aria-live announcements whenever OLDER rows enter the DOM — window
  // growth ("show earlier"), an anchor-driven extension (time-travel landing /
  // search hit), history replay, or a conversation switch. Those all lower (or
  // reset) the window start; a genuine new tail arrival keeps start flat or
  // raises it and stays announced. Restored to "polite" shortly after.
  let prevWindowStart = Number.POSITIVE_INFINITY;
  let prevLiveTarget: string | null = null;
  let liveRestoreTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const start = messageWindow().start;
    const target = activeTarget();
    const switched = target !== prevLiveTarget;
    if (switched || start < prevWindowStart) {
      setLiveMode('off');
      if (liveRestoreTimer) clearTimeout(liveRestoreTimer);
      liveRestoreTimer = setTimeout(() => setLiveMode('polite'), LIVE_RESTORE_MS);
    }
    prevWindowStart = start;
    prevLiveTarget = target;
  });
  onCleanup(() => {
    if (liveRestoreTimer) clearTimeout(liveRestoreTimer);
  });

  return (
    <main class="shell-messages" aria-label="Messages">
      <Show when={activeView().kind === 'channel' && preferences().topicTools}>
        <div class="shell-topic-filter">
          <Show when={availableTopics().length > 0}>
            <TopicFilterBar
              topics={availableTopics()}
              active={activeTopic()}
              unreadCounts={topicUnreadCounts()}
              onSelect={setActiveTopic}
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
          <section class="shell-topic-forum" aria-label="Topic forum">
            <For each={topicSummaries()}>
              {(summary) => {
                const latest = createMemo(() => latestTopicMessage(summary.topic));
                return (
                  <article class="shell-topic-card">
                    <button type="button" class="shell-topic-card-main" onClick={() => openTopic(summary.topic)}>
                      <span class="shell-topic-card-title">#{summary.topic}</span>
                      <span class="shell-topic-card-meta">
                        {summary.count} {summary.count === 1 ? 'message' : 'messages'}
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
        <Show
          when={messages().length > 0}
          fallback={
            <Show
              when={isLoadingHistory()}
              fallback={
                <div class="shell-feed-empty">
                  <Show when={activeView().kind !== 'home'}>
                    <span>Still waters here — say the first thing.</span>
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
              <span class="shell-channel-intro-glyph" aria-hidden="true">#</span>
              <h2 class="shell-channel-intro-title">
                {activeView().kind === 'channel' ? (activeView() as { kind: 'channel'; channel: string }).channel : ''}
              </h2>
              <p class="shell-channel-intro-note">
                This is the very beginning of the conversation. Say something worth scrolling back to.
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
                hasUnreadBoundary={unreadDividerId() !== null}
                onJumpStart={scrollToReaderStart}
                onJumpUnread={scrollToUnreadBoundary}
                onJumpLatest={() => scrollToBottom(true)}
                onReturnHome={() => getState().navigate({ kind: 'home' })}
                onJumpReviewed={jumpToReviewedSpan}
                onJumpReviewedContext={jumpToReviewedContext}
                onSearchReviewed={searchReviewedSpan}
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
              // continuation/day-boundary grouping stays correct across the
              // window's top edge (the row just above the first visible one may
              // be hidden but still governs grouping).
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
              const dayBoundary = createMemo(() => {
                const prev = prevMsg();
                return !prev || prev.time.toDateString() !== msg.time.toDateString();
              });
              const dayEl = (
                <Show when={dayBoundary()}>
                  <div class="shell-day-divider" role="separator" aria-label={dayLabel(msg.time)}>
                    <span class="shell-day-divider-label">{dayLabel(msg.time)}</span>
                  </div>
                </Show>
              );

              // "New messages" boundary, rendered above the captured divider message.
              const dividerEl = (
                <Show when={msg.id === unreadDividerId()}>
                  <div class="shell-unread-divider" role="separator" aria-label="New messages">
                    <span class="shell-unread-divider-label">new messages</span>
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
                      role="status"
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
              const splitTopicLabel = createMemo(() => {
                const view = activeView();
                if (view.kind !== 'channel' || !preferences().topicTools || msg.topic) return '';
                return suggestTopic(msg);
              });

              // Per-row overflow-menu open state, so a right-click anywhere on
              // the row opens the same ⋯ menu the action bar exposes.
              const [menuOpen, setMenuOpen] = createSignal(false);
              const openMenuFromRow = (e: MouseEvent): void => {
                e.preventDefault();
                setMenuOpen(true);
              };

              // Continuation line (same author within 5 min). Branching on
              // isContinuation() outside JSX is intentional: rows are keyed by
              // message id and a message's continuation status is fixed at
              // insert time — the row re-creates whenever the list changes.
              // eslint-disable-next-line solid/reactivity
              if (isContinuation()) {
                return (
                  <>
                  {dayEl}
                  {dividerEl}
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
                  >
                    <span class="shell-msg-cont-ts" aria-hidden="true">
                      {fmtTime(msg.time)}
                    </span>
                    <MessageMenu
                      msg={msg}
                      target={activeTarget()}
                      selfNick={selfNick()}
                      canEdit={canEditMessages()}
                      menuOpen={menuOpen()}
                      onMenuOpenChange={setMenuOpen}
                    />
                    <div class="shell-msg-cont-body">
                      <Show when={msg.replyTo}>
                        {(rt) => (
                          <div class="shell-msg-reply" aria-label={`Replying to ${rt().from}`}>
                            <span class="shell-msg-reply-from">{rt().from}</span>
                            <span>{rt().text.slice(0, 80)}{rt().text.length > 80 ? '…' : ''}</span>
                          </div>
                        )}
                      </Show>
                      <MsgBody msg={msg} selfNick={selfNick()} onChannelClick={(name) => getState().navigate({ kind: 'channel', channel: name })} />
                      <SplitTopicAction
                        msg={msg}
                        label={splitTopicLabel()}
                        onSplit={splitMessageIntoThread}
                      />
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
                  </>
                );
              }

              // Full group (avatar + meta)
              return (
                <>
                {dayEl}
                {dividerEl}
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
                >
                  <MessageMenu
                    msg={msg}
                    target={activeTarget()}
                    selfNick={selfNick()}
                    canEdit={canEditMessages()}
                    menuOpen={menuOpen()}
                    onMenuOpenChange={setMenuOpen}
                  />
                  <div class="shell-msg-avatar" style={{ '--nick-tint': nickTint(msg.from) }}>
                    <Avatar
                      name={msg.from}
                      size="sm"
                      owner={msg.from === selfNick()}
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
                      <Show when={msg.edited}>
                        <span style={{ color: 'var(--washi-mute)', 'font-family': 'var(--font-mono)', 'font-size': '0.62rem' }}>
                          (edited)
                        </span>
                      </Show>
                    </div>
                    <Show when={msg.replyTo}>
                      {(rt) => (
                        <div class="shell-msg-reply" aria-label={`Replying to ${rt().from}`}>
                          <span class="shell-msg-reply-from">{rt().from}</span>
                          <span>{rt().text.slice(0, 80)}{rt().text.length > 80 ? '…' : ''}</span>
                        </div>
                      )}
                    </Show>
                    <MsgBody msg={msg} selfNick={selfNick()} onChannelClick={(name) => getState().navigate({ kind: 'channel', channel: name })} />
                    <SplitTopicAction
                      msg={msg}
                      label={splitTopicLabel()}
                      onSplit={splitMessageIntoThread}
                    />
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
                </>
              );
            }}
          </For>
        </Show>
      </div>

      {/* Jump to latest button — shows the new-message count when scrolled up. */}
      <Show when={!atBottom()}>
        <button
          type="button"
          class="shell-jump-latest"
          classList={{ 'shell-jump-latest--unread': unreadBelow() > 0 }}
          onClick={() => scrollToBottom(true)}
          aria-label={
            unreadBelow() > 0
              ? `${unreadBelow()} new message${unreadBelow() === 1 ? '' : 's'} below — jump to latest`
              : 'Jump to latest messages'
          }
        >
          <Show when={unreadBelow() > 0} fallback={<span>↓ latest</span>}>
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
