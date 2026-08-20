// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Authoritative room block list. Requests go through store.fetchBanList;
 * 367/368 parsing stays in the store. Unban is review-first.
 */
import { createEffect, createMemo, createSignal, createUniqueId, For, on, Show, splitProps, type JSX } from 'solid-js';
import {
  getState,
  selectBanListView,
  selectIsChannelOp,
  useStore,
} from '@/lib/store';
import type { BanListEntry } from '@/lib/moderation/banListView';
import type { ModerationActionDraft, NormalizedModerationAction } from '@/lib/moderation/actionModel';
import { ModerationActionReview } from './ModerationActionReview';
import './moderation-desk.css';

export type BanListPanelProps = {
  channel: string;
};

export function BanListPanel(props: BanListPanelProps): JSX.Element {
  const [local] = splitProps(props, ['channel']);
  const instanceId = createUniqueId();
  const titleId = `ban-list-title-${instanceId}`;
  const statusId = `ban-list-status-${instanceId}`;
  const view = useStore((s) => selectBanListView(local.channel)(s));
  const canModerate = useStore((s) => selectIsChannelOp(local.channel)(s));
  const connectionStatus = useStore((s) => s.connectionStatus);
  const serverConnected = useStore((s) => !!s.server?.connected);
  const ourNick = useStore((s) => s.ourNick);
  const connected = createMemo(() => connectionStatus() === 'connected' && serverConnected());
  const [pending, setPending] = createSignal<ModerationActionDraft | null>(null);
  const [returnFocus, setReturnFocus] = createSignal<HTMLElement | null>(null);

  createEffect(on(
    () => [local.channel, connected(), canModerate()] as const,
    ([channel, isConnected, moderator]) => {
      if (!isConnected || !moderator || !channel) return;
      getState().fetchBanList(channel);
    },
  ));

  function refresh(): void {
    if (!connected() || !canModerate()) return;
    getState().fetchBanList(local.channel);
  }

  function requestUnban(entry: BanListEntry, event: MouseEvent): void {
    const target = event.currentTarget;
    setReturnFocus(target instanceof HTMLElement ? target : null);
    setPending({ kind: 'unban', channel: local.channel, mask: entry.mask });
  }

  function applyUnban(action: NormalizedModerationAction): void {
    if (action.kind !== 'unban') return;
    getState().unbanMask(action.channel, action.mask);
    setPending(null);
  }

  const visibleEntries = createMemo(() => {
    const next = view();
    return 'entries' in next ? next.entries : [];
  });

  const statusText = createMemo(() => {
    const next = view();
    switch (next.kind) {
      case 'loading':
        return next.entries.length > 0 ? 'Refreshing the block list…' : 'Loading the block list…';
      case 'empty':
        return 'No active blocks in this room.';
      case 'error':
        return next.message;
      case 'unavailable':
        return next.message;
      case 'idle':
        return canModerate()
          ? 'Refresh to load the server block list.'
          : 'Only room moderators can load the block list.';
      default:
        return null;
    }
  });

  return (
    <section class="moderation-desk__bans" aria-labelledby={titleId} data-testid="ban-list-panel">
      <div class="moderation-cockpit__head">
        <h4 id={titleId}>Active blocks</h4>
        <button
          type="button"
          data-testid="ban-list-refresh"
          disabled={!connected() || !canModerate()}
          onClick={refresh}
        >
          Refresh list
        </button>
      </div>
      <Show when={statusText()}>
        {(text) => (
          <p id={statusId} class="moderation-cockpit__hint" role="status" data-testid="ban-list-status">
            {text()}
          </p>
        )}
      </Show>
      <Show when={visibleEntries().length > 0}>
        <ul class="moderation-desk__ban-list" aria-label={`Active blocks in ${local.channel}`}>
          <For each={visibleEntries()}>
            {(entry) => (
              <li class="moderation-desk__ban-row" data-testid="ban-list-row">
                <div>
                  <code class="moderation-desk__ban-mask">{entry.mask}</code>
                  <Show when={entry.setBy}>
                    {(setter) => <p class="moderation-cockpit__hint">Set by {setter()}</p>}
                  </Show>
                </div>
                <button
                  type="button"
                  disabled={!connected() || !canModerate()}
                  aria-label={`Review lifting the block on ${entry.mask}`}
                  onClick={(event) => requestUnban(entry, event)}
                >
                  Review lift
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <ModerationActionReview
        open={pending() !== null}
        draft={pending()}
        actorNick={ourNick()}
        connected={connected()}
        canModerate={canModerate()}
        returnFocus={returnFocus()}
        onConfirm={applyUnban}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
