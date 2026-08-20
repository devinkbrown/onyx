// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ScheduledMessagesSheet.tsx — the pending "send later" queue.
 *
 * A Sheet listing every message waiting to be dispatched (channel, a text
 * preview, and when it fires) with a per-entry cancel. Gated on the store's
 * showScheduledMessages flag; the Sheet primitive supplies focus-trap, Esc,
 * focus-restore and the dialog role, so this stays a thin, presentational list.
 *
 * SOLID IDIOMS: component runs once; never destructure props; reads via
 * useStore; lists via <For>; conditionals via <Show>.
 */
import { For, Show } from 'solid-js';
import { getState, selectOwnedScheduledMessages, useStore } from '@/lib/store';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import { Sheet } from '@/primitives/Sheet';
import { RelativeTime } from '@/components/RelativeTime';

export function ScheduledMessagesSheet() {
  const open = useStore((s) => s.showScheduledMessages);
  const scheduled = useStore(
    selectOwnedScheduledMessages,
    (left, right) => left.length === right.length
      && left.every((entry, index) => entry === right[index]),
  );

  return (
    <Sheet
      open={open()}
      title="Scheduled messages"
      description="Messages waiting to send later. They fire once their time arrives and you're connected."
      closeLabel="Close scheduled messages"
      onOpenChange={(next) =>
        next ? getState().openScheduledMessages() : getState().closeScheduledMessages()
      }
    >
      <Show
        when={scheduled().length > 0}
        fallback={<p class="shell-scheduled-empty">Nothing scheduled. Use the clock in the composer to send a message later.</p>}
      >
        <ul class="shell-scheduled-list" aria-label="Pending scheduled messages">
          <For each={scheduled()}>
            {(entry) => (
              <li class="shell-scheduled-item">
                <div class="shell-scheduled-meta">
                  <span class="shell-scheduled-channel">{entry.channel}</span>
                  <RelativeTime timestamp={entry.sendAt} />
                </div>
                <p class="shell-scheduled-text">{entry.text}</p>
                <div class="shell-scheduled-actions">
                  <Show when={/^[#&]/.test(entry.channel.trim())}>
                    <a
                      class="shell-scheduled-ledger shell-ribbon-stats"
                      href={statsRoomHref(entry.channel)}
                      aria-label={`Room ledger for ${entry.channel}`}
                      data-testid="scheduled-channel-ledger"
                    >
                      Room ledger
                    </a>
                  </Show>
                  <button
                    type="button"
                    class="shell-scheduled-cancel"
                    aria-label={`Cancel scheduled message to ${entry.channel}: ${entry.text.slice(0, 40)}`}
                    onClick={() => getState().cancelScheduledMessage(entry.id)}
                  >
                    Cancel
                  </button>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Sheet>
  );
}
