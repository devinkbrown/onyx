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

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  splitProps,
  type JSX,
} from 'solid-js';
import { useStore, getState } from '@/lib/store';
import type { ChatMessage, MessageReaction } from '@/lib/irc/types';
import { Avatar } from '@/primitives/index';
import { Sheet } from '@/primitives/index';
import { MessageText } from '@/shell/message/MessageText';

// ── Types ────────────────────────────────────────────────────────────────────

export type MessageViewProps = {
  /** optionally passed in; falls back to store's ourNick */
  selfNick?: string;
};

const SYSTEM_TYPES = new Set(['join', 'part', 'quit', 'kick', 'mode', 'topic', 'nick', 'system', 'error']);

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(date: Date): string {
  return date.toTimeString().slice(0, 5); // HH:MM
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

  const topUsers = createMemo(() => local.reaction.users.slice(0, 4));
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

  const cls = createMemo(() => {
    if (local.msg.deleted || local.msg.redacted) return 'shell-msg-text shell-msg-text--deleted';
    if (local.msg.type === 'action') return 'shell-msg-text shell-msg-text--action';
    return 'shell-msg-text';
  });

  const displayText = createMemo(() => {
    if (local.msg.deleted || local.msg.redacted) return '[message deleted]';
    if (local.msg.type === 'action') return `* ${local.msg.from} ${local.msg.text}`;
    return local.msg.text;
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

// ── Message actions ─────────────────────────────────────────────────────────

type MessageActionsProps = {
  msg: ChatMessage;
  target: string;
  selfNick: string;
  canEdit: boolean;
};

function MessageActions(props: MessageActionsProps): JSX.Element {
  const [local] = splitProps(props, ['msg', 'target', 'selfNick', 'canEdit']);

  const isOwnMessage = createMemo(() =>
    !!local.selfNick && local.msg.from.toLowerCase() === local.selfNick.toLowerCase()
  );
  const canReply = createMemo(() => !local.msg.deleted && !local.msg.redacted);
  const canEditMessage = createMemo(() =>
    canReply() && local.canEdit && isOwnMessage() && local.msg.type === 'msg'
  );

  function startReply(): void {
    if (!canReply()) return;
    getState().setReplyingTo(local.msg);
  }

  function startEdit(): void {
    if (!canEditMessage()) return;
    getState().setComposerEditingMessage(local.msg);
  }

  return (
    <div class="shell-msg-actions" role="group" aria-label="Message actions">
      <button
        type="button"
        class="shell-msg-action"
        aria-label={`Reply to ${local.msg.from}`}
        onClick={startReply}
      >
        reply
      </button>
      <Show when={canEditMessage()}>
        <button
          type="button"
          class="shell-msg-action"
          aria-label="Edit message"
          onClick={startEdit}
        >
          edit
        </button>
      </Show>
    </div>
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
  const ourNick = useStore((s) => s.ourNick);
  const canEditMessages = useStore((s) => s.canEditMessages);

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
    return '';
  });

  // ── scroll state ──
  let feedEl!: HTMLDivElement;
  const [atBottom, setAtBottom] = createSignal(true);

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

  // ── thread panel ──
  const [threadOpen, setThreadOpen] = createSignal(false);
  const [threadParentId, setThreadParentId] = createSignal<string | null>(null);

  function openThread(msgId: string): void {
    setThreadParentId(msgId);
    setThreadOpen(true);
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
            <div class="shell-feed-empty">
              <Show when={activeView().kind !== 'home'}>
                <span>Still waters here — say the first thing.</span>
              </Show>
            </div>
          }
        >
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

              // System message
              if (isSystemMsg(msg)) {
                return (
                  <div
                    class="shell-msg-system"
                    role="status"
                    aria-label={msg.text}
                  >
                    {msg.text}
                  </div>
                );
              }

              const isHighlight = createMemo(() => !!msg.highlight);
              const hasReactions = createMemo(() => (msg.reactions?.length ?? 0) > 0);
              const hasThread = createMemo(() => {
                // A message has a thread if there's at least one reply to it
                return messages().some((m) => m.replyTo?.id === msg.id);
              });

              // Continuation line (same author within 5 min)
              if (isContinuation()) {
                return (
                  <div
                    class={[
                      'shell-msg-cont',
                      isHighlight() ? 'shell-msg-cont--highlight' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <span class="shell-msg-cont-ts" aria-hidden="true">
                      {fmtTime(msg.time)}
                    </span>
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
                      <MessageActions
                        msg={msg}
                        target={activeTarget()}
                        selfNick={selfNick()}
                        canEdit={canEditMessages()}
                      />
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
                );
              }

              // Full group (avatar + meta)
              return (
                <div
                  class={[
                    'shell-msg-group',
                    isHighlight() ? 'shell-msg-group--highlight' : '',
                  ].filter(Boolean).join(' ')}
                  aria-label={`${msg.from} at ${fmtTime(msg.time)}`}
                >
                  <div class="shell-msg-avatar">
                    <Avatar
                      name={msg.from}
                      size="sm"
                      owner={msg.from === selfNick()}
                    />
                  </div>
                  <div class="shell-msg-body">
                    <div class="shell-msg-meta">
                      <span class="shell-msg-author">{msg.from}</span>
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
                    <MessageActions
                      msg={msg}
                      target={activeTarget()}
                      selfNick={selfNick()}
                      canEdit={canEditMessages()}
                    />
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
              );
            }}
          </For>
        </Show>
      </div>

      {/* Jump to latest button */}
      <Show when={!atBottom()}>
        <button
          type="button"
          class="shell-jump-latest"
          onClick={() => scrollToBottom(true)}
          aria-label="Jump to latest messages"
        >
          ↓ latest
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
