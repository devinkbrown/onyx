// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import { onMount } from 'solid-js';
import { setPageMeta } from './pageMeta';

/**
 * The authored roadmap lives on the public website. Keeping a second catalogue
 * in the client made status claims drift, so this SPA route is intentionally a
 * document-navigation bridge to the one canonical page.
 */
export const CANONICAL_ROADMAP_PATH = '/roadmap/index.html';

export function redirectToCanonicalRoadmap(
  replace: (path: string) => void = (path) => window.location.replace(path),
) {
  replace(CANONICAL_ROADMAP_PATH);
}

export function RoadmapBridge() {
  return (
    <main class="landing-page" aria-labelledby="roadmap-bridge-title">
      <section class="landing-hero">
        <div class="landing-container">
          <p class="landing-eyebrow">One roadmap · one source of truth</p>
          <h1 id="roadmap-bridge-title">Opening the Onyx roadmap</h1>
          <p>
            Product status now lives on one canonical public page, checked against
            shipped source and acceptance evidence.
          </p>
          <a class="landing-primary" href={CANONICAL_ROADMAP_PATH}>
            Open roadmap
          </a>
        </div>
      </section>
    </main>
  );
}

export default function RoadmapRoute() {
  setPageMeta(
    'Onyx roadmap — shipped, building, and later',
    'The canonical, evidence-led Onyx product roadmap.',
  );

  onMount(() => {
    redirectToCanonicalRoadmap();
  });

  return <RoadmapBridge />;
}
