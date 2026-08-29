// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './roadmap.css';
import { For } from 'solid-js';
import { PublicFrame } from '@/ui/public';
import { setPageMeta } from './pageMeta';

const ROADMAP_ITEMS = [
  {
    state: 'now',
    label: 'Now',
    title: 'Rooms that stay open',
    summary: 'A standing place for friends, clubs, and creators. The conversation stays with the room when you come back.',
  },
  {
    state: 'next',
    label: 'Next',
    title: 'Calls and catch-up',
    summary: 'Talk in text, then start a call when the night wants one. Come back later and pick up where you left off.',
  },
  {
    state: 'later',
    label: 'Later',
    title: 'Home Screen on this device',
    summary: 'Supporting browsers can keep Onyx here — same rooms, same people, no extra store.',
  },
] as const;

export function RoadmapBridge() {
  return (
    <PublicFrame
      currentPath="/roadmap/"
      mainLabel="Onyx product roadmap"
      context={(
        <p class="public-frame__current-line">
          <span class="public-frame__current-kicker">What is next</span>
          <span aria-hidden="true">·</span>
          <span class="public-frame__current-label">Rooms, calls, catch-up</span>
        </p>
      )}
    >
      <div class="ui-root r roadmap-page">
        <div class="r-ground" aria-hidden="true" />
        <div class="r-grain" aria-hidden="true" />

        <section class="r-wrap r-section roadmap-hero" aria-labelledby="roadmap-bridge-title">
          <p class="roadmap-kicker">what we are working on</p>
          <h1 id="roadmap-bridge-title">
            Rooms, calls, catch-up, and a Home Screen.
          </h1>
          <p class="roadmap-lede">
            The work in front of us is the life of the rooms — not an operating
            system, and not a dated promise.
          </p>
          <div class="roadmap-legend" role="group" aria-label="Roadmap state legend">
            <For each={ROADMAP_ITEMS}>
              {(item, index) => (
                <a href={`#roadmap-${item.state}`} data-state={item.state}>
                  <span class="roadmap-legend__marker" aria-hidden="true">
                    {String(index() + 1).padStart(2, '0')}
                  </span>
                  <span>{item.label}</span>
                </a>
              )}
            </For>
          </div>
        </section>

        <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

        <section class="r-wrap r-section roadmap-grid" aria-label="Current Onyx product priorities">
          <For each={ROADMAP_ITEMS}>
            {(item) => (
              <article
                id={`roadmap-${item.state}`}
                class="roadmap-card"
                data-state={item.state}
                aria-labelledby={`roadmap-${item.state}-title`}
                tabindex="-1"
              >
                <div class="roadmap-card-head">
                  <span class="roadmap-state">{item.label}</span>
                </div>
                <h2 id={`roadmap-${item.state}-title`}>{item.title}</h2>
                <p class="roadmap-summary">{item.summary}</p>
              </article>
            )}
          </For>
        </section>

        <section class="r-wrap r-section roadmap-note" aria-labelledby="roadmap-note-heading">
          <h2 id="roadmap-note-heading">No dates on the wall</h2>
          <p>
            These are the things we are making better. Nothing here is a ship
            date, a bindable Terms page, or a claim that everything is fully
            encrypted.
          </p>
        </section>
      </div>
    </PublicFrame>
  );
}

export default function RoadmapRoute() {
  setPageMeta(
    'Onyx roadmap — rooms, calls, catch-up',
    'What we are working on: rooms that stay open, calls when you want them, catch-up when you come back, and a Home Screen on this device.',
    '/roadmap/',
  );

  return <RoadmapBridge />;
}
