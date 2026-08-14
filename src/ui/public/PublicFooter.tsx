// SPDX-License-Identifier: AGPL-3.0-or-later
import { For, type JSX } from 'solid-js';
import { publicRouteById, type PublicRouteId } from '@/ui/navigation/publicRouteManifest';

const FOOTER_ROUTE_IDS = ['about', 'onyxos', 'roadmap', 'status', 'download', 'accessibility'] as const satisfies readonly PublicRouteId[];
const FOOTER_ROUTES = FOOTER_ROUTE_IDS.map(publicRouteById);

export function PublicFooter(): JSX.Element {
  return (
    <footer class="public-frame__footer">
      <div class="public-frame__footer-inner">
        <div>
          <a class="public-frame__footer-brand" href={publicRouteById('home').href}>Onyx</a>
          <p>A durable room for communities and technically curious people, with local-first continuity and shown security states.</p>
        </div>
        <nav aria-label="Footer navigation">
          <For each={FOOTER_ROUTES}>
            {(route) => <a href={route.href}>{route.label}</a>}
          </For>
        </nav>
      </div>
    </footer>
  );
}
