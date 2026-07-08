import './landing.css';
import './data-pages.css';
import { For } from 'solid-js';
import { Mascot } from '@/components/brand/Mascot';
import { setPageMeta } from './pageMeta';

type Phase = {
  phase: string;
  title: string;
  state: 'complete' | 'active';
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
];

export default function RoadmapRoute() {
  setPageMeta(
    'Onyx roadmap — what shipped and what is next',
    'Track the public Onyx roadmap across memory, reach, privacy, presence, and operational visibility.',
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
          reach, privacy, presence, and the operational surfaces now coming online.
        </p>
        <div class="data-summary">
          <div class="data-metric">
            <span class="label">complete phases</span>
            <span class="value">4</span>
            <span class="note">client features shipped</span>
          </div>
          <div class="data-metric">
            <span class="label">active phase</span>
            <span class="value">Ops</span>
            <span class="note">status, graphs, backups</span>
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
          <h2>Operations become visible</h2>
          <p>
            The site now carries `/status`, `/stats`, backup readiness, and a live
            root pulse. The remaining work is mostly deployment and feed polish:
            point backup manifests at their public path and keep Prometheus-backed
            health graphs moving toward richer history.
          </p>
        </article>
        <aside class="data-card">
          <span class="label">open surfaces</span>
          <h3>Keep tightening</h3>
          <div class="data-list data-list--compact">
            <div class="data-row"><div><strong>Prometheus graph history</strong><span>Turn point-in-time metrics into visible trends.</span></div></div>
            <div class="data-row"><div><strong>Backup feed deployment</strong><span>Serve `latest.json` from the operator vault path.</span></div></div>
            <div class="data-row"><div><strong>Roadmap freshness</strong><span>Keep shipped-state copy in the site, not only in docs.</span></div></div>
          </div>
        </aside>
      </section>
    </main>
  );
}
