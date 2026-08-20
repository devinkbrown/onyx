// SPDX-License-Identifier: AGPL-3.0-or-later
import { MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';
import { render, screen, within } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import NotFoundRoute, { setNotFoundPageMeta } from './NotFound';
import { setPageMeta } from './pageMeta';

function renderMiss(path: string) {
  const history = createMemoryHistory();
  history.set({ value: path, scroll: false });
  return render(() => <MemoryRouter history={history}><Route path="/*notFound" component={NotFoundRoute} /></MemoryRouter>);
}

describe('NotFoundRoute', () => {
  it('uses the public frame and never reflects an unknown path', () => {
    const unknown = '/untrusted/%3Cscript%3E';
    const { container } = renderMiss(unknown);
    expect(screen.getAllByRole('heading', { level: 1, name: 'Route terminus' })).toHaveLength(1);
    expect(screen.getByText(/404/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
    expect(container.textContent).not.toContain(unknown);
    expect(container.querySelectorAll('main#public-main[aria-label="Onyx page not found"]')).toHaveLength(1);
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
  });

  it('keeps an app-subtree miss in the app recovery lane', () => {
    const { container } = renderMiss('/app/room/unknown');
    expect(within(container.querySelector('main')!).getByRole('link', { name: 'Open Onyx' })).toHaveAttribute('href', '/app/');
  });

  it('removes route-truth claims and lets the next known route restore them', () => {
    setPageMeta('Onyx status', 'Network health.', '/status');
    setNotFoundPageMeta();
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('meta[property="og:url"]')).toBeNull();
    expect(document.querySelector('script[data-onyx-route-jsonld]')).toBeNull();

    setPageMeta('Onyx status', 'Network health.', '/status');
    expect(document.querySelector('meta[data-onyx-route-robots]')).toBeNull();
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', `${window.location.origin}/status/`);
  });

  it('adopts a hard-loaded static 404 robots marker and removes it on a known route', () => {
    document.querySelectorAll('meta[name="robots"]').forEach((node) => node.remove());
    const staticRobots = document.createElement('meta');
    staticRobots.name = 'robots';
    staticRobots.content = 'noindex, nofollow';
    staticRobots.dataset.onyxRouteRobots = 'true';
    document.head.append(staticRobots);

    setNotFoundPageMeta();
    expect(document.querySelectorAll('meta[name="robots"]')).toHaveLength(1);

    setPageMeta('Onyx status', 'Network health.', '/status');
    expect(document.querySelectorAll('meta[name="robots"]')).toHaveLength(0);
  });
});
