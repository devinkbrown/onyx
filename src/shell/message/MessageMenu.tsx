/**
 * MessageMenu.tsx — per-message hover action bar + overflow menu.
 *
 * Replaces the faint "reply"/"edit" text affordance with a compact floating
 * icon bar (React · Reply · ⋯) anchored top-right of the row, plus:
 *   - React  → emoji picker popover (reuses src/lib/emoji search) → addReaction
 *   - ⋯      → overflow Popover: Copy text · Reply · Edit · Delete
 *
 * The overflow menu's open state is controllable (so a right-click on the row
 * can open it) and also opens from the ⋯ button. Delete is only shown when the
 * store exposes deleteMessage (it does — IRCv3 REDACT) and the message is the
 * user's own, non-deleted text message.
 *
 * SOLID IDIOMS: components run once; never destructure props (splitProps);
 * createSignal/createMemo/onCleanup; For/Show. No innerHTML. Clipboard via
 * navigator.clipboard.writeText. Animations are transform/opacity only (CSS).
 */

import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  splitProps,
  type JSX,
} from 'solid-js';
import { getState } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import { Popover } from '@/primitives/index';
import { searchEmojis } from '@/lib/emoji/emoji';
import { CopyIcon, EditIcon, OverflowIcon, ReactIcon, ReplyIcon, TrashIcon } from './icons';

import './message-menu.css';

// ── Pure capability logic (unit-tested) ──────────────────────────────────────

export type MessageMenuCapabilities = {
  /** Reply / React are allowed only on live (non-deleted) messages. */
  canReply: boolean;
  canReact: boolean;
  /** Copy is offered whenever there is real text to copy. */
  canCopy: boolean;
  /** Edit: own, non-deleted, plain text message, and editing is enabled. */
  canEdit: boolean;
  /** Delete: own, non-deleted message (store supports redaction). */
  canDelete: boolean;
};

export type CapabilityInput = {
  msg: Pick<ChatMessage, 'from' | 'text' | 'type' | 'deleted' | 'redacted'>;
  selfNick: string;
  /** server/account permits editing (store.canEditMessages) */
  editingEnabled: boolean;
  /** store exposes a delete/redact action */
  deleteSupported: boolean;
};

/**
 * Derive which menu items apply to a message. Pure — no store, no DOM — so the
 * gating rules can be unit-tested in isolation.
 */
export function messageMenuCapabilities(input: CapabilityInput): MessageMenuCapabilities {
  const { msg, selfNick, editingEnabled, deleteSupported } = input;
  const gone = !!msg.deleted || !!msg.redacted;
  const isOwn = !!selfNick && msg.from.toLowerCase() === selfNick.toLowerCase();
  const hasText = !gone && msg.text.trim().length > 0;

  return {
    canReply: !gone,
    canReact: !gone,
    canCopy: hasText,
    canEdit: !gone && isOwn && editingEnabled && msg.type === 'msg',
    canDelete: !gone && isOwn && deleteSupported,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export type MessageMenuProps = {
  msg: ChatMessage;
  target: string;
  selfNick: string;
  /** store.canEditMessages */
  canEdit: boolean;
  /** controlled overflow-menu open state (lets the row's right-click open it) */
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
};

const EMOJI_PICKER_LIMIT = 36;

export function MessageMenu(props: MessageMenuProps): JSX.Element {
  const [local] = splitProps(props, [
    'msg',
    'target',
    'selfNick',
    'canEdit',
    'menuOpen',
    'onMenuOpenChange',
  ]);

  // ── capability gating ──
  const caps = createMemo(() =>
    messageMenuCapabilities({
      msg: local.msg,
      selfNick: local.selfNick,
      editingEnabled: local.canEdit,
      // Delete rides IRCv3 REDACT via store.deleteMessage; it always exists on
      // the store, so the affordance is governed purely by ownership/state.
      deleteSupported: true,
    }),
  );

  // ── popover open states ──
  const [reactOpen, setReactOpen] = createSignal(false);
  const [innerMenuOpen, setInnerMenuOpen] = createSignal(false);
  const menuOpen = () => local.menuOpen ?? innerMenuOpen();
  const setMenuOpen = (next: boolean): void => {
    if (local.menuOpen === undefined) setInnerMenuOpen(next);
    local.onMenuOpenChange?.(next);
  };

  // ── emoji search ──
  const [emojiQuery, setEmojiQuery] = createSignal('');
  const emojiMatches = createMemo(() => searchEmojis(emojiQuery(), EMOJI_PICKER_LIMIT));

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

  function edit(): void {
    if (!caps().canEdit) return;
    getState().setComposerEditingMessage(local.msg);
    setMenuOpen(false);
  }

  async function copyText(): Promise<void> {
    if (!caps().canCopy) return;
    try {
      await navigator.clipboard?.writeText(local.msg.text);
    } catch {
      // Clipboard can reject (denied permission / insecure context). Failing to
      // copy is non-fatal; we simply close the menu without surfacing an error.
    }
    setMenuOpen(false);
  }

  function remove(): void {
    if (!caps().canDelete) return;
    getState().deleteMessage(local.target, local.msg.id);
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
    setMenuOpen(next);
  };
  const guardedSetReactOpen = (next: boolean): void => {
    if (next) setMenuOpen(false);
    onReactOpenChange(next);
  };

  onCleanup(() => {
    setReactOpen(false);
    setInnerMenuOpen(false);
  });

  return (
    <div class="msg-menu" role="group" aria-label={`Actions for message from ${local.msg.from}`}>
      <div class="msg-menu-bar">
        {/* React → emoji picker */}
        <Show when={caps().canReact}>
          <Popover
            open={reactOpen()}
            onOpenChange={guardedSetReactOpen}
            placement="top"
            trigger={
              <span class="msg-menu-btn" aria-hidden="true">
                <ReactIcon class="msg-menu-icon" />
              </span>
            }
          >
            <div class="msg-menu-emoji" role="dialog" aria-label="Add reaction">
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
                      aria-label={`React with ${entry.shortcode}`}
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

        {/* Overflow ⋯ */}
        <Popover
          open={menuOpen()}
          onOpenChange={guardedSetMenuOpen}
          placement="top"
          trigger={
            <span class="msg-menu-btn" aria-hidden="true">
              <OverflowIcon class="msg-menu-icon" />
            </span>
          }
        >
          <div class="msg-menu-list" role="menu" aria-label="More message actions">
            <Show when={caps().canCopy}>
              <button type="button" class="msg-menu-item" role="menuitem" onClick={() => void copyText()}>
                <CopyIcon class="msg-menu-item-icon" />
                <span>Copy text</span>
              </button>
            </Show>
            <Show when={caps().canReply}>
              <button type="button" class="msg-menu-item" role="menuitem" onClick={reply}>
                <ReplyIcon class="msg-menu-item-icon" />
                <span>Reply</span>
              </button>
            </Show>
            <Show when={caps().canEdit}>
              <button type="button" class="msg-menu-item" role="menuitem" onClick={edit}>
                <EditIcon class="msg-menu-item-icon" />
                <span>Edit</span>
              </button>
            </Show>
            <Show when={caps().canDelete}>
              <button
                type="button"
                class="msg-menu-item msg-menu-item--danger"
                role="menuitem"
                onClick={remove}
              >
                <TrashIcon class="msg-menu-item-icon" />
                <span>Delete</span>
              </button>
            </Show>
          </div>
        </Popover>
      </div>
    </div>
  );
}
