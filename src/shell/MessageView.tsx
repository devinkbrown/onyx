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
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  splitProps,
  type JSX,
} from 'solid-js';
import { useStore, getState, STATUS_TARGET } from '@/lib/store';
import { LOCKED_PLACEHOLDER } from '@/lib/e2ee/dmCipher';
import type { ChatMessage, MessageReaction } from '@/lib/irc/types';
import { Avatar } from '@/primitives/index';
import { Sheet } from '@/primitives/index';
import { MessageText } from '@/shell/message/MessageText';
import { MessageMenu } from '@/shell/message/MessageMenu';
import { activeMessageSearchResultId } from './search/useMessageSearch';

// ── Types ────────────────────────────────────────────────────────────────────

export type MessageViewProps = {
  /** optionally passed in; falls back to store's ourNick */
  selfNick?: string;
};

const SYSTEM_TYPES = new Set(['join', 'part', 'quit', 'kick', 'mode', 'topic', 'nick', 'system', 'error']);

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

/** Human day label for the elegant date dividers. */
function dayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Per-nick tint inside the water: hue walks the cyan→azure→ice band, so every
    speaker is distinct yet the palette never leaves the ocean. */
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

function sameAuthorGroup(a: ChatMessage, b: ChatMessage): boolean {
  if (a.from !== b.from) return false;
  if (isSystemMsg(a) || isSystemMsg(b)) return false;
  // Group consecutive messages within 5 minutes
  return Math.abs(b.time.getTime() - a.time.getTime()) < 5 * 60 * 1000;
}

// ── Reaction avatars ─────────────────────────────────────────────────────────

type ReactionProps = {
  reaction: MessageReaction;
  target: string;
  messageId: string;
  selfNick: string;
};

function ReactionPill(props: ReactionProps): JSX.Element {
  const [local] = splitProps(props, ['reaction', 'target', 'messageId', 'selfNick']);

  const topUsers = createMemo(() => local.reaction.users.slice(0, 3));
  const mine = createMemo(() => !!local.selfNick && local.reaction.users.includes(local.selfNick));

  function handleClick(): void {
    const emoji = local.reaction.emoji;
    const self = local.selfNick;
    if (!self) return;
    if (local.reaction.users.includes(self)) {
      getState().removeReaction(local.target, local.messageId, emoji, self);
    } else {
      getState().addReaction(local.target, local.messageId, emoji);
    }
  }

  return (
    <button
      type="button"
      class={`shell-reaction${mine() ? ' shell-reaction--mine' : ''}`}
      aria-label={`${local.reaction.emoji} — ${local.reaction.users.join(', ')} reacted`}
      aria-pressed={mine()}
      onClick={handleClick}
    >
      <span class="shell-reaction-emoji" aria-hidden="true">{local.reaction.emoji}</span>
      <span class="shell-reaction-avatars" aria-hidden="true">
        <For each={topUsers()}>
          {(nick) => <Avatar name={nick} size="sm" />}
        </For>
      </span>
      <span class="shell-reaction-count">{local.reaction.users.length}</span>
    </button>
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
      aria-label="Open thread"
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

// ── Thread panel content ─────────────────────────────────────────────────────

type ThreadPanelProps = {
  parentId: string;
  messages: ChatMessage[];
};

function ThreadPanel(props: ThreadPanelProps): JSX.Element {
  const [local] = splitProps(props, ['parentId', 'messages']);

  const threadMessages = createMemo(() =>
    local.messages.filter((m) => m.replyTo?.id === local.parentId)
  );

  const parent = createMemo(() => local.messages.find((m) => m.id === local.parentId));

  return (
    <div>
      {/* Parent message */}
      <Show when={parent()}>
        {(p) => (
          <div class="shell-thread-msg" style={{ 'margin-bottom': '12px' }}>
            <div class="shell-thread-msg-meta">
              <span class="shell-thread-msg-from">{p().from}</span>
              <span>{fmtTime(p().time)}</span>
            </div>
            <p class="shell-thread-msg-text">{p().text}</p>
          </div>
        )}
      </Show>

      {/* Thread replies */}
      <div role="log" aria-label="Thread replies">
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
              <div class="shell-thread-msg">
                <div class="shell-thread-msg-meta">
                  <span class="shell-thread-msg-from">{msg.from}</span>
                  <span>{fmtTime(msg.time)}</span>
                </div>
                <p class="shell-thread-msg-text">{msg.text}</p>
              </div>
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
  const ourNick = useStore((s) => s.ourNick);
  const canEditMessages = useStore((s) => s.canEditMessages);
  const historyLoading = useStore((s) => s.historyLoading);
  const historyExhausted = useStore((s) => s.historyExhausted);

  const selfNick = createMemo(() => local.selfNick ?? ourNick() ?? '');

  // ── active messages ──
  const messages = createMemo((): ChatMessage[] => {
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

  // ── active target for reactions/sends ──
  const activeTarget = createMemo(() => {
    const view = activeView();
    if (view.kind === 'channel') return view.channel;
    if (view.kind === 'dm') return view.nick;
    if (view.kind === 'status') return STATUS_TARGET;
    return '';
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

  // ── scroll state ──
  let feedEl!: HTMLDivElement;
  const [atBottom, setAtBottom] = createSignal(true);

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
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
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
        window.setTimeout(() => node.classList.remove('shell-msg-search-pulse'), 1400);
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

  function openThread(msgId: string): void {
    setThreadParentId(msgId);
    setThreadOpen(true);
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

  return (
    <main class="shell-messages" aria-label="Messages">
      {/* Message feed */}
      <div
        ref={feedEl!}
        class="shell-feed"
        role="log"
        aria-live="polite"
        aria-label="Message history"
        onScroll={checkScroll}
      >
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
            </div>
          </Show>
          <For each={messages()}>
            {(msg, index) => {
              const prevMsg = createMemo(() => {
                const idx = index();
                return idx > 0 ? messages()[idx - 1] ?? null : null;
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
              const hasReactions = createMemo(() => (msg.reactions?.length ?? 0) > 0);
              const hasThread = createMemo(() => {
                // A message has a thread if there's at least one reply to it
                return messages().some((m) => m.replyTo?.id === msg.id);
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
                    onContextMenu={openMenuFromRow}
                    onClick={(e) => toggleReveal(msg.id, e)}
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
                      <Show when={hasReactions()}>
                        <div class="shell-reactions" role="group" aria-label="Reactions">
                          <For each={msg.reactions ?? []}>
                            {(reaction) => (
                              <ReactionPill
                                reaction={reaction}
                                target={activeTarget()}
                                messageId={msg.id}
                                selfNick={selfNick()}
                              />
                            )}
                          </For>
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
                  aria-label={`${msg.from} at ${fmtTime(msg.time)}`}
                  onContextMenu={openMenuFromRow}
                  onClick={(e) => toggleReveal(msg.id, e)}
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
                    <Show when={hasReactions()}>
                      <div class="shell-reactions" role="group" aria-label="Reactions">
                        <For each={msg.reactions ?? []}>
                          {(reaction) => (
                            <ReactionPill
                              reaction={reaction}
                              target={activeTarget()}
                              messageId={msg.id}
                              selfNick={selfNick()}
                            />
                          )}
                        </For>
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
