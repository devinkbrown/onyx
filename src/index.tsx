// SPDX-License-Identifier: AGPL-3.0-or-later
/* @refresh reload */
// MUST stay the first import: migrates legacy 'ocean-*' localStorage keys to
// 'onyx:*' as an import side effect, before any module-scope storage reads.
import './lib/migrateStorage';

// ── Service worker: register + self-heal ────────────────────────────────────
// The SW registration survives from older builds even though no current code
// registered it — so keep registering explicitly. A replacement worker reloads
// once so a page cannot keep running stale hashed chunks; the first worker to
// claim a fresh page deliberately does not interrupt in-progress connect input.
if (import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  void import('./pwa/serviceWorkerRuntime').then(({ startServiceWorkerRuntime }) => {
    startServiceWorkerRuntime(navigator.serviceWorker);
  });
}
import { Dynamic, render } from 'solid-js/web';
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
import { DeferredLoading, lazyRouteFallback, retryableLazy } from './app/StaleChunkRecovery';
const Landing = () => import('./routes/Landing');
const About = () => import('./routes/About');
const AppShell = () => import('./routes/AppRoute');
const Appearance = () => import('./app/Appearance');
const Stats = () => import('./routes/Stats');
const Status = () => import('./routes/Status');
const Roadmap = () => import('./routes/Roadmap');
const Invite = () => import('./routes/Invite');
const OnyxOS = () => import('./routes/OnyxOS');
const Download = () => import('./routes/Download');
const PublicInfoRoute = () => import('./routes/PublicInfo');
const Guides = () => import('./routes/Guides');
const TrustPages = () => import('./routes/TrustPages');
// Both paths share one deferred public-route chunk; the module dispatches the
// catchall to its route-terminus component after loading.
const NotFoundRoute = withLazyRoute(PublicInfoRoute);
const LandingRoute = withLazyRoute(Landing);
const PublicInfoRouteGuarded = withLazyRoute(PublicInfoRoute);
const Spotlight = () => import('./chat/spotlight/Spotlight');
const UpdateAvailable = () => import('./pwa/UpdateAvailable').then(({ UpdateAvailable }) => ({ default: UpdateAvailable }));

type LazyLoader = () => Promise<{ default: Component }>;

function withLazyRoute(loader: LazyLoader): Component {
  return function LazyRouteGuarded() {
    const [attempt, setAttempt] = createSignal(0);
    const current = () => {
      attempt();
      return retryableLazy(loader, 'page');
    };
    return (
      <ErrorBoundary fallback={(error, reset) => lazyRouteFallback(error, () => {
        setAttempt((value) => value + 1);
        reset();
      })}>
        <Suspense fallback={<DeferredLoading label="Loading page…" />}>
          <Dynamic component={current()} />
        </Suspense>
      </ErrorBoundary>
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
const TrustPagesRoute = withLazyRoute(TrustPages);

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
      <ErrorBoundary fallback={(error, reset) => lazyRouteFallback(error, reset)}><Suspense fallback={<DeferredLoading label="Loading spotlight…" />}><Dynamic component={lazy(Spotlight)} /></Suspense></ErrorBoundary>
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
          <Route path="/" component={LandingRoute} />
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
          <Route path={['/privacy', '/privacy/', '/guidelines', '/guidelines/', '/contact', '/contact/']} component={TrustPagesRoute} />
          <Route path={['/accessibility/', '/glossary/', '/integrations/', '/agents/']} component={PublicInfoRouteGuarded} />
          <Route path="/*notFound" component={NotFoundRoute} />
        </Router>
        {/* Global command palette — Cmd/Ctrl+K or / opens it from any route.
            Its lazy chunk (command catalogue + fuzzy matcher) is fetched only
            on first open, not on landing. */}
        <GlobalSpotlight />
        <ErrorBoundary fallback={lazyRouteFallback}>
          <Suspense fallback={null}><Dynamic component={lazy(UpdateAvailable)} /></Suspense>
        </ErrorBoundary>
      </SpotlightProvider>
    </ThemeProvider>
  ),
  root,
);
