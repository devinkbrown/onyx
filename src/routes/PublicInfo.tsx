// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import { createEffect, createMemo } from 'solid-js';
import { PublicFooter } from './PublicFooter';
import { setPageMeta } from './pageMeta';

const content = {
  accessibility: ['Accessibility', 'Access is a product requirement.', 'Keyboard navigation, focus recovery, motion controls, contrast variants, and live-status announcements are tested in the client. Report a gap in #accessibility.'],
  glossary: ['Glossary', 'Words should make the network easier to use.', 'Onyx is the network and client. Onyx Server is the engine. Cadence is the media system. Mooring is the secured mesh channel.'],
  integrations: ['Integrations', 'Useful actions, constrained by design.', 'Onyx renders reviewed Block-Kit-lite content and uses capability-scoped action manifests. It never executes a message as a command.'],
  agents: ['Agent safety', 'Automation has a boundary.', 'Agent-visible actions are reviewed, capability-scoped, and labelled with their source. Local data stays local unless you explicitly choose otherwise.'],
} as const;

export function PublicInfo(props: { page: keyof typeof content }) {
  const item = createMemo(() => content[props.page]);
  createEffect(() => {
    setPageMeta(`Onyx — ${item()[0]}`, item()[1], `/${props.page}/`);
  });
  return (
    <main class="r data-page">
      <div class="r-ground" aria-hidden="true" />
      <div class="r-flecks" aria-hidden="true" />
      <header class="r-status">
        <a class="brand" href="/">ONYX</a>
        <nav aria-label="Primary">
          <a href="/">Home</a>
          <a href="/roadmap/">Roadmap</a>
          <a href="/app/" class="enter">Open Onyx</a>
        </nav>
      </header>
      <section class="r-wrap data-hero">
        <p class="r-kicker">public contract</p>
        <h1>{item()[0]}</h1>
        <p class="sub">{item()[1]}</p>
      </section>
      <section class="r-wrap r-section">
        <article class="data-card">
          <span class="label">Onyx</span>
          <h2>{item()[0]}</h2>
          <p>{item()[2]}</p>
        </article>
      </section>
      <PublicFooter />
    </main>
  );
}
