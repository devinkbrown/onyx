// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import { createMemo, createResource, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { Mascot } from '@/components/brand/Mascot';
import { fetchStatsIndex, relTime, type NetworkDay, type StatsChannel } from '@/lib/stats/networkIndex';
import { publicFeedFreshness, type PublicFeedFreshness } from '@/lib/stats/feedBounds';
import { setPageMeta } from './pageMeta';

function PageChrome(props: {
  children: JSX.Element;
  feedState: PublicFeedFreshness | 'partial' | 'unavailable';
}) {
  const label = () => {
    switch (props.feedState) {
      case 'current': return 'stats current';
      case 'stale': return 'stats stale';
      case 'future': return 'stats time mismatch';
      case 'unknown': return 'stats undated';
      case 'partial': return 'stats incomplete';
      default: return 'stats unavailable';
    }
  };
  return (
    <main class="r data-page">
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
      <header class="r-status" role="banner">
        <a class="brand" href="/" aria-label="Onyx home">
          <Mascot variant="mark" />ONYX
        </a>
        <nav aria-label="Primary">
          <a class="hideable" href="/">Home</a>
          <a class="hideable" href="/stats/" aria-current="page">Stats</a>
          <a class="hideable" href="/status/">Status</a>
          <a class="hideable" href="/roadmap/">Roadmap</a>
          <a class="hideable" href="/about/">About</a>
          <span class="live hideable" data-feed-state={props.feedState}><i aria-hidden="true" />{label()}</span>
          <a class="enter" href="/app/">Open Onyx</a>
        </nav>
      </header>
      {props.children}
    </main>
  );
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
  if (channel.active_users > 0) return `${channel.active_users} active recently`;
  return `last active ${relTime(channel.last_active, nowMs)}`;
}

type RoomSort = 'messages' | 'pulse' | 'presence' | 'recent';
type RoomScope = 'all' | 'active';

const roomSortLabels: Record<RoomSort, string> = {
  messages: 'Messages',
  pulse: 'Pulse',
  presence: 'Presence',
  recent: 'Most recent',
};

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

function ChannelRow(props: { channel: StatsChannel; nowMs: number; rank: number }) {
  const c = () => props.channel;
  const active = () => c().present || c().active_users;
  const maxSpark = createMemo(() => Math.max(0, ...c().spark));
  return (
    <article class="data-row data-room-row">
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
          <div><dt>pulse</dt><dd>{formatCount(roomPulse(c()))}</dd></div>
          <div><dt>present</dt><dd>{formatCount(active())}</dd></div>
        </dl>
        <a class="data-action" href={roomDeepLink(c().channel, c().last_active)}>Open room</a>
      </div>
    </article>
  );
}

export default function StatsRoute() {
  setPageMeta(
    'Onyx stats — live room activity',
    'See public Onyx room activity, network message trends, people online, and channel sparklines.',
    '/stats/',
  );
  const [stats, { refetch: refetchStats }] = createResource(fetchStatsIndex, { initialValue: null });
  const [nowMs, setNowMs] = createSignal(Date.now());
  const [roomSort, setRoomSort] = createSignal<RoomSort>('messages');
  const [roomScope, setRoomScope] = createSignal<RoomScope>('all');
  const timer = setInterval(() => {
    setNowMs(Date.now());
    void refetchStats();
  }, 30_000);
  onCleanup(() => clearInterval(timer));

  const channels = createMemo(() => [...(stats.latest?.channels ?? [])].sort((a, b) => b.messages - a.messages));
  const totalMessages = createMemo(() => channels().reduce((sum, c) => sum + c.messages, 0));
  const busiest = createMemo(() => channels()[0] ?? null);
  const days = createMemo(() => stats.latest?.network_days ?? []);
  const maxDay = createMemo(() => Math.max(0, ...days().map((d) => d.messages)));
  const totalDayMessages = createMemo(() => days().reduce((sum, day) => sum + day.messages, 0));
  const dailyAverage = createMemo(() => days().length === 0 ? 0 : Math.round(totalDayMessages() / days().length));
  const latestDay = createMemo(() => days()[days().length - 1] ?? null);
  const previousDay = createMemo(() => days()[days().length - 2] ?? null);
  const tideDelta = createMemo(() => (latestDay()?.messages ?? 0) - (previousDay()?.messages ?? 0));
  const activeRooms = createMemo(() => channels().filter((channel) => channel.present > 0 || channel.active_users > 0).length);
  const visibleChannels = createMemo(() => {
    const scoped = roomScope() === 'active'
      ? channels().filter((channel) => channel.present > 0 || channel.active_users > 0)
      : channels();
    const sort = roomSort();
    return [...scoped].sort((left, right) => {
      const delta = sort === 'pulse'
        ? roomPulse(right) - roomPulse(left)
        : sort === 'presence'
          ? (right.present || right.active_users) - (left.present || left.active_users)
          : sort === 'recent'
            ? right.last_active - left.last_active
            : right.messages - left.messages;
      return delta || left.channel.localeCompare(right.channel);
    });
  });
  const feedState = createMemo<PublicFeedFreshness | 'partial' | 'unavailable'>(() => {
    const data = stats.latest;
    if (!data) return 'unavailable';
    const freshness = publicFeedFreshness(data.generated_at, nowMs());
    return freshness === 'current' && (!data.channels_complete || !data.network_days_complete)
      ? 'partial'
      : freshness;
  });

  return (
    <PageChrome feedState={feedState()}>
      <section class="r-wrap data-hero" aria-labelledby="stats-heading">
        <p class="r-kicker">network activity</p>
        <h1 id="stats-heading">The rooms <br /><span class="gold">in motion</span></h1>
        <p class="sub">
          Live channel activity from the network itself: people present now, recent
          message volume, and the rhythm of the rooms without opening the app.
        </p>
        <Show when={stats.latest} fallback={<div class="data-empty">Stats are waiting for the next exported feed.</div>}>
          {(data) => (
            <>
              <div class="stats-ledger" aria-label="Live feed ledger">
                <span class="stats-ledger-mark" data-state={feedState()} aria-hidden="true" />
                <p><strong>{data().network || 'Onyx'} activity ledger</strong> · {data().node || 'network export'} · refreshed {relTime(data().generated_at, nowMs())}</p>
                <button type="button" class="stats-refresh" onClick={() => void refetchStats()}>Refresh data</button>
              </div>
              <div class="data-summary stats-summary" aria-label="Network summary">
                <div class="data-metric stats-primary-metric">
                  <span class="label">people online</span>
                  <span class="value">{formatCount(data().users_online)}</span>
                  <span class="note">authoritative network presence</span>
                </div>
                <div class="data-metric">
                  <span class="label">rooms alive</span>
                  <span class="value">{formatCount(activeRooms())}</span>
                  <span class="note">{formatCount(data().channels.length)} rooms tracked</span>
                </div>
                <div class="data-metric">
                  <span class="label">in the current index</span>
                  <span class="value">{formatCount(totalMessages())}</span>
                  <span class="note">{data().channels_complete ? 'complete public room index' : 'partial public room index'}</span>
                </div>
                <div class="data-metric">
                  <span class="label">latest tide</span>
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
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      <section class="r-wrap r-section data-grid" aria-label="Activity detail">
        <article class="data-card">
          <div class="stats-card-heading">
            <span class="label">last exported days</span>
            <span class="stats-card-quiet">{days().length} samples</span>
          </div>
          <h2>Network tide</h2>
          <Show when={days().length > 0} fallback={<p>No daily series has been exported yet.</p>}>
            <figure class="data-chart" aria-labelledby="network-tide-caption">
              <div class="data-bars" aria-hidden="true">
                <For each={days()}>
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
                <span>{days()[0]?.date ?? '—'}</span>
                <strong>{latestDay() ? `${formatCount(latestDay()!.messages)} messages` : '—'}</strong>
                <span>{latestDay()?.date ?? '—'}</span>
              </div>
              <figcaption id="network-tide-caption" class="sr-only">
                Daily message totals, oldest to newest.
              </figcaption>
              <ol class="sr-only" aria-label="Daily message totals">
                <For each={days()}>
                  {(day) => (
                    <li>
                      <time datetime={day.date}>{day.date}</time>: {day.messages.toLocaleString('en-US')} messages
                    </li>
                  )}
                </For>
              </ol>
            </figure>
          </Show>
          <p>
            The bars are the network-wide message total per exported day, oldest to newest.
            {!stats.latest?.network_days_complete ? ' Some malformed or duplicate day rows were omitted. ' : ' '}
            The strongest bar is the busiest exported day, not a forecast.
          </p>
        </article>

        <aside class="data-card">
          <div class="stats-card-heading">
            <span class="label">busiest room</span>
            <span class="stats-card-quiet">all tracked activity</span>
          </div>
          <Show when={busiest()} fallback={<h3>No rooms yet</h3>}>
            {(room) => (
              <>
                <h3>{room().channel}</h3>
                <p>{room().topic || 'No topic set yet.'}</p>
                <div class="data-summary">
                  <div class="data-metric">
                    <span class="label">messages</span>
                    <span class="value">{room().messages.toLocaleString('en-US')}</span>
                    <span class="note">tracked total</span>
                  </div>
                  <div class="data-metric">
                    <span class="label">activity pulse</span>
                    <span class="value">{formatCount(roomPulse(room()))}</span>
                    <span class="note">recent exported intervals</span>
                  </div>
                  <div class="data-metric">
                    <span class="label">present</span>
                    <span class="value">{(room().present || room().active_users).toLocaleString('en-US')}</span>
                    <span class="note">right now</span>
                  </div>
                </div>
                <div class="r-cta">
                  <a class="r-btn ghost" href={roomDeepLink(room().channel, room().last_active)}>Open this room &rarr;</a>
                </div>
              </>
            )}
          </Show>
        </aside>
      </section>

      <section class="r-wrap r-section" aria-labelledby="rooms-heading">
        <span class="r-eyebrow">rooms</span>
        <h2 class="r-title" id="rooms-heading">Room by room,<br />in the open</h2>
        <p class="stats-section-note">Choose how to read the public index. Pulse is the sum of a room’s recent exported samples; presence is a current or recently active count.</p>
        <div class="stats-room-controls" aria-label="Room list controls">
          <div class="stats-control-group" role="group" aria-label="Room scope">
            <button type="button" classList={{ 'is-active': roomScope() === 'all' }} aria-pressed={roomScope() === 'all'} onClick={() => setRoomScope('all')}>All rooms</button>
            <button type="button" classList={{ 'is-active': roomScope() === 'active' }} aria-pressed={roomScope() === 'active'} onClick={() => setRoomScope('active')}>Active rooms</button>
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
            <For each={visibleChannels().slice(0, 18)}>
              {(channel, index) => <ChannelRow channel={channel} nowMs={nowMs()} rank={index() + 1} />}
            </For>
          </Show>
        </div>
      </section>
    </PageChrome>
  );
}
