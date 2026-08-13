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

const LANDING_SHELF_ITEMS = [
  [PUBLIC_ROUTE_MANIFEST[4]!.href, 'Status'],
  [PUBLIC_ROUTE_MANIFEST[9]!.href, 'Stats'],
  [PUBLIC_ROUTE_MANIFEST[10]!.href, 'Roadmap'],
  [PUBLIC_ROUTE_MANIFEST[1]!.href, 'About'],
  [PUBLIC_ROUTE_MANIFEST[2]!.href, 'Download'],
  [`${PUBLIC_ROUTE_MANIFEST[11]!.href}?join=%23root`, 'Invite'],
] as const;

/**
 * Onyx public homepage — mineral-night front door with a live-room aperture.
 * Contract: docs/PUBLIC_COMPANY_SITE.md
 * Proof order: browser entry → aperture preview → compact telemetry →
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
      default: return 'listening';
    }
  });

  return (
    <PublicFrame currentPath="/" mainLabel="Onyx home">
      <div class="ui-root r r-landing home">
      {/* Thin mineral atmosphere — motion stacks gated in home.css reduced-motion */}
      <div class="r-ground home-ground" aria-hidden="true" />
      <div class="r-grain home-grain" aria-hidden="true" />

      <section class="r-wrap home-hero" aria-labelledby="hero-heading">
        <div class="home-hero-grid">
          <div class="home-hero-copy">
            <p class="home-kicker">Public communication · powered by Onyx Server</p>
            <h1 id="hero-heading" class="home-h1">A room for your people.</h1>
            <p class="home-lede">
              Talk, call, and keep continuity on your device — open in the browser now.
            </p>
            <div class="home-cta-row">
              <a class="home-secondary-link" href={PUBLIC_ROUTE_MANIFEST[2]!.href}>
                Desktop downloads
              </a>
            </div>
            <p class="home-desktop-note">
              No install is required to begin. Use the same client on desktop or mobile;
              supporting browsers can also install Onyx as a PWA.
            </p>
          </div>

          <aside
            class="home-aperture"
            data-home-aperture
            aria-labelledby="aperture-label"
          >
            <p class="home-aperture-label" id="aperture-label">
              <span class="home-aperture-badge">Preview</span>
              Not live content — a quiet picture of the room you open.
            </p>
            <div
              class="home-aperture-shell"
              role="img"
              aria-label="Preview of an Onyx room with a call stage, chat, local continuity, and protection state — not live content"
            >
              <div class="home-aperture-chrome">
                <span class="home-aperture-dots" aria-hidden="true"><i /><i /><i /></span>
                <span class="home-aperture-title">#root · living room</span>
                <span class="home-aperture-chip">Preview</span>
              </div>

              <div class="home-aperture-body">
                {/* Miniature room rail — product silhouette, not a live list */}
                <div class="home-aperture-rail" aria-hidden="true">
                  <span class="home-aperture-rail-k">Rooms</span>
                  <span class="home-aperture-rail-item is-active">
                    <i class="mark mark-msg" />#root
                  </span>
                  <span class="home-aperture-rail-item">
                    <i class="mark mark-call" />#stage
                  </span>
                  <span class="home-aperture-rail-item mute">
                    <i class="mark mark-cont" />#ops
                  </span>
                </div>

                <div class="home-aperture-main">
                  <div class="home-aperture-stage">
                    <div class="home-aperture-stage-meta">
                      <span class="mark mark-call" aria-hidden="true" />
                      <span>Call · share</span>
                    </div>
                    <div class="home-aperture-tiles" aria-hidden="true">
                      <span class="home-aperture-tile is-you">you</span>
                      <span class="home-aperture-tile">mira</span>
                      <span class="home-aperture-tile is-idle">+</span>
                    </div>
                    <p class="home-aperture-stage-title">Voice when you need it</p>
                    <p class="home-aperture-stage-sub">Camera optional · share when ready</p>
                    <span class="home-aperture-protect">
                      <span class="mark mark-protect" aria-hidden="true" />
                      Protection shown, not assumed
                    </span>
                  </div>

                  <div class="home-aperture-chat">
                    <div class="home-aperture-line">
                      <span class="who">mira</span>
                      <span class="msg">Room is open — drop a message when you land.</span>
                    </div>
                    <div class="home-aperture-line">
                      <span class="who mute">you</span>
                      <span class="msg">History stays on this device.</span>
                    </div>
                    <div class="home-aperture-continuity" aria-hidden="true">
                      <span class="mark mark-cont" />
                      <span>Local continuity · resume when you return</span>
                    </div>
                    <div class="home-aperture-composer" aria-hidden="true">
                      <span>Message #root</span>
                      <span class="send">Send</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Category-spectrum current under the miniature */}
              <div class="home-aperture-spectrum" aria-hidden="true">
                <span class="home-spectrum-seg is-msg">message</span>
                <span class="home-spectrum-seg is-call">call</span>
                <span class="home-spectrum-seg is-cont">continuity</span>
                <span class="home-spectrum-seg is-protect">protection</span>
              </div>
            </div>
          </aside>
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
          <a class="home-telemetry-link" href={PUBLIC_ROUTE_MANIFEST[4]!.href}>Status</a>
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
          <For each={LANDING_SHELF_ITEMS}>
            {(item) => <li><a href={item[0]}>{item[1]}</a></li>}
          </For>
        </ul>
      </nav>

      </div>
    </PublicFrame>
  );
}
