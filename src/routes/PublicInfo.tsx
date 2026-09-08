// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import './public-info.css';
import { createEffect, createMemo, Show } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { PublicFrame } from '@/ui/public';
import { setPageMeta } from './pageMeta';
import NotFoundPage from './NotFound';

// Both supporting information and the route terminus are deferred public
// surfaces. Re-exporting the latter keeps their router entry boundary shared.
export { NotFoundPage };

const content = {
  accessibility: ['Accessibility', 'Access is a product requirement.', 'Keyboard navigation, focus recovery, motion controls, contrast variants, and live-status announcements are tested in the client. Report a gap in #accessibility.'],
  glossary: ['Glossary', 'Words should make the network easier to use.', 'Onyx is the network and client. Onyx Server is the engine. Cadence is the media system. Mooring is the secured peer channel.'],
  integrations: ['Integrations', 'Useful actions, constrained by design.', 'Onyx renders reviewed Block-Kit-lite content and uses capability-scoped action manifests. It never executes a message as a command.'],
  agents: ['Agent safety', 'Automation has a boundary.', 'Agent-visible actions are reviewed, capability-scoped, and labelled with their source. Local data stays local unless you explicitly choose otherwise.'],
} as const;

export type PublicInfoPage = keyof typeof content;
const PUBLIC_INFO_PATHS = {
  '/accessibility/': 'accessibility',
  '/glossary/': 'glossary',
  '/integrations/': 'integrations',
  '/agents/': 'agents',
} as const satisfies Readonly<Record<string, PublicInfoPage>>;

const PUBLIC_INFO_PATH_ALIASES = {
  '/accessibility': 'accessibility',
  '/glossary': 'glossary',
  '/integrations': 'integrations',
  '/agents': 'agents',
} as const satisfies Readonly<Record<string, PublicInfoPage>>;

function publicInfoPageForPath(path: string): PublicInfoPage | undefined {
  return (
    PUBLIC_INFO_PATHS[path as keyof typeof PUBLIC_INFO_PATHS] ??
    PUBLIC_INFO_PATH_ALIASES[path as keyof typeof PUBLIC_INFO_PATH_ALIASES]
  );
}

export function resolvePublicInfoPage(path: string): PublicInfoPage {
  const page = publicInfoPageForPath(path);
  if (!page) throw new Error('Onyx: PublicInfo route was not allowlisted');
  return page;
}

/**
 * Accessible name for the shared `main` landmark. These supporting routes are
 * absent from the primary navigation, so the landmark name is the only
 * page-level orientation a landmark-jumping user gets.
 */
const mainLabels = {
  accessibility: 'Onyx accessibility',
  glossary: 'Onyx glossary',
  integrations: 'Onyx integrations',
  agents: 'Onyx agent safety',
} as const satisfies Record<PublicInfoPage, string>;

export function PublicInfo(props: { page: PublicInfoPage }) {
  const item = createMemo(() => content[props.page]);
  createEffect(() => {
    setPageMeta(`Onyx — ${item()[0]}`, item()[1], `/${props.page}/`);
  });
  return (
    <PublicFrame
      currentPath={`/${props.page}/`}
      mainLabel={mainLabels[props.page]}
      context={(
        <p class="public-frame__current-line">
          <span class="public-frame__current-kicker">Public contract</span>
          <span aria-hidden="true">·</span>
          <span class="public-frame__current-label">{item()[0]}</span>
        </p>
      )}
    >
      <div class={`ui-root r data-page public-info-page public-info-page--${props.page}`}>
        <div class="r-ground" aria-hidden="true" />
        <div class="r-flecks" aria-hidden="true" />
        <section class="r-wrap r-section public-info-article" aria-labelledby={`public-info-${props.page}-heading`}>
          <div class="public-info-article__header">
            <p class="r-kicker">public contract</p>
            <h1 id={`public-info-${props.page}-heading`}>{item()[0]}</h1>
            <p class="sub">{item()[1]}</p>
          </div>
          <article class="public-info-statement" aria-labelledby={`public-info-${props.page}-statement`}>
            <p class="label">Onyx · public statement</p>
            <h2 id={`public-info-${props.page}-statement`}>The statement</h2>
            <p>{item()[2]}</p>
          </article>
        </section>
      </div>
    </PublicFrame>
  );
}

/** Route-facing resolver; the named component remains useful for focused rendering tests. */
export default function PublicInfoRoute() {
  const location = useLocation();
  const page = () => publicInfoPageForPath(location.pathname);
  return (
    <Show when={page()} fallback={<NotFoundPage />}>
      {(currentPage) => <PublicInfo page={currentPage()} />}
    </Show>
  );
}
