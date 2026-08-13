// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createMemo } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { PublicFrame } from '@/ui/public';
import './not-found.css';

/** Kept in the deferred terminus chunk: the eager landing only needs known-route metadata. */
export function setNotFoundPageMeta(): void {
  if (typeof document === 'undefined') return;
  document.title = 'Route terminus — Onyx';
  let description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!description) {
    description = document.createElement('meta');
    description.name = 'description';
    document.head.append(description);
  }
  description.content = 'This Onyx route is not available.';
  let robots = document.querySelector<HTMLMetaElement>('meta[data-onyx-route-robots]');
  if (!robots) {
    robots = document.createElement('meta');
    robots.dataset.onyxRouteRobots = 'true';
    document.head.append(robots);
  }
  robots.name = 'robots';
  robots.content = 'noindex,nofollow';
  document.querySelector('link[rel="canonical"]')?.remove();
  document.querySelector('meta[property="og:url"]')?.remove();
  document.querySelector('script[data-onyx-route-jsonld]')?.remove();
}

export default function NotFoundRoute() {
  const location = useLocation();
  const isAppMiss = createMemo(() => /^\/app(?:\/|$)/u.test(location.pathname));
  createEffect(setNotFoundPageMeta);

  return (
    <PublicFrame mainLabel="Onyx page not found">
      <div class="ui-root r not-found-page">
        <div class="r-ground" aria-hidden="true" />
        <div class="r-flecks" aria-hidden="true" />
        <section class="r-wrap not-found-page__body">
          <p class="r-kicker">404 · route terminus</p>
          <h1>Route terminus</h1>
          <p class="sub">This route is not part of the public Onyx surface.</p>
          <A class="not-found-page__action" href={isAppMiss() ? '/app/' : '/'}>
            {isAppMiss() ? 'Open Onyx' : 'Back to home'}
          </A>
        </section>
      </div>
    </PublicFrame>
  );
}
