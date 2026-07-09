/**
 * PinnedMessages.tsx — the pins drawer (Roadmap Phase 4.8).
 *
 * Pins are the channel's IRCX PINS prop (a server-synced, mesh-propagated,
 * op-managed msgid list), so every client sees the same set. This drawer
 * resolves each pinned msgid against the loaded channel buffer; a pin whose
 * message isn't loaded shows a placeholder with a jump that requests history.
 */
import { createMemo, For, Show, type JSX } from 'solid-js';
import { Sheet } from '@/primitives';
import {
  useStore,
  getState,
  selectChannelPins,
  selectIsChannelOp,
} from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import { PinIcon } from '@/shell/message/icons';
import './pinned-messages.css';

type ResolvedPin = { id: string; msg: ChatMessage | null };

export function PinnedMessages(): JSX.Element {
  const open = useStore((s) => s.showPinnedMessages);
  const activeView = useStore((s) => s.activeView);

  const channel = createMemo(() => {
    const v = activeView();
    return v.kind === 'channel' ? v.channel : null;
  });

  const canManage = useStore((s) => {
    const v = s.activeView;
    return v.kind === 'channel' && selectIsChannelOp(v.channel)(s);
  });

  // Resolve pins (oldest→newest in the prop) but present newest-first.
  const pins = useStore((s): ResolvedPin[] => {
    const v = s.activeView;
    if (v.kind !== 'channel') return [];
    const ids = selectChannelPins(v.channel)(s);
    const buffer = s.channels.get(v.channel.toLowerCase())?.messages ?? [];
    const byId = new Map(buffer.map((m) => [m.id, m]));
    return ids
      .map((id) => ({ id, msg: byId.get(id) ?? null }))
      .reverse();
  });

  // Recompute display text safely (encrypted DMs never reach a channel pin).
  const bodyOf = (m: ChatMessage): string =>
    m.type === 'action' ? `* ${m.from} ${m.text}` : m.text;

  const clip = (text: string): string =>
    text.length > 80 ? `${text.slice(0, 77)}...` : text;

  const pinActionLabel = (pin: ResolvedPin): string =>
    pin.msg
      ? `Jump to pinned message from ${pin.msg.from}: ${clip(bodyOf(pin.msg))}`
      : `Load pinned message ${pin.id}`;

  function jumpTo(pin: ResolvedPin): void {
    const ch = channel();
    if (!ch) return;
    if (pin.msg) {
      // Reuse the landing highlight machinery (feed scrolls + pulses).
      getState().focusMessage(pin.id);
    } else {
      // Not loaded — pull older history so the pin can resolve on a re-open.
      getState().requestHistory(ch, 50);
    }
    getState().closePinnedMessages();
  }

  function unpin(pin: ResolvedPin): void {
    const ch = channel();
    if (ch) getState().unpinMessage(ch, pin.id);
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
        <Show
          when={pins().length > 0}
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
            <For each={pins()}>
              {(pin) => (
                <li class="pins-list-item">
                  <button
                    type="button"
                    class="pins-item"
                    aria-label={pinActionLabel(pin)}
                    onClick={() => jumpTo(pin)}
                  >
                    <PinIcon class="pins-item-ico" />
                    <Show
                      when={pin.msg}
                      fallback={
                        <span class="pins-item-body pins-item-body--missing">
                          Pinned message — scroll up to load, then reopen.
                        </span>
                      }
                    >
                      {(m) => (
                        <span class="pins-item-main">
                          <span class="pins-item-meta">
                            <strong class="pins-item-from">{m().from}</strong>
                            <span class="pins-item-when">{fmtTime(m().time)}</span>
                          </span>
                          <span class="pins-item-body">{bodyOf(m())}</span>
                        </span>
                      )}
                    </Show>
                  </button>
                  <Show when={canManage()}>
                    <button
                      type="button"
                      class="pins-item-unpin"
                      aria-label={`Unpin message ${pin.id}`}
                      title="Unpin"
                      onClick={() => unpin(pin)}
                    >
                      ×
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Sheet>
  );
}

export default PinnedMessages;
