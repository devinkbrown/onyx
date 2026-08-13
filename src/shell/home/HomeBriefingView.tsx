// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HomeBriefingView — Current Ledger presentation.
 *
 * Receives already-composed section data and callbacks. Presentation only:
 * no Zustand snapshot, IndexedDB, network fetch, clocks, or security inference.
 */
import { createMemo, For, Show, type JSX } from 'solid-js';
import { eventCountdown, type ScheduledEventItem } from '@/lib/notifications/scheduledEvents';
import { outboxEntryStatusLabel } from '@/lib/vault/outboxStatus';
import { relTime } from '@/lib/stats/networkIndex';
import type { CatchUpItem } from '@/lib/notifications/catchUp';
import type { ResumePoint } from '@/lib/catchup/resumePoints';
import type { HomeMemoryItem } from '@/lib/notifications/homeMemory';
import type { StatsChannel } from '@/lib/stats/networkIndex';
import type { CaughtUpPlan } from '@/lib/catchup/markCaughtUp';
import { HomeMarkCaughtUp } from './HomeMarkCaughtUp';
import type { HomeBriefing, HomeLiveSlot, HomeOverflow } from './homeBriefingModel';
import type {
  HomeBriefingActions,
  HomeCatchUpRecap,
  HomeMoreActivityView,
  HomeQueuedSend,
  HomeRhythmItem,
} from './homeController';

export type HomeBriefingViewProps = {
  nowMs: () => number;
  welcomeName: () => string | null;
  connectionStatus: () => string;
  localMemoryStatus: () => string;
  briefing: () => HomeBriefing;
  outboxChrome: () => { title: string; detail: string; tone: string; showRetry: boolean } | null;
  queuedSends: () => readonly HomeQueuedSend[];
  confirmDiscardId: () => string | null;
  recaps: () => readonly HomeCatchUpRecap[];
  more: () => HomeMoreActivityView;
  showFirstRoomPrompt: () => boolean;
  isJoined: (name: string) => boolean;
  caughtUpPlan: () => CaughtUpPlan;
  actions: HomeBriefingActions;
};

function Sparkline(props: { values: number[] }): JSX.Element {
  const points = createMemo(() => {
    const vals = props.values;
    if (vals.length < 2) return null;
    const w = 240;
    const h = 32;
    const pad = 3;
    const max = Math.max(...vals, 1);
    const step = (w - pad * 2) / (vals.length - 1);
    const xy = vals.map(
      (v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)] as const,
    );
    return {
      line: xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '),
      area:
        `${pad},${h - pad} ` +
        xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
        ` ${(pad + (vals.length - 1) * step).toFixed(1)},${h - pad}`,
    };
  });
  return (
    <Show when={points()}>
      {(p) => (
        <svg class="home-spark" viewBox="0 0 240 32" preserveAspectRatio="none" aria-hidden="true">
          <polygon class="home-spark-fill" points={p().area} />
          <polyline class="home-spark-line" points={p().line} />
        </svg>
      )}
    </Show>
  );
}

function kindGlyph(kind: CatchUpItem['kind'] | ResumePoint['kind'], name: string): string {
  if (kind === 'dm') return '@';
  return name.startsWith('&') ? '&' : '#';
}

function kindVisibleName(kind: CatchUpItem['kind'] | ResumePoint['kind'], name: string): string {
  if (kind === 'dm') return name;
  return name.replace(/^[#&]/, '');
}

function clipped(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function voiceSummary(recap: HomeCatchUpRecap): string {
  if (recap.voices.length === 0) return 'room activity';
  const names = recap.voices.join(', ');
  return recap.overflowVoices > 0 ? `${names} +${recap.overflowVoices}` : names;
}

function reviewCountSummary(messageCount: number, mentionCount: number): string {
  const lineLabel = messageCount === 1 ? 'line' : 'lines';
  const mentionLabel = mentionCount === 1 ? 'mention' : 'mentions';
  const mentionPart = mentionCount > 0 ? `, ${mentionCount} ${mentionLabel}` : '';
  return `${messageCount} ${lineLabel}${mentionPart}`;
}

function recapSummary(recap: HomeCatchUpRecap): string {
  return reviewCountSummary(recap.messageCount, recap.mentionCount);
}

function trendLabel(item: HomeRhythmItem): string {
  if (item.activeUsers > 0) {
    return `${item.activeUsers} ${item.activeUsers === 1 ? 'person' : 'people'} here now`;
  }
  return `${item.total.toLocaleString()} tracked`;
}

function eventWhenLabel(event: ScheduledEventItem): string {
  return new Date(event.at * 1000).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CatchUpRow(props: {
  item: CatchUpItem;
  nowMs: number;
  onOpen: (item: CatchUpItem) => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        class={`home-catchup-item${props.item.highlights > 0 || props.item.kind === 'dm' ? ' is-priority' : ''}${props.item.followed ? ' is-followed' : ''}`}
        onClick={() => props.onOpen(props.item)}
        aria-label={`Open ${props.item.name}, ${props.item.unread} unread${props.item.highlights > 0 ? `, ${props.item.highlights} mention${props.item.highlights === 1 ? '' : 's'}` : ''}${props.item.followed ? ', followed' : ''}`}
      >
        <span class="home-catchup-name">
          <span class="home-catchup-kind" aria-hidden="true">
            {kindGlyph(props.item.kind, props.item.name)}
          </span>
          {kindVisibleName(props.item.kind, props.item.name)}
        </span>
        <span class="home-catchup-meta">
          <Show when={props.item.highlights > 0}>
            <span class="home-catchup-mention">{props.item.highlights} @you</span>
          </Show>
          <Show when={props.item.followed}>
            <span class="home-catchup-followed">followed</span>
          </Show>
          <span class="home-catchup-unread">{props.item.unread}</span>
          <Show when={props.item.lastActivity > 0}>
            <span class="home-catchup-when">
              {relTime(Math.floor(props.item.lastActivity / 1000), props.nowMs)}
            </span>
          </Show>
        </span>
      </button>
    </li>
  );
}

function ResumeRow(props: {
  point: ResumePoint;
  onResume: (point: ResumePoint) => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        class={`home-resume-item is-${props.point.tier}`}
        onClick={() => props.onResume(props.point)}
        aria-label={`Resume ${props.point.name} at your first unread message, ${props.point.unread} unread${props.point.highlights > 0 ? `, ${props.point.highlights} mention${props.point.highlights === 1 ? '' : 's'}` : ''}`}
      >
        <span class="home-resume-name">
          <span class="home-resume-kind" aria-hidden="true">
            {kindGlyph(props.point.kind, props.point.name)}
          </span>
          {kindVisibleName(props.point.kind, props.point.name)}
        </span>
        <span class="home-resume-meta">
          <Show when={props.point.highlights > 0}>
            <span class="home-resume-mention">{props.point.highlights} @you</span>
          </Show>
          <Show when={props.point.tier === 'followed'}>
            <span class="home-resume-followed">followed</span>
          </Show>
          <span class="home-resume-count">{props.point.unread} unread</span>
          <span class="home-resume-cue" aria-hidden="true">Resume →</span>
        </span>
      </button>
    </li>
  );
}

function LiveSlotButton(props: {
  slot: HomeLiveSlot;
  nowMs: number;
  onCall: () => void;
  onEvent: (event: ScheduledEventItem) => void;
}): JSX.Element {
  return (
    <Show
      when={props.slot.kind === 'event' ? props.slot.event : null}
      fallback={
        <button
          type="button"
          class="home-event home-event--call is-live"
          onClick={() => props.onCall()}
          aria-label={`${props.slot.kind === 'call' ? props.slot.label : 'Call'}. Open the room — does not join the call.`}
        >
          <span class="home-event-time">
            <span class="home-event-state">call</span>
            <span>already active</span>
          </span>
          <span class="home-event-main">
            <span class="home-event-title">{props.slot.kind === 'call' ? props.slot.label : 'Call'}</span>
            <span class="home-event-channel">Open the room · join stays explicit</span>
          </span>
          <span class="home-event-open" aria-hidden="true">Open →</span>
        </button>
      }
    >
      {(event) => (
        <button
          type="button"
          class={`home-event${event().live ? ' is-live' : ''}`}
          onClick={() => props.onEvent(event())}
          aria-label={`Open ${event().channel} for ${event().title}, ${eventCountdown(event(), props.nowMs)}`}
        >
          <span class="home-event-time">
            <span class="home-event-state">{event().live ? 'live' : eventCountdown(event(), props.nowMs)}</span>
            <span>{eventWhenLabel(event())}</span>
          </span>
          <span class="home-event-main">
            <span class="home-event-title">{event().title}</span>
            <span class="home-event-channel">{event().channel}</span>
          </span>
          <span class="home-event-open" aria-hidden="true">Open →</span>
        </button>
      )}
    </Show>
  );
}

function DirectoryCard(props: {
  channel: StatsChannel;
  nowMs: number;
  joined: boolean;
  onOpen: (channel: string) => void;
}): JSX.Element {
  return (
    <article class="home-card" role="listitem">
      <header class="home-card-head">
        <h4 class="home-card-name">{props.channel.channel}</h4>
        <span class="home-card-when">
          {props.channel.present > 0
            ? `${props.channel.present} ${props.channel.present === 1 ? 'person' : 'people'} here now`
            : relTime(props.channel.last_active, props.nowMs)}
        </span>
      </header>
      <p class={`home-card-topic${props.channel.topic ? '' : ' is-empty'}`}>
        {props.channel.topic || 'No topic yet — set the tone.'}
      </p>
      <Sparkline values={props.channel.spark} />
      <footer class="home-card-foot">
        <span class="home-card-msgs">
          {props.channel.messages.toLocaleString('en-US')} messages tracked
        </span>
        <button
          type="button"
          class="home-card-join"
          aria-label={props.joined ? `Open ${props.channel.channel}` : `Join ${props.channel.channel}`}
          onClick={() => props.onOpen(props.channel.channel)}
        >
          {props.joined ? 'Open →' : 'Join →'}
        </button>
      </footer>
    </article>
  );
}

function OverflowDisclosure(props: {
  overflow: HomeOverflow | null;
  action?: () => void;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Show when={props.overflow}>
      {(item) => (
        <Show
          when={item().action === 'browse-rooms'}
          fallback={
            <details class="home-overflow">
              <summary class="home-overflow__summary">{item().label}</summary>
              <div class="home-overflow__body">{props.children}</div>
            </details>
          }
        >
          <button
            type="button"
            class="home-overflow__action"
            onClick={() => props.action?.()}
          >
            {item().label}
          </button>
        </Show>
      )}
    </Show>
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
      <span class="home-memory-foot">
        <span>
          {props.item.count} remembered {props.item.count === 1 ? 'message' : 'messages'}
        </span>
        <span>
          {props.item.participants.length}{' '}
          {props.item.participants.length === 1 ? 'person' : 'people'}
        </span>
      </span>
    </button>
  );
}

export function HomeBriefingView(props: HomeBriefingViewProps): JSX.Element {
  const liveHappening = createMemo(() =>
    props.briefing().liveSlots.some((slot) =>
      slot.kind === 'call' || (slot.kind === 'event' && slot.event.live),
    ),
  );
  const coldCount = createMemo(() =>
    props.briefing().coldVaultRooms.reduce((total, item) => total + item.count, 0),
  );
  const railActive = createMemo(() =>
    props.briefing().attention.length > 0 || props.briefing().continueVisible,
  );

  return (
    <div class="home" role="main" aria-label="Network home">
      <div class="home-inner home-inner--ledger">
        <header class="home-masthead">
          <p class="home-kicker">Current ledger</p>
          <h1 class="home-title">
            {props.welcomeName() ? `Welcome, ${props.welcomeName()}.` : 'Welcome.'}
          </h1>
          <p class="home-sub">What needs you, and where you continue.</p>
          <p class="home-shortcut-note">
            <span>Power tip</span>
            Press <b>/</b> for the palette or <b>?</b> for shortcuts.
          </p>
          <div class="home-welcome-actions" role="group" aria-label="Primary home actions">
            <button
              type="button"
              class="home-cta"
              onClick={() => props.actions.openBrowseRooms()}
            >
              Browse rooms
            </button>
            <button
              type="button"
              class="home-action home-action--primary"
              onClick={() => props.actions.openSearchMessages()}
            >
              Search messages
            </button>
          </div>
          <Show when={props.connectionStatus() !== 'connected'}>
            <p class="home-offline-note" role="status">
              {props.localMemoryStatus()}
            </p>
          </Show>
        </header>

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

        <div
          class="home-ledger"
          classList={{ 'home-ledger--split': props.briefing().liveNowVisible }}
        >
          <div class="home-ledger__main">
            <Show when={props.briefing().showColdVault}>
              <section class="home-catchup home-catchup--cold" aria-label="Device-local catch-up">
                <div class="home-catchup-head">
                  <h2 class="home-section-label">Catch up from this device</h2>
                  <span class="home-catchup-summary">
                    {coldCount()} remembered{' '}
                    {coldCount() === 1 ? 'message' : 'messages'}
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

            <div
              class="home-current-rail"
              classList={{ 'home-current-rail--active': railActive() }}
            >
              <Show when={props.briefing().showCatchUp && !props.briefing().showCaughtUpEmpty}>
                <section
                  class="home-catchup home-catchup--needs"
                  data-catchup-source={props.briefing().catchUpFromMemory ? 'memory' : 'live'}
                  data-home-band="needs-you"
                  aria-label="Catch up on what you missed"
                >
                  <div class="home-catchup-head">
                    <h2 class="home-section-label">Needs you</h2>
                    <Show
                      when={!props.briefing().digestEmpty}
                      fallback={<span class="home-catchup-clear">You're all caught up</span>}
                    >
                      <span class="home-catchup-summary">
                        {props.briefing().catchUpTotals.unread} unread
                        <Show when={props.briefing().catchUpTotals.mentions > 0}>
                          {' · '}
                          <b>
                            {props.briefing().catchUpTotals.mentions} mention{props.briefing().catchUpTotals.mentions === 1 ? '' : 's'}
                          </b>
                        </Show>
                        <Show when={props.briefing().catchUpTotals.followed > 0}>
                          {' · '}
                          {props.briefing().catchUpTotals.followed} followed
                        </Show>
                        {' · '}
                        <span class="home-catchup-source">{props.briefing().catchUpSourceLabel}</span>
                      </span>
                    </Show>
                  </div>
                  <Show when={!props.briefing().digestEmpty}>
                    <Show when={!props.briefing().catchUpFromMemory}>
                      <HomeMarkCaughtUp
                        plan={props.caughtUpPlan}
                        onMarkCaughtUp={props.actions.markAllCaughtUp}
                      />
                    </Show>
                    <Show when={props.briefing().attention.length > 0}>
                      <div
                        class="home-catchup-tier home-catchup-tier--attention"
                        data-home-stratum="attention"
                        role="group"
                        aria-label="Mentions and direct messages"
                      >
                        <ul class="home-catchup-list">
                          <For each={props.briefing().attention}>
                            {(item) => (
                              <CatchUpRow
                                item={item}
                                nowMs={props.nowMs()}
                                onOpen={props.actions.openCatchUp}
                              />
                            )}
                          </For>
                        </ul>
                        <OverflowDisclosure overflow={props.briefing().attentionOverflow}>
                          <ul class="home-catchup-list">
                            <For each={props.briefing().attentionRest}>
                              {(item) => (
                                <CatchUpRow
                                  item={item}
                                  nowMs={props.nowMs()}
                                  onOpen={props.actions.openCatchUp}
                                />
                              )}
                            </For>
                          </ul>
                        </OverflowDisclosure>
                      </div>
                    </Show>
                    <Show when={props.briefing().quiet.length > 0}>
                      <details
                        class="home-catchup-quiet home-catchup-tier--quiet"
                        data-home-stratum="quiet"
                      >
                        <summary class="home-catchup-tier-label">
                          Quiet activity ({props.briefing().quiet.length})
                        </summary>
                        <ul class="home-catchup-list">
                          <For each={props.briefing().quiet}>
                            {(item) => (
                              <CatchUpRow
                                item={item}
                                nowMs={props.nowMs()}
                                onOpen={props.actions.openCatchUp}
                              />
                            )}
                          </For>
                        </ul>
                      </details>
                    </Show>
                  </Show>
                  <Show when={props.recaps().length > 0}>
                    <details class="home-catchup-details home-catchup-details--recaps">
                      <summary class="home-catchup-details__summary">
                        Catch-up details ({props.recaps().length})
                      </summary>
                      <div class="home-recap-strip" role="list" aria-label="Since you left recaps">
                        <For each={props.recaps()}>
                          {(recap) => (
                            <article class="home-recap-card" role="listitem">
                              <div class="home-recap-card__head">
                                <span class="home-recap-card__target">
                                  {recap.item.kind === 'dm' ? `@${recap.item.name}` : recap.item.name}
                                </span>
                                <span class="home-recap-card__count">{recapSummary(recap)}</span>
                              </div>
                              <p class="home-recap-card__voice">{voiceSummary(recap)}</p>
                              <p class="home-recap-card__preview">{recap.preview}</p>
                              <div class="home-recap-card__actions">
                                <button
                                  type="button"
                                  class="home-recap-card__open"
                                  onClick={() => props.actions.openCatchUp(recap.item)}
                                >
                                  Open
                                </button>
                                <button
                                  type="button"
                                  class="home-recap-card__review"
                                  onClick={() => props.actions.reviewCatchUpFromStart(recap)}
                                  aria-label={`Review ${recap.item.name} from first unread line`}
                                >
                                  Review from start
                                </button>
                                <button
                                  type="button"
                                  class="home-recap-card__spotlight"
                                  onClick={() => props.actions.openCatchUpSpotlight(recap.item)}
                                  aria-label={`Find related actions for ${recap.item.name}`}
                                >
                                  Find related
                                </button>
                              </div>
                            </article>
                          )}
                        </For>
                      </div>
                    </details>
                  </Show>
                </section>
              </Show>

              <Show when={props.briefing().continueVisible}>
                <section
                  class="home-continue"
                  data-home-band="continue"
                  aria-label="Continue where you left off"
                >
                  <div class="home-continue-head">
                    <h2 class="home-section-label">Continue</h2>
                    <span class="home-continue-summary">pick up exactly</span>
                  </div>

                  <Show when={props.briefing().resume.length > 0}>
                    <div
                      class="home-resume"
                      data-home-stratum="resume"
                      role="region"
                      aria-label="Resume where you left off"
                    >
                      <div class="home-resume-head">
                        <h3 class="home-resume-label">Pick up where you left off</h3>
                        <span class="home-resume-summary">first unread</span>
                      </div>
                      <ul class="home-resume-list">
                        <For each={props.briefing().resume}>
                          {(point) => (
                            <ResumeRow point={point} onResume={props.actions.resumeAt} />
                          )}
                        </For>
                      </ul>
                    </div>
                  </Show>

                  <Show when={props.briefing().followed.length > 0}>
                    <div
                      class="home-catchup-tier home-catchup-tier--followed"
                      data-home-stratum="followed"
                      role="group"
                      aria-label="Followed channels"
                    >
                      <h3 class="home-catchup-tier-label">Followed</h3>
                      <ul class="home-catchup-list">
                        <For each={props.briefing().followed}>
                          {(item) => (
                            <CatchUpRow
                              item={item}
                              nowMs={props.nowMs()}
                              onOpen={props.actions.openCatchUp}
                            />
                          )}
                        </For>
                      </ul>
                    </div>
                  </Show>

                  <OverflowDisclosure overflow={props.briefing().continueOverflow}>
                    <Show when={props.briefing().resumeRest.length > 0}>
                      <ul class="home-resume-list">
                        <For each={props.briefing().resumeRest}>
                          {(point) => (
                            <ResumeRow point={point} onResume={props.actions.resumeAt} />
                          )}
                        </For>
                      </ul>
                    </Show>
                    <Show when={props.briefing().followedRest.length > 0}>
                      <ul class="home-catchup-list">
                        <For each={props.briefing().followedRest}>
                          {(item) => (
                            <CatchUpRow
                              item={item}
                              nowMs={props.nowMs()}
                              onOpen={props.actions.openCatchUp}
                            />
                          )}
                        </For>
                      </ul>
                    </Show>
                  </OverflowDisclosure>
                </section>
              </Show>
            </div>
          </div>

          <Show when={props.briefing().liveNowVisible}>
            <aside class="home-ledger__rail">
              <section
                class="home-events home-live-now"
                data-home-band="live-now"
                aria-label="Live now"
              >
                <div class="home-events-head">
                  <h2 class="home-section-label">Live now</h2>
                  <span class="home-events-summary">
                    <Show when={liveHappening()} fallback="coming up">
                      happening
                    </Show>
                  </span>
                </div>
                <ul class="home-events-list">
                  <For each={props.briefing().liveSlots}>
                    {(slot) => (
                      <li>
                        <LiveSlotButton
                          slot={slot}
                          nowMs={props.nowMs()}
                          onCall={props.actions.openLiveCall}
                          onEvent={props.actions.openEvent}
                        />
                      </li>
                    )}
                  </For>
                </ul>
                <OverflowDisclosure overflow={props.briefing().liveOverflow}>
                  <ul class="home-events-list">
                    <For each={props.briefing().liveRest}>
                      {(slot) => (
                        <li>
                          <LiveSlotButton
                            slot={slot}
                            nowMs={props.nowMs()}
                            onCall={props.actions.openLiveCall}
                            onEvent={props.actions.openEvent}
                          />
                        </li>
                      )}
                    </For>
                  </ul>
                </OverflowDisclosure>
              </section>
            </aside>
          </Show>
        </div>

        <section class="home-explore" data-home-band="explore" aria-label="Explore">
          <div class="home-explore-head">
            <h2 class="home-section-label">Explore</h2>
            <div class="home-explore-actions">
              <button type="button" class="home-action home-action--quiet" onClick={() => props.actions.openAppearance()}>
                Appearance
              </button>
              <button type="button" class="home-action home-action--quiet" onClick={() => props.actions.openShortcuts()}>
                Shortcuts
              </button>
            </div>
          </div>

          <Show when={props.briefing().directory.length > 0}>
            <div class="home-directory" aria-label="Active channels">
              <p class="home-explore-kicker">Active rooms</p>
              <div class="home-grid" role="list" aria-label="Active channel directory">
                <For each={props.briefing().directory}>
                  {(channel) => (
                    <DirectoryCard
                      channel={channel}
                      nowMs={props.nowMs()}
                      joined={props.isJoined(channel.channel)}
                      onOpen={props.actions.openOrJoinActiveRoom}
                    />
                  )}
                </For>
              </div>
              <OverflowDisclosure
                overflow={props.briefing().exploreOverflow}
                action={() => props.actions.openBrowseRooms()}
              >
                <div class="home-grid" role="list" aria-label="More active rooms">
                  <For each={props.briefing().directoryRest}>
                    {(channel) => (
                      <DirectoryCard
                        channel={channel}
                        nowMs={props.nowMs()}
                        joined={props.isJoined(channel.channel)}
                        onOpen={props.actions.openOrJoinActiveRoom}
                      />
                    )}
                  </For>
                </div>
              </OverflowDisclosure>
            </div>
          </Show>

          <Show when={props.briefing().recentRooms.length > 0}>
            <div class="home-recent">
              <span class="home-section-label">Recent rooms</span>
              <div class="home-recent-chips">
                <For each={props.briefing().recentRooms}>
                  {(room) => (
                    <button
                      type="button"
                      class="home-recent-chip"
                      onClick={() => props.actions.joinRecentRoom(room)}
                    >
                      {room}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={props.showFirstRoomPrompt()}>
            <div class="home-first-room" role="note" aria-label="Start with a room">
              <p class="home-first-room__eyebrow">Your space is ready</p>
              <p class="home-first-room__title">Start with a room.</p>
              <p class="home-first-room__copy">
                Rooms hold your conversation, files, and calls in one place.
                Browse what is open now, or join one by name.
              </p>
            </div>
          </Show>
        </section>

        <Show when={props.briefing().showCaughtUpEmpty}>
          <section class="home-empty" data-home-band="caught-up" aria-label="You're caught up">
            <p class="home-empty-title">You're caught up</p>
            <p class="home-empty-copy">
              No unread messages need you right now. Use Browse rooms or Search messages above when you're ready.
            </p>
          </section>
        </Show>

        <Show when={props.more().hasContent}>
          <details class="home-more-activity" data-home-band="more-activity">
            <summary class="home-more-activity__summary">More activity</summary>
            <div class="home-more-activity__body">
              <Show when={props.more().reviewHistory.length > 0}>
                <section class="home-review-history" aria-label="Recent catch-up reviews">
                  <div class="home-review-history__head">
                    <h2 class="home-section-label">Reviewed recently</h2>
                    <span class="home-review-history__summary">{props.more().reviewHistorySummary}</span>
                  </div>
                  <div class="home-review-history__list" role="list" aria-label="Recent catch-up review cards">
                    <For each={props.more().reviewHistory}>
                      {(entry) => (
                        <article class="home-review-history__item" role="listitem">
                          <div class="home-review-history__meta">
                            <span class="home-review-history__target">
                              {entry.kind === 'dm' ? `@${entry.name}` : entry.name}
                            </span>
                            <span>{reviewCountSummary(entry.messageCount, entry.mentionCount)}</span>
                            <span>{relTime(Math.floor(Date.parse(entry.reviewedAt) / 1000), props.nowMs())}</span>
                          </div>
                          <p class="home-review-history__preview">{entry.preview}</p>
                          <div class="home-review-history__actions">
                            <button
                              type="button"
                              onClick={() => props.actions.reopenReview(entry)}
                              aria-label={`Reopen reviewed catch-up for ${entry.name}`}
                            >
                              Reopen
                            </button>
                            <button
                              type="button"
                              onClick={() => props.actions.openReviewSpotlight(entry)}
                              aria-label={`Find related actions for reviewed ${entry.name}`}
                            >
                              Find related
                            </button>
                            <button
                              type="button"
                              onClick={() => props.actions.searchReviewText(entry)}
                              aria-label={`Search reviewed text for ${entry.name}`}
                            >
                              Search text
                            </button>
                          </div>
                        </article>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Show when={props.more().stats}>
                {(data) => (
                  <div class="home-pulse" aria-label="Live network figures">
                    <div class="home-pulse-tile">
                      <span class="home-pulse-num">{data().channels.length}</span>
                      <span class="home-pulse-label">channels</span>
                    </div>
                    <div class="home-pulse-tile">
                      <span class="home-pulse-num">{props.more().totalMessages.toLocaleString('en-US')}</span>
                      <span class="home-pulse-label">messages tracked</span>
                    </div>
                    <div class="home-pulse-tile">
                      <span class="home-pulse-num">{data().users_online.toLocaleString('en-US')}</span>
                      <span class="home-pulse-label">people online</span>
                    </div>
                    <div class="home-pulse-tile">
                      <span class="home-pulse-num">{relTime(data().generated_at, props.nowMs())}</span>
                      <span class="home-pulse-label">stats updated</span>
                    </div>
                  </div>
                )}
              </Show>

              <Show when={props.more().connected && props.more().roomRhythm.length > 0}>
                <section class="home-rhythm" aria-label="Room rhythm">
                  <div class="home-rhythm-head">
                    <h2 class="home-section-label">Room rhythm</h2>
                    <span class="home-rhythm-summary">joined rooms</span>
                  </div>
                  <div class="home-rhythm-list">
                    <For each={props.more().roomRhythm}>
                      {(item) => (
                        <button
                          type="button"
                          class={`home-rhythm-item${item.event?.live ? ' is-live' : ''}`}
                          onClick={() => item.event ? props.actions.openEvent(item.event) : props.actions.openOrJoinActiveRoom(item.channel)}
                          aria-label={`Open ${item.channel}, ${trendLabel(item)}${item.event ? `, ${item.event.title} ${eventCountdown(item.event, props.nowMs())}` : ''}`}
                        >
                          <span class="home-rhythm-main">
                            <span class="home-rhythm-title">
                              <span>{item.channel}</span>
                              <span>{trendLabel(item)}</span>
                            </span>
                            <span class={`home-rhythm-topic${item.topic ? '' : ' is-empty'}`}>
                              {item.topic || 'No topic set'}
                            </span>
                          </span>
                          <span class="home-rhythm-heat" aria-hidden="true">
                            <For each={item.spark}>
                              {(value) => (
                                <span
                                  class={`home-rhythm-bar${value > 0 ? ' is-active' : ''}`}
                                  style={{ '--heat': (value / item.peak).toFixed(3) }}
                                />
                              )}
                            </For>
                          </span>
                          <span class="home-rhythm-event">
                            <Show
                              when={item.event}
                              fallback={<span>{relTime(item.lastActive, props.nowMs())}</span>}
                            >
                              {(event) => (
                                <>
                                  <b>{event().live ? 'live' : eventCountdown(event(), props.nowMs())}</b>
                                  <span>{event().title}</span>
                                </>
                              )}
                            </Show>
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Show when={props.more().localHistory && props.more().rememberedRooms.length > 0}>
                <section
                  class="home-memory"
                  data-home-stratum="memory"
                  aria-label="Remembered rooms on this device"
                >
                  <div class="home-memory-head">
                    <h2 class="home-section-label">On this device</h2>
                    <span class="home-memory-summary">remembered rooms</span>
                  </div>
                  <div class="home-memory-grid">
                    <For each={props.more().rememberedRooms}>
                      {(item) => (
                        <button
                          type="button"
                          class="home-memory-card"
                          onClick={() => props.actions.openMemory(item)}
                          aria-label={`Rejoin ${item.target}, last remembered ${relTime(Math.floor(item.lastAt.getTime() / 1000), props.nowMs())}`}
                        >
                          <span class="home-memory-card-head">
                            <span class="home-memory-room">{item.target}</span>
                            <span class="home-memory-when">
                              {relTime(Math.floor(item.lastAt.getTime() / 1000), props.nowMs())}
                            </span>
                          </span>
                          <span class="home-memory-preview">
                            <b>{item.lastFrom}</b>: {item.preview}
                          </span>
                          <span class="home-memory-foot">
                            <span>
                              {item.count} remembered {item.count === 1 ? 'message' : 'messages'}
                            </span>
                            <span>
                              {item.participants.length} {item.participants.length === 1 ? 'person' : 'people'}
                            </span>
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Show when={props.more().connected && props.more().quietActivity.length > 0}>
                <section class="home-quiet" aria-label="Quiet room activity">
                  <div class="home-quiet-head">
                    <h2 class="home-section-label">Quiet rooms</h2>
                    <span class="home-quiet-summary">already read</span>
                  </div>
                  <div class="home-quiet-list">
                    <For each={props.more().quietActivity}>
                      {(item) => (
                        <button
                          type="button"
                          class="home-quiet-item"
                          onClick={() => props.actions.openQuietActivity(item)}
                          aria-label={`Open ${item.name}, active ${relTime(Math.floor(item.lastActivity / 1000), props.nowMs())}`}
                        >
                          <span class="home-quiet-main">
                            <span class="home-quiet-room">{item.name}</span>
                            <span class={`home-quiet-topic${item.topic ? '' : ' is-empty'}`}>
                              {item.topic || 'No topic set'}
                            </span>
                          </span>
                          <span class="home-quiet-when">
                            {relTime(Math.floor(item.lastActivity / 1000), props.nowMs())}
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Show when={props.more().connected && props.more().quietBoosts.length > 0}>
                <section class="home-boosts" aria-label="Quiet boosts">
                  <div class="home-boosts-head">
                    <h2 class="home-section-label">Quiet boosts</h2>
                    <span class="home-boosts-summary">reactions</span>
                  </div>
                  <div class="home-boosts-list" role="list" aria-label="Quiet boost cards">
                    <For each={props.more().quietBoosts}>
                      {(item) => (
                        <article class="home-boost-card" role="listitem">
                          <button
                            type="button"
                            class="home-boost-card__open"
                            onClick={() => props.actions.openQuietBoost(item)}
                            aria-label={`Open boosted message in ${item.target}`}
                          >
                            <span class="home-boost-card__target">
                              {item.target.startsWith('#') || item.target.startsWith('&')
                                ? item.target
                                : `@${item.target}`}
                            </span>
                            <span class="home-boost-card__badges" aria-label={`${item.total} quiet boosts`}>
                              <For each={item.groups.slice(0, 3)}>
                                {(group) => (
                                  <span class={`home-boost-card__badge${group.youBoosted ? ' is-you' : ''}`}>
                                    <span aria-hidden="true">{group.emoji}</span>
                                    <span>{group.count}</span>
                                  </span>
                                )}
                              </For>
                            </span>
                            <span class="home-boost-card__preview">
                              <b>{item.from}</b>: {clipped(item.text, 96)}
                            </span>
                            <span class="home-boost-card__when">
                              {relTime(Math.floor(item.at.getTime() / 1000), props.nowMs())}
                            </span>
                          </button>
                        </article>
                      )}
                    </For>
                  </div>
                </section>
              </Show>
            </div>
          </details>
        </Show>
      </div>
    </div>
  );
}
