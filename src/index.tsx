/* @refresh reload */
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
if (!root) throw new Error('Ruri: #root not found');

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
