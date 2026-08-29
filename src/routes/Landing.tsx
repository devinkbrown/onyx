// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './home.css';
import { For } from 'solid-js';
import { PublicFrame } from '@/ui/public';
import { publicRouteById } from '@/ui/navigation/publicRouteManifest';
import { PUBLIC_HOME_DESCRIPTION, setPageMeta } from './pageMeta';
import { ProductPreview } from './ProductPreview';
import { HomeRoomBoard } from './HomeRoomBoard';

const LANDING_SHELF_ITEMS = [
  [publicRouteById('status').href, 'Status'],
  [publicRouteById('roadmap').href, 'Roadmap'],
  [publicRouteById('about').href, 'About'],
  [publicRouteById('download').href, 'Download'],
  [publicRouteById('guides').href, 'Guides'],
  [`${publicRouteById('invite').href}?join=%23root`, 'Invite'],
] as const;

const TRUST_CLAIMS = [
  ['No ads', 'Nobody is selling your attention in the room.'],
  ['No third-party trackers', 'This site does not load analytics pixels or ad tags.'],
  ['Private DMs', 'Only the two of you. The words stay on this device.'],
  ['History on this device', 'About 400 recent messages per room stay here.'],
] as const;

/**
 * Onyx public homepage — quiet harbor, community door.
 * Contract: docs/PUBLIC_COMPANY_SITE.md
 */
export default function Landing() {
  setPageMeta(
    'Onyx — a room for your people',
    PUBLIC_HOME_DESCRIPTION,
    '/',
  );

  return (
    <PublicFrame
      currentPath="/"
      mainLabel="Onyx home"
    >
      <div class="ui-root r r-landing home">
      <div class="r-ground home-ground" aria-hidden="true" />
      <div class="r-grain home-grain" aria-hidden="true" />

      <section class="r-wrap home-hero" aria-labelledby="hero-heading">
        <div class="home-hero-grid">
          <div class="home-hero-copy">
            <p class="home-kicker">Friends · clubs · rooms</p>
            <h1 id="hero-heading" class="home-h1">Find your people. Keep the room.</h1>
            <p class="home-lede">
              A calm place to begin a conversation, return to it later, and make room for more people.
            </p>
            <div class="home-cta-row">
              <a class="home-cta-primary" href="/app/">Join free</a>
              <a class="home-secondary-link" href={publicRouteById('download').href}>Download</a>
            </div>
            <p class="home-desktop-note">
              Supporting browsers can put Onyx on the Home Screen or in its own window. No store.
            </p>
            <div class="home-mascot-scene" aria-hidden="true">
              <span class="home-mascot-wake" aria-hidden="true" />
              <img
                class="home-mascot"
                src="/brand/mascot-transparent.png"
                width="220"
                height="220"
                alt=""
                decoding="async"
              />
            </div>
          </div>

          <ProductPreview />
        </div>
      </section>

      <section class="r-wrap home-room-board-wrap" aria-label="First-room switchboard">
        <HomeRoomBoard />
      </section>

      <section class="r-wrap home-trust" aria-labelledby="trust-heading">
        <h2 id="trust-heading" class="home-visually-hidden">Why people stay</h2>
        <ul class="home-trust-strip" data-home-trust>
          <For each={TRUST_CLAIMS}>
            {(claim) => (
              <li>
                <strong>{claim[0]}</strong>
                <span>{claim[1]}</span>
              </li>
            )}
          </For>
        </ul>
      </section>

      <section class="r-wrap home-capability" aria-labelledby="capability-heading">
        <h2 id="capability-heading" class="home-visually-hidden">Life in the rooms</h2>
        <ul class="home-current" data-home-current>
          <li class="home-current-beat is-msg">
            <span class="mark mark-msg" aria-hidden="true" />
            <span>Rooms for friends, clubs, class groups, and public-interest hangouts</span>
          </li>
          <li class="home-current-beat is-call">
            <span class="mark mark-call" aria-hidden="true" />
            <span>Talk in text, then start a call when the night wants one</span>
          </li>
          <li class="home-current-beat is-cont">
            <span class="mark mark-cont" aria-hidden="true" />
            <span>Come back later — the room and your place in it stay with you</span>
          </li>
          <li class="home-current-beat is-protect">
            <span class="mark mark-protect" aria-hidden="true" />
            <span>Private DMs when a conversation should stay between people</span>
          </li>
        </ul>
        <div class="home-capability-chapters" aria-label="More ways in">
          <a href={`${publicRouteById('invite').href}?join=%23root`}><strong>Invite someone</strong><span>Send a room link to a friend</span></a>
          <a href={publicRouteById('download').href}><strong>Keep it here</strong><span>Browser first. Packages stay further down.</span></a>
          <a href={publicRouteById('about').href}><strong>How the rooms work</strong><span>A short, plain walkthrough</span></a>
        </div>
      </section>

      <nav
        id="extras"
        class="r-wrap home-shelf"
        data-home-shelf
        aria-label="Also here"
      >
        <p class="home-shelf-label">Also here</p>
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
