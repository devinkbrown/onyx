import './landing.css';
import './data-pages.css';
import { For } from 'solid-js';
import { Mascot } from '@/components/brand/Mascot';
import { setPageMeta } from './pageMeta';

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
    date: '2026-07-02',
    summary: 'DMs and short-lived rooms keep private state out of durable replay.',
    items: ['Tsumugi-encrypted DMs', 'Ephemeral room TTL', 'Ciphertext-only vault/search'],
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
    state: 'active',
    date: 'in progress',
    summary: 'The public site now shows the network, not just describes it.',
    items: ['Mesh status page', 'Stats graphs', 'Backup readiness'],
  },
  {
    phase: 'Phase 6',
    title: 'Time-native',
    state: 'active',
    date: '2026-07-09',
    summary: 'Home now brings followed activity, scheduled rooms, local memory, quiet rooms, return recaps, room rhythm, review-from-start handoffs, review history, channel directory dedupe, review text search, active-target vault search, reader summaries, shareable moments, reader memory, search handoff, transcript jumps, digest review completion, reader return-home affordances, reviewed-span recall, hydrated context trails, vault context trails, vault anchor jumps, a 20-command palette grammar batch, and J/K transcript navigation into view.',
    items: ['Followed catch-up', 'Scheduled events on Home', 'Vault memory previews', 'Quiet room activity', 'Home return recaps', 'Spotlight handoff', 'Room rhythm heatlines', 'Event context', 'Review from start', 'Catch-up review history', 'Review text search', 'Active-target vault search', 'Channel directory dedupe', 'Reader digest notes', 'Shareable moment links', 'Reader memory context', 'Moment search handoff', 'Reader transcript jumps', 'Digest review handoff', 'Review completion', 'Reader return Home', 'Reviewed span recall', 'Hydrated context trails', 'Vault context trails', 'Vault anchor jumps', 'Command grammar examples', 'Selected-command status', 'Join/open aliases', 'Goto-at jump', 'Targeted at jump', 'Search/find grammar', 'Home command', 'Preferences command', 'Shortcuts command', 'Reader command', 'Density commands', 'Width commands', 'Motion commands', 'Timed mute', 'Quiet on/off', 'J/K transcript nav'],
  },
  {
    phase: 'Phase 7',
    title: 'Washi',
    state: 'active',
    date: '2026-07-09',
    summary: 'Accessibility is now a public ledger and an in-client audit surface with dense-panel, Home catch-up, message-search, notification-center, channel-browser, account-panel, channel-sidebar, keyboard-shortcuts including transcript navigation, command-palette, pinned-messages, theme-import, thread-panel, voice-settings, call-overlay, message-action, member-list, notification-control, and time-scrubber pass evidence.',
    items: ['Public accessibility ledger', 'Client access audit', 'Motion controls', 'Dense-panel evidence', 'Home access evidence', 'Search access evidence', 'Inbox access evidence', 'Directory access evidence', 'Account access evidence', 'Sidebar access evidence', 'Shortcuts access evidence', 'Command palette evidence', 'Pins access evidence', 'Theme import evidence', 'Thread access evidence', 'Voice settings evidence', 'Call overlay evidence', 'Message action evidence', 'Member list evidence', 'Notification control evidence', 'Time scrubber evidence'],
  },
  {
    phase: 'Phase 8',
    title: 'Torii entry',
    state: 'active',
    date: '2026-07-09',
    summary: 'Fold the master roadmap product-entry work into Onyx and the main site: rich invite previews, instant guest handoff, native onboarding, install guidance, and a stricter public glossary.',
    items: ['Rich invite route', 'Invite Open Graph metadata', 'Instant guest identity', 'Invite moment handoff', 'Native onboarding forms', 'Account claim flow', 'Install guide', 'Generated public sitemap', 'Public glossary', 'Brand glossary cleanup'],
  },
  {
    phase: 'Phase 9',
    title: 'Venue model',
    state: 'active',
    date: '2026-07-09',
    summary: 'Keep building the time-native venue: named conversations, calm notifications, quiet boost collection, presence-as-place, and one responsive information model across desktop and mobile.',
    items: ['Named conversations', 'Forum projection', 'Forum topic follow controls', 'Pinned forum projection', 'Calm notification presets', 'Compact calm preset control', 'Quiet boosts', 'Quiet boost Home digest', 'Presence-as-place header', 'Scheduled event header chip', 'One-canvas responsive projection', 'Mobile Home tab', 'Touch-sized Home review cards'],
  },
  {
    phase: 'Phase 10',
    title: 'Atmosphere',
    state: 'planned',
    date: 'planned',
    summary: 'Consolidate the background system and finish mechanically derived accessibility variants, including reduced transparency, contrast, and mobile drawer focus semantics.',
    items: ['Background consolidation', 'Theme-reactive identity', 'Contrast variants', 'Reduced-transparency variants', 'User reduced-transparency control', 'Mobile drawer focus management', 'Mobile drawer focus trap', 'Deterministic time scrubber jumps'],
  },
  {
    phase: 'Phase 11',
    title: 'Media presence',
    state: 'planned',
    date: 'planned',
    summary: 'Promote voice and video into room presence with stage context, spatial controls, screenshare controls, and watch-together surfaces.',
    items: ['Voice-room-as-place UI', 'Voice room status chip', 'Stage context', 'Spatial audio controls', 'Spatial audio availability state', 'Screenshare controls', 'Watch-together surface', 'Watch-together room activity'],
  },
  {
    phase: 'Phase 12',
    title: 'Apps',
    state: 'planned',
    date: 'planned',
    summary: 'Prepare the client and site for structured integrations: Block-Kit-lite rendering, a constrained extension surface, and migration/importer paths.',
    items: ['Block-Kit-lite renderer', 'Block-Kit-lite message controls', 'Client extension surface', 'Capability-scoped extension actions', 'Importer path', 'Reviewed portable import', 'Incoming webhook migration', 'Server snapshot imports', 'IRC-log-to-vault import', 'Bridge status surface', 'Integrations page'],
  },
  {
    phase: 'Phase 13',
    title: 'Local intelligence',
    state: 'planned',
    date: 'planned',
    summary: 'Add local-first intelligence without making AI the front door: provenance chrome, vault recall, local catch-up, captions, translation, and agent-safe contracts.',
    items: ['AI provenance chrome', 'Search provenance labels', 'Digest provenance labels', 'Caption provenance labels', 'Extension action audit', 'Digest recall terms', 'Digest review history', 'Vault RAG', 'Semantic recall', 'Local catch-up', 'Local captions', 'Local translation', 'Agent-safe public contract', 'Agent safety page', 'Provenance labels'],
  },
  {
    phase: 'Phase 14',
    title: 'Roaming',
    state: 'active',
    date: '2026-07-09',
    summary: 'Generalize offline-first behavior into read, compose, search, PWA install clarity, moderation drafts, desktop packaging, and portable local-state transfer.',
    items: ['TravelTo vault fallback', 'Active-target vault search', 'Immediate vault-result navigation', 'Offline reviewed recall', 'Offline search gating', 'Local-memory mode status', 'Outbox count status', 'Offline topic drafts', 'Installable manifest', 'PWA shortcuts', 'Install screenshots', 'Launch handler', 'Wrapper readiness matrix', 'Wrapper contract', 'Portable vault export', 'Portable vault import', 'Reviewed catch-up transfer', 'Room draft transfer', 'Topic draft transfer', 'Full offline-first UX', 'Desktop packaging path'],
  },
];

const completePhaseCount = phases.filter((phase) => phase.state === 'complete').length;

export default function RoadmapRoute() {
  setPageMeta(
    'Onyx roadmap — what shipped and what is next',
    'Track the public Onyx roadmap across memory, reach, privacy, presence, operations, and the time-native client work next.',
    '/roadmap',
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
          <a class="hideable" href="/stats">Stats</a>
          <a class="hideable" href="/status">Status</a>
          <a class="hideable" href="/roadmap" aria-current="page">Roadmap</a>
          <a class="hideable" href="/about">About</a>
          <a class="enter" href="/app">Open Onyx</a>
        </nav>
      </header>

      <section class="r-wrap data-hero" aria-labelledby="roadmap-heading">
        <p class="r-kicker">roadmap</p>
        <h1 id="roadmap-heading">What shipped,<br /><span class="gold">what is next</span></h1>
        <p class="sub">
          The public product plan, reduced to what matters on the site: memory,
          reach, privacy, presence, operations, and the Onyx backlog folded in
          from the master roadmap.
        </p>
        <div class="data-summary">
          <div class="data-metric">
            <span class="label">complete phases</span>
            <span class="value">{completePhaseCount}</span>
            <span class="note">client features shipped</span>
          </div>
          <div class="data-metric">
            <span class="label">next tranche</span>
            <span class="value">Time</span>
            <span class="note">venue model, access, local-first roaming</span>
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
          <h2>Operations are visible; time is active</h2>
          <p>
            The site now carries `/status`, `/stats`, backup readiness, and a live
            root pulse. Onyx's current client work makes the app a time-native
            place to return to: followed catch-up, scheduled room events, local
            memory previews, quiet room activity, home return recaps, Spotlight
            handoff, room rhythm heatlines, event context, review-from-start
            handoffs, review history, review text search, channel directory dedupe, reader digest notes, shareable moment links, reader memory context, moment search handoff,
            reader transcript jumps, digest review handoff, review completion, reader return-home affordances, reviewed-span recall, hydrated context trails, vault context trails, vault anchor jumps, and
            command grammar for goto, search, time jumps, reading projections, J/K transcript navigation, and quieter activity surfaces.
          </p>
        </article>
        <aside class="data-card">
          <span class="label">open surfaces</span>
          <h3>Keep tightening</h3>
          <div class="data-list data-list--compact">
            <div class="data-row"><div><strong>Catch-up Home</strong><span>Continue richer cross-room review handoffs on the return screen.</span></div></div>
            <div class="data-row"><div><strong>Reader mode</strong><span>Carry reviewed anchors into richer cross-room handoffs.</span></div></div>
            <div class="data-row"><div><strong>Accessibility conformance</strong><span><a href="/accessibility/">Continue remaining dense-surface pass/fix evidence.</a></span></div></div>
            <div class="data-row"><div><strong>Torii entry</strong><span><a href="/invite?join=%23root">Rich invite entry</a> and install guidance now anchor the first-run path.</span></div></div>
            <div class="data-row"><div><strong>Public contracts</strong><span><a href="/glossary/">Glossary</a>, <a href="/integrations/">integrations</a>, and <a href="/agents/">agent safety</a> now carry site-level roadmap contracts.</span></div></div>
            <div class="data-row"><div><strong>Master roadmap fold-in</strong><span>Track onboarding, calm presets, media presence, app surfaces, local intelligence, and offline roaming here.</span></div></div>
          </div>
        </aside>
      </section>
    </main>
  );
}
