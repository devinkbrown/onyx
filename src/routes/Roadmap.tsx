// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import { For } from 'solid-js';
import { Mascot } from '@/components/brand/Mascot';
import { setPageMeta } from './pageMeta';
import { PublicFooter } from './PublicFooter';

type Phase = {
  phase: string;
  title: string;
  state: 'complete' | 'active' | 'planned';
  date: string;
  summary: string;
  items: string[];
};

const phases: Phase[] = [
  {
    phase: 'Phase 1',
    title: 'Memory',
    state: 'complete',
    date: '2026-07-02',
    summary: 'The client remembers locally before the network answers.',
    items: ['Local history vault', 'Time travel from stats', 'Vault-backed search'],
  },
  {
    phase: 'Phase 2',
    title: 'Reach',
    state: 'complete',
    date: '2026-07-02',
    summary: 'The tab can close without dropping the thread of a conversation.',
    items: ['Web push lifecycle', 'Offline outbox', 'Reconnect handoff'],
  },
  {
    phase: 'Phase 3',
    title: 'Privacy',
    state: 'complete',
    date: '2026-07-16',
    summary: 'DMs, room policies, and account key surfaces keep private state out of durable replay while exposing stable, verifiable device identity hooks.',
    items: ['Client-encrypted DMs', 'Onyx Server E2EE capability', 'Encrypted message tags', 'Channel encryption policy', 'Account device-key publishing', 'Stable device-key identity', 'Key transparency status', 'Ephemeral room TTL', 'Ciphertext-only vault/search'],
  },
  {
    phase: 'Phase 4',
    title: 'Presence',
    state: 'complete',
    date: '2026-07-03',
    summary: 'Rooms gained visible rhythm, shared pins, and scheduled voice places.',
    items: ['Pinned messages', 'Presence heatline', 'Scheduled room events'],
  },
  {
    phase: 'Phase 5',
    title: 'Operations',
    state: 'complete',
    date: '2026-07-20',
    summary: 'The public site shows the live network and a released self-host path instead of asking visitors to trust prose.',
    items: ['Mesh status page', 'Live stats graphs', 'Backup readiness', 'Released server binary', 'Unified self-host route'],
  },
  {
    phase: 'Phase 6',
    title: 'Time-native',
    state: 'active',
    date: '2026-07-16',
    summary: 'Home now brings followed activity, scheduled rooms, local memory, quiet rooms, return recaps, a global Search Center with saved queries and archived-result hydration, room rhythm, review handoffs, reader memory, transcript jumps, command grammar, and J/K navigation into view.',
    items: ['Followed catch-up', 'Scheduled events on Home', 'Vault memory previews', 'Quiet room activity', 'Home return recaps', 'Global Search Center', 'Saved search queries', 'Archived-result hydration', 'Spotlight handoff', 'Room rhythm heatlines', 'Event context', 'Review from start', 'Catch-up review history', 'Review text search', 'Active-target vault search', 'Channel directory dedupe', 'Reader digest notes', 'Shareable moment links', 'Reader memory context', 'Moment search handoff', 'Reader transcript jumps', 'Digest review handoff', 'Review completion', 'Reader return Home', 'Reviewed span recall', 'Hydrated context trails', 'Vault context trails', 'Vault anchor jumps', 'Command grammar examples', 'Selected-command status', 'Join/open aliases', 'Goto-at jump', 'Targeted at jump', 'Search/find grammar', 'Home command', 'Preferences command', 'Shortcuts command', 'Reader command', 'Density commands', 'Width commands', 'Motion commands', 'Timed mute', 'Quiet on/off', 'J/K transcript nav'],
  },
  {
    phase: 'Phase 7',
    title: 'Washi',
    state: 'active',
    date: '2026-07-11',
    summary: 'Accessibility is now a public ledger and an in-client audit surface with dense-panel, Home catch-up, message-search, notification-center, channel-browser, account-panel, channel-sidebar, keyboard-shortcuts including transcript navigation, command-palette, pinned-messages, theme-import, thread-panel, voice-settings, call-overlay, message-action, member-list, notification-control, time-scrubber pass evidence, reduced-transparency controls, and user/OS high-contrast variants.',
    items: ['Public accessibility ledger', 'Client access audit', 'Motion controls', 'Dense-panel evidence', 'Home access evidence', 'Search access evidence', 'Inbox access evidence', 'Directory access evidence', 'Account access evidence', 'Sidebar access evidence', 'Shortcuts access evidence', 'Command palette evidence', 'Pins access evidence', 'Theme import evidence', 'Thread access evidence', 'Voice settings evidence', 'Call overlay evidence', 'Message action evidence', 'Member list evidence', 'Notification control evidence', 'Time scrubber evidence', 'Reduced transparency control', 'High contrast control', 'Prefers-contrast variant', 'Message menu keyboard nav', 'Modal focus recapture'],
  },
  {
    phase: 'Phase 8',
    title: 'Torii entry',
    state: 'active',
    date: '2026-07-16',
    summary: 'Fold the master roadmap product-entry work into Onyx and the main site: rich invite previews, topic and reader handoff, instant guest entry, native onboarding, safe remembered-identity switching, install guidance, release checks, and a stricter public glossary.',
    items: ['Rich invite route', 'Invite Open Graph metadata', 'Instant guest identity', 'Invite moment handoff', 'Invite topic metadata', 'Invite reader metadata', 'Copyable canonical invite', 'Invite first-run runway', 'App topic handoff', 'App reader handoff', 'Native onboarding forms', 'Remembered identity switcher', 'Capability-labelled sign-in', 'Account claim flow', 'In-session guest claim prompt', 'Client brand unification', 'Install guide', 'Install release checks', 'Wrapper link contract', 'Generated public sitemap', 'Public glossary', 'Brand glossary cleanup'],
  },
  {
    phase: 'Phase 9',
    title: 'Venue model',
    state: 'active',
    date: '2026-07-09',
    summary: 'Keep building the time-native venue: named conversations, calm notifications, quiet boost collection, presence-as-place, and one responsive information model across desktop and mobile.',
    items: ['Named conversations', 'Forum projection', 'Forum topic follow controls', 'Pinned forum projection', 'Calm notification presets', 'Compact calm preset control', 'Quiet boosts', 'Quiet boost Home digest', 'Presence-as-place header', 'Scheduled event header chip', 'One-canvas responsive projection', 'Mobile Home tab', 'Touch-sized Home review cards', 'Mobile Connect front door', 'Mobile thumb bar polish', 'Mobile overlay clearance', 'Mobile website nav polish'],
  },
  {
    phase: 'Phase 10',
    title: 'Atmosphere',
    state: 'active',
    date: '2026-07-09',
    summary: 'Consolidate the background system and finish mechanically derived accessibility variants, including renderer-level Animated/Still/Off controls, bounded room identity, mobile Appearance entry, reduced transparency, contrast, forced-colors, and mobile drawer focus semantics.',
    items: ['Background consolidation', 'Renderer-level scene motion', 'Animated mode', 'Still static render', 'Off skips renderer', 'Scene reset defaults', 'Theme-reactive identity', 'Bounded room accent', 'Room identity tokens', 'Mobile appearance entry', 'Contrast-locked room chrome', 'Contrast variants', 'Reduced-transparency variants', 'User reduced-transparency control', 'Public high-contrast ledger', 'Public reduced-transparency ledger', 'Forced-colors audit notes', 'Mobile drawer focus management', 'Mobile drawer focus trap', 'Deterministic time scrubber jumps'],
  },
  {
    phase: 'Phase 11',
    title: 'Media presence',
    state: 'active',
    date: '2026-07-20',
    summary: 'Voice, video, and screenshare now fail closed through client-held group encryption with authenticated routing context, membership re-keying, replay rejection, and a padlock driven only by negotiated engine state. Multi-node media cascading and a human-comparable privacy code remain active work.',
    items: ['Voice-room-as-place UI', 'Voice room status chip', 'Stage context', 'Spatial audio controls', 'Spatial audio availability state', 'Screenshare controls', 'Watch-together surface', 'Watch-together room activity'],
  },
  {
    phase: 'Phase 12',
    title: 'Apps',
    state: 'active',
    date: '2026-07-09',
    summary: 'Prepare the client and site for structured integrations: Block-Kit-lite rendering, safe message controls, reviewed extension action manifests, a constrained extension surface, and migration/importer paths.',
    items: ['Block-Kit-lite renderer', 'Block-Kit-lite message controls', 'Safe value-copy controls', 'No command execution', 'Client extension surface', 'Capability-scoped extension actions', 'Extension action manifest import', 'Extension action manifest export', 'Importer path', 'Reviewed portable import', 'Incoming webhook migration', 'Server snapshot imports', 'IRC-log-to-vault import', 'Bridge status surface', 'Integrations page'],
  },
  {
    phase: 'Phase 13',
    title: 'Local intelligence',
    state: 'active',
    date: '2026-07-20',
    summary: 'Local-first intelligence is active without becoming the front door: provenance chrome, vault recall, reviewed catch-up, caption controls, loopback-only embeddings, browser-local translation readiness, and agent-safe contracts.',
    items: ['AI provenance chrome', 'Search provenance labels', 'Digest provenance labels', 'Caption provenance labels', 'Caption transcript copy', 'Extension action audit', 'Digest recall terms', 'Digest review history', 'Search recall pivots', 'Vault RAG', 'Semantic recall', 'Local catch-up', 'Local captions', 'Local translation', 'Local language tools', 'Browser translator readiness', 'No external translation endpoint', 'Agent-safe public contract', 'Agent safety page', 'Provenance labels'],
  },
  {
    phase: 'Phase 14',
    title: 'Roaming',
    state: 'active',
    date: '2026-07-16',
    summary: 'Generalize offline-first behavior into read, compose, search, bounded device-memory retention, PWA install clarity, moderation drafts, update recovery, and portable local-state transfer including saved searches and retention policy.',
    items: ['TravelTo vault fallback', 'Active-target vault search', 'Immediate vault-result navigation', 'Offline reviewed recall', 'Offline search gating', 'Local-memory mode status', 'Device-memory retention controls', 'Bounded vault pruning', 'Outbox count status', 'Offline draft counts', 'Offline topic drafts', 'Installable manifest', 'PWA shortcuts', 'Install screenshots', 'Launch handler', 'Installed app readiness', 'Service worker readiness', 'App shell refresh action', 'Wrapper readiness matrix', 'Wrapper contract', 'Portable vault export', 'Portable vault import', 'Reviewed catch-up transfer', 'Room draft transfer', 'Topic draft transfer', 'Followed conversation transfer', 'Saved search transfer', 'Retention policy transfer', 'Account handoff transfer', 'Preference handoff transfer', 'Full offline-first UX', 'Desktop packaging path'],
  },
  {
    phase: 'Phase 15',
    title: 'Continuity',
    state: 'active',
    date: '2026-07-20',
    summary: 'Reusable certificate sessions, exact message routing, immediate rosters, and negotiated media now survive the two-node mesh; user-visible device control is the next boundary.',
    items: ['Certificate session resume', 'Multi-attachment message convergence', 'Immediate authoritative roster', 'No repeated operator-mode churn', 'Explicit WebSocket media protocol', 'Bounded binary transport', 'Helix WebSocket continuity', 'Sessions and devices list', 'Remote session revoke', 'Recovery codes next'],
  },
];

const completePhaseCount = phases.filter((phase) => phase.state === 'complete').length;

export default function RoadmapRoute() {
  setPageMeta(
    'Onyx roadmap — what shipped and what is next',
    'Track the public Onyx roadmap across memory, reach, privacy, presence, operations, and the time-native client work next.',
    '/roadmap/',
  );
  return (
    <main class="r data-page roadmap-page">
      <div class="r-ground" aria-hidden="true" />
      <div class="r-flecks" aria-hidden="true" />
      <svg class="r-veins" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
        <path class="flow" d="M-40 130 C 250 40, 460 290, 750 210 S 1170 130, 1500 260" />
        <path class="flow" d="M-40 570 C 330 650, 600 430, 900 540 S 1240 670, 1520 560" />
        <path d="M-40 790 C 380 710, 720 880, 1060 770 S 1340 710, 1540 830" />
      </svg>
      <div class="r-grain" aria-hidden="true" />

      <header class="r-status" role="banner">
        <a class="brand" href="/" aria-label="Onyx home">
          <Mascot variant="mark" />ONYX
        </a>
        <nav aria-label="Primary">
          <a class="hideable" href="/">Home</a>
          <a class="hideable" href="/stats/">Stats</a>
          <a class="hideable" href="/status/">Status</a>
          <a class="hideable" href="/roadmap/" aria-current="page">Roadmap</a>
          <a class="hideable" href="/about/">About</a>
          <a class="hideable" href="/invite/?join=%23root">Invite</a>
          <a class="enter" href="/app/">Open Onyx</a>
        </nav>
      </header>

      <section class="r-wrap data-hero" aria-labelledby="roadmap-heading">
        <p class="r-kicker">roadmap</p>
        <h1 id="roadmap-heading">What shipped,<br /><span class="gold">what is next</span></h1>
        <p class="sub">
          A public ledger of the network: what is dependable today, what is being
          sharpened now, and where a new person can feel the difference next.
        </p>
        <div class="data-summary">
          <div class="data-metric">
            <span class="label">complete phases</span>
            <span class="value">{completePhaseCount}</span>
            <span class="note">public milestones closed</span>
          </div>
          <div class="data-metric">
            <span class="label">in motion</span>
            <span class="value">Devices</span>
            <span class="note">session control, recovery, complete Cadence calls</span>
          </div>
          <div class="data-metric">
            <span class="label">site role</span>
            <span class="value">Live</span>
            <span class="note">telemetry is part of the front door</span>
          </div>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      <section class="r-wrap r-section" aria-labelledby="phase-heading">
        <span class="r-eyebrow">phases</span>
        <h2 class="r-title" id="phase-heading">The build<br />so far</h2>
        <div class="roadmap-track">
          <For each={phases}>
            {(phase) => (
              <article class="roadmap-phase" data-state={phase.state}>
                <div class="roadmap-phase__rail" aria-hidden="true">
                  <span />
                </div>
                <div class="roadmap-phase__body">
                  <div class="roadmap-phase__meta">
                    <span>{phase.phase}</span>
                    <span>{phase.date}</span>
                  </div>
                  <h3>{phase.title}</h3>
                  <p>{phase.summary}</p>
                  <ul>
                    <For each={phase.items}>
                      {(item) => <li>{item}</li>}
                    </For>
                  </ul>
                </div>
              </article>
            )}
          </For>
        </div>
      </section>

      <section class="r-wrap r-section data-grid" aria-label="Roadmap next steps">
        <article class="data-card">
          <span class="label">now</span>
          <h2>The next job is user-controlled continuity</h2>
          <p>
            Sessions now resume across the mesh and every attachment sees the same
            accepted messages. The active program makes that continuity inspectable
            and revocable, then completes the Cadence call roster and control path
            without weakening encrypted DMs or the open IRC wire.
          </p>
        </article>
        <aside class="data-card">
          <span class="label">open surfaces</span>
          <h3>Keep tightening</h3>
          <div class="data-list data-list--compact">
            <div class="data-row"><div><strong>Sessions & devices</strong><span>List every attached device, revoke it remotely, and add recovery codes without a fake local-only control.</span></div></div>
            <div class="data-row"><div><strong>Cadence calls</strong><span>Finish participant state, mute/leave/error controls, and two-client media delivery while keeping chat visible.</span></div></div>
            <div class="data-row"><div><strong>Room administration</strong><span>Expose roles, encryption policy, and history policy through ACCESS and PROP.</span></div></div>
            <div class="data-row"><div><strong>Closed-tab reach</strong><span>Prove DM push recovery without exposing encrypted message bodies.</span></div></div>
            <div class="data-row"><div><strong>Open-wire proof</strong><span>Publish the Halloy capability matrix against both public nodes.</span></div></div>
            <div class="data-row"><div><strong>Public contracts</strong><span><a href="/glossary/">Glossary</a>, <a href="/integrations/">integrations</a>, and <a href="/agents/">agent safety</a> remain the product boundary.</span></div></div>
          </div>
        </aside>
      </section>
      <PublicFooter />
    </main>
  );
}
