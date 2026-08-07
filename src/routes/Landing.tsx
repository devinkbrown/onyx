// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './home.css';
import { createMemo, createResource, createSignal, onCleanup, Show } from 'solid-js';
import { Mascot } from '@/components/brand/Mascot';
import { fetchStatsIndex } from '@/lib/stats/networkIndex';
import {
  fetchNetworkStatus,
  formatDuration,
  publicMeshFeedLabel,
  publicMeshFeedState,
} from '@/lib/stats/status';
import { setPageMeta } from './pageMeta';

/** Onyx launch site — the human front door to the product.
 *  The transport and operator engine remain inspectable below the primary story;
 *  the first decision is whether Onyx helps a visitor and their people. */
export default function Landing() {
  setPageMeta(
    'Onyx — a place for your people that you can trust',
    'Onyx brings rooms, calls, useful catch-up, and honest protection state together in one communication product.',
    '/',
  );
  const [stats, { refetch: refetchStats }] = createResource(fetchStatsIndex, { initialValue: null });
  const [status, { refetch: refetchStatus }] = createResource(fetchNetworkStatus, { initialValue: null });
  const [nowMs, setNowMs] = createSignal(Date.now());
  const refreshTimer = setInterval(() => {
    setNowMs(Date.now());
    void refetchStats();
    void refetchStatus();
  }, 30_000);
  onCleanup(() => clearInterval(refreshTimer));

  const busiest = createMemo(() =>
    [...(stats.latest?.channels ?? [])].sort((a, b) => b.messages - a.messages)[0] ?? null,
  );
  const feedState = createMemo(() =>
    status.loading ? 'loading' as const : publicMeshFeedState(status.latest, nowMs()),
  );
  const meshState = createMemo(() => {
    switch (feedState()) {
      case 'current': return 'operational';
      case 'degraded': return 'degraded';
      case 'stale': return 'stale';
      case 'future': return 'time mismatch';
      case 'unknown': return 'undated';
      default: return 'listening';
    }
  });

  return (
    <main class="r r-landing home">
      {/* Thin mineral atmosphere — motion stacks gated in home.css reduced-motion */}
      <div class="r-ground home-ground" aria-hidden="true" />
      <div class="r-grain home-grain" aria-hidden="true" />

      {/* ── top bar ── */}
      <header class="r-status r-status--landing" role="banner">
        <a class="brand" href="/" aria-label="Onyx home">
          <span class="brand-mark" aria-hidden="true">
            <Mascot variant="mark" />
          </span>
          <span class="brand-wordmark" aria-hidden="true">ONYX</span>
        </a>
        <nav aria-label="Primary">
          <a class="hideable r-nav-detail" href="#product">Product</a>
          <a class="hideable r-nav-detail" href="#trust">Trust</a>
          <a class="hideable" href="/onyxos/">OnyxOS</a>
          <span class="live hideable" data-feed-state={feedState()}>
            <i aria-hidden="true" />{publicMeshFeedLabel(feedState())}
          </span>
          <a class="enter" href="/app/">Open Onyx</a>
        </nav>
      </header>

      {/* ── hero ── */}
      <section class="r-wrap r-hero" aria-labelledby="hero-heading">
        <div class="r-hero-grid">
          <div class="r-hero-copy">
            <p class="r-kicker">rooms · calls · catch-up · honest protection</p>
            <h1 id="hero-heading">A place for<br /><span class="gold">your people</span></h1>
            <p class="serif-sub">Fast enough to feel alive. Clear enough to trust.</p>
            <p class="sub">
              Onyx brings your conversations, calls, and everything you missed
              into one calm home. It shows what is protected, keeps useful
              history on your device, and never turns your relationships into
              an advertising product.
            </p>
            <div class="r-cta">
              <a class="r-btn primary" href="/app/">Open Onyx &rarr;</a>
              <a class="r-btn ghost" href="#product">See how it works</a>
            </div>
            <div class="r-proof-rail" id="trust" aria-label="What Onyx makes visible">
              <span><b>Conversation</b> ready</span>
              <span><b>History</b> on this device</span>
              <span><b>Protection</b> shown honestly</span>
              <a href="/about/">Why you can trust it &rarr;</a>
            </div>
          </aside>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── live pulse from public feeds ── */}
      <section id="product" class="r-wrap r-section r-live" aria-labelledby="live-heading">
        <div class="r-live-head">
          <div>
            <span class="r-eyebrow">live pulse</span>
            <h2 class="r-title" id="live-heading">The network<br />is visible</h2>
          </div>
          <a class="r-live-link" href="/status/">Open status</a>
        </div>
        <p class="r-lede">
          Public telemetry is part of the front door: room activity, mesh health,
          and node state are readable before you join.
        </p>
        <div class="r-live-grid" aria-label="Live network summary">
          <article class="r-live-tile">
            <span class="k">mesh</span>
            <strong data-state={meshState()}>{meshState()}</strong>
          </span>
          <span class="home-telemetry-sep" aria-hidden="true">·</span>
          <span class="home-telemetry-item">
            <span class="k">people</span>
            <strong>
              <Show when={stats.latest} fallback="--">
                {(data) => data().users_online.toLocaleString('en-US')}
              </Show>
            </strong>
            <span class="hint">
              <Show when={stats.latest} fallback="waiting for stats">
                online
              </Show>
            </span>
          </span>
          <span class="home-telemetry-sep" aria-hidden="true">·</span>
          <span class="home-telemetry-item">
            <span class="k">rooms</span>
            <strong>
              <Show when={stats.latest} fallback="--">
                {(data) => data().channels.length.toLocaleString('en-US')}
              </Show>
            </strong>
            <span class="hint">
              {stats.latest
                ? (stats.latest.channels_complete ? 'tracked' : 'partial')
                : 'waiting'}
            </span>
          </span>
          <span class="home-telemetry-sep" aria-hidden="true">·</span>
          <span class="home-telemetry-item">
            <span class="k">busy</span>
            <strong>
              <Show when={busiest()} fallback="--">
                {(room) => room().channel}
              </Show>
            </strong>
            <span class="hint">
              <Show when={status.latest} fallback="no status yet">
                {(s) => `up ${formatDuration(s().uptime_seconds)}`}
              </Show>
            </span>
          </span>
          <a class="home-telemetry-link" href="/status/">Status</a>
        </div>
      </section>

      <section class="r-wrap home-capability" aria-labelledby="capability-heading">
        <h2 id="capability-heading" class="home-visually-hidden">What you get</h2>
        <ul class="home-current" data-home-current>
          <li class="home-current-beat is-msg">
            <span class="mark mark-msg" aria-hidden="true" />
            <span>Text rooms and direct messages</span>
          </li>
          <li class="home-current-beat is-call">
            <span class="mark mark-call" aria-hidden="true" />
            <span>Voice and video when you need them</span>
          </li>
          <li class="home-current-beat is-cont">
            <span class="mark mark-cont" aria-hidden="true" />
            <span>Session resume and local history that stay with you</span>
          </li>
          <li class="home-current-beat is-protect">
            <span class="mark mark-protect" aria-hidden="true" />
            <span>Calls show how media is protected — never guessed.</span>
          </li>
        </ul>
      </section>

      <nav
        id="operators"
        class="r-wrap home-shelf"
        data-home-shelf
        aria-label="Operators and power users"
      >
        <p class="home-shelf-label">Operators and power users</p>
        <ul class="home-shelf-list">
          <li><a href="/status/">Status</a></li>
          <li><a href="/stats/">Stats</a></li>
          <li><a href="/roadmap/">Roadmap</a></li>
          <li><a href="/about/">About</a></li>
          <li><a href="/download/">Download</a></li>
          <li><a href="/invite/?join=%23root">Invite</a></li>
        </ul>
      </nav>

      <footer class="r-wrap home-footer">
        <div class="home-footer-brand">
          <span aria-hidden="true"><Mascot variant="mark" /></span>
          <span>Onyx</span>
        </div>
        <p class="home-footer-lede">
          Open rooms, local continuity, and security state that says what is true.
        </p>
        <nav aria-label="Standards and product information">
          <a href="/accessibility/">Accessibility</a>
          <a href="/glossary/">Glossary</a>
          <a href="/about/">About</a>
        </nav>
        <small class="home-footer-credit">Powered by Onyx Server · 2026</small>
      </footer>
    </main>
  );
}
