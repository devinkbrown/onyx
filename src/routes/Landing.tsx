// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
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
import { PublicFooter } from './PublicFooter';

/**
 * Onyx public homepage — Deep Current living-room / studio front door.
 * Contract: docs/PUBLIC_COMPANY_SITE.md
 * Proof order: browser entry → Rooms/Messages/Calls/Continuity → live
 * telemetry → audience paths → Trust/Technology evidence.
 * Open Onyx is the only primary CTA. Desktop downloads stay gated.
 */
export default function Landing() {
  setPageMeta(
    'Onyx — talk, stream, and stay with your people',
    'Onyx is a public communication service for communities, creators, gaming crews, organizations, and power users. Open in the browser now; install as a PWA from a supporting browser. Native desktop downloads stay gated. Powered by Onyx Server.',
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
  const feedState = createMemo(() => publicMeshFeedState(status.latest, nowMs()));
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
    <main class="r r-landing">
      {/* ── mineral atmosphere: depth · glass tide · soft signal ── */}
      <div class="r-ground" aria-hidden="true" />
      <div class="r-flecks" aria-hidden="true" />
      <svg class="r-veins" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
        <path class="flow" d="M-40 120 C 280 60, 420 280, 720 220 S 1180 120, 1500 240" />
        <path class="flow" d="M-40 540 C 320 640, 560 420, 860 520 S 1240 660, 1520 560" />
        <path d="M-40 760 C 360 700, 700 860, 1040 760 S 1320 700, 1520 800" />
        <circle class="node" cx="720" cy="220" r="3" />
        <circle class="node" cx="860" cy="520" r="3" />
        <circle class="node" cx="1040" cy="760" r="2.5" />
      </svg>
      <div class="r-grain" aria-hidden="true" />

      {/* ── top bar ── */}
      <header class="r-status" role="banner">
        <a class="brand" href="/" aria-label="Onyx home">
          {/* Decorative mark: parent link owns the concise accessible name so
              embedded mascot <style> CSS never pollutes the role name. */}
          <span class="brand-mark" aria-hidden="true">
            <Mascot variant="mark" />
          </span>
          <span class="brand-wordmark" aria-hidden="true">ONYX</span>
        </a>
        <nav aria-label="Primary">
          <a class="hideable" href="#product">Product</a>
          <a class="hideable" href="#live">Live</a>
          <a class="hideable" href="#audience">Audiences</a>
          <a class="hideable" href="#start">Start</a>
          <a class="hideable" href="/stats/">Stats</a>
          <a class="hideable" href="/status/">Status</a>
          <a class="hideable" href="/roadmap/">Roadmap</a>
          <a class="hideable" href="/about/">About</a>
          <a class="hideable" href="/invite/?join=%23root">Invite</a>
          <span class="live hideable" data-feed-state={feedState()}>
            <i aria-hidden="true" />{publicMeshFeedLabel(feedState())}
          </span>
          <a class="enter" href="/app/">Open Onyx</a>
        </nav>
      </header>

      {/* ── 1. immediate browser entry ── */}
      <section class="r-wrap r-hero" aria-labelledby="hero-heading">
        <div class="r-hero-grid">
          <div class="r-hero-copy">
            <p class="r-kicker">public communication · powered by Onyx Server</p>
            <h1 id="hero-heading">
              Your rooms.
              <br />
              <span class="gold">Your people.</span>
              <br />
              Right here.
            </h1>
            <p class="serif-sub">
              Onyx is a public place to talk, gather, and stream together —
              one product for communities, gaming crews, creators, organizations,
              friends, and power users.
            </p>
            <p class="sub">
              Open text rooms and private messages, hop into voice and video,
              share a screen for a stage or a stream, keep continuity on your device,
              carry a name that stays yours, and see the protection state of every call —
              never guessed, never overstated.
            </p>
            <div class="r-cta">
              <a class="r-btn primary" href="/app/">Open Onyx &rarr;</a>
              <a class="r-btn ghost" href="#product">See what you get</a>
            </div>
            <p class="r-desktop-note">
              <strong>Browser now.</strong> The full client opens in your browser —
              no install required. On a supporting browser you can also install Onyx as a
              PWA. Native desktop downloads remain gated until installers, signing,
              updater, checksums, and release gates are green.
            </p>
            <div class="r-ticker" aria-label="Product highlights">
              <span><b>rooms</b> · spaces that stay open</span>
              <span><b>messages</b> · DMs without a second app</span>
              <span><b>calls</b> · voice · video · screen</span>
              <span><b>continuity</b> · resume · local history</span>
            </div>
          </div>

          {/* Signature: honest product tableau — labeled preview, not live content */}
          <aside class="r-tableau" aria-labelledby="tableau-label">
            <p class="r-tableau-label" id="tableau-label">
              <span class="r-tableau-badge">Product preview</span>
              Not live content — a picture of the room you open.
            </p>
            <div class="r-tableau-shell" role="img" aria-label="Preview of an Onyx room with chat, a stream stage, and visible connection and protection receipts">
              <div class="r-tableau-chrome">
                <span class="r-tableau-dots" aria-hidden="true"><i /><i /><i /></span>
                <span class="r-tableau-title">#creator-night · studio floor</span>
                <span class="r-tableau-chip r-tableau-chip--link">Connected</span>
              </div>
              <div class="r-tableau-body">
                <div class="r-tableau-stage">
                  <div class="r-tableau-stage-glow" aria-hidden="true" />
                  <div class="r-tableau-stage-meta">
                    <span class="r-tableau-live">Stage</span>
                    <span>Screen share · preview</span>
                  </div>
                  <p class="r-tableau-stage-title">Tonight&apos;s stream board</p>
                  <p class="r-tableau-stage-sub">Voice on · camera optional · share when you are ready</p>
                  <div class="r-tableau-receipts">
                    <span class="r-receipt r-receipt--ok">Connection · live</span>
                    <span class="r-receipt r-receipt--cyan">Media · protected in transit</span>
                    <span class="r-receipt r-receipt--coral">Protection state · shown, not assumed</span>
                  </div>
                </div>
                <div class="r-tableau-chat">
                  <div class="r-tableau-line">
                    <span class="who coral">mira</span>
                    <span class="msg">Dropping into voice — screen is up when you are.</span>
                  </div>
                  <div class="r-tableau-line">
                    <span class="who cyan">devon</span>
                    <span class="msg">History is local on my machine; session picks up where I left off.</span>
                  </div>
                  <div class="r-tableau-line">
                    <span class="who pearl">you</span>
                    <span class="msg">Open Onyx, say hi, join the stage.</span>
                  </div>
                  <div class="r-tableau-composer" aria-hidden="true">
                    <span>Message #creator-night</span>
                    <span class="send">Send</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="r-tableau-mascot" aria-hidden="true">
              <Mascot variant="mark" />
            </div>
          </aside>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── 2. real product pillars: Rooms / Messages / Calls / Continuity ── */}
      <section id="product" class="r-wrap r-section r-product" aria-labelledby="product-heading">
        <span class="r-eyebrow">what you open</span>
        <h2 class="r-title" id="product-heading">Rooms. Messages.<br />Calls. Continuity.</h2>
        <p class="r-lede">
          Four pillars, one client. Everything below is language for people, not protocol names.
          The same surface serves a quiet friend chat, a gaming crew, a community stage, or a working group.
        </p>
        <div class="r-board">
          <article class="r-card">
            <span class="k">rooms</span>
            <h3>Text rooms that stay open</h3>
            <p>Shared spaces for communities and crews. Topics, presence, and conversation that wait for you between visits.</p>
          </article>
          <article class="r-card">
            <span class="k">messages</span>
            <h3>Direct messages</h3>
            <p>Side conversations without a second app. Same account, same people, quieter corner.</p>
          </article>
          <article class="r-card">
            <span class="k">calls</span>
            <h3>Voice, video, and screen</h3>
            <p>Talk face to face when typing is not enough — hangouts, co-working, after-stream debriefs, or a shared stage.</p>
          </article>
          <article class="r-card">
            <span class="k">continuity</span>
            <h3>Continuity on your device</h3>
            <p>
              Session resume when you reconnect, local history in a device-side vault,
              and on-device import so conversation memory stays with you — not rented as a cloud feed.
            </p>
          </article>
          <article class="r-card">
            <span class="k">identity</span>
            <h3>A name that travels</h3>
            <p>Register once and carry the same identity across doors. Portable by design — not locked to one browser tab.</p>
          </article>
          <article class="r-card">
            <span class="k">protection</span>
            <h3>Visible protection state</h3>
            <p>Calls show how media is protected. Onyx never paints a lock that overstates what is actually on the path.</p>
          </article>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── 3. live telemetry ── */}
      <section id="live" class="r-wrap r-section r-live" aria-labelledby="live-heading">
        <div class="r-live-head">
          <div>
            <span class="r-eyebrow">live network</span>
            <h2 class="r-title" id="live-heading">Public telemetry,<br />not a marketing number</h2>
          </div>
          <a class="r-live-link" href="/status/">Open status</a>
        </div>
        <p class="r-lede">
          Real public feeds power this page. When a feed is still loading, stale, or incomplete,
          Onyx says so — no invented online counts, no fake “everyone is here” banners.
        </p>
        <div class="r-live-grid" aria-label="Live network summary">
          <article class="r-live-tile">
            <span class="k">network</span>
            <strong data-state={meshState()}>{meshState()}</strong>
            <p>
              <Show when={status.latest} fallback="waiting for the public status feed">
                {(s) => !s().peers_complete
                  ? 'peer feed incomplete'
                  : s().mesh.partitioned
                  ? `${s().mesh.components} visible network components`
                  : `${s().peers.filter((p) => p.up).length}/${s().peers.length} peer links up`}
              </Show>
            </p>
          </article>
          <article class="r-live-tile">
            <span class="k">people</span>
            <strong>
              <Show when={stats.latest} fallback="--">
                {(data) => data().users_online.toLocaleString('en-US')}
              </Show>
            </strong>
            <p>online from the public stats feed</p>
          </article>
          <article class="r-live-tile">
            <span class="k">rooms</span>
            <strong>
              <Show when={stats.latest} fallback="--">
                {(data) => data().channels.length.toLocaleString('en-US')}
              </Show>
            </strong>
            <p>{stats.latest?.channels_complete ? 'tracked in the public index' : 'partial public index'}</p>
          </article>
          <article class="r-live-tile">
            <span class="k">busiest</span>
            <strong>
              <Show when={busiest()} fallback="#root">
                {(room) => room().channel}
              </Show>
            </strong>
            <p>
              <Show when={status.latest} fallback="updated by the stats cadence">
                {(s) => `${s().node || s().network || 'node'} up ${formatDuration(s().uptime_seconds)}`}
              </Show>
            </p>
          </article>
        </div>
        <div class="r-cta">
          <a class="r-btn ghost" href="/stats/">Open channel stats &rarr;</a>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── 4. audience proof paths (same client, no sector skins) ── */}
      <section id="audience" class="r-wrap r-section r-audience" aria-labelledby="audience-heading">
        <span class="r-eyebrow">who it is for</span>
        <h2 class="r-title" id="audience-heading">One product.<br />Many proof paths.</h2>
        <p class="r-lede">
          Same Deep Current client for everyone — no gaming skin, no enterprise skin.
          Each path leads with the proofs that audience actually needs.
        </p>
        <div class="r-stats">
          <div class="r-stat">
            <span class="n">General public</span>
            <span class="l">Open in the browser, join a room, say hello — no install wall.</span>
          </div>
          <div class="r-stat">
            <span class="n">Gaming &amp; creators</span>
            <span class="l">Persistent rooms, live calls, voice and video, screen stages, receipts you can see.</span>
          </div>
          <div class="r-stat">
            <span class="n">Communities</span>
            <span class="l">Rooms that stay open for the people who keep showing up — invites included.</span>
          </div>
          <div class="r-stat">
            <span class="n">Organizations</span>
            <span class="l">The same rooms, messages, and calls for working groups — honest state, no pretend admin suite.</span>
          </div>
          <div class="r-stat">
            <span class="n">Developers</span>
            <span class="l">Open wire under the glass — IRCv3 and IRCX over WebSocket, powered by Onyx Server.</span>
          </div>
          <div class="r-stat">
            <span class="n">Press &amp; procurement</span>
            <span class="l">Live status, a claim ledger on the roadmap, and protection language that refuses to invent compliance.</span>
          </div>
          <div class="r-stat">
            <span class="n">Power users</span>
            <span class="l">Continuity, local history, on-device import, and a name you control — not a black box.</span>
          </div>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── start ── */}
      <section id="start" class="r-wrap r-section r-join" aria-labelledby="start-heading">
        <span class="r-eyebrow">start here</span>
        <h2 class="r-title" id="start-heading">Open Onyx.<br />Say hello.</h2>
        <div class="grid2">
          <ol class="r-steps">
            <li>
              <span class="idx">01</span>
              <div><b>Open Onyx in the browser.</b> No install required to begin.</div>
            </li>
            <li>
              <span class="idx">02</span>
              <div><b>Pick a name.</b> Drop in as a guest or register so the identity stays yours.</div>
            </li>
            <li>
              <span class="idx">03</span>
              <div><b>Join a room or a call.</b> Text, DM, voice, video, or screen share — with protection state visible.</div>
            </li>
          </ol>
          <div class="term" aria-hidden="true">
            <div class="bar">
              <span class="lights"><i /><i /><i /></span>
              <span>onyx — first open</span>
            </div>
            <div class="body">
              <div><span class="o">welcome —</span> <span class="c">finding a quiet door …</span></div>
              <div><span class="o">you joined</span> <span class="h">#root</span></div>
              <div><span class="o">&lt;you&gt;</span> <span class="c">hello from the living room</span></div>
              <div><span class="o">receipt</span> <span class="p">connection live · protection shown</span> <span class="cursor">0</span></div>
            </div>
          </div>
        </div>
        <div class="r-cta">
          <a class="r-btn primary" href="/app/">Open Onyx &rarr;</a>
          <a class="r-btn ghost" href="/invite/?join=%23root">Invite someone</a>
          <a class="r-btn ghost" href="/about/">How it works</a>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── 5. Trust / Technology evidence (protocol language allowed here) ── */}
      <section id="proof" class="r-wrap r-section r-built" aria-labelledby="proof-heading">
        <span class="r-eyebrow">trust &amp; technology</span>
        <h2 class="r-title" id="proof-heading">Quietly serious<br />under the glass</h2>
        <p class="r-lede">
          You do not need this section to use Onyx. It is here so claims stay accountable.
          Powered by Onyx Server — the engine behind the public service.
          Dedicated Trust, Technology, Download, and legal pages stay gated until they carry real content.
        </p>
        <div class="r-strip">
          <div class="r-spec">
            <span class="t">open wire</span>
            <p>IRCv3 + IRCX over WebSocket. Onyx is one client door; other clients can speak the same network language.</p>
          </div>
          <div class="r-spec">
            <span class="t">honest media state</span>
            <p>Voice, video, and screen share show hop protection vs stronger media encryption when it applies. No decorative padlock for weaker paths.</p>
          </div>
          <div class="r-spec">
            <span class="t">local-first memory</span>
            <p>Device-side history vault with bounded retention — conversation memory is not rented back to you as a cloud feed.</p>
          </div>
          <div class="r-spec">
            <span class="t">self-selecting nodes</span>
            <p>The client prefers a responsive public node; when one is quiet, another can take the load without you hand-picking a server.</p>
          </div>
        </div>
        <div class="r-cta">
          <a class="r-btn ghost" href="/status/">Public status &rarr;</a>
          <a class="r-btn ghost" href="/roadmap/">Read the roadmap &rarr;</a>
          <a class="r-btn ghost" href="/about/">Full technical about &rarr;</a>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
