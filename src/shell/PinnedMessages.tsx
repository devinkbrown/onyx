// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PinnedMessages.tsx — the pins drawer (Roadmap Phase 4.8).
 *
 * Pins are the channel's IRCX PINS prop (a server-synced, mesh-propagated,
 * op-managed msgid list), so every client sees the same set. This drawer
 * resolves each pinned msgid against the loaded channel buffer; a pin whose
 * message isn't loaded shows a placeholder with a jump that requests history.
 */
import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { Sheet } from '@/primitives';
import {
  useStore,
  getState,
  selectChannelPins,
  selectIsChannelOp,
  type OnyxState,
} from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import {
  hasEncryptedMessageBoundary,
  lockedPlaceholderForText,
} from '@/lib/e2ee/replyPrivacy';
import { PinIcon } from '@/shell/message/icons';
import { ProvenanceBadge } from '@/shell/ProvenanceBadge';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import './pinned-messages.css';

/** Stable empty fallbacks so useStore equality does not thrash when there is
 *  no active channel (module-level, matching MessageView's EMPTY_EDIT_REVISIONS /
 *  store.ts's EMPTY_BAN_LIST_META idiom). */
const EMPTY_PIN_IDS: readonly string[] = [];
const EMPTY_MESSAGES: readonly ChatMessage[] = [];

/**
 * Pinned msgids for the active channel, oldest→newest in the prop, presented
 * newest-first. selectChannelPins re-splits the raw prop string on every
 * call, so this always returns a fresh array — callers that need identity
 * stability across an unrelated store write must gate it with
 * `sameStringArray` (as the `pinIds` useStore selector below does).
 */
export function derivePinIds(s: OnyxState): readonly string[] {
  const v = s.activeView;
  if (v.kind !== 'channel') return EMPTY_PIN_IDS;
  return [...selectChannelPins(v.channel)(s)].reverse();
}

export function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Render a pinned message with the same withdrawal and encryption boundaries as
 * the transcript. Pinned rows are still a transcript surface: ciphertext,
 * withdrawn text, and action-message fallbacks must never get a second path to
 * the screen or an accessible name.
 */
export function pinnedMessageDisplayText(message: ChatMessage): string {
  if (message.deleted || message.redacted) return '[message deleted]';

  const encrypted = hasEncryptedMessageBoundary(message);
  if (encrypted && message.plaintext === undefined) {
    return lockedPlaceholderForText(message.text);
  }

  const body = encrypted
    ? (message.plaintext ?? lockedPlaceholderForText(message.text))
    : message.text;
  return message.type === 'action' ? `* ${message.from} ${body}` : body;
}

export function pinnedMessageDisplayState(message: ChatMessage): 'deleted' | 'locked' | 'visible' {
  if (message.deleted || message.redacted) return 'deleted';
  return hasEncryptedMessageBoundary(message) && message.plaintext === undefined
    ? 'locked'
    : 'visible';
}

export function pinnedMessageStateLabel(message: ChatMessage): 'Deleted' | 'Locked' | 'Loaded locally' {
  const state = pinnedMessageDisplayState(message);
  if (state === 'deleted') return 'Deleted';
  if (state === 'locked') return 'Locked';
  return 'Loaded locally';
}

export function PinnedMessages(): JSX.Element {
  const open = useStore((s) => s.showPinnedMessages);
  const activeView = useStore((s) => s.activeView);

  const channel = createMemo(() => {
    const v = activeView();
    return v.kind === 'channel' ? v.channel : null;
  });

  const channelLedger = createMemo(() => {
    const ch = channel();
    if (!ch || !/^[#&]/.test(ch.trim())) return null;
    return { channel: ch, href: statsRoomHref(ch) };
  });

  const canManage = useStore((s) => {
    const v = s.activeView;
    return v.kind === 'channel' && selectIsChannelOp(v.channel)(s);
  });

  // Content-stable (not just reference-stable) via `equals`, since
  // derivePinIds always allocates a fresh array — without this a wholly
  // unrelated store write (a keystroke, a typing indicator) would produce a
  // "new" id array every time and force `<For>` to re-diff needlessly.
  const pinIds = useStore(derivePinIds, sameStringArray);

  // The channel's message buffer. The store only ever replaces this array
  // when messages actually change, so this selector is reference-stable
  // (no `equals` needed) and recomputes only on real message activity.
  const messages = useStore((s): readonly ChatMessage[] => {
    const v = s.activeView;
    if (v.kind !== 'channel') return EMPTY_MESSAGES;
    return s.channels.get(v.channel.toLowerCase())?.messages ?? EMPTY_MESSAGES;
  });

  // Only rebuilds the lookup Map when the buffer array itself changed.
  const messageById = createMemo(() => {
    const byId = new Map<string, ChatMessage>();
    for (const m of messages()) byId.set(m.id, m);
    return byId;
  });

  const resolvePin = (id: string): ChatMessage | null => messageById().get(id) ?? null;

  const [loadFeedback, setLoadFeedback] = createSignal('');
  createEffect(() => {
    // A failed request belongs to the current open/channel context only.
    void open();
    void channel();
    setLoadFeedback('');
  });

  const clip = (text: string): string =>
    text.length > 80 ? `${text.slice(0, 77)}...` : text;

  const pinActionLabel = (id: string, msg: ChatMessage | null): string =>
    msg
      ? `Jump to pinned message from ${msg.from}: ${clip(pinnedMessageDisplayText(msg))}`
      : `Load pinned message ${id}`;

  function jumpTo(id: string, msg: ChatMessage | null): void {
    const ch = channel();
    if (!ch) return;
    if (msg) {
      setLoadFeedback('');
      // Reuse the landing highlight machinery (feed scrolls + pulses).
      getState().focusMessage(id);
    } else {
      // Not loaded — ask the server for the exact pin and focus it only after
      // the authoritative CHATHISTORY batch has merged.
      if (!getState().requestPinnedMessage(ch, id)) {
        setLoadFeedback('Pinned message could not be loaded from history. Try again.');
        return;
      }
    }
    getState().closePinnedMessages();
  }

  function unpin(id: string): void {
    const ch = channel();
    if (ch) getState().unpinMessage(ch, id);
  }

  const fmtTime = (d: Date): string =>
    d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <Sheet
      open={open()}
      title="Pinned messages"
      description={channel() ? `Shared pins for ${channel()}` : 'Pinned messages'}
      onOpenChange={(next) => (next ? getState().openPinnedMessages() : getState().closePinnedMessages())}
      closeLabel="Close pinned messages"
    >
      <div class="pins-panel" data-testid="pinned-messages">
        <Show when={channel()}>
          {(target) => (
            <div class="pins-context" data-testid="pins-context">
              <div class="pins-context-copy">
                <span class="pins-context-kicker">Shared in</span>
                {' '}
                <strong dir="auto">{target()}</strong>
              </div>
              <ProvenanceBadge scope="server" subject="Pinned messages" />
            </div>
          )}
        </Show>
        <Show when={channelLedger()}>
          {(ledger) => (
            <a
              class="pins-ledger shell-ribbon-stats"
              href={ledger().href}
              aria-label={`Room ledger for ${ledger().channel}`}
              data-testid="pins-channel-ledger"
            >
              Room ledger
            </a>
          )}
        </Show>
        <Show when={loadFeedback()}>
          {(feedback) => (
            <p
              class="pins-load-feedback"
              role="alert"
              aria-live="assertive"
              data-testid="pins-load-feedback"
            >
              {feedback()}
            </p>
          )}
        </Show>
        <Show
          when={pinIds().length > 0}
          fallback={
            <p class="pins-empty">
              No pins yet. {canManage() ? 'Pin a message from its ⋯ menu.' : 'Ops can pin important messages here.'}
            </p>
          }
        >
          <ul
            class="pins-list"
            role="list"
            aria-label={channel() ? `Pinned messages in ${channel()}` : 'Pinned messages'}
          >
            {/* Keyed by the stable pin id itself (not a freshly-allocated
                {id, msg} object) so an unrelated store write can't force
                `<For>` to tear down and rebuild every pinned row; each row
                resolves its own message via a narrow per-row memo. */}
            <For each={pinIds()}>
              {(id) => {
                const msg = createMemo(() => resolvePin(id));
                return (
                  <li class="pins-list-item">
                    <button
                      type="button"
                      class="pins-item"
                      aria-label={pinActionLabel(id, msg())}
                      onClick={() => jumpTo(id, msg())}
                    >
                      <PinIcon class="pins-item-ico" />
                      <Show
                        when={msg()}
                        fallback={
                          <span class="pins-item-body pins-item-body--missing">
                            Pinned message — load it from history to jump there.
                          </span>
                        }
                      >
                        {(m) => (
                          <span class="pins-item-main">
                            <span class="pins-item-meta">
                              <strong class="pins-item-from">{m().from}</strong>
                              <span class="pins-item-when">{fmtTime(m().time)}</span>
                              <span
                                class="pins-item-state"
                                data-state={pinnedMessageDisplayState(m())}
                              >
                                {pinnedMessageStateLabel(m())}
                              </span>
                            </span>
                            <span
                              class="pins-item-body"
                              classList={{
                                'pins-item-body--deleted': pinnedMessageDisplayState(m()) === 'deleted',
                                'pins-item-body--locked': pinnedMessageDisplayState(m()) === 'locked',
                              }}
                            >
                              {pinnedMessageDisplayText(m())}
                            </span>
                          </span>
                        )}
                      </Show>
                    </button>
                    <Show when={canManage()}>
                      <button
                        type="button"
                        class="pins-item-unpin"
                        aria-label={`Unpin message ${id}`}
                        title="Unpin"
                        onClick={() => unpin(id)}
                      >
                        ×
                      </button>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </div>
    </Sheet>
  );
}

export default PinnedMessages;
