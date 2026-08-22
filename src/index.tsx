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
import { createEffect, createSignal, ErrorBoundary, lazy, Show, Suspense, type Component, type JSX } from 'solid-js';
import { RouteLifecycleRoot } from './ui/a11y/RouteLifecycleRoot';
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
import { lazyRouteFallback } from './app/StaleChunkRecovery';
import Landing from './routes/Landing';

const About = lazy(() => import('./routes/About'));
const AppShell = lazy(() => import('./routes/AppRoute'));
const Appearance = lazy(() => import('./app/Appearance'));
const Stats = lazy(() => import('./routes/Stats'));
const Status = lazy(() => import('./routes/Status'));
const Roadmap = lazy(() => import('./routes/Roadmap'));
const Invite = lazy(() => import('./routes/Invite'));
const OnyxOS = lazy(() => import('./routes/OnyxOS'));
const Download = lazy(() => import('./routes/Download'));
const PublicInfoRoute = lazy(() => import('./routes/PublicInfo'));
const Guides = lazy(() => import('./routes/Guides'));
// Both paths share one deferred public-route chunk; the module dispatches the
// catchall to its route-terminus component after loading.
const NotFoundRoute = withLazyRoute(PublicInfoRoute);
const Spotlight = lazy(() => import('./chat/spotlight/Spotlight'));

/**
 * Guard a lazy route so a 404'd post-deploy chunk shows recovery UI instead of
 * a wallpaper-only blank shell. No automatic reload loop.
 */
function LazyRouteBoundary(props: { children: JSX.Element }): JSX.Element {
  return (
    <ErrorBoundary fallback={lazyRouteFallback}>
      <Suspense
        fallback={(
          <div class="route-lazy-pending" role="status" data-testid="route-lazy-pending">
            Loading…
          </div>
        )}
      >
        {props.children}
      </Suspense>
    </ErrorBoundary>
  );
}

function withLazyRoute(Lazy: Component): Component {
  return function LazyRouteGuarded() {
    return (
      <LazyRouteBoundary>
        <Lazy />
      </LazyRouteBoundary>
    );
  };
}

const AboutRoute = withLazyRoute(About);
const AppRouteGuarded = withLazyRoute(AppShell);
const AppearanceRoute = withLazyRoute(Appearance);
const StatsRoute = withLazyRoute(Stats);
const StatusRoute = withLazyRoute(Status);
const RoadmapRoute = withLazyRoute(Roadmap);
const InviteRoute = withLazyRoute(Invite);
const OnyxOSRoute = withLazyRoute(OnyxOS);
const DownloadRoute = withLazyRoute(Download);
const GuidesRoute = withLazyRoute(Guides);

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
        <Router root={RouteLifecycleRoot}>
          <Route path="/" component={Landing} />
          <Route path="/about" component={AboutRoute} />
          <Route path="/app" component={AppRouteGuarded} />
          <Route path="/appearance" component={AppearanceRoute} />
          <Route path={['/stats', '/stats/']} component={StatsRoute} />
          <Route path={['/status', '/status/']} component={StatusRoute} />
          <Route path={['/roadmap', '/roadmap/']} component={RoadmapRoute} />
          <Route path={['/invite', '/invite/']} component={InviteRoute} />
          <Route path={['/onyxos', '/onyxos/']} component={OnyxOSRoute} />
          <Route path={['/download', '/download/', '/install', '/install/']} component={DownloadRoute} />
          <Route path={['/guides', '/guides/', '/community', '/community/']} component={GuidesRoute} />
          <Route path={['/accessibility/', '/glossary/', '/integrations/', '/agents/']} component={() => <LazyRouteBoundary><PublicInfoRoute /></LazyRouteBoundary>} />
          <Route path="/*notFound" component={NotFoundRoute} />
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
