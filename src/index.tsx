/* @refresh reload */
// MUST stay the first import: migrates legacy 'ocean-*' localStorage keys to
// 'onyx:*' as an import side effect, before any module-scope storage reads.
import './lib/migrateStorage';

// ── Service worker: register + self-heal ────────────────────────────────────
// The SW registration survives from older builds even though no current code
// registered it — so keep registering explicitly, and when a NEW worker takes
// control (skipWaiting + clients.claim after a deploy), reload ONCE so the
// page can't keep running a stale bundle whose hashed chunks no longer exist
// ("clicking X does nothing" syndrome).
if (import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}
import { render } from 'solid-js/web';
import { initVaultSync } from './lib/vault/vaultSync';
import { Router, Route } from '@solidjs/router';
import { lazy } from 'solid-js';
import '@fontsource/anton';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/instrument-sans';
import './styles/global.css';
import './styles/a11y-media.css';
import './backgrounds/scene-motion.css';
import { ThemeProvider } from './theme';
import { Spotlight, SpotlightProvider } from './chat/spotlight';
import Landing from './routes/Landing';

const About = lazy(() => import('./routes/About'));
const AppShell = lazy(() => import('./routes/AppRoute'));
const Appearance = lazy(() => import('./app/Appearance'));

const root = document.getElementById('root');
if (!root) throw new Error('Onyx: #root not found');

// Dev-only store handle for headless screenshot/QA harnesses (never ships to prod).
if (import.meta.env.DEV) {
  void import('@/lib/store/store').then((m) => {
    (window as unknown as { __onyx?: unknown }).__onyx = m;
  });
}

initVaultSync();

render(
  () => (
    <ThemeProvider>
      <SpotlightProvider>
        <Router>
          <Route path="/" component={Landing} />
          <Route path="/about" component={About} />
          <Route path="/app" component={AppShell} />
          <Route path="/appearance" component={Appearance} />
        </Router>
        {/* Global command palette — Cmd/Ctrl+K or / opens it from any route */}
        <Spotlight />
      </SpotlightProvider>
    </ThemeProvider>
  ),
  root,
);
