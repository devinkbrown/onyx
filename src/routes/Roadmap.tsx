// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import { Mascot } from '@/components/brand/Mascot';
import { setPageMeta } from './pageMeta';
import { PublicFooter } from './PublicFooter';

export default function RoadmapRoute(): JSX.Element {
  setPageMeta(
    'Onyx roadmap — shipped, building, and later',
    'The evidence-led public roadmap for Onyx and Onyx Server.',
    '/roadmap/',
  );

  return (
    <main class="r" aria-labelledby="roadmap-bridge-title">
      <div class="r-ground" aria-hidden="true" />
      <div class="r-flecks" aria-hidden="true" />
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
          <a class="hideable" href="/onyxos/">OnyxOS</a>
          <a class="enter" href="/app/">Open Onyx</a>
        </nav>
      </header>

      <section class="r-wrap r-section" aria-labelledby="roadmap-bridge-title">
        <p class="r-kicker">what we are building</p>
        <h1 id="roadmap-bridge-title" class="r-title">
          A place for your people<br /><span class="gold">that you can trust</span>
        </h1>
        <p class="r-lede">
          Onyx is becoming a dependable public communication product: easy
          rooms and calls, useful catch-up, honest protection state, and an open
          engine. It will work everywhere and become a first-class native
          experience inside OnyxOS.
        </p>

        <div class="r-board" aria-label="Current Onyx product priorities">
          <article class="r-card">
            <span class="k">now</span>
            <h2>Repair the front door</h2>
            <p>Remove false outage states, broken routes, clipped forms, contradictory claims, and unreliable first-run paths.</p>
          </article>
          <article class="r-card">
            <span class="k">next</span>
            <h2>Make the client dependable</h2>
            <p>Unify the experience around Home, Rooms, DMs, Calls, and You while preserving the tested protocol, vault, crypto, and media kernel.</p>
          </article>
          <article class="r-card">
            <span class="k">native</span>
            <h2>Bring Onyx into OnyxOS</h2>
            <p>Integrate identity, notifications, local history, media, accessibility, and system security without making OnyxOS a requirement.</p>
          </article>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}

export default function RoadmapRoute() {
  setPageMeta(
    'Onyx roadmap — shipped, building, and later',
    'The canonical, evidence-led Onyx product roadmap.',
  );

  return <RoadmapBridge />;
}
