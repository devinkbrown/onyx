/* @refresh reload */
// MUST stay the first import: migrates legacy 'ocean-*' localStorage keys to
// 'onyx:*' as an import side effect, before any module-scope storage reads.
import './lib/migrateStorage';
import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import { lazy } from 'solid-js';
import '@fontsource/anton';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/instrument-sans';
import './styles/global.css';
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
