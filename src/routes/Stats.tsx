// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import './stats.css';
import { createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js';
import {
  fetchChannelDetail,
  netMembershipFlow,
  parseStatsRoomQuery,
  peakHourShare,
  roomShareOfNetwork,
  statsRoomHref,
  type ChannelDetail,
} from '@/lib/stats/channelDetail';
import { fetchStatsIndex, relTime, type NetworkDay, type StatsChannel } from '@/lib/stats/networkIndex';
import { publicFeedFreshness, type PublicFeedFreshness } from '@/lib/stats/feedBounds';
import { PublicFrame } from '@/ui/public';
import { setPageMeta } from './pageMeta';

export type StatsFeedState = PublicFeedFreshness | 'partial' | 'loading' | 'unavailable';

export type StatsFeedTimelineStep = {
  id: 'report' | 'freshness' | 'scope';
  label: string;
  status: string;
  detail: string;
  state: 'pending' | 'observed' | 'attention' | 'unavailable';
};

/**
 * Keep the public feed legible without turning a snapshot into an operator
 * dashboard: first confirm that a report arrived, then qualify its freshness,
 * then state exactly what the page is allowed to expose.
 */
export function statsFeedTimeline(state: StatsFeedState, hasData: boolean): StatsFeedTimelineStep[] {
  const report: StatsFeedTimelineStep = state === 'loading'
    ? {
      id: 'report',
      label: 'Report',
      status: 'waiting',
      detail: 'Waiting for the next public export.',
      state: 'pending',
    }
    : state === 'unavailable' || !hasData
      ? {
        id: 'report',
        label: 'Report',
        status: 'not found',
        detail: 'No public export is available to inspect.',
        state: 'unavailable',
      }
      : {
        id: 'report',
        label: 'Report',
        status: 'received',
        detail: 'A public aggregate export is available.',
        state: 'observed',
      };

  const freshness: StatsFeedTimelineStep = state === 'loading'
    ? {
      id: 'freshness',
      label: 'Freshness',
      status: 'pending',
      detail: 'Freshness is checked after a report arrives.',
      state: 'pending',
    }
    : state === 'unavailable' || !hasData
      ? {
        id: 'freshness',
        label: 'Freshness',
        status: 'not checked',
        detail: 'There is no timestamp to qualify.',
        state: 'unavailable',
      }
      : state === 'current'
        ? {
          id: 'freshness',
          label: 'Freshness',
          status: 'within window',
          detail: 'The report is inside the public freshness window.',
          state: 'observed',
        }
        : state === 'partial'
          ? {
            id: 'freshness',
            label: 'Freshness',
            status: 'within window',
            detail: 'The report is current, but some rows need review.',
            state: 'attention',
          }
          : {
            id: 'freshness',
            label: 'Freshness',
            status: state === 'future' ? 'time mismatch' : state === 'unknown' ? 'undated' : 'outside window',
            detail: 'The snapshot stays visible, but it cannot support a current claim.',
            state: 'attention',
          };

  const scope: StatsFeedTimelineStep = state === 'loading'
    ? {
      id: 'scope',
      label: 'Scope',
      status: 'pending',
      detail: 'Privacy boundaries are applied when data is read.',
      state: 'pending',
    }
    : state === 'unavailable' || !hasData
      ? {
        id: 'scope',
        label: 'Scope',
        status: 'not available',
        detail: 'No feed means no activity claim.',
        state: 'unavailable',
      }
      : state === 'partial'
        ? {
          id: 'scope',
          label: 'Scope',
          status: 'partial aggregate',
          detail: 'Only validated room and day rows are counted.',
          state: 'attention',
        }
        : {
          id: 'scope',
          label: 'Scope',
          status: 'aggregate-only',
          detail: 'Room totals and daily counts; no message text or rankings.',
          state: 'observed',
        };

  return [report, freshness, scope];
}

function feedStateLabel(state: StatsFeedState): string {
  switch (state) {
    case 'loading': return 'stats checking';
    case 'current': return 'stats current';
    case 'stale': return 'stats stale';
    case 'future': return 'stats time mismatch';
    case 'unknown': return 'stats undated';
    case 'partial': return 'stats incomplete';
    default: return 'stats unavailable';
  }
}

function feedLedgerPhrase(state: StatsFeedState): string {
  switch (state) {
    case 'current': return 'export current';
    case 'partial': return 'export incomplete';
    case 'stale': return 'export stale';
    case 'future': return 'export time mismatch';
    case 'unknown': return 'export undated';
    case 'loading': return 'export pending';
    default: return 'export unavailable';
  }
}

function presenceFromExport(state: StatsFeedState, whenCurrent: string, otherwise: string): string {
  return state === 'current' ? whenCurrent : otherwise;
}

function barHeight(day: NetworkDay, max: number): string {
  if (max <= 0) return '3';
  return String(Math.max(3, Math.round((day.messages / max) * 100)));
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function roomPulse(channel: StatsChannel): number {
  return channel.spark.reduce((sum, point) => sum + point, 0);
}

function activityLabel(channel: StatsChannel, nowMs: number): string {
  if (channel.present > 0) return `${channel.present} present now`;
  return `last active ${relTime(channel.last_active, nowMs)}`;
}

const RECENT_ROOM_WINDOW_SECONDS = 24 * 60 * 60;

function roomActiveRecently(channel: StatsChannel, nowMs: number): boolean {
  if (channel.present > 0) return true;
  const nowSeconds = Math.floor(nowMs / 1000);
  return channel.last_active > 0
    && channel.last_active <= nowSeconds + 5 * 60
    && nowSeconds - channel.last_active <= RECENT_ROOM_WINDOW_SECONDS;
}

type RoomSort = 'messages' | 'pulse' | 'presence' | 'recent';
type RoomScope = 'all' | 'present' | 'recent';

const roomSortLabels: Record<RoomSort, string> = {
  messages: 'Messages',
  pulse: 'Pulse',
  presence: 'Presence',
  recent: 'Most recent',
};

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type StatsWindow = 7 | 14;

/** Parse the shareable network activity window, defaulting to the full feed. */
export function parseStatsWindowQuery(search: string): StatsWindow {
  try {
    return new URLSearchParams(search).get('window') === '7' ? 7 : 14;
  } catch {
    return 14;
  }
}

function formatHour(hour: number | null): string {
  if (hour === null) return '—';
  return `${String(hour).padStart(2, '0')}:00 UTC`;
}

function averageWords(detail: ChannelDetail): string {
  if (detail.totals.messages <= 0) return '0';
  return (detail.totals.words / detail.totals.messages).toFixed(1);
}

// JS Date can only represent ±8.64e15 ms; toISOString() throws RangeError past it.
const MAX_TIME_MS = 8.64e15;

export function roomDeepLink(channel: string, lastActiveUnixSec = 0): string {
  const params = new URLSearchParams({ join: channel });
  const ms = lastActiveUnixSec * 1000;
  // Bound the outlier feed value before formatting so a mis-scaled/garbage
  // last_active can never throw and crash the Stats render — degrade to a plain join.
  if (lastActiveUnixSec > 0 && Number.isFinite(ms) && ms <= MAX_TIME_MS) {
    params.set('at', new Date(ms).toISOString());
  }
  return `/app/?${params.toString()}`;
}

/** Stable id for the room inspector region — linked from every Inspect control. */
export const STATS_INSPECTOR_ID = 'stats-room-inspector';

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** User-activated reveal of the inspector: scroll + focus. Never call on initial load. */
export function revealStatsInspector(target: HTMLElement | null = document.getElementById(STATS_INSPECTOR_ID)): void {
  if (!target) return;
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  target.scrollIntoView({ block: 'start', behavior });
  // preventScroll avoids a second jump after scrollIntoView; focus still lands for AT/keyboard.
  if (typeof target.focus === 'function') {
    target.focus({ preventScroll: true });
  }
}

function ChannelRow(props: {
  channel: StatsChannel;
  nowMs: number;
  rank: number;
  selected: boolean;
  inspectorId: string;
  onInspect: (channel: string) => void;
}) {
  const c = () => props.channel;
  const maxSpark = createMemo(() => Math.max(0, ...c().spark));
  return (
    <article class="data-row data-room-row" data-selected={props.selected ? 'true' : undefined}>
      <span class="data-room-rank" aria-label={`Rank ${props.rank}`}>{String(props.rank).padStart(2, '0')}</span>
      <div class="data-room-copy">
        <div class="data-room-heading">
          <strong>{c().channel}</strong>
          <span>{activityLabel(c(), props.nowMs)}</span>
        </div>
        <p>{c().topic || 'No topic set yet.'}</p>
      </div>
      <div class="data-room-telemetry">
        <div class="channel-spark" aria-label={`${c().channel} recent activity`}>
          <Show when={c().spark.length > 0} fallback={<span class="channel-spark-empty">no recent pulse</span>}>
            <span class="channel-spark-bars" aria-hidden="true">
              <For each={c().spark.slice(-18)}>
                {(n) => (
                  <i
                    style={{
                      '--h': String(maxSpark() <= 0
                        ? 3
                        : Math.max(3, Math.round((n / maxSpark()) * 100))),
                    }}
                  />
                )}
              </For>
            </span>
          </Show>
        </div>
        <dl class="data-room-numbers">
          <div><dt>messages</dt><dd>{formatCount(c().messages)}</dd></div>
          <div><dt>14-day pulse</dt><dd>{formatCount(roomPulse(c()))}</dd></div>
          <div><dt>present</dt><dd>{formatCount(c().present)}</dd></div>
        </dl>
        <div class="data-room-actions">
          <button
            type="button"
            class="data-action data-action--inspect"
            aria-pressed={props.selected}
            aria-controls={props.inspectorId}
            onClick={() => props.onInspect(c().channel)}
          >
            Inspect
          </button>
          <a class="data-action" href={roomDeepLink(c().channel, c().last_active)}>Open room</a>
          <a class="data-action data-action--ledger" href={statsRoomHref(c().channel)}>Room ledger</a>
        </div>
      </div>
    </article>
  );
}

export default function StatsRoute() {
  setPageMeta(
    'Onyx stats — live room activity',
    'See public Onyx room activity, network message trends, people online, and room sparklines.',
    '/stats/',
  );
  const [stats, { refetch: refetchStats }] = createResource(fetchStatsIndex, { initialValue: null });
  const [nowMs, setNowMs] = createSignal(Date.now());
  const [roomSort, setRoomSort] = createSignal<RoomSort>('messages');
  const [roomScope, setRoomScope] = createSignal<RoomScope>('all');
  const [roomQuery, setRoomQuery] = createSignal('');
  const [activityWindow, setActivityWindow] = createSignal<StatsWindow>(
    typeof window === 'undefined' ? 14 : parseStatsWindowQuery(window.location.search),
  );
  const [inspectedRoom, setInspectedRoom] = createSignal(
    typeof window === 'undefined' ? '' : parseStatsRoomQuery(window.location.search),
  );
  const timer = setInterval(() => {
    setNowMs(Date.now());
    void refetchStats();
  }, 30_000);
  onCleanup(() => clearInterval(timer));

  const channels = createMemo(() => [...(stats.latest?.channels ?? [])].sort((a, b) => b.messages - a.messages));
  const totalMessages = createMemo(() => channels().reduce((sum, c) => sum + c.messages, 0));
  const busiest = createMemo(() => channels()[0] ?? null);
  const days = createMemo(() => stats.latest?.network_days ?? []);
  const windowDays = createMemo(() => days().slice(-activityWindow()));
  const maxDay = createMemo(() => Math.max(0, ...windowDays().map((d) => d.messages)));
  const totalDayMessages = createMemo(() => windowDays().reduce((sum, day) => sum + day.messages, 0));
  const dailyAverage = createMemo(() => windowDays().length === 0 ? 0 : Math.round(totalDayMessages() / windowDays().length));
  const latestDay = createMemo(() => windowDays()[windowDays().length - 1] ?? null);
  const previousDay = createMemo(() => windowDays()[windowDays().length - 2] ?? null);
  const tideDelta = createMemo(() => (latestDay()?.messages ?? 0) - (previousDay()?.messages ?? 0));
  const activeRooms = createMemo(() => channels().filter((channel) => roomActiveRecently(channel, nowMs())).length);
  const roomsWithPeople = createMemo(() => channels().filter((channel) => channel.present > 0).length);
  const inspectedChannel = createMemo(() => inspectedRoom() || busiest()?.channel || '');
  const [channelDetail, { refetch: refetchChannelDetail }] = createResource(inspectedChannel, fetchChannelDetail, { initialValue: null });
  // createResource keeps `.latest` across source changes; never paint another room's detail
  // while the newly selected room is loading or failed.
  const matchingChannelDetail = createMemo(() => {
    const detail = channelDetail.latest;
    const room = inspectedChannel();
    if (!detail || !room) return null;
    if (detail.channel.toLocaleLowerCase('en') !== room.toLocaleLowerCase('en')) return null;
    return detail;
  });
  const inspectorAwaitingMatch = createMemo(() => {
    const room = inspectedChannel();
    if (!room || matchingChannelDetail()) return false;
    if (channelDetail.loading) return true;
    // Transitional: previous room still in `.latest` while the new source is resolving.
    const stale = channelDetail.latest;
    return !!stale && stale.channel.toLocaleLowerCase('en') !== room.toLocaleLowerCase('en');
  });
  const inspectRoom = (channel: string) => {
    setInspectedRoom(channel);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('room', channel);
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // jsdom / sandboxed documents may reject URL mutation
    }
    // Defer until after Solid commits selected state so scroll/focus target the current inspector.
    queueMicrotask(() => revealStatsInspector());
  };
  const visibleChannels = createMemo(() => {
    const query = roomQuery().trim().toLocaleLowerCase('en');
    const scoped = channels().filter((channel) => {
      if (roomScope() === 'present' && channel.present <= 0) return false;
      if (roomScope() === 'recent' && !roomActiveRecently(channel, nowMs())) return false;
      return !query
        || channel.channel.toLocaleLowerCase('en').includes(query)
        || channel.topic.toLocaleLowerCase('en').includes(query);
    });
    const sort = roomSort();
    return [...scoped].sort((left, right) => {
      const delta = sort === 'pulse'
        ? roomPulse(right) - roomPulse(left)
        : sort === 'presence'
          ? right.present - left.present
          : sort === 'recent'
            ? right.last_active - left.last_active
            : right.messages - left.messages;
      return delta || left.channel.localeCompare(right.channel);
    });
  });
  const heatmapMax = createMemo(() => Math.max(0, ...(matchingChannelDetail()?.heatmap.flat() ?? [])));
  const feedState = createMemo<StatsFeedState>(() => {
    const data = stats.latest;
    if (!data) return stats.loading ? 'loading' : 'unavailable';
    const freshness = publicFeedFreshness(data.generated_at, nowMs());
    return freshness === 'current' && (!data.channels_complete || !data.network_days_complete)
      ? 'partial'
      : freshness;
  });
  const feedTimeline = createMemo(() => statsFeedTimeline(feedState(), Boolean(stats.latest)));
  const feedTimelineNote = createMemo(() => {
    const state = feedState();
    if (state === 'loading') return 'Checking the public export. No activity claim yet.';
    if (state === 'unavailable') return 'The public export is unavailable. No activity claim is made.';
    const generatedAt = stats.latest?.generated_at ?? 0;
    const age = generatedAt > 0 ? `Last report ${relTime(generatedAt, nowMs())}.` : 'The report has no usable timestamp.';
    if (state === 'partial') return `${age} Some aggregate rows were omitted, so read this as an incomplete snapshot.`;
    if (state === 'current') return `${age} The visible network totals are inside the public freshness window.`;
    return `${age} This snapshot remains visible for context, not as a current health claim.`;
  });
  const activityWindowState = createMemo<'current' | 'loading' | 'stale' | 'unavailable'>(() => {
    const state = feedState();
    if (state === 'loading') return 'loading';
    if (state === 'unavailable' || windowDays().length === 0) return 'unavailable';
    return state === 'current' ? 'current' : 'stale';
  });
  const activityWindowStatus = createMemo(() => {
    switch (activityWindowState()) {
      case 'loading':
        return 'Waiting for the public feed before choosing a window.';
      case 'unavailable':
        return 'Window controls are unavailable until daily public activity is exported.';
      case 'stale':
        return `Showing the latest ${activityWindow()} days from a ${feedLedgerPhrase(feedState())}. Treat this as a snapshot.`;
      default: {
        const samples = windowDays().length;
        const suffix = samples < activityWindow() ? ` · ${samples} exported ${samples === 1 ? 'day' : 'days'} available` : '';
        return `Showing the latest ${activityWindow()} days of public network activity${suffix}.`;
      }
    }
  });
  const updateActivityWindow = (next: StatsWindow): void => {
    setActivityWindow(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('window', String(next));
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // jsdom / sandboxed documents may reject URL mutation
    }
  };

  return (
    <PublicFrame
      currentPath="/stats/"
      mainLabel="Onyx network stats"
      context={(
        <p class="public-frame__current-line">
          <span class="public-frame__current-kicker">Rooms</span>
          <span aria-hidden="true">·</span>
          <span class="public-frame__current-label">Stats</span>
        </p>
      )}
    >
      <div class="ui-root r data-page stats-page">
        <div class="r-ground" aria-hidden="true" />
        <div class="r-flecks" aria-hidden="true" />
        <svg class="r-veins" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
          <path class="flow" d="M-40 120 C 280 60, 420 280, 720 220 S 1180 120, 1500 240" />
          <path class="flow" d="M-40 540 C 320 640, 560 420, 860 520 S 1240 660, 1520 560" />
          <path d="M-40 760 C 360 700, 700 860, 1040 760 S 1320 700, 1520 800" />
          <circle class="node" cx="720" cy="220" r="3" />
          <circle class="node" cx="860" cy="520" r="3" />
        </svg>
        <div class="r-grain" aria-hidden="true" />

        <section class="r-wrap data-hero stats-hero" aria-labelledby="stats-heading">
        <p class="r-kicker">Rooms</p>
        <h1 id="stats-heading">The rooms <br /><span class="stats-title-accent">in motion</span></h1>
        <p class="sub">
          See where people are talking, follow the network’s rhythm, and step
          directly into a public conversation. No member rankings. No message text.
        </p>
        <div
          class="stats-observation"
          data-feed-state={feedState()}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span class="stats-observation__marker" aria-hidden="true" />
          {feedStateLabel(feedState())}
        </div>
        <Show
          when={stats.latest}
          fallback={(
            <div class="data-empty">
              {feedState() === 'loading'
                ? 'Stats are waiting for the next exported feed.'
                : 'No public stats export is available.'}
            </div>
          )}
        >
          {(data) => (
            <>
              <div class="stats-ledger" aria-label="Live feed ledger">
                <span class="stats-ledger-mark" data-state={feedState()} aria-hidden="true" />
                <p><strong>{data().network || 'Onyx'} activity</strong> · {feedLedgerPhrase(feedState())} · {data().node || 'network export'} · updated {relTime(data().generated_at, nowMs())}</p>
                <button
                  type="button"
                  class="stats-refresh"
                  onClick={() => {
                    void refetchStats();
                    if (inspectedChannel()) void refetchChannelDetail();
                  }}
                >
                  Refresh data
                </button>
              </div>
              <div class="data-summary stats-summary" aria-label="Network summary">
                <div class="data-metric stats-primary-metric" data-tone="presence">
                  <span class="label">people online</span>
                  <span class="value">{formatCount(data().users_online)}</span>
                  <span class="note"><i aria-hidden="true" /> {presenceFromExport(feedState(), 'live network presence', 'presence from this export')}</span>
                </div>
                <div class="data-metric" data-tone="rooms">
                  <span class="label">rooms moving</span>
                  <span class="value">{formatCount(activeRooms())}</span>
                  <span class="note">{formatCount(roomsWithPeople())} {presenceFromExport(feedState(), 'live right now', 'present in this export')}</span>
                </div>
                <div class="data-metric" data-tone="messages">
                  <span class="label">messages observed</span>
                  <span class="value">{formatCount(totalMessages())}</span>
                  <span class="note">{data().channels_complete ? 'across the complete public room index' : 'across a partial public room index'}</span>
                </div>
                <div class="data-metric" data-tone="momentum">
                  <span class="label">latest day</span>
                  <span class="value">{formatCount(latestDay()?.messages ?? dailyAverage())}</span>
                  <span class="note">
                    {previousDay()
                      ? tideDelta() === 0
                        ? 'level with previous export'
                        : `${tideDelta() > 0 ? '+' : ''}${formatCount(tideDelta())} vs previous export`
                      : 'first exported day in this feed'}
                  </span>
                </div>
              </div>
            </>
          )}
        </Show>
        <section
          class="stats-feed-timeline"
          data-feed-state={feedState()}
          data-testid="stats-feed-timeline"
          aria-labelledby="stats-feed-timeline-heading"
        >
          <div class="stats-feed-timeline-head">
            <div>
              <span class="label">signal path</span>
              <h2 id="stats-feed-timeline-heading">Three checks before a claim</h2>
            </div>
            <p class="stats-feed-cadence"><span aria-hidden="true">↻</span> auto-check · 30 sec</p>
          </div>
          <ol class="stats-feed-timeline-list" aria-label="Public stats feed checks">
            <For each={feedTimeline()}>
              {(step, index) => (
                <li class="stats-feed-step" data-step={step.id} data-step-state={step.state}>
                  <span class="stats-feed-step__index" aria-hidden="true">{String(index() + 1).padStart(2, '0')}</span>
                  <div class="stats-feed-step__body">
                    <div class="stats-feed-step__heading">
                      <span>{step.label}</span>
                      <strong>{step.status}</strong>
                    </div>
                    <p>{step.detail}</p>
                  </div>
                </li>
              )}
            </For>
          </ol>
          <p class="stats-feed-timeline-note" aria-live="polite" aria-atomic="true">{feedTimelineNote()}</p>
        </section>
      </section>

      <nav class="r-wrap stats-view-nav" aria-label="Stats sections">
        <a href="#network-overview"><span>01</span> Network pulse</a>
        <a href={`#${STATS_INSPECTOR_ID}`}><span>02</span> Room inspector</a>
        <a href="#rooms"><span>03</span> All rooms</a>
      </nav>

      <section id="network-overview" class="r-wrap r-section data-grid stats-overview" aria-label="Activity detail">
        <article class="data-card">
          <div class="stats-card-heading">
            <span class="label">network pulse</span>
            <span class="stats-card-quiet">{windowDays().length}/{days().length} samples</span>
          </div>
          <h2>Conversation current</h2>
          <div
            class="stats-window-control"
            data-window-state={activityWindowState()}
            data-testid="stats-window-control"
            role="group"
            aria-labelledby="stats-window-heading"
          >
            <div class="stats-window-copy">
              <span class="label" id="stats-window-heading">network window</span>
              <p id="stats-window-help">Use a shorter or fuller public activity horizon.</p>
            </div>
            <div class="stats-window-options" role="group" aria-label="Network activity window">
              <button
                type="button"
                aria-label="Latest 7 days"
                aria-pressed={activityWindow() === 7}
                aria-describedby="stats-window-help"
                disabled={activityWindowState() === 'loading' || activityWindowState() === 'unavailable'}
                onClick={() => updateActivityWindow(7)}
              >
                7 days
              </button>
              <button
                type="button"
                aria-label="Latest 14 days"
                aria-pressed={activityWindow() === 14}
                aria-describedby="stats-window-help"
                disabled={activityWindowState() === 'loading' || activityWindowState() === 'unavailable'}
                onClick={() => updateActivityWindow(14)}
              >
                14 days
              </button>
            </div>
            <p class="stats-window-status" data-window-state={activityWindowState()} role="status" aria-live="polite">
              {activityWindowStatus()}
            </p>
          </div>
          <Show when={windowDays().length > 0} fallback={<p>No daily series has been exported yet.</p>}>
            <figure class="data-chart" aria-labelledby="network-tide-caption">
              <div class="data-bars" aria-hidden="true">
                <For each={windowDays()}>
                  {(day) => (
                    <span
                      class="data-bar"
                      title={`${day.date}: ${day.messages.toLocaleString('en-US')} messages`}
                      style={{ '--h': String(barHeight(day, maxDay())) }}
                    />
                  )}
                </For>
              </div>
              <div class="stats-chart-caption" aria-hidden="true">
                <span>{windowDays()[0]?.date ?? '—'}</span>
                <strong>{latestDay() ? `${formatCount(latestDay()!.messages)} messages` : '—'}</strong>
                <span>{latestDay()?.date ?? '—'}</span>
              </div>
              <figcaption id="network-tide-caption" class="sr-only">
                Daily message totals, oldest to newest. Showing the latest {activityWindow()} days.
              </figcaption>
              <ol class="sr-only" aria-label="Daily message totals">
                <For each={windowDays()}>
                  {(day) => (
                    <li>
                      <time datetime={day.date}>{day.date}</time>: {day.messages.toLocaleString('en-US')} messages
                    </li>
                  )}
                </For>
              </ol>
            </figure>
          </Show>
          <p class="stats-chart-note">
            Network-wide public messages for the latest {activityWindow()} exported days, oldest to newest.
            {!stats.latest?.network_days_complete ? ' Some malformed or duplicate day rows were omitted. ' : ' '}
            This is observed activity, not a forecast.
          </p>
        </article>

        <aside class="data-card stats-busiest-card">
          <div class="stats-card-heading">
            <span class="label">room spotlight</span>
            <span class="stats-card-quiet">most messages</span>
          </div>
          <Show when={busiest()} fallback={<h3>No rooms yet</h3>}>
            {(room) => (
              <>
                <h3>{room().channel}</h3>
                <p>{room().topic || 'No topic set yet.'}</p>
                <div class="data-summary stats-spotlight-metrics">
                  <div class="data-metric" data-tone="messages">
                    <span class="label">messages</span>
                    <span class="value">{room().messages.toLocaleString('en-US')}</span>
                    <span class="note">tracked total</span>
                  </div>
                  <div class="data-metric" data-tone="momentum">
                    <span class="label">activity pulse</span>
                    <span class="value">{formatCount(roomPulse(room()))}</span>
                    <span class="note">recent exported intervals</span>
                  </div>
                  <div class="data-metric" data-tone="presence">
                    <span class="label">present</span>
                    <span class="value">{(room().present || room().active_users).toLocaleString('en-US')}</span>
                    <span class="note">{presenceFromExport(feedState(), 'right now', 'in this export')}</span>
                  </div>
                </div>
                <div class="r-cta">
                  <a class="r-btn primary" href={roomDeepLink(room().channel, room().last_active)}>Join the conversation <span aria-hidden="true">&rarr;</span></a>
                </div>
              </>
            )}
          </Show>
        </aside>
      </section>

      <section
        id={STATS_INSPECTOR_ID}
        class="r-wrap r-section stats-inspector"
        aria-labelledby="inspector-heading"
        tabindex="-1"
      >
        <div class="stats-inspector-head">
          <div>
            <span class="r-eyebrow">room signal</span>
            <h2 class="r-title" id="inspector-heading">
              <Show when={inspectedChannel()} fallback="Choose a room">
                {(channel) => <>Inside <span class="stats-title-accent">{channel()}</span></>}
              </Show>
            </h2>
          </div>
          <Show when={inspectedChannel()}>
            {(channel) => (
              <a class="r-btn primary stats-inspector-open" href={roomDeepLink(channel())}>
                Open room <span aria-hidden="true">&rarr;</span>
              </a>
            )}
          </Show>
        </div>

        <Show
          when={matchingChannelDetail()}
          fallback={
            <div class="data-empty" role="status">
              {inspectorAwaitingMatch()
                ? `Loading ${inspectedChannel() || 'room'} insights…`
                : 'Detailed room telemetry is unavailable. The public index above is still usable.'}
            </div>
          }
        >
          {(detail) => (
            <>
              <div class="stats-inspector-ledger">
                <p>
                  <strong>{detail().channel}</strong> · observed since {detail().firstSeen > 0 ? new Date(detail().firstSeen * 1000).toLocaleDateString() : 'an unknown date'}
                  {' '}· last activity {relTime(detail().lastActive, nowMs())}
                </p>
                <span data-state={detail().complete ? 'complete' : 'partial'}>
                  {detail().complete ? 'complete room feed' : 'partial room feed'}
                </span>
              </div>

              <div class="stats-inspector-metrics" aria-label={`${detail().channel} summary`}>
                <div data-tone="presence"><span>present now</span><strong>{formatCount(detail().present)}</strong><small>live network roster</small></div>
                <div data-tone="messages"><span>messages tracked</span><strong>{formatCount(detail().totals.messages)}</strong><small>durable public aggregate</small></div>
                <div data-tone="people"><span>contributors</span><strong>{formatCount(detail().totals.activeUsers)}</strong><small>distinct recorded authors</small></div>
                <div data-tone="words"><span>words / message</span><strong>{averageWords(detail())}</strong><small>aggregate average</small></div>
                <div data-tone="momentum"><span>busiest day</span><strong>{formatCount(detail().busiestDay?.messages ?? 0)}</strong><small>{detail().busiestDay?.date ?? 'not enough history'}</small></div>
                <div data-tone="time"><span>peak hour</span><strong>{formatHour(detail().peakHour)}</strong><small>{peakHourShare(detail().hours).toFixed(0)}% of the daily rhythm</small></div>
                <div data-tone="share">
                  <span>network share</span>
                  <strong>
                    {(() => {
                      const share = roomShareOfNetwork(detail().totals.messages, totalMessages());
                      return share === null ? '—' : `${share.toFixed(share >= 10 ? 0 : 1)}%`;
                    })()}
                  </strong>
                  <small>of observed public messages</small>
                </div>
                <div data-tone="flow">
                  <span>net joins</span>
                  <strong>{netMembershipFlow(detail().totals).toLocaleString('en-US')}</strong>
                  <small>joins minus parts, quits, and kicks</small>
                </div>
              </div>

              <div class="stats-inspector-grid">
                <article class="data-card stats-hour-card">
                  <div class="stats-card-heading">
                    <span class="label">daily rhythm</span>
                    <span class="stats-card-quiet">UTC · all recorded days</span>
                  </div>
                  <h3>When the room talks</h3>
                  <div class="stats-hour-chart" aria-hidden="true">
                    <For each={detail().hours}>
                      {(messages, hour) => (
                        <i
                          title={`${String(hour()).padStart(2, '0')}:00 UTC: ${formatCount(messages)} messages`}
                          style={{ '--h': String(Math.max(3, Math.round((messages / Math.max(1, ...detail().hours)) * 100))) }}
                        />
                      )}
                    </For>
                  </div>
                  <div class="stats-hour-axis" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
                  <p class="stats-chart-explanation">Each bar is one UTC hour accumulated across the room’s retained statistics.</p>
                  <ol class="sr-only" aria-label={`${detail().channel} messages by UTC hour`}>
                    <For each={detail().hours}>
                      {(messages, hour) => <li>{String(hour()).padStart(2, '0')}:00 UTC: {formatCount(messages)} messages</li>}
                    </For>
                  </ol>
                </article>

                <article class="data-card stats-days-card">
                  <div class="stats-card-heading">
                    <span class="label">recent days</span>
                    <span class="stats-card-quiet">{detail().days.length} exported days</span>
                  </div>
                  <h3>How the room moved</h3>
                  <Show when={detail().days.length > 0} fallback={<p>No per-room daily series has been exported yet.</p>}>
                    <figure class="data-chart stats-room-days" aria-labelledby="room-days-caption">
                      <div class="data-bars" aria-hidden="true">
                        <For each={detail().days}>
                          {(day) => {
                            const peak = Math.max(1, ...detail().days.map((entry) => entry.messages));
                            return (
                              <span
                                class="data-bar"
                                title={`${day.date}: ${formatCount(day.messages)} messages`}
                                style={{ '--h': String(Math.max(3, Math.round((day.messages / peak) * 100))) }}
                              />
                            );
                          }}
                        </For>
                      </div>
                      <figcaption id="room-days-caption" class="sr-only">
                        Daily message totals for {detail().channel}, oldest to newest.
                      </figcaption>
                      <ol class="sr-only" aria-label={`${detail().channel} messages by day`}>
                        <For each={detail().days}>
                          {(day) => (
                            <li>
                              <time datetime={day.date}>{day.date}</time>: {formatCount(day.messages)} messages
                            </li>
                          )}
                        </For>
                      </ol>
                    </figure>
                  </Show>
                </article>

                <article class="data-card stats-flow-card">
                  <div class="stats-card-heading">
                    <span class="label">room flow</span>
                    <span class="stats-card-quiet">aggregate events</span>
                  </div>
                  <h3>Room movement</h3>
                  <dl class="stats-flow-list">
                    <div><dt>joins</dt><dd>{formatCount(detail().totals.joins)}</dd></div>
                    <div><dt>parts</dt><dd>{formatCount(detail().totals.parts)}</dd></div>
                    <div><dt>quits</dt><dd>{formatCount(detail().totals.quits)}</dd></div>
                    <div><dt>kicks</dt><dd>{formatCount(detail().totals.kicks)}</dd></div>
                    <div><dt>topic changes</dt><dd>{formatCount(detail().totals.topicChanges)}</dd></div>
                    <div><dt>last speaker</dt><dd>{detail().lastSpeaker || '—'}</dd></div>
                  </dl>
                </article>
              </div>

              <article class="data-card stats-heatmap-card">
                <div class="stats-card-heading">
                  <span class="label">week × hour</span>
                  <span class="stats-card-quiet">darker means more messages</span>
                </div>
                <h3>The room’s weekly current</h3>
                <div class="stats-heatmap-scroll" tabindex="0" role="region" aria-label={`${detail().channel} weekly activity table`}>
                  <table class="stats-heatmap">
                    <caption class="sr-only">Messages by weekday and UTC hour for {detail().channel}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Day</th>
                        <For each={detail().hours}>{(_, hour) => <th scope="col">{String(hour()).padStart(2, '0')}</th>}</For>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={detail().heatmap}>
                        {(row, day) => (
                          <tr>
                            <th scope="row">{weekdayLabels[day()]}</th>
                            <For each={row}>
                              {(messages, hour) => (
                                <td
                                  style={{ '--heat': `${Math.round((heatmapMax() <= 0 ? 0 : messages / heatmapMax()) * 82) + 4}%` }}
                                  title={`${weekdayLabels[day()]} ${String(hour()).padStart(2, '0')}:00 UTC: ${formatCount(messages)} messages`}
                                >
                                  <span class="sr-only">{formatCount(messages)}</span>
                                </td>
                              )}
                            </For>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </article>

              <p class="stats-method-note">
                This page reports aggregate activity from public, non-ephemeral rooms. It does not publish message text,
                private-room traffic, participant rankings, or word-frequency profiles. Presence is live; other totals are retained server counters.
              </p>
            </>
          )}
        </Show>
      </section>

      <section id="rooms" class="r-wrap r-section stats-rooms-section" aria-labelledby="rooms-heading">
        <span class="r-eyebrow">public room directory</span>
        <h2 class="r-title" id="rooms-heading">Find the conversation</h2>
        <p class="stats-section-note">Search by room or topic, see who is present, and open the room at its latest recorded moment. The 14-day pulse shows activity without exposing what anyone said.</p>
        <div class="stats-room-controls" aria-label="Room list controls">
          <label class="stats-room-search">
            <span>Find a room or topic</span>
            <input
              type="search"
              value={roomQuery()}
              onInput={(event) => setRoomQuery(event.currentTarget.value)}
              placeholder="#room or topic"
              autocomplete="off"
            />
          </label>
          <div class="stats-control-group" role="group" aria-label="Room scope">
            <button type="button" classList={{ 'is-active': roomScope() === 'all' }} aria-pressed={roomScope() === 'all'} onClick={() => setRoomScope('all')}>All rooms</button>
            <button type="button" classList={{ 'is-active': roomScope() === 'present' }} aria-pressed={roomScope() === 'present'} onClick={() => setRoomScope('present')}>People here now</button>
            <button type="button" classList={{ 'is-active': roomScope() === 'recent' }} aria-pressed={roomScope() === 'recent'} onClick={() => setRoomScope('recent')}>Active in 24h</button>
          </div>
          <div class="stats-control-group" role="group" aria-label="Sort rooms">
            <For each={Object.entries(roomSortLabels) as [RoomSort, string][]}>
              {([value, label]) => (
                <button type="button" classList={{ 'is-active': roomSort() === value }} aria-pressed={roomSort() === value} onClick={() => setRoomSort(value)}>{label}</button>
              )}
            </For>
          </div>
          <p class="stats-result-count">Showing {formatCount(visibleChannels().length)} of {formatCount(channels().length)} rooms · sorted by {roomSortLabels[roomSort()].toLowerCase()}</p>
        </div>
        <div class="data-list">
          <Show when={visibleChannels().length > 0} fallback={<div class="data-empty">No rooms match this view. Switch back to all rooms to see the full public index.</div>}>
            <For each={visibleChannels()}>
              {(channel, index) => (
                <ChannelRow
                  channel={channel}
                  nowMs={nowMs()}
                  rank={index() + 1}
                  selected={inspectedChannel().toLowerCase() === channel.channel.toLowerCase()}
                  inspectorId={STATS_INSPECTOR_ID}
                  onInspect={inspectRoom}
                />
              )}
            </For>
          </Show>
        </div>
      </section>
      </div>
    </PublicFrame>
  );
}
