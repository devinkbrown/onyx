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

/** Onyx launch site — deep-water dark luxury, community-first.
 *  Leads with people and place: a real IRC network you join, not a product you buy.
 *  Atmosphere is deep-water depth + flowing azure currents + drifting bioluminescence,
 *  all reduced-motion safe. The friendly water-dragon Mascot is the brand face. */
export default function Landing() {
  setPageMeta(
    'Onyx — open rooms on the mesh',
    'Onyx is the public front door to the mesh: open rooms, honest media security, live network stats, and a name that is yours.',
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
    <main class="r">
      {/* ── living atmosphere: depth · currents · bioluminescence · grain ── */}
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
          <Mascot variant="mark" />ONYX
        </a>
        <nav aria-label="Primary">
          <a class="hideable" href="#community">Who's here</a>
          <a class="hideable" href="#rooms">Rooms</a>
          <a class="hideable" href="/stats/">Stats</a>
          <a class="hideable" href="/status/">Status</a>
          <a class="hideable" href="/roadmap/">Roadmap</a>
          <a class="hideable" href="/about/">About</a>
          <a class="hideable" href="/invite/?join=%23root">Invite</a>
          <a class="hideable" href="#join">Join</a>
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
            <p class="r-kicker">a home on the open IRC mesh</p>
            <h1 id="hero-heading">Come live<br /><span class="gold">on the water</span></h1>
            <p class="serif-sub">A real network of real people — rooms that stay open, names that are yours, and a place no one can quietly take away.</p>
            <p class="sub">
              Onyx is the warm front door to the mesh: drop into a channel,
              find your people, talk in text or hop into voice and video with its
              exact security state shown.
              It's open, it's yours, and there's no account to rent and no ads to dodge.
            </p>
            <div class="r-cta">
              <a class="r-btn primary" href="/app/">Open Onyx &rarr;</a>
              <a class="r-btn ghost" href="#community">See who's around</a>
            </div>
            <div class="r-ticker">
              <span><b>open protocol</b> · IRCv3 + IRCX</span>
              <span><b>honest media state</b> · voice, video, screen</span>
              <span><b>yours to keep</b> · no ads, no rental</span>
            </div>
          </div>
          <div class="r-hero-art" aria-hidden="true">
            <Mascot variant="hero" />
          </div>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── live pulse from public feeds ── */}
      <section id="live" class="r-wrap r-section r-live" aria-labelledby="live-heading">
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
            <p>
              <Show when={status.latest} fallback="waiting for the public status feed">
                {(s) => !s().peers_complete
                  ? 'peer feed incomplete'
                  : s().mesh.partitioned
                  ? `${s().mesh.components} visible mesh components`
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
            <p>online across the mesh</p>
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

      {/* ── who's here / community ── */}
      <section id="community" class="r-wrap r-section r-community" aria-labelledby="community-heading">
        <span class="r-eyebrow">who's here</span>
        <h2 class="r-title" id="community-heading">People, not<br />a product</h2>
        <p class="r-lede">IRC was always a place — a town square that belonged to the people in it. Onyx keeps it that way. You're not a user in someone's database; you're a regular in a room.</p>
        <div class="r-stats">
          <div class="r-stat"><span class="n">#root</span><span class="l">the build channel — say hello, we're around</span></div>
          <div class="r-stat"><span class="n">always-on</span><span class="l">rooms stay open between visits, history and all</span></div>
          <div class="r-stat"><span class="n">your name</span><span class="l">register once, it's yours across every door</span></div>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── channels & rooms to explore ── */}
      <section id="rooms" class="r-wrap r-section r-rooms" aria-labelledby="rooms-heading">
        <span class="r-eyebrow">channels &amp; rooms</span>
        <h2 class="r-title" id="rooms-heading">Rooms to<br />wander into</h2>
        <p class="r-lede">Browse the directory and watch presence light up as people arrive. Text rooms, voice stages, screen-shares, quiet DMs — pick a current and drift in.</p>
        <div class="r-board">
          <article class="r-card">
            <span class="k">text</span>
            <h4>#root</h4>
            <p>Where the network lives day to day — questions, builds, late-night tangents. Open Onyx and you're in the conversation in seconds.</p>
            <a class="more" href="/app/">Drop in &rarr;</a>
          </article>
          <article class="r-card">
            <span class="k">voice</span>
            <h4>Voice stages</h4>
            <p>Hop into a room and just talk — spatial audio, screen-share, raise-hand. Media is protected in transit today, with its exact privacy state shown in the call.</p>
            <a class="more" href="/app/">Join a stage &rarr;</a>
          </article>
          <article class="r-card">
            <span class="k">browse</span>
            <h4>Room directory</h4>
            <p>The whole network in one list. Sort by what's busy, peek at topics, and follow the lights to wherever your people happen to be tonight.</p>
            <a class="more" href="/app/">Browse rooms &rarr;</a>
          </article>
          <article class="r-card">
            <span class="k">dm</span>
            <h4>Quiet corners</h4>
            <p>Private messages and small groups for the side conversations. Same network, same name, no separate app — just a calmer current.</p>
            <a class="more" href="/app/">Say hi &rarr;</a>
          </article>
        </div>
        <div class="r-cta"><a class="r-btn ghost" href="/stats/">See which rooms are busiest &rarr;</a></div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── join in seconds ── */}
      <section id="join" class="r-wrap r-section r-join" aria-labelledby="join-heading">
        <span class="r-eyebrow">join in seconds</span>
        <h2 class="r-title" id="join-heading">You're three<br />steps from hello</h2>
        <div class="grid2">
          <ol class="r-steps">
            <li><span class="idx">01</span><div><b>Open Onyx.</b> Nothing to install — it runs right here in your browser.</div></li>
            <li><span class="idx">02</span><div><b>Pick a name.</b> Claim a handle now, or register it so it's yours for good.</div></li>
            <li><span class="idx">03</span><div><b>Say hi in #root.</b> You're on the wire, in the room, part of the network.</div></li>
          </ol>
          <div class="term" aria-hidden="true">
            <div class="bar"><span class="lights"><i /><i /><i /></span><span>onyx — first connection</span></div>
            <div class="body">
              <div><span class="o">welcome aboard —</span> <span class="c">finding the nearest shore …</span></div>
              <div><span class="o">you joined</span> <span class="h">#root</span></div>
              <div><span class="o">&lt;you&gt;</span> <span class="c">hello :)</span></div>
              <div><span class="o">&lt;onyx&gt;</span> <span class="p">good to have you here.</span> <span class="cursor">▍</span></div>
            </div>
          </div>
        </div>
        <div class="r-cta"><a class="r-btn primary" href="/app/">Open Onyx &rarr;</a><a class="r-btn ghost" href="/about/">Read more</a></div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── the culture ── */}
      <section class="r-wrap r-section r-culture" aria-labelledby="culture-heading">
        <span class="r-eyebrow">the culture</span>
        <h2 class="r-title" id="culture-heading">Open. Yours.<br />No catch.</h2>
        <p class="r-lede">A network should feel like somewhere you live, not a service that tolerates you. Here's what that means in practice.</p>
        <div class="r-board three">
          <article class="r-card">
            <span class="k">open</span>
            <h4>Open to the bone</h4>
            <p>Plain IRCv3 + IRCX over WebSocket. Onyx is one way in — bring any client you like, or write your own straight from the spec.</p>
          </article>
          <article class="r-card">
            <span class="k">yours</span>
            <h4>Your name, your data</h4>
            <p>Register once and your identity follows you across every node. No silent shutdowns, no account you're only renting from a landlord.</p>
          </article>
          <article class="r-card">
            <span class="k">clean</span>
            <h4>No ads, no mining</h4>
            <p>Nobody's selling your attention. No trackers in the timeline, no engagement traps — just the room and the people in it.</p>
          </article>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── run your own ── */}
      <section class="r-wrap r-section r-sovereign" aria-labelledby="sovereign-heading">
        <div class="grid2 align">
          <div>
            <span class="r-eyebrow">run your own</span>
            <h2 class="r-title" id="sovereign-heading">Or raise<br />your own shore</h2>
            <p class="r-lede">Sovereignty is the whole point. Stand up your own Onyx Server node, peer it into the network, and own a slice of the mesh outright — your rooms, your rules, still part of the wider tide.</p>
            <div class="r-cta"><a class="r-btn ghost" href="/about/">How to run a node &rarr;</a></div>
          </div>
          <svg class="r-meshvis" viewBox="0 0 600 360" role="img" aria-label="Several nodes joined by azure currents into one connected network">
            <g fill="none" stroke="var(--lapis)" stroke-width="1.3">
              <path class="r-vein" d="M150 180 C 250 90, 350 270, 450 180" />
              <path class="r-vein" d="M150 180 C 260 200, 340 160, 450 180" opacity="0.6" />
              <path d="M150 180 C 230 300, 370 60, 450 180" opacity="0.35" />
            </g>
            <g stroke="var(--seam-faint)" stroke-width="1">
              <line x1="150" y1="180" x2="70" y2="90" /><line x1="150" y1="180" x2="60" y2="270" />
              <line x1="450" y1="180" x2="540" y2="90" /><line x1="450" y1="180" x2="535" y2="270" />
            </g>
            <circle cx="70" cy="90" r="3" fill="var(--paper-mute)" /><circle cx="60" cy="270" r="3" fill="var(--paper-mute)" />
            <circle cx="540" cy="90" r="3" fill="var(--paper-mute)" /><circle cx="535" cy="270" r="3" fill="var(--paper-mute)" />
            <circle cx="150" cy="180" r="13" fill="var(--ink)" stroke="var(--gold-bright)" stroke-width="2" />
            <circle cx="150" cy="180" r="5" fill="var(--gold-bright)" />
            <circle cx="450" cy="180" r="13" fill="var(--ink)" stroke="var(--lapis-bright)" stroke-width="2" />
            <circle cx="450" cy="180" r="5" fill="var(--lapis-bright)" />
          </svg>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── built right (concise tech strip) ── */}
      <section class="r-wrap r-section r-built" aria-labelledby="built-heading">
        <span class="r-eyebrow">built right</span>
        <h2 class="r-title" id="built-heading">Quietly serious<br />underneath</h2>
        <p class="r-lede">You never have to think about any of this — but it is why the network heals, media protection stays visible, and the lights stay on.</p>
        <div class="r-strip">
          <div class="r-spec"><span class="t">self-healing network</span><p>The client finds the nearest node by latency; when one drops, the rest close over the gap. You never pick a server.</p></div>
          <div class="r-spec"><span class="t">honest media security</span><p>Calls show whether they are protected to the server or end-to-end encrypted. Onyx never uses a padlock to overstate hop protection.</p></div>
          <div class="r-spec"><span class="t">real services, not bots</span><p>Register, ghost a stale session, manage a room — all real server commands, not a puppet sitting in your DMs.</p></div>
          <div class="r-spec"><span class="t">a client you can theme</span><p>A live Theme Studio and deep-water backgrounds, synced to your account across every device you sign in from.</p></div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
