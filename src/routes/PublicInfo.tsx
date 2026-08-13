// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import { createEffect, createMemo } from 'solid-js';
import { PublicFrame } from '@/ui/public';
import { setPageMeta } from './pageMeta';

const content = {
  accessibility: ['Accessibility', 'Access is a product requirement.', 'Keyboard navigation, focus recovery, motion controls, contrast variants, and live-status announcements are tested in the client. Report a gap in #accessibility.'],
  glossary: ['Glossary', 'Words should make the network easier to use.', 'Onyx is the network and client. Onyx Server is the engine. Cadence is the media system. Mooring is the secured mesh channel.'],
  integrations: ['Integrations', 'Useful actions, constrained by design.', 'Onyx renders reviewed Block-Kit-lite content and uses capability-scoped action manifests. It never executes a message as a command.'],
  agents: ['Agent safety', 'Automation has a boundary.', 'Agent-visible actions are reviewed, capability-scoped, and labelled with their source. Local data stays local unless you explicitly choose otherwise.'],
} as const;

export type PublicInfoPage = keyof typeof content;

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
    <PublicFrame currentPath={`/${props.page}/`} mainLabel={mainLabels[props.page]}>
      <div class="ui-root r data-page">
        <div class="r-ground" aria-hidden="true" />
        <div class="r-flecks" aria-hidden="true" />
        <section class="r-wrap data-hero">
          <p class="r-kicker">public contract</p>
          <h1>{item()[0]}</h1>
          <p class="sub">{item()[1]}</p>
        </section>
        <section class="r-wrap r-section">
          <article class="data-card">
            <div class="label">Onyx</div>
            <h2>{item()[0]}</h2>
            <p>{item()[2]}</p>
          </article>
        </section>
      </div>
    </PublicFrame>
  );
}
