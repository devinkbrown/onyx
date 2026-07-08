import './landing.css';
import './data-pages.css';
import { createMemo, createResource, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { Mascot } from '@/components/brand/Mascot';
import { fetchStatsIndex, relTime, type NetworkDay, type StatsChannel } from '@/lib/stats/networkIndex';
import { setPageMeta } from './pageMeta';

function PageChrome(props: { children: JSX.Element }) {
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
          <a class="hideable" href="/stats" aria-current="page">Stats</a>
          <a class="hideable" href="/status">Status</a>
          <a class="hideable" href="/roadmap">Roadmap</a>
          <a class="hideable" href="/about">About</a>
          <span class="live hideable"><i aria-hidden="true" />network online</span>
          <a class="enter" href="/app">Open Onyx</a>
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

function ChannelRow(props: { channel: StatsChannel; nowMs: number }) {
  const c = () => props.channel;
  const active = () => c().present || c().active_users;
  const maxSpark = createMemo(() => Math.max(0, ...c().spark));
  return (
    <article class="data-row">
      <div>
        <strong>{c().channel}</strong>
        <p>{c().topic || 'No topic set yet.'}</p>
      </div>
      <div class="channel-spark" aria-label={`${c().channel} recent activity`}>
        <Show when={c().spark.length > 0} fallback={<span class="channel-spark-empty">no trend</span>}>
          <span class="channel-spark-bars" aria-hidden="true">
            <For each={c().spark.slice(-14)}>
              {(n) => (
                <i style={`--h: ${maxSpark() <= 0 ? 3 : Math.max(3, Math.round((n / maxSpark()) * 100))}`} />
              )}
            </For>
          </span>
        </Show>
        <span class="num">{active() > 0 ? `${active()} present` : relTime(c().last_active, props.nowMs)}</span>
      </div>
    </article>
  );
}

export default function StatsRoute() {
  setPageMeta(
    'Onyx stats — live IRCXNet room activity',
    'See public IRCXNet room activity, network message trends, people online, and channel sparklines.',
  );
  const [stats] = createResource(fetchStatsIndex);
  const [nowMs, setNowMs] = createSignal(Date.now());
  const timer = setInterval(() => setNowMs(Date.now()), 30_000);
  onCleanup(() => clearInterval(timer));

  const channels = createMemo(() => [...(stats()?.channels ?? [])].sort((a, b) => b.messages - a.messages));
  const totalMessages = createMemo(() => channels().reduce((sum, c) => sum + c.messages, 0));
  const busiest = createMemo(() => channels()[0] ?? null);
  const days = createMemo(() => stats()?.network_days ?? []);
  const maxDay = createMemo(() => Math.max(0, ...days().map((d) => d.messages)));

  return (
    <PageChrome>
      <section class="r-wrap data-hero" aria-labelledby="stats-heading">
        <p class="r-kicker">network activity</p>
        <h1 id="stats-heading">The rooms <br /><span class="gold">in motion</span></h1>
        <p class="sub">
          Live channel activity from the network itself: people present now, recent
          message volume, and the rhythm of the rooms without opening the app.
        </p>
        <Show when={stats()} fallback={<div class="data-empty">Stats are waiting for the next exported feed.</div>}>
          {(data) => (
            <div class="data-summary" aria-label="Network summary">
              <div class="data-metric">
                <span class="label">people online</span>
                <span class="value">{data().users_online.toLocaleString('en-US')}</span>
                <span class="note">mesh-wide presence</span>
              </div>
              <div class="data-metric">
                <span class="label">rooms tracked</span>
                <span class="value">{data().channels.length.toLocaleString('en-US')}</span>
                <span class="note">updated {relTime(data().generated_at, nowMs())}</span>
              </div>
              <div class="data-metric">
                <span class="label">messages counted</span>
                <span class="value">{totalMessages().toLocaleString('en-US')}</span>
                <span class="note">current public index</span>
              </div>
            </div>
          )}
        </Show>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      <section class="r-wrap r-section data-grid" aria-label="Activity detail">
        <article class="data-card">
          <span class="label">last exported days</span>
          <h2>Network tide</h2>
          <Show when={days().length > 0} fallback={<p>No daily series has been exported yet.</p>}>
            <div class="data-bars" aria-label="Daily message totals">
              <For each={days()}>
                {(day) => (
                  <span
                    class="data-bar"
                    title={`${day.date}: ${day.messages.toLocaleString('en-US')} messages`}
                    style={`--h: ${barHeight(day, maxDay())}`}
                  />
                )}
              </For>
            </div>
          </Show>
          <p>
            The bars are the network-wide message total per exported day, oldest to newest.
            They come from the same data that powers channel history.
          </p>
        </article>

        <aside class="data-card">
          <span class="label">busiest room</span>
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
                    <span class="label">present</span>
                    <span class="value">{(room().present || room().active_users).toLocaleString('en-US')}</span>
                    <span class="note">right now</span>
                  </div>
                </div>
              </>
            )}
          </Show>
        </aside>
      </section>

      <section class="r-wrap r-section" aria-labelledby="rooms-heading">
        <span class="r-eyebrow">rooms</span>
        <h2 class="r-title" id="rooms-heading">Where people<br />are talking</h2>
        <div class="data-list">
          <For each={channels().slice(0, 12)}>
            {(channel) => <ChannelRow channel={channel} nowMs={nowMs()} />}
          </For>
        </div>
      </section>
    </PageChrome>
  );
}
