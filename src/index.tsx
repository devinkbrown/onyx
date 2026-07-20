// SPDX-License-Identifier: AGPL-3.0-or-later
/* @refresh reload */
// MUST stay the first import: migrates legacy 'ocean-*' localStorage keys to
// 'onyx:*' as an import side effect, before any module-scope storage reads.
import './lib/migrateStorage';
import { startServiceWorkerRuntime } from './pwa/serviceWorkerRuntime';

// ── Service worker: register + self-heal ────────────────────────────────────
// The SW registration survives from older builds even though no current code
// registered it — so keep registering explicitly. A replacement worker reloads
// once so a page cannot keep running stale hashed chunks; the first worker to
// claim a fresh page deliberately does not interrupt in-progress connect input.
if (import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  startServiceWorkerRuntime(navigator.serviceWorker);
}
import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import { createEffect, createSignal, lazy, Show, type JSX } from 'solid-js';
import '@fontsource/anton';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/instrument-sans';
import './styles/global.css';
import './styles/a11y-media.css';
import './backgrounds/scene-motion.css';
import { ThemeProvider } from './theme';
// SpotlightProvider only installs the Cmd/Ctrl+K + "/" hotkey and owns the
// open signal — it is tiny and has no dependency on the command catalogue, so
// it stays eager. The Spotlight PANEL (below) pulls the ~1k-line command
// catalogue + fuzzy matcher, none of which is needed until the palette is
// first opened, so it is lazy + gated behind the open signal to keep it off
// the eager landing entry chunk.
import { SpotlightProvider, useSpotlight } from './chat/spotlight/useSpotlight';
import Landing from './routes/Landing';

const About = lazy(() => import('./routes/About'));
const AppShell = lazy(() => import('./routes/AppRoute'));
const Appearance = lazy(() => import('./app/Appearance'));
const Stats = lazy(() => import('./routes/Stats'));
const Status = lazy(() => import('./routes/Status'));
const Roadmap = lazy(() => import('./routes/Roadmap'));
const Invite = lazy(() => import('./routes/Invite'));
const PublicInfo = lazy(() => import('./routes/PublicInfo').then((m) => ({ default: m.PublicInfo })));
const Spotlight = lazy(() => import('./chat/spotlight/Spotlight'));

// Global command palette host. The panel + its command catalogue live in a
// lazy chunk; we ARM (and permanently keep mounted) on the first open so the
// panel's own open/close + focus-restoration lifecycle is unchanged after the
// initial fetch. Latching-on avoids unmounting the panel on close, which would
// race its focus-restore effect (WCAG 2.4.3).
function GlobalSpotlight(): JSX.Element {
  const spotlight = useSpotlight();
  const [armed, setArmed] = createSignal(false);
  createEffect(() => {
    if (spotlight.isOpen()) setArmed(true);
  });
  return (
    <Show when={armed()}>
      <Spotlight />
    </Show>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Onyx: #root not found');

// Dev-only store handle for headless screenshot/QA harnesses (never ships to prod).
if (import.meta.env.DEV) {
  void import('@/lib/store/store').then((m) => {
    (window as unknown as { __onyx?: unknown }).__onyx = m;
  });
}

render(
  () => (
    <ThemeProvider>
      <SpotlightProvider>
        <Router>
          <Route path="/" component={Landing} />
          <Route path="/about" component={About} />
          <Route path="/app" component={AppShell} />
          <Route path="/appearance" component={Appearance} />
          <Route path="/stats" component={Stats} />
          <Route path="/stats/" component={Stats} />
          <Route path="/status" component={Status} />
          <Route path="/status/" component={Status} />
          <Route path="/roadmap" component={Roadmap} />
          <Route path="/roadmap/" component={Roadmap} />
          <Route path="/invite" component={Invite} />
          <Route path="/invite/" component={Invite} />
          <Route path="/accessibility/" component={() => <PublicInfo page="accessibility" />} />
          <Route path="/glossary/" component={() => <PublicInfo page="glossary" />} />
          <Route path="/integrations/" component={() => <PublicInfo page="integrations" />} />
          <Route path="/agents/" component={() => <PublicInfo page="agents" />} />
        </Router>
        {/* Global command palette — Cmd/Ctrl+K or / opens it from any route.
            Its lazy chunk (command catalogue + fuzzy matcher) is fetched only
            on first open, not on landing. */}
        <GlobalSpotlight />
      </SpotlightProvider>
    </ThemeProvider>
  ),
  root,
);
