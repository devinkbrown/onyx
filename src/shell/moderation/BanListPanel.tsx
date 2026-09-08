// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Authoritative room block list. Requests go through store.fetchBanList;
 * 367/368 parsing stays in the store. Unban is review-first.
 */
import { createEffect, createMemo, createSignal, createUniqueId, For, on, Show, splitProps, type JSX } from 'solid-js';
import {
  captureDeviceMemoryContext,
  getState,
  isDeviceMemoryContextCurrent,
  selectBanListView,
  selectIsChannelOp,
  useStore,
  type DeviceMemoryContext,
  type OnyxState,
} from '@/lib/store';
import type { BanListEntry } from '@/lib/moderation/banListView';
import type { ModerationActionDraft, NormalizedModerationAction } from '@/lib/moderation/actionModel';
import { ModerationActionReview } from './ModerationActionReview';
import './moderation-desk.css';

export type BanListPanelProps = {
  channel: string;
};

type ModerationReviewAuthority = {
  account: string | null;
  serverId: string | null;
  serverUrl: string | null;
  client: OnyxState['client'];
  deviceMemory: DeviceMemoryContext | null;
};

function captureModerationReviewAuthority(state: OnyxState): ModerationReviewAuthority {
  return {
    account: state.server?.account ?? null,
    serverId: state.server?.id ?? null,
    serverUrl: state.server?.url ?? null,
    client: state.client,
    deviceMemory: captureDeviceMemoryContext(state),
  };
}

function moderationReviewAuthorityIsCurrent(
  captured: ModerationReviewAuthority,
  state: OnyxState,
): boolean {
  const currentDeviceMemory = captureDeviceMemoryContext(state);
  return captured.account === (state.server?.account ?? null)
    && captured.serverId === (state.server?.id ?? null)
    && captured.serverUrl === (state.server?.url ?? null)
    && captured.client === state.client
    && (captured.deviceMemory === null
      ? currentDeviceMemory === null
      : currentDeviceMemory !== null && isDeviceMemoryContextCurrent(captured.deviceMemory, state));
}

function moderationReviewAuthorityEqual(
  left: ModerationReviewAuthority,
  right: ModerationReviewAuthority,
): boolean {
  const leftDeviceMemory = left.deviceMemory;
  const rightDeviceMemory = right.deviceMemory;
  return left.account === right.account
    && left.serverId === right.serverId
    && left.serverUrl === right.serverUrl
    && left.client === right.client
    && ((leftDeviceMemory === null && rightDeviceMemory === null)
      || (leftDeviceMemory !== null
        && rightDeviceMemory !== null
        && leftDeviceMemory.generation === rightDeviceMemory.generation
        && leftDeviceMemory.client === rightDeviceMemory.client
        && leftDeviceMemory.owner.serverUrl === rightDeviceMemory.owner.serverUrl
        && leftDeviceMemory.owner.identity === rightDeviceMemory.owner.identity));
}

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
  const [reviewAuthority, setReviewAuthority] = createSignal<ModerationReviewAuthority | null>(null);
  const [returnFocus, setReturnFocus] = createSignal<HTMLElement | null>(null);
  const liveReviewAuthority = useStore(captureModerationReviewAuthority, moderationReviewAuthorityEqual);

  createEffect(on(
    liveReviewAuthority,
    (authority, previous) => {
      if (previous !== undefined && !moderationReviewAuthorityEqual(authority, previous)) {
        setPending(null);
        setReviewAuthority(null);
        setReturnFocus(null);
      }
    },
  ));

  createEffect(on(
    () => local.channel,
    (channel, previous) => {
      if (previous !== undefined && channel !== previous) {
        setPending(null);
        setReviewAuthority(null);
        setReturnFocus(null);
      }
    },
  ));

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
    setReviewAuthority(captureModerationReviewAuthority(getState()));
    setPending({ kind: 'unban', channel: local.channel, mask: entry.mask });
  }

  function applyUnban(action: NormalizedModerationAction): void {
    const state = getState();
    const currentConnected = state.connectionStatus === 'connected' && !!state.server?.connected;
    const currentCanModerate = selectIsChannelOp(local.channel)(state);
    const capturedAuthority = reviewAuthority();
    if (
      action.kind !== 'unban'
      || action.channel.trim().toLowerCase() !== local.channel.trim().toLowerCase()
      || !currentConnected
      || !currentCanModerate
      || !capturedAuthority
      || !moderationReviewAuthorityIsCurrent(capturedAuthority, state)
    ) {
      setPending(null);
      setReviewAuthority(null);
      setReturnFocus(null);
      return;
    }
    state.unbanMask(action.channel, action.mask);
    setPending(null);
    setReviewAuthority(null);
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
        <div>
          <h4 id={titleId}>Active blocks</h4>
          <span class="moderation-desk__room">{local.channel}</span>
        </div>
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
        onCancel={() => {
          setPending(null);
          setReviewAuthority(null);
        }}
      />
    </section>
  );
}
