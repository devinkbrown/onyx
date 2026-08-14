// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './home.css';
import { createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js';
import { fetchStatsIndex } from '@/lib/stats/networkIndex';
import {
  fetchNetworkStatus,
  formatDuration,
  publicMeshFeedState,
} from '@/lib/stats/status';
import { ProofRail, type TruthState } from '@/ui/proof';
import { PublicFrame } from '@/ui/public';
import { PUBLIC_ROUTE_MANIFEST } from '@/ui/navigation/publicRouteManifest';
import { setPageMeta } from './pageMeta';
import { ProductPreview } from './ProductPreview';

const LANDING_SHELF_ITEMS = [
  [PUBLIC_ROUTE_MANIFEST[4]!.href, 'Status'],
  [PUBLIC_ROUTE_MANIFEST[9]!.href, 'Stats'],
  [PUBLIC_ROUTE_MANIFEST[10]!.href, 'Roadmap'],
  [PUBLIC_ROUTE_MANIFEST[1]!.href, 'About'],
  [PUBLIC_ROUTE_MANIFEST[2]!.href, 'Download'],
  [`${PUBLIC_ROUTE_MANIFEST[11]!.href}?join=%23root`, 'Invite'],
] as const;

/**
 * Onyx public homepage — Room Current threshold.
 * Contract: docs/PUBLIC_COMPANY_SITE.md
 * Proof order: browser entry → labeled Room Aperture → evidence rail →
 * capability current → operator shelf. One primary Open Onyx CTA.
 * Native artifacts remain a secondary, platform-neutral link at /download/.
 */
export default function Landing() {
  setPageMeta(
    'Onyx — a room for your people',
    'Open Onyx in your browser for rooms, messages, calls, and continuity on your device. Use the same client across desktop and mobile, or choose a native download.',
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
  const feedState = createMemo(() => (
    status.loading ? 'loading' : publicMeshFeedState(status.latest, nowMs())
  ));
  const proofState = createMemo<TruthState>(() => {
    switch (feedState()) {
      // A current report only confirms the report's own complete, non-partitioned
      // quorum observation. It is not an uptime or security assertion.
      case 'current': return 'verified';
      case 'degraded': return 'partial';
      case 'stale': return 'reconnecting';
      case 'future':
      case 'unknown': return 'unknown';
      case 'loading': return 'reconnecting';
      default: return 'unavailable';
    }
  });
  const proofDetail = createMemo(() => {
    switch (feedState()) {
      case 'current': return 'A current public mesh report confirms a complete, non-partitioned quorum observation.';
      case 'degraded': return 'The public mesh report is current, but its observation is incomplete or degraded.';
      case 'stale': return 'The last public mesh report is stale; a fresh observation is being awaited.';
      case 'future': return 'The public mesh report has a future timestamp, so it cannot support a current claim.';
      case 'unknown': return 'The public mesh report has no usable timestamp, so no current claim can be made.';
      case 'loading': return 'The public mesh report is still being requested.';
      default: return 'No public mesh report is available.';
    }
  });
  const meshState = createMemo(() => {
    switch (feedState()) {
      case 'current': return 'operational';
      case 'degraded': return 'degraded';
      case 'stale': return 'stale';
      case 'future': return 'time mismatch';
      case 'unknown': return 'undated';
      case 'loading': return 'listening';
      default: return 'unavailable';
    }
  });
  const peopleHint = createMemo(() => {
    if (stats.latest) return 'reported';
    return stats.loading ? 'waiting for stats' : 'no stats export';
  });
  const roomsHint = createMemo(() => {
    if (stats.latest) return stats.latest.channels_complete ? 'tracked' : 'partial';
    return stats.loading ? 'waiting' : 'no export';
  });
  const busyHint = createMemo(() => {
    const report = status.latest;
    if (report) return `up ${formatDuration(report.uptime_seconds)}`;
    return status.loading ? 'no status yet' : 'no status export';
  });

  return (
    <PublicFrame
      currentPath="/"
      mainLabel="Onyx home"
      context={(
        <p class="public-frame__current-line">
          <span class="public-frame__current-kicker">Threshold</span>
          <span aria-hidden="true">·</span>
          <span class="public-frame__current-label">Home</span>
        </p>
      )}
    >
      <div class="ui-root r r-landing home">
      {/* Thin mineral atmosphere — motion stacks gated in home.css reduced-motion */}
      <div class="r-ground home-ground" aria-hidden="true" />
      <div class="r-grain home-grain" aria-hidden="true" />

      <section class="r-wrap home-hero" aria-labelledby="hero-heading">
        <div class="home-hero-grid">
          <div class="home-hero-copy">
            <p class="home-kicker">Public communication · powered by Onyx Server</p>
            <h1 id="hero-heading" class="home-h1">Make room for the conversations that matter.</h1>
            <p class="home-lede">
              Onyx gives your group a clear place to talk, call, and return to on your own device.
            </p>
            <div class="home-cta-row">
              <a class="home-cta-primary" href="/app/">Open Onyx</a>
              <a class="home-secondary-link" href={PUBLIC_ROUTE_MANIFEST[2]!.href}>Downloads</a>
            </div>
            <p class="home-desktop-note">
              No install is required to begin. Use the same client on desktop or mobile;
              supporting browsers can also install Onyx as a PWA.
            </p>
          </div>

          <ProductPreview />
        </div>
      </section>

      <section
        class="r-wrap home-telemetry"
        aria-label="Public network telemetry"
      >
        <ProofRail
          state={proofState()}
          label="Public mesh report"
          detail={proofDetail()}
          evidenceType="Public status feed"
          ariaLabel="Public mesh report evidence"
        />
        <dl class="home-evidence-rail" data-home-evidence data-feed-state={feedState()}>
          <div class="home-evidence-item">
            <dt>Source</dt>
            <dd>Public status feed</dd>
          </div>
          <div class="home-evidence-item">
            <dt>State</dt>
            <dd><strong data-state={meshState()}>{meshState()}</strong></dd>
          </div>
          <div class="home-evidence-item home-evidence-scope">
            <dt>Scope</dt>
            <dd>{proofDetail()}</dd>
          </div>
          <div class="home-evidence-item home-evidence-action">
            <dt>Ledger</dt>
            <dd>
              <a class="home-telemetry-link" href={PUBLIC_ROUTE_MANIFEST[4]!.href}>Status</a>
            </dd>
          </div>
        </dl>
        <div class="home-telemetry-strip" data-feed-state={feedState()}>
          <span class="home-telemetry-item">
            <span class="k">network</span>
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
            <span class="hint">{peopleHint()}</span>
          </span>
          <span class="home-telemetry-sep" aria-hidden="true">·</span>
          <span class="home-telemetry-item">
            <span class="k">rooms</span>
            <strong>
              <Show when={stats.latest} fallback="--">
                {(data) => data().channels.length.toLocaleString('en-US')}
              </Show>
            </strong>
            <span class="hint">{roomsHint()}</span>
          </span>
          <span class="home-telemetry-sep" aria-hidden="true">·</span>
          <span class="home-telemetry-item">
            <span class="k">busy</span>
            <strong>
              <Show when={busiest()} fallback="--">
                {(room) => room().channel}
              </Show>
            </strong>
            <span class="hint">{busyHint()}</span>
          </span>
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
        <div class="home-capability-chapters" aria-label="Learn more about Onyx">
          <a href={PUBLIC_ROUTE_MANIFEST[1]!.href}><strong>How Onyx works</strong><span>Read the product overview</span></a>
          <a href={PUBLIC_ROUTE_MANIFEST[4]!.href}><strong>Network status</strong><span>See public operational evidence</span></a>
          <a href={PUBLIC_ROUTE_MANIFEST[2]!.href}><strong>Downloads</strong><span>Choose a native app or browser entry</span></a>
        </div>
      </section>

      <nav
        id="operators"
        class="r-wrap home-shelf"
        data-home-shelf
        aria-label="Operators and power users"
      >
        <p class="home-shelf-label">Operators and power users</p>
        <ul class="home-shelf-list">
          <For each={LANDING_SHELF_ITEMS}>
            {(item) => <li><a href={item[0]}>{item[1]}</a></li>}
          </For>
        </ul>
      </nav>

      </div>
    </PublicFrame>
  );
}
