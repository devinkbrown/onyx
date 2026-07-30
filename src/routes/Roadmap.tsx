// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import './roadmap.css';
import { For, type JSX } from 'solid-js';
import { Mascot } from '@/components/brand/Mascot';
import { PublicFooter } from './PublicFooter';
import { setPageMeta } from './pageMeta';

type RoadmapState = 'shipped' | 'active' | 'next' | 'gated';

type RoadmapLane = {
  state: RoadmapState;
  eyebrow: string;
  title: string;
  summary: string;
  items: readonly string[];
};

export const ROADMAP_LANES: readonly RoadmapLane[] = [
  {
    state: 'shipped',
    eyebrow: 'Foundation',
    title: 'The open network works',
    summary:
      'Onyx already has the product kernel that the public experience is built on.',
    items: [
      'Rooms, direct messages, calls, presence, invites, accounts, and local-first history',
      'Reusable sessions and continuity across reconnects and mesh nodes',
      'Browser and installable PWA from the same SolidJS client',
      'Pure-Zig Onyx Server with the Undertow mesh and Helix upgrade path',
    ],
  },
  {
    state: 'active',
    eyebrow: 'Now',
    title: 'Make the power feel effortless',
    summary:
      'The current release cycle turns the existing depth into a product ordinary communities can use immediately.',
    items: [
      'Commercial-quality mobile, tablet, and desktop interaction polish',
      'Friendly onboarding that does not require IRC vocabulary',
      'Clear Home, Rooms, Messages, Calls, and You navigation',
      'Accessibility, responsive layout, wallpaper, and preference-panel hardening',
    ],
  },
  {
    state: 'active',
    eyebrow: 'Distribution',
    title: 'One client, more places',
    summary:
      'The web client remains the source of truth while native packages mature around it.',
    items: [
      'Unsigned Windows, Linux, FreeBSD, and OpenBSD packages with checksums',
      'Runtime-aware package layouts and documented install paths',
      'Browser and PWA remain available everywhere, including macOS',
      'Intel and Apple Silicon packages wait for genuine Darwin builds',
    ],
  },
  {
    state: 'next',
    eyebrow: 'Next',
    title: 'Trust, groups, and organizations',
    summary:
      'The next product layer makes advanced controls understandable without hiding what the network is doing.',
    items: [
      'General-public group controls shaped around Onyx Server capabilities',
      'Clearer E2EE state, device trust, recovery, and migration surfaces',
      'Dedicated community, organization, trust, and technology pages',
      'Deeper cross-room handoffs, catch-up, and power-user workflows',
    ],
  },
  {
    state: 'gated',
    eyebrow: 'Release gates',
    title: 'Claims we will not fake',
    summary:
      'These become shipped only after the actual platform evidence exists.',
    items: [
      'Signed and notarized native packages',
      'A verified native auto-updater and secure-storage bridge',
      'Production macOS Intel and Apple Silicon downloads',
      'Store distribution and enterprise controls backed by working integrations',
    ],
  },
] as const;

const STATE_LABELS: Record<RoadmapState, string> = {
  shipped: 'Shipped',
  active: 'In progress',
  next: 'Up next',
  gated: 'Evidence gated',
};

function RoadmapCard(props: { lane: RoadmapLane; index: number }): JSX.Element {
  return (
    <article class="roadmap-card data-card" data-state={props.lane.state}>
      <div class="roadmap-card-head">
        <span class="roadmap-index">{String(props.index + 1).padStart(2, '0')}</span>
        <span class="roadmap-state">{STATE_LABELS[props.lane.state]}</span>
      </div>
      <p class="label">{props.lane.eyebrow}</p>
      <h2>{props.lane.title}</h2>
      <p class="roadmap-summary">{props.lane.summary}</p>
      <ul>
        <For each={[...props.lane.items]}>{(item) => <li>{item}</li>}</For>
      </ul>
    </article>
  );
}

export default function RoadmapRoute(): JSX.Element {
  setPageMeta(
    'Onyx roadmap — shipped, building, and later',
    'The evidence-led public roadmap for Onyx and Onyx Server.',
    '/roadmap/',
  );

  return (
    <main class="r data-page roadmap-page" data-testid="roadmap-page">
      <div class="r-ground" aria-hidden="true" />
      <div class="r-flecks" aria-hidden="true" />

      <header class="r-status" role="banner">
        <a class="brand" href="/" aria-label="Onyx home">
          <span class="brand-mark" aria-hidden="true"><Mascot variant="mark" /></span>
          <span class="brand-wordmark" aria-hidden="true">ONYX</span>
        </a>
        <nav aria-label="Primary">
          <a href="/">Home</a>
          <a href="/download/">Download</a>
          <a href="/roadmap/" aria-current="page">Roadmap</a>
          <a class="enter" href="/app/">Open Onyx</a>
        </nav>
      </header>

      <section class="r-wrap data-hero roadmap-hero" aria-labelledby="roadmap-heading">
        <p class="r-kicker">Public roadmap · evidence before claims</p>
        <h1 id="roadmap-heading">Build the place.<br />Keep the network open.</h1>
        <p class="sub">
          Onyx is moving from a powerful protocol client into a public communication
          product without throwing away the mesh, continuity, privacy, or operator control
          that make it different.
        </p>
        <div class="roadmap-legend" aria-label="Roadmap status key">
          <For each={(['shipped', 'active', 'next', 'gated'] as const)}>
            {(state) => <span data-state={state}>{STATE_LABELS[state]}</span>}
          </For>
        </div>
      </section>

      <section class="r-wrap r-section roadmap-grid" aria-label="Onyx delivery roadmap">
        <For each={[...ROADMAP_LANES]}>
          {(lane, index) => <RoadmapCard lane={lane} index={index()} />}
        </For>
      </section>

      <section class="r-wrap r-section roadmap-principle" aria-labelledby="roadmap-rule">
        <div class="data-card">
          <p class="label">The rule</p>
          <h2 id="roadmap-rule">Source truth wins.</h2>
          <p>
            “Shipped” means the implementation and its verification exist. Packaging,
            signing, native integration, and production rollout stay visibly gated until
            their own evidence is green.
          </p>
          <div class="roadmap-actions">
            <a class="r-btn primary" href="/app/">Open Onyx</a>
            <a class="r-btn ghost" href="/download/">Download and install</a>
            <a class="r-btn ghost" href="/status/">Check network status</a>
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
