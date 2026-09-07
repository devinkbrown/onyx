// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MessageMenu.tsx — per-message hover action bar + overflow menu.
 *
 * Replaces the faint "reply"/"edit" text affordance with a compact floating
 * icon bar (React · Reply · ⋯) anchored top-right of the row, plus:
 *   - React  → emoji picker popover (reuses src/lib/emoji search) → addReaction
 *   - ⋯      → overflow Popover: Copy text · Reply · Edit · Delete
 *
 * The overflow menu's open state is controllable (so a right-click on the row
 * can open it) and also opens from the ⋯ button. Delete is only shown when
 * draft/message-redaction is negotiated (canRedact), the message is our own
 * live non-pending text, and the user confirms "Delete for everyone".
 *
 * SOLID IDIOMS: components run once; never destructure props (splitProps);
 * createSignal/createMemo/onCleanup; For/Show. No innerHTML. Clipboard writes
 * use the shared observable-result helper. Animations are transform/opacity only.
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
import { getState, useStore, selectChannelPins, selectIsChannelOp } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import { Popover } from '@/primitives/index';
import { buildMomentLink } from '@/lib/deeplink';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import { searchEmojis } from '@/lib/emoji/emoji';
import { localTranslationReadiness, preferredTranslationTarget } from '@/lib/intelligence/localLanguage';
import {
  createBrowserTranslator,
  languageLabel,
  resolveTranslationTarget,
  translateMessage,
  translationTarget,
} from '@/lib/intelligence/translateMessage';
import { isValidTopicLabel } from '@/lib/topics/topics';
import { openMessageSearchWithQuery } from '@/shell/search/useMessageSearch';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import { hasEncryptedMessageBoundary } from '@/lib/e2ee/replyPrivacy';
import { formatQuoteInsert } from '@/lib/composer/composerInject';
import { ProvenanceBadge } from '@/shell/ProvenanceBadge';
import { keyboardEventIsClaimed } from '@/primitives/focusTrap';
import { CopyIcon, EditIcon, OverflowIcon, PinIcon, ReactIcon, ReplyIcon, SearchIcon, TopicIcon, TranslateIcon, TrashIcon } from './icons';

import './message-menu.css';

// ── Pure capability logic (unit-tested) ──────────────────────────────────────

export type MessageMenuCapabilities = {
  /** Reply / React are allowed only on live (non-deleted) messages. */
  canReply: boolean;
  canReact: boolean;
  /** Copy is offered whenever there is real text to copy. */
  canCopy: boolean;
  /** Open message search prefilled from this line. */
  canSearchText: boolean;
  /** Copy a shareable `/app/?join=...&at=...` link for channel messages. */
  canCopyMoment: boolean;
  /** Start a named conversation from this message; channel messages only. */
  canStartTopic: boolean;
  /** Edit: own, non-deleted, plain text message, and editing is enabled. */
  canEdit: boolean;
  /** Delete: own, non-deleted message (store supports redaction). */
  canDelete: boolean;
  /** Ignore this nick on this device (not self, not empty). */
  canIgnore: boolean;
  /** Quote body into the composer (readable text present). */
  canQuote: boolean;
  /** Collapse/hide this nick's messages in the feed (not self). */
  canCollapse: boolean;
};

export type CapabilityInput = {
  msg: Pick<ChatMessage, 'from' | 'text' | 'plaintext' | 'encrypted' | 'type' | 'deleted' | 'redacted' | 'pending'>;
  selfNick: string;
  /** server/account permits editing (store.canEditMessages) */
  editingEnabled: boolean;
  /** store exposes a delete/redact action */
  deleteSupported: boolean;
  /** true when the target accepts named-conversation topic tags */
  channelTarget: boolean;
};

/**
 * Return only text already readable in this loaded row. Encrypted rows use
 * transient plaintext exclusively; a locked row's ciphertext is never treated
 * as user-visible action text.
 */
export function loadedMessageActionText(
  msg: Pick<ChatMessage, 'text' | 'plaintext' | 'encrypted' | 'deleted' | 'redacted'>,
): string | null {
  if (msg.deleted || msg.redacted) return null;
  const text = hasEncryptedMessageBoundary(msg) ? msg.plaintext : msg.text;
  return typeof text === 'string' && text.trim().length > 0 ? text : null;
}

/**
 * Derive which menu items apply to a message. Pure — no store, no DOM — so the
 * gating rules can be unit-tested in isolation.
 */
export function messageMenuCapabilities(input: CapabilityInput): MessageMenuCapabilities {
  const { msg, selfNick, editingEnabled, deleteSupported } = input;
  const gone = !!msg.deleted || !!msg.redacted;
  const isOwn = !!selfNick && msg.from.toLowerCase() === selfNick.toLowerCase();
  const hasText = loadedMessageActionText(msg) !== null;

  return {
    canReply: !gone,
    canReact: !gone,
    canCopy: hasText,
    canSearchText: hasText,
    canCopyMoment: !gone && input.channelTarget,
    canStartTopic: !gone && input.channelTarget && hasText,
    canEdit: !gone
      && isOwn
      && editingEnabled
      && msg.type === 'msg'
      && !hasEncryptedMessageBoundary(msg),
    canDelete: !gone && !msg.pending && isOwn && deleteSupported,
    canIgnore: !gone && !isOwn && typeof msg.from === 'string' && msg.from.trim().length > 0,
    canQuote: hasText,
    canCollapse: !gone && !isOwn && typeof msg.from === 'string' && msg.from.trim().length > 0,
  };
}

export function suggestTopicLabelFromMessage(text: string): string | null {
  const normalized = text
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/[`*_~>#[\]()+={}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) return null;

  const words = normalized.split(' ').filter(Boolean).slice(0, 6);
  while (words.length > 0) {
    const candidate = words.join(' ').replace(/[,:;.!?]+$/u, '').trim();
    if (isValidTopicLabel(candidate)) return candidate;
    words.pop();
  }
  return null;
}

export function suggestSearchQueryFromMessage(text: string): string | null {
  const normalized = text
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/[`*_~>#[\]()+={}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) return null;

  const words = normalized.split(' ').filter(Boolean).slice(0, 8);
  const candidate = words.join(' ').replace(/[,:;.!?]+$/u, '').trim();
  return candidate.length > 0 ? candidate : null;
}

// ── Component ────────────────────────────────────────────────────────────────

export type MessageMenuProps = {
  msg: ChatMessage;
  target: string;
  selfNick: string;
  /** store.canEditMessages */
  canEdit: boolean;
  /** store.canRedactMessages; omitted callers fail closed */
  canRedact?: boolean;
  /** controlled overflow-menu open state (lets the row's right-click open it) */
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
};

const EMOJI_PICKER_LIMIT = 36;
const MAX_CONCURRENT_MESSAGE_TRANSLATIONS = 4;

let activeMessageTranslations = 0;

type MessageTranslationState =
  | { status: 'idle' }
  | { status: 'pending'; lang: string }
  | { status: 'done'; lang: string; text: string }
  | { status: 'error'; lang: string; reason: 'busy' | 'failed' };

type VisibleMessageTranslation = Exclude<MessageTranslationState, { status: 'idle' }>;

type TranslationCopyState = 'idle' | 'pending' | 'copied' | 'failed';

export function MessageMenu(props: MessageMenuProps): JSX.Element {
  const [local] = splitProps(props, [
    'msg',
    'target',
    'selfNick',
    'canEdit',
    'canRedact',
    'menuOpen',
    'onMenuOpenChange',
  ]);

  const isChannelTarget = createMemo(() => {
    const t = local.target;
    return t.length > 0 && (t[0] === '#' || t[0] === '&');
  });

  // ── capability gating ──
  const caps = createMemo(() =>
    messageMenuCapabilities({
      msg: local.msg,
      selfNick: local.selfNick,
      editingEnabled: local.canEdit,
      // Fail closed: omit canRedact (or pass false) when REDACT was not negotiated.
      deleteSupported: local.canRedact === true,
      channelTarget: isChannelTarget(),
    }),
  );

  // ── popover open states ──
  const [reactOpen, setReactOpen] = createSignal(false);
  const [innerMenuOpen, setInnerMenuOpen] = createSignal(false);
  const [deleteConfirming, setDeleteConfirming] = createSignal(false);
  const [clipboardStatus, setClipboardStatus] = createSignal('');
  const [messageTranslation, setMessageTranslation] = createSignal<MessageTranslationState>({ status: 'idle' });
  const [translationCopyState, setTranslationCopyState] = createSignal<TranslationCopyState>('idle');
  const visibleMessageTranslation = createMemo<VisibleMessageTranslation | null>(() => {
    const state = messageTranslation();
    return state.status === 'idle' ? null : state;
  });
  const menuOpen = () => local.menuOpen ?? innerMenuOpen();
  const setMenuOpen = (next: boolean): void => {
    if (local.menuOpen === undefined) setInnerMenuOpen(next);
    local.onMenuOpenChange?.(next);
  };

  // ── emoji search ──
  const [emojiQuery, setEmojiQuery] = createSignal('');
  const emojiMatches = createMemo(() => searchEmojis(emojiQuery(), EMOJI_PICKER_LIMIT));
  const messageActionTarget = createMemo(() => `message from ${local.msg.from}`);
  const actionText = createMemo(() => loadedMessageActionText(local.msg));
  const translationLang = createMemo(() => (
    resolveTranslationTarget(translationTarget(), preferredTranslationTarget())
  ));
  const localTranslatorAvailable = createMemo(() => (
    localTranslationReadiness(translationLang()).state === 'available'
  ));
  const translator = createBrowserTranslator();

  let disposed = false;
  let deleteActionRef: HTMLButtonElement | undefined;
  let deleteCancelRef: HTMLButtonElement | undefined;
  let clipboardEpoch = 0;
  let activeTranslation: symbol | undefined;
  let activeTranslationCopy: symbol | undefined;
  let observedTranslationInput = false;
  let observedMessageId = '';
  let observedSource: string | null = null;
  let observedTarget = '';
  let observedMessageTarget = '';
  let observedCopyState = false;
  let observedCopyMessageId = '';
  let observedCopyTarget = '';
  let observedCopyText: string | null = null;
  let observedDeleteMessageId = '';

  // A keyed row is normally stable, but controlled tests and list replacement
  // can update props in place. Invalidate any old completion before it can land.
  createEffect(() => {
    const messageId = local.msg.id;
    const source = actionText();
    const lang = translationLang();
    const messageTarget = local.target;
    if (!observedTranslationInput) {
      observedTranslationInput = true;
      observedMessageId = messageId;
      observedSource = source;
      observedTarget = lang;
      observedMessageTarget = messageTarget;
      return;
    }
    if (
      messageId === observedMessageId
      && source === observedSource
      && lang === observedTarget
      && messageTarget === observedMessageTarget
    ) return;
    observedMessageId = messageId;
    observedSource = source;
    observedTarget = lang;
    observedMessageTarget = messageTarget;
    clipboardEpoch += 1;
    setClipboardStatus('');
    activeTranslation = undefined;
    setMessageTranslation({ status: 'idle' });
  });

  // Clipboard feedback belongs to one successful transient result. Invalidate
  // it whenever the row, target, or translated text changes so stale writes can
  // never announce success for a replacement message.
  createEffect(() => {
    const state = messageTranslation();
    const messageId = local.msg.id;
    const target = translationLang();
    const translated = state.status === 'done' ? state.text : null;
    if (!observedCopyState) {
      observedCopyState = true;
      observedCopyMessageId = messageId;
      observedCopyTarget = target;
      observedCopyText = translated;
      return;
    }
    if (
      messageId === observedCopyMessageId
      && target === observedCopyTarget
      && translated === observedCopyText
    ) return;
    observedCopyMessageId = messageId;
    observedCopyTarget = target;
    observedCopyText = translated;
    activeTranslationCopy = undefined;
    setTranslationCopyState('idle');
  });

  // A confirmation is authority- and row-bound. If either the rendered row
  // changes or REDACT disappears during reconnect/cap renegotiation, disarm it
  // before a stale confirm can act on a different message.
  createEffect(() => {
    const messageId = local.msg.id;
    const allowed = caps().canDelete;
    if (messageId !== observedDeleteMessageId || !allowed) {
      observedDeleteMessageId = messageId;
      setDeleteConfirming(false);
    }
  });

  // ── actions ──
  function react(emoji: string): void {
    if (!caps().canReact) return;
    getState().addReaction(local.target, local.msg.id, emoji);
    setReactOpen(false);
    setEmojiQuery('');
  }

  function reply(): void {
    if (!caps().canReply) return;
    getState().setReplyingTo(local.msg);
    setMenuOpen(false);
  }

  function startTopic(): void {
    if (!caps().canStartTopic) return;
    const source = actionText();
    if (source === null) return;
    const topic = suggestTopicLabelFromMessage(source);
    if (!topic) {
      getState().addToast({
        variant: 'warning',
        title: 'Topic not started',
        description: 'This message does not contain a usable topic label.',
      });
      setMenuOpen(false);
      return;
    }
    getState().setActiveChannelTopic(local.target, topic);
    getState().setReplyingTo(local.msg);
    setMenuOpen(false);
  }

  function edit(): void {
    if (!caps().canEdit) return;
    getState().setComposerEditingMessage(local.msg);
    setMenuOpen(false);
  }

  async function translateOnDevice(): Promise<void> {
    const source = actionText();
    const lang = translationLang();
    const messageId = local.msg.id;
    if (source === null || !localTranslatorAvailable() || activeTranslation !== undefined) return;
    if (activeMessageTranslations >= MAX_CONCURRENT_MESSAGE_TRANSLATIONS) {
      setMessageTranslation({ status: 'error', lang, reason: 'busy' });
      return;
    }

    const request = Symbol(messageId);
    activeTranslation = request;
    activeMessageTranslations += 1;
    setMessageTranslation({ status: 'pending', lang });
    try {
      const result = await translateMessage(translator, { text: source }, lang);
      if (
        disposed
        || activeTranslation !== request
        || local.msg.id !== messageId
        || actionText() !== source
        || translationLang() !== lang
      ) return;
      const translated = result.translation?.translated;
      if (translated === undefined) throw new Error('The on-device translator returned no result.');
      activeTranslation = undefined;
      setMessageTranslation({ status: 'done', lang, text: translated });
    } catch {
      if (
        disposed
        || activeTranslation !== request
        || local.msg.id !== messageId
        || actionText() !== source
        || translationLang() !== lang
      ) return;
      activeTranslation = undefined;
      setMessageTranslation({ status: 'error', lang, reason: 'failed' });
    } finally {
      activeMessageTranslations = Math.max(0, activeMessageTranslations - 1);
    }
  }

  function dismissTranslation(): void {
    activeTranslation = undefined;
    setMessageTranslation({ status: 'idle' });
  }

  async function copyTranslatedText(): Promise<void> {
    const state = messageTranslation();
    if (state.status !== 'done' || activeTranslationCopy !== undefined) return;
    const messageId = local.msg.id;
    const lang = state.lang;
    const text = state.text;
    const request = Symbol(messageId);
    activeTranslationCopy = request;
    setTranslationCopyState('pending');

    const copied = await writeClipboardText(text);
    const current = messageTranslation();
    if (
      disposed
      || activeTranslationCopy !== request
      || local.msg.id !== messageId
      || translationLang() !== lang
      || current.status !== 'done'
      || current.text !== text
    ) return;
    activeTranslationCopy = undefined;
    setTranslationCopyState(copied ? 'copied' : 'failed');
  }

  function reportClipboardResult(copied: boolean, kind: 'message' | 'moment'): void {
    if (copied) {
      const status = kind === 'message' ? 'Message text copied.' : 'Moment link copied.';
      setClipboardStatus(status);
      getState().addToast({
        variant: 'success',
        title: kind === 'message' ? 'Message copied' : 'Moment copied',
        description: status,
      });
      return;
    }

    const status = kind === 'message'
      ? 'Could not copy message text. Clipboard access is unavailable.'
      : 'Could not copy moment link. Clipboard access is unavailable.';
    setClipboardStatus(status);
    getState().addToast({
      variant: 'error',
      title: 'Copy failed',
      description: 'Allow clipboard access in this browser and try again.',
    });
  }

  async function copyText(): Promise<void> {
    if (!caps().canCopy) return;
    const source = actionText();
    if (source === null) return;
    const messageId = local.msg.id;
    const target = local.target;
    const epoch = ++clipboardEpoch;
    const copied = await writeClipboardText(source);
    if (
      disposed
      || epoch !== clipboardEpoch
      || local.msg.id !== messageId
      || local.target !== target
      || actionText() !== source
    ) return;
    reportClipboardResult(copied, 'message');
    setMenuOpen(false);
  }

  async function copyMomentLink(): Promise<void> {
    if (!caps().canCopyMoment) return;
    const messageId = local.msg.id;
    const messageTime = local.msg.time.getTime();
    const target = local.target;
    const href = typeof window !== 'undefined' ? window.location.href : undefined;
    const link = buildMomentLink(target, local.msg.time, href);
    const epoch = ++clipboardEpoch;

    const copied = await writeClipboardText(link);
    if (
      disposed
      || epoch !== clipboardEpoch
      || local.msg.id !== messageId
      || local.msg.time.getTime() !== messageTime
      || local.target !== target
    ) return;
    reportClipboardResult(copied, 'moment');
    setMenuOpen(false);
  }

  function searchText(): void {
    if (!caps().canSearchText) return;
    const source = actionText();
    if (source === null) return;
    const query = suggestSearchQueryFromMessage(source);
    if (!query) return;
    openMessageSearchWithQuery(query);
    setMenuOpen(false);
  }

  function remove(): void {
    if (!caps().canDelete) return;
    getState().deleteMessage(local.target, local.msg.id);
    setDeleteConfirming(false);
    setMenuOpen(false);
  }

  function stageRemove(): void {
    if (!caps().canDelete) return;
    const panel = overflowMenuRef?.closest<HTMLElement>('.onyx-popover__panel');
    setDeleteConfirming(true);
    // The destructive item is commonly the last row and focusing it can leave
    // the scroll-owned short-height popover scrolled down. Reset after swapping
    // in the shorter confirmation so its warning is never clipped above view.
    queueMicrotask(() => {
      if (panel?.isConnected) panel.scrollTop = 0;
    });
  }

  function cancelRemove(): void {
    setDeleteConfirming(false);
    queueMicrotask(() => {
      const deleteIndex = overflowItems().findIndex((item) => item === deleteActionRef);
      if (deleteIndex >= 0) focusMenuItem(deleteIndex);
    });
  }

  // Pin/unpin (ops only, channels only). Reactive to the live PINS prop.
  const canPin = useStore((s) => isChannelTarget() && selectIsChannelOp(local.target)(s));
  const isPinned = useStore((s) => selectChannelPins(local.target)(s).includes(local.msg.id));
  const senderIgnored = useStore((s) => {
    const nick = typeof local.msg.from === 'string' ? local.msg.from.trim() : '';
    return nick.length > 0 && s.isIgnored(nick);
  });
  const senderCollapsed = useStore((s) => {
    const nick = typeof local.msg.from === 'string' ? local.msg.from.trim() : '';
    return nick.length > 0 && s.collapsedNicks.has(nick.toLowerCase());
  });
  function togglePin(): void {
    if (!canPin()) return;
    if (isPinned()) getState().unpinMessage(local.target, local.msg.id);
    else getState().pinMessage(local.target, local.msg.id);
    setMenuOpen(false);
  }

  // Reset transient picker state whenever either popover closes so reopening is
  // always clean.
  function onReactOpenChange(next: boolean): void {
    setReactOpen(next);
    if (!next) setEmojiQuery('');
  }

  // Close the React picker if the overflow menu opens (and vice-versa) so two
  // floating layers never stack on a single row.
  const guardedSetMenuOpen = (next: boolean): void => {
    if (next) setReactOpen(false);
    if (!next) setDeleteConfirming(false);
    setMenuOpen(next);
  };
  const guardedSetReactOpen = (next: boolean): void => {
    if (next) setMenuOpen(false);
    onReactOpenChange(next);
  };

  // ── Overflow-menu keyboard pattern (WAI-ARIA menu) ──
  // The overflow list is role="menu" + role="menuitem"; that role sets an AT
  // expectation of arrow-key traversal and focus moving into the menu on open.
  // Implement it here (the shared Popover only owns Escape + dialog framing).
  let overflowMenuRef: HTMLDivElement | undefined;

  const overflowItems = (): HTMLElement[] => {
    if (!overflowMenuRef) return [];
    return Array.from(
      overflowMenuRef.querySelectorAll<HTMLElement>('button[role="menuitem"], a[role="menuitem"]'),
    ).sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  };

  // Roving tabindex: only the active item stays in the Tab sequence, so Tab
  // exits the menu (per the menu pattern) while arrows move within it.
  const focusMenuItem = (index: number): void => {
    const items = overflowItems();
    if (items.length === 0) return;
    const clamped = ((index % items.length) + items.length) % items.length;
    items.forEach((item, i) => {
      item.tabIndex = i === clamped ? 0 : -1;
    });
    items[clamped]?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent): void => {
    const items = overflowItems();
    if (items.length === 0) return;
    const current = items.findIndex((item) => item === document.activeElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusMenuItem(current < 0 ? 0 : current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusMenuItem(current < 0 ? items.length - 1 : current - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusMenuItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusMenuItem(items.length - 1);
        break;
    }
  };

  onCleanup(() => {
    disposed = true;
    clipboardEpoch += 1;
    activeTranslation = undefined;
    activeTranslationCopy = undefined;
    setReactOpen(false);
    setDeleteConfirming(false);
    setInnerMenuOpen(false);
  });

  return (
    <div class="msg-menu" role="group" aria-label={`Actions for message from ${local.msg.from}`}>
      <div class="msg-menu-bar">
        {/* Calm default actions: Reply · React · Copy. Everything else stays in More. */}
        {/* React → emoji picker */}
        <Show when={caps().canReact}>
          <Popover
            open={reactOpen()}
            onOpenChange={guardedSetReactOpen}
            placement="top"
            panelLabel={`Choose reaction for ${messageActionTarget()}`}
            trigger={
              <span class="msg-menu-btn">
                <ReactIcon class="msg-menu-icon" />
                <span class="sr-only">Choose reaction for {messageActionTarget()}</span>
              </span>
            }
          >
            <div class="msg-menu-emoji" aria-label={`Reaction picker for ${messageActionTarget()}`}>
              <label class="sr-only" for={`msg-emoji-search-${local.msg.id}`}>
                Search emoji
              </label>
              <input
                id={`msg-emoji-search-${local.msg.id}`}
                class="msg-menu-emoji-search"
                value={emojiQuery()}
                placeholder="Search emoji"
                autocomplete="off"
                onInput={(e) => setEmojiQuery((e.currentTarget as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (keyboardEventIsClaimed(e)) return;
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    guardedSetReactOpen(false);
                  }
                }}
              />
              <div class="msg-menu-emoji-grid" role="listbox" aria-label="Emoji results">
                <For each={emojiMatches()}>
                  {(entry) => (
                    <button
                      type="button"
                      class="msg-menu-emoji-choice"
                      role="option"
                      aria-label={`React to ${messageActionTarget()} with ${entry.shortcode}`}
                      onClick={() => react(entry.emoji)}
                    >
                      {entry.emoji}
                    </button>
                  )}
                </For>
                <Show when={emojiMatches().length === 0}>
                  <p class="msg-menu-emoji-empty">no matches</p>
                </Show>
              </div>
            </div>
          </Popover>
        </Show>

        {/* Reply (quick button on the bar) */}
        <Show when={caps().canReply}>
          <button
            type="button"
            class="msg-menu-btn"
            aria-label={`Reply to ${local.msg.from}`}
            onClick={reply}
          >
            <ReplyIcon class="msg-menu-icon" />
          </button>
        </Show>

        <Show when={caps().canCopy}>
          <button
            type="button"
            class="msg-menu-btn"
            aria-label={`Copy text from ${messageActionTarget()}`}
            onClick={() => void copyText()}
          >
            <CopyIcon class="msg-menu-icon" />
          </button>
        </Show>

        {/* Overflow ⋯ */}
        <Popover
          open={menuOpen()}
          onOpenChange={guardedSetMenuOpen}
          placement="top"
          panelLabel={`More actions for ${messageActionTarget()}`}
          trigger={
            <span class="msg-menu-btn">
              <OverflowIcon class="msg-menu-icon" />
              <span class="sr-only">More actions for {messageActionTarget()}</span>
            </span>
          }
        >
          <div class="msg-menu-overflow">
            <Show
              when={!deleteConfirming()}
              fallback={(
                <div
                  class="msg-menu-delete-confirm"
                  role="group"
                  aria-label={`Confirm deleting ${messageActionTarget()} for everyone`}
                >
                  <p class="msg-menu-delete-confirm__title">Delete for everyone?</p>
                  <p class="msg-menu-delete-confirm__copy">
                    This removes the message from the conversation and cannot be undone.
                  </p>
                  <div class="msg-menu-delete-confirm__actions">
                    <button
                      ref={(element) => {
                        deleteCancelRef = element;
                        queueMicrotask(() => {
                          if (deleteCancelRef?.isConnected) deleteCancelRef.focus({ preventScroll: true });
                        });
                      }}
                      type="button"
                      class="msg-menu-delete-confirm__cancel"
                      aria-label={`Keep ${messageActionTarget()}`}
                      onClick={cancelRemove}
                    >
                      Keep message
                    </button>
                    <button
                      type="button"
                      class="msg-menu-delete-confirm__delete"
                      aria-label={`Confirm deleting ${messageActionTarget()} for everyone`}
                      onClick={remove}
                    >
                      Delete for everyone
                    </button>
                  </div>
                </div>
              )}
            >
              <div
                ref={(element) => {
                  overflowMenuRef = element;
                  // This element only mounts while the Popover is open, so moving
                  // focus into the menu on mount == focus-into-menu on open (menu
                  // pattern). Deferred so the conditional <Show> menuitems exist
                  // before we focus the first one.
                  queueMicrotask(() => focusMenuItem(0));
                }}
                class="msg-menu-list"
                role="menu"
                aria-label={`More actions for ${messageActionTarget()}`}
                onKeyDown={onMenuKeyDown}
              >
            <Show when={caps().canQuote}>
              <button
                type="button"
                class="msg-menu-item"
                role="menuitem"
                data-testid="msg-menu-quote"
                aria-label={`Quote ${messageActionTarget()} in composer`}
                onClick={() => {
                  const source = actionText();
                  if (!source) return;
                  const insert = formatQuoteInsert(local.msg.from, source);
                  getState().injectComposerText(local.target, insert, 'prefix');
                  getState().addToast({
                    variant: 'info',
                    title: 'Quoted into composer',
                    description: `Prefixed a quote from ${local.msg.from}.`,
                  });
                  local.onMenuOpenChange?.(false);
                  queueMicrotask(() => {
                    document.querySelector<HTMLElement>('[data-composer-input]')?.focus();
                  });
                }}
              >
                <span class="msg-menu-item-icon" aria-hidden="true">❝</span>
                <span>Quote in composer</span>
              </button>
            </Show>
            <Show when={caps().canCopyMoment}>
              <button
                type="button"
                class="msg-menu-item"
                role="menuitem"
                aria-label={`Copy moment link for ${messageActionTarget()}`}
                onClick={() => void copyMomentLink()}
              >
                <CopyIcon class="msg-menu-item-icon" />
                <span>Copy moment link</span>
              </button>
            </Show>
            <Show when={isChannelTarget()}>
              <a
                class="msg-menu-item"
                role="menuitem"
                href={statsRoomHref(local.target)}
                aria-label={`Room ledger for ${local.target}`}
                onClick={() => local.onMenuOpenChange?.(false)}
              >
                <span class="msg-menu-item-icon" aria-hidden="true">⌁</span>
                <span>Room ledger</span>
              </a>
            </Show>
            <Show when={caps().canSearchText}>
              <button
                type="button"
                class="msg-menu-item"
                role="menuitem"
                aria-label={`Search text from ${messageActionTarget()}`}
                onClick={searchText}
              >
                <SearchIcon class="msg-menu-item-icon" />
                <span>Search this text</span>
              </button>
            </Show>
            <Show when={actionText() !== null && localTranslatorAvailable()}>
              <button
                type="button"
                class="msg-menu-item"
                role="menuitem"
                aria-label={`Translate ${messageActionTarget()} on this device`}
                disabled={messageTranslation().status === 'pending'}
                onClick={() => void translateOnDevice()}
              >
                <TranslateIcon class="msg-menu-item-icon" />
                <span>Translate on this device</span>
              </button>
            </Show>
            <Show when={caps().canStartTopic}>
              <button
                type="button"
                class="msg-menu-item"
                role="menuitem"
                aria-label={`Start topic from ${messageActionTarget()}`}
                onClick={startTopic}
              >
                <TopicIcon class="msg-menu-item-icon" />
                <span>Start topic from here</span>
              </button>
            </Show>
            <Show when={caps().canEdit}>
              <button
                type="button"
                class="msg-menu-item"
                role="menuitem"
                aria-label={`Edit ${messageActionTarget()}`}
                onClick={edit}
              >
                <EditIcon class="msg-menu-item-icon" />
                <span>Edit</span>
              </button>
            </Show>
            <Show when={canPin()}>
              <button
                type="button"
                class="msg-menu-item"
                role="menuitem"
                aria-label={`${isPinned() ? 'Unpin' : 'Pin'} ${messageActionTarget()}`}
                onClick={togglePin}
              >
                <PinIcon class="msg-menu-item-icon" />
                <span>{isPinned() ? 'Unpin message' : 'Pin message'}</span>
              </button>
            </Show>
            <Show when={caps().canIgnore}>
              <button
                type="button"
                class="msg-menu-item"
                role="menuitem"
                data-testid="msg-menu-ignore"
                aria-label={
                  senderIgnored()
                    ? `Stop ignoring ${local.msg.from} on this device`
                    : `Ignore ${local.msg.from} on this device`
                }
                onClick={() => {
                  const nick = local.msg.from.trim();
                  if (!nick) return;
                  if (senderIgnored()) {
                    getState().unignoreUser(nick);
                    getState().addToast({
                      variant: 'info',
                      title: `Unignored ${nick}`,
                      description: 'Messages and notifications from this name resume on this device.',
                    });
                  } else {
                    getState().ignoreUser(nick);
                    getState().addToast({
                      variant: 'info',
                      title: `Ignoring ${nick}`,
                      description: 'Their messages are hidden on this device. Preferences → Conversation manages the list.',
                    });
                  }
                  local.onMenuOpenChange?.(false);
                }}
              >
                <span class="msg-menu-item-icon" aria-hidden="true">⊘</span>
                <span>
                  {senderIgnored()
                    ? `Unignore ${local.msg.from}`
                    : `Ignore ${local.msg.from}`}
                </span>
              </button>
            </Show>
            <Show when={caps().canCollapse}>
              <button
                type="button"
                class="msg-menu-item"
                role="menuitem"
                data-testid="msg-menu-collapse"
                aria-label={
                  senderCollapsed()
                    ? `Show messages from ${local.msg.from}`
                    : `Hide messages from ${local.msg.from} in this feed`
                }
                onClick={() => {
                  const nick = local.msg.from.trim();
                  if (!nick) return;
                  getState().toggleNickCollapse(nick);
                  const nowCollapsed = getState().collapsedNicks.has(nick.toLowerCase());
                  getState().addToast({
                    variant: 'info',
                    title: nowCollapsed ? `Hiding ${nick}` : `Showing ${nick}`,
                    description: nowCollapsed
                      ? 'Their lines are hidden in this feed until you expand them. Device-only; not an ignore.'
                      : 'Their messages are visible in the feed again.',
                  });
                  local.onMenuOpenChange?.(false);
                }}
              >
                <span class="msg-menu-item-icon" aria-hidden="true">▾</span>
                <span>
                  {senderCollapsed()
                    ? `Show ${local.msg.from}`
                    : `Hide ${local.msg.from}`}
                </span>
              </button>
            </Show>
            <Show when={caps().canDelete}>
              <button
                ref={(element) => { deleteActionRef = element; }}
                type="button"
                class="msg-menu-item msg-menu-item--danger"
                role="menuitem"
                aria-label={`Delete ${messageActionTarget()} for everyone`}
                onClick={stageRemove}
              >
                <TrashIcon class="msg-menu-item-icon" />
                <span>Delete for everyone</span>
              </button>
            </Show>
              </div>
            </Show>
            <Show when={!deleteConfirming() && actionText() !== null && !localTranslatorAvailable()}>
              <p class="msg-menu-translation-note" role="note">
                On-device translation is unavailable in this browser.
              </p>
            </Show>
            <Show when={!deleteConfirming() && visibleMessageTranslation()} keyed>
              {(state) => (
                <section
                  class="msg-menu-translation"
                  aria-label={`On-device translation for ${messageActionTarget()}`}
                >
                  <div class="msg-menu-translation-head">
                    <ProvenanceBadge scope="device" subject={`Translation for ${messageActionTarget()}`} />
                    <span>{languageLabel(state.lang)}</span>
                  </div>
                  <p class="msg-menu-translation-text" role="status" aria-live="polite" aria-atomic="true">
                    {state.status === 'pending'
                      ? 'Translating on this device…'
                      : state.status === 'done'
                        ? state.text
                        : state.reason === 'busy'
                          ? 'On-device translation is busy. Retry in a moment.'
                          : 'On-device translation failed. Retry when the local model is ready.'}
                  </p>
                  <div class="msg-menu-translation-actions">
                    <Show when={state.status === 'error'}>
                      <button
                        type="button"
                        class="msg-menu-translation-action"
                        aria-label={`Retry translating ${messageActionTarget()} on this device`}
                        onClick={() => void translateOnDevice()}
                      >
                        Retry
                      </button>
                    </Show>
                    <Show when={state.status === 'done'}>
                      <button
                        type="button"
                        class="msg-menu-translation-action"
                        aria-label={`Copy translated text for ${messageActionTarget()}`}
                        disabled={translationCopyState() === 'pending'}
                        onClick={() => void copyTranslatedText()}
                      >
                        Copy translation
                      </button>
                    </Show>
                    <Show when={state.status !== 'pending'}>
                      <button
                        type="button"
                        class="msg-menu-translation-action"
                        aria-label={`Dismiss translation for ${messageActionTarget()}`}
                        onClick={dismissTranslation}
                      >
                        Dismiss
                      </button>
                    </Show>
                  </div>
                  <Show when={translationCopyState() !== 'idle'}>
                    <p
                      class="msg-menu-translation-copy-status"
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {translationCopyState() === 'pending'
                        ? 'Copying translation…'
                        : translationCopyState() === 'copied'
                          ? 'Translation copied.'
                          : 'Could not copy translation. Clipboard access is unavailable.'}
                    </p>
                  </Show>
                </section>
              )}
            </Show>
          </div>
        </Popover>
      </div>
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {clipboardStatus()}
      </span>
    </div>
  );
}
