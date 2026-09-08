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
  ['Private DMs', 'Encrypted DM message text is intended for the two people in the conversation.'],
  ['History on this device', 'About 400 recent messages per room stay here.'],
] as const;

/**
 * Onyx public homepage — a social front door for rooms, messages, and calls.
 * Contract: docs/PUBLIC_COMPANY_SITE.md
 */
export default function Landing() {
  setPageMeta(
    'Onyx — good company. Great nights.',
    PUBLIC_HOME_DESCRIPTION,
    '/',
  );

  return (
    <PublicFrame
      currentPath="/"
      mainLabel="Onyx home"
    >
      <div class="ui-root ui-commercial r r-landing home">
        <div class="r-ground home-ground" aria-hidden="true" />
        <div class="r-grain home-grain" aria-hidden="true" />

        <section class="r-wrap home-hero" aria-labelledby="hero-heading">
          <div class="home-hero-grid">
            <div class="home-hero-copy">
              <h1 id="hero-heading" class="home-h1">
                <span>Good company.</span>
                {' '}
                <span>Great nights.</span>
              </h1>
              <p class="home-lede">
                A place for your friends to talk, play, and catch up. Open a room in your browser.
              </p>
              <div class="home-cta-row">
                <a class="home-cta-primary" href="/app/">Open Onyx</a>
                <a class="home-secondary-link" href={`${publicRouteById('invite').href}?join=%23root`}>See the public room</a>
              </div>
              <p class="home-device-note home-desktop-note">
                Browser first. Keep it on this device from a supporting browser — <a class="home-local-link" href={publicRouteById('download').href}>see device options</a>.
              </p>
            </div>

            <div class="home-hero-scene">
              <ProductPreview />
            </div>
          </div>
        </section>

        <section class="r-wrap home-trust" aria-labelledby="trust-heading">
          <h2 id="trust-heading" class="home-visually-hidden">What you can count on</h2>
          <dl class="home-trust-list" data-home-trust>
            <For each={TRUST_CLAIMS}>
              {(claim) => (
                <div>
                  <dt>{claim[0]}</dt>
                  <dd>{claim[1]}</dd>
                </div>
              )}
            </For>
          </dl>
          <p class="home-trust-detail">Read <a href={publicRouteById('privacy').href}>the privacy details</a>.</p>
        </section>

        <div class="r-wrap home-community">
          <HomeRoomBoard />
        </div>

        <nav
          id="extras"
          class="r-wrap home-shelf"
          data-home-shelf
          aria-label="Also here"
        >
          <p class="home-shelf-label">More to explore</p>
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
