// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import './roadmap.css';
import { PublicFrame } from '@/ui/public';
import { setPageMeta } from './pageMeta';

export function RoadmapBridge() {
  return (
    <PublicFrame
      currentPath="/roadmap/"
      mainLabel="Onyx product roadmap"
      context={(
        <p class="public-frame__current-line">
          <span class="public-frame__current-kicker">Planning</span>
          <span aria-hidden="true">·</span>
          <span class="public-frame__current-label">Proof before promise</span>
        </p>
      )}
    >
      <div class="ui-root r data-page roadmap-page">
        <div class="r-ground" aria-hidden="true" />
        <div class="r-flecks" aria-hidden="true" />
        <div class="r-grain" aria-hidden="true" />

        <section class="r-wrap r-section roadmap-hero" aria-labelledby="roadmap-bridge-title">
          <p class="r-kicker">what we are building · current room</p>
          <h1 id="roadmap-bridge-title" class="r-title">
            A place for your people<br /><span class="roadmap-title-accent">that you can trust</span>
          </h1>
          <p class="r-lede">
            Onyx is becoming a dependable public communication product: easy
            rooms and calls, useful catch-up, honest protection state, and an open
            engine. It will work everywhere and become a first-class native
            experience inside OnyxOS.
          </p>
          <div class="roadmap-legend" role="group" aria-label="Roadmap state legend">
            <span data-state="active">Current focus</span>
            <span data-state="next">Next</span>
            <span data-state="gated">Evidence gated</span>
          </div>
        </section>

        <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

        <section class="r-wrap r-section roadmap-grid" aria-label="Current Onyx product priorities">
          <article class="data-card roadmap-card" data-state="active">
            <div class="roadmap-card-head">
              <span class="roadmap-index" aria-hidden="true">01</span>
              <span class="roadmap-state">Current focus</span>
            </div>
            <h2>Repair the front door</h2>
            <p class="roadmap-summary">Remove false outage states, broken routes, clipped forms, contradictory claims, and unreliable first-run paths.</p>
          </article>
          <article class="data-card roadmap-card" data-state="next">
            <div class="roadmap-card-head">
              <span class="roadmap-index" aria-hidden="true">02</span>
              <span class="roadmap-state">Next</span>
            </div>
            <h2>Make the client dependable</h2>
            <p class="roadmap-summary">Unify the experience around Home, Rooms, DMs, Calls, and You while preserving the tested protocol, vault, crypto, and media kernel.</p>
          </article>
          <article class="data-card roadmap-card" data-state="gated">
            <div class="roadmap-card-head">
              <span class="roadmap-index" aria-hidden="true">03</span>
              <span class="roadmap-state">Evidence gated</span>
            </div>
            <h2>Bring Onyx into OnyxOS</h2>
            <p class="roadmap-summary">Integrate identity, notifications, local history, media, accessibility, and system security without making OnyxOS a requirement.</p>
          </article>
        </section>

        <section class="r-wrap r-section roadmap-principle" aria-labelledby="roadmap-principle-heading">
          <div class="data-card">
            <span class="r-eyebrow">release rule</span>
            <h2 id="roadmap-principle-heading">Proof before promise</h2>
            <p>
              A roadmap state describes priority, not deployment. Features move
              forward only when their source, failure paths, and production behavior
              have evidence strong enough for the claim.
            </p>
          </div>
        </section>
      </div>
    </PublicFrame>
  );
}

export default function RoadmapRoute() {
  setPageMeta(
    'Onyx roadmap — shipped, building, and later',
    'The canonical, evidence-led Onyx product roadmap.',
  );

  return <RoadmapBridge />;
}
