// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HomeBriefingView — quiet catch-up inbox.
 *
 * Receives already-composed inbox data and callbacks. Presentation only:
 * no Zustand snapshot, IndexedDB, network fetch, clocks, or security inference.
 */
import { For, Show, type JSX } from 'solid-js';
import { outboxEntryStatusLabel } from '@/lib/vault/outboxStatus';
import { relTime } from '@/lib/stats/networkIndex';
import type { HomeInboxInvite, HomeInboxRow } from '@/lib/catchup/homeInbox';
import { HomeMarkCaughtUp } from './HomeMarkCaughtUp';
import { HomeFormationStrip } from './HomeFormationStrip';
import type { HomeBriefing } from './homeBriefingModel';
import type { HomeBriefingActions, HomeQueuedSend } from './homeController';
import type { FormationStrip } from '@/lib/formation/formationLoop';
import type { CaughtUpPlan } from '@/lib/catchup/markCaughtUp';
import type { HomeMemoryItem } from '@/lib/notifications/homeMemory';

export type HomeBriefingViewProps = {
  nowMs: () => number;
  welcomeName: () => string | null;
  connectionStatus: () => string;
  localMemoryStatus: () => string;
  briefing: () => HomeBriefing;
  outboxChrome: () => { title: string; detail: string; tone: string; showRetry: boolean } | null;
  queuedSends: () => readonly HomeQueuedSend[];
  confirmDiscardId: () => string | null;
  recaps: () => unknown;
  more: () => { hasContent: boolean };
  showFirstRoomPrompt: () => boolean;
  showInviteFriends: () => boolean;
  showFirstHourWelcome: () => boolean;
  firstHourTip: () => unknown;
  formationStrip: () => FormationStrip | null;
  isJoined: (name: string) => boolean;
  caughtUpPlan: () => CaughtUpPlan;
  actions: HomeBriefingActions;
};

function kindVisibleName(kind: HomeInboxRow['kind'], name: string): string {
  if (kind === 'dm') return name;
  return name.replace(/^[#&]/, '');
}

function initials(name: string): string {
  const visible = name.replace(/^[#&@]/, '').trim();
  return visible ? visible.slice(0, 1).toUpperCase() : '?';
}

function inboxAria(row: HomeInboxRow): string {
  const mention = row.highlights > 0
    ? `, ${row.highlights} mention${row.highlights === 1 ? '' : 's'}`
    : '';
  const resume = row.boundaryId ? ' at your first unread message' : '';
  return `Open ${row.name}${resume}, ${row.unread} unread${mention}`;
}

function InboxAvatar(props: { kind: HomeInboxRow['kind']; name: string }): JSX.Element {
  return (
    <span
      class={`home-inbox-avatar home-inbox-avatar--${props.kind === 'dm' ? 'person' : 'room'}`}
      aria-hidden="true"
    >
      {initials(props.name)}
    </span>
  );
}

function InboxRow(props: {
  row: HomeInboxRow;
  nowMs: number;
  onOpen: (row: HomeInboxRow) => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        class="home-inbox-row"
        classList={{
          'is-unread': props.row.unread > 0 || props.row.highlights > 0,
          'is-mention': props.row.highlights > 0,
        }}
        onClick={() => props.onOpen(props.row)}
        aria-label={inboxAria(props.row)}
      >
        <InboxAvatar kind={props.row.kind} name={props.row.name} />
        <span class="home-inbox-copy">
          <span class="home-inbox-name">{kindVisibleName(props.row.kind, props.row.name)}</span>
          <span class="home-inbox-meta">
            <Show when={props.row.highlights > 0}>
              <span class="home-inbox-mention">
                {props.row.highlights === 1 ? 'mentioned you' : `${props.row.highlights} mentions`}
              </span>
            </Show>
            <Show when={props.row.lastActivity > 0}>
              <span class="home-inbox-when">
                {relTime(Math.floor(props.row.lastActivity / 1000), props.nowMs)}
              </span>
            </Show>
          </span>
        </span>
        <Show when={props.row.unread > 0}>
          <span class="home-inbox-unread">{props.row.unread}</span>
        </Show>
      </button>
    </li>
  );
}

function InviteRow(props: {
  invite: HomeInboxInvite;
  onOpen: (invite: HomeInboxInvite) => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        class="home-inbox-row is-invite"
        onClick={() => props.onOpen(props.invite)}
        aria-label={`${props.invite.inviter} wants you in ${props.invite.channel}`}
      >
        <InboxAvatar kind="channel" name={props.invite.channel} />
        <span class="home-inbox-copy">
          <span class="home-inbox-name">{props.invite.channel.replace(/^[#&]/, '')}</span>
          <span class="home-inbox-meta">
            {props.invite.inviter} wants you in {props.invite.channel}
          </span>
        </span>
        <span class="home-inbox-join">Join</span>
      </button>
    </li>
  );
}

function ColdMemoryCard(props: {
  item: HomeMemoryItem;
  nowMs: number;
  onOpen: (item: HomeMemoryItem) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      class="home-memory-card"
      onClick={() => props.onOpen(props.item)}
      aria-label={`Open ${props.item.target} from this device, ${props.item.count} remembered ${props.item.count === 1 ? 'message' : 'messages'}`}
    >
      <span class="home-memory-card-head">
        <span class="home-memory-room">{props.item.target}</span>
        <span class="home-memory-when">
          {relTime(Math.floor(props.item.lastAt.getTime() / 1000), props.nowMs)}
        </span>
      </span>
      <span class="home-memory-preview">
        <b>{props.item.lastFrom}</b>: {props.item.preview}
      </span>
    </button>
  );
}

export function HomeBriefingView(props: HomeBriefingViewProps): JSX.Element {
  const inbox = () => props.briefing().inbox;
  const title = () => inbox().empty ? 'The room is quiet.' : 'What did you miss?';
  const canPointAtRooms = () =>
    typeof props.actions.openBrowseRooms === 'function'
    && typeof props.actions.openCreateRoom === 'function';

  return (
    <div class="home" role="main" aria-label="Home">
      <div class="home-inner">
        <header class="home-masthead">
          <h1 class="home-title">{title()}</h1>
          <Show when={props.connectionStatus() !== 'connected'}>
            <p class="home-offline-note" role="status">
              {props.localMemoryStatus()}
            </p>
          </Show>
        </header>

        <Show when={props.formationStrip()}>
          {(strip) => (
            <HomeFormationStrip
              strip={strip()}
              onOpen={props.actions.openFormationRoom}
              onReshare={props.actions.reshareFormation}
            />
          )}
        </Show>

        <Show when={props.outboxChrome()}>
          {(chrome) => (
            <section
              class={`home-outbox home-outbox--${chrome().tone}`}
              aria-labelledby="home-outbox-title"
              data-home-stratum="outbox"
            >
              <div class="home-outbox__head">
                <div>
                  <h2 id="home-outbox-title" class="home-section-label">{chrome().title}</h2>
                  <p class="home-outbox__detail" role="status">{chrome().detail}</p>
                  <p class="home-outbox__privacy">
                    Message bodies stay inside their conversations; Home shows only destination and age.
                  </p>
                </div>
                <Show when={chrome().showRetry}>
                  <button type="button" class="home-outbox__retry" onClick={() => props.actions.retryOutbox()}>
                    Try sending now
                  </button>
                </Show>
              </div>
              <ul class="home-outbox__list" aria-label="Queued messages waiting on this device">
                <For each={props.queuedSends()}>
                  {(entry) => {
                    const status = () => outboxEntryStatusLabel(entry.queued_at, props.nowMs());
                    return (
                      <li
                        class="home-outbox__item"
                        classList={{
                          'home-outbox__item--expiring': status().includes('expires soon'),
                          'home-outbox__item--expired': status().startsWith('expired'),
                        }}
                      >
                        <span class="home-outbox__target">{entry.target}</span>
                        <time class="home-outbox__age" dateTime={new Date(entry.queued_at).toISOString()}>
                          {status()} · {relTime(Math.floor(entry.queued_at / 1000), props.nowMs())}
                        </time>
                        <div class="home-outbox__actions">
                          <button
                            type="button"
                            onClick={() => props.actions.openQueuedSend(entry)}
                            aria-label={`Open queued message for ${entry.target}`}
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            classList={{ 'is-confirming': props.confirmDiscardId() === entry.id }}
                            onClick={() => props.actions.discardQueuedSend(entry)}
                            aria-label={props.confirmDiscardId() === entry.id
                              ? `Confirm remove queued message for ${entry.target}`
                              : `Remove queued message for ${entry.target}`}
                          >
                            {props.confirmDiscardId() === entry.id ? 'Confirm remove' : 'Remove'}
                          </button>
                        </div>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </section>
          )}
        </Show>

        <Show when={props.briefing().showColdVault}>
          <section
            class="home-catchup home-catchup--cold"
            data-home-stratum="memory"
            aria-label="Device-local catch-up"
          >
            <div class="home-catchup-head">
              <h2 class="home-section-label">On this device</h2>
              <span class="home-catchup-summary">
                {props.briefing().coldVaultRooms.reduce((total, item) => total + item.count, 0)} remembered{' '}
                {props.briefing().coldVaultRooms.reduce((total, item) => total + item.count, 0) === 1
                  ? 'message'
                  : 'messages'}
              </span>
            </div>
            <div class="home-memory-grid">
              <For each={props.briefing().coldVaultRooms}>
                {(item) => (
                  <ColdMemoryCard
                    item={item}
                    nowMs={props.nowMs()}
                    onOpen={props.actions.openColdMemory}
                  />
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={!inbox().empty}>
          <section
            class="home-inbox"
            data-catchup-source={props.briefing().catchUpFromMemory ? 'memory' : 'live'}
            data-home-band="inbox"
            aria-label="Catch up on what you missed"
          >
            <div class="home-catchup-head">
              <span class="home-catchup-summary">
                {props.briefing().catchUpTotals.unread} unread
                <Show when={props.briefing().catchUpTotals.mentions > 0}>
                  {' · '}
                  {props.briefing().catchUpTotals.mentions} mention{props.briefing().catchUpTotals.mentions === 1 ? '' : 's'}
                </Show>
                {' · '}
                <span class="home-catchup-source">{props.briefing().catchUpSourceLabel}</span>
              </span>
              <Show when={!props.briefing().catchUpFromMemory}>
                <HomeMarkCaughtUp
                  plan={props.caughtUpPlan}
                  onMarkCaughtUp={props.actions.markAllCaughtUp}
                />
              </Show>
            </div>

            <Show when={inbox().mentions.length > 0}>
              <div
                class="home-catchup-tier home-catchup-tier--attention"
                data-home-stratum="attention"
                role="group"
                aria-label="Mentions"
              >
                <h2 class="home-inbox-label">Mentions</h2>
                <ul class="home-inbox-list">
                  <For each={inbox().mentions}>
                    {(row) => (
                      <InboxRow
                        row={row}
                        nowMs={props.nowMs()}
                        onOpen={props.actions.openInboxRow}
                      />
                    )}
                  </For>
                </ul>
              </div>
            </Show>

            <Show when={inbox().missed.length > 0}>
              <div
                class="home-catchup-tier"
                data-home-stratum="missed"
                role="group"
                aria-label="Unread rooms and messages"
              >
                <h2 class="home-inbox-label">Unread</h2>
                <ul class="home-inbox-list">
                  <For each={inbox().missed}>
                    {(row) => (
                      <InboxRow
                        row={row}
                        nowMs={props.nowMs()}
                        onOpen={props.actions.openInboxRow}
                      />
                    )}
                  </For>
                </ul>
              </div>
            </Show>

            <Show when={inbox().invites.length > 0}>
              <div
                class="home-catchup-tier"
                data-home-stratum="invites"
                role="group"
                aria-label="Room invites"
              >
                <h2 class="home-inbox-label">Invites</h2>
                <ul class="home-inbox-list">
                  <For each={inbox().invites}>
                    {(invite) => (
                      <InviteRow invite={invite} onOpen={props.actions.openInboxInvite} />
                    )}
                  </For>
                </ul>
              </div>
            </Show>
          </section>
        </Show>

        <Show when={props.briefing().showQuietEmpty}>
          <section
            class="home-empty"
            data-home-band="caught-up"
            aria-label="The room is quiet"
          >
            <Show when={canPointAtRooms()}>
              <div class="home-empty-actions" role="group" aria-label="Find or start a room">
                <button
                  type="button"
                  class="home-action home-action--supporting"
                  onClick={() => props.actions.openBrowseRooms()}
                >
                  Browse rooms
                </button>
                <button
                  type="button"
                  class="home-action home-action--supporting"
                  onClick={() => props.showFirstHourWelcome()
                    ? props.actions.startRoom()
                    : props.actions.openCreateRoom()}
                >
                  Start a room
                </button>
              </div>
            </Show>
          </section>
        </Show>
      </div>
    </div>
  );
}
