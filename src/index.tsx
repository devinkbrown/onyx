/* @refresh reload */
import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import { lazy } from 'solid-js';
import '@fontsource/anton';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/instrument-sans';
import './styles/global.css';
import Landing from './routes/Landing';

const About = lazy(() => import('./routes/About'));
const AppShell = lazy(() => import('./routes/AppRoute'));

const root = document.getElementById('root');
if (!root) throw new Error('Ruri: #root not found');

render(
  () => (
    <Router>
      <Route path="/" component={Landing} />
      <Route path="/about" component={About} />
      <Route path="/app" component={AppShell} />
    </Router>
  ),
  root,
);
