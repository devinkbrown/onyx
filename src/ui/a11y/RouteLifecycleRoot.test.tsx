// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lazy, type JSX } from 'solid-js';
import { A, MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ROUTE_ANNOUNCER_CLASS,
  DEFAULT_ROUTE_ANNOUNCER_LABEL,
  ROUTE_LIFECYCLE_APP_LABEL,
  ROUTE_LIFECYCLE_NOT_FOUND_LABEL,
  ROUTE_LIFECYCLE_MAP,
  RouteLifecycleRoot,
  normalizeRouteLifecyclePath,
  resolveRouteLifecycleEntry,
  resolveRouteLifecycleIdentity,
  resolveRouteLifecycleLabel,
  resolveNotFoundRouteLifecycleEntry,
} from './index';

afterEach(cleanup);

function sourceWithoutComments(fileName: string): string {
  const source = readFileSync(join(process.cwd(), 'src/ui/a11y', fileName), 'utf8');
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function liveRegion(): HTMLElement {
  const region = document.querySelector<HTMLElement>('[data-ui="route-announcer"]');
  if (!region) throw new Error('expected the persistent route live region');
  return region;
}

async function awaitLifecycleReady(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(document.querySelector('[data-ui="route-announcer"]')).toBeTruthy();
  });
  return liveRegion();
}

function HomePage(): JSX.Element {
  return (
    <div data-testid="page-home">
      <nav aria-label="Primary navigation">
        <A href="/about/">About</A>
        <A href="/download/">Downloads</A>
        <A href="/status/">Status</A>
        <A href="/app/">Open app</A>
      </nav>
      <main>
        <h1>Home</h1>
        <A href="/about/?ref=shelf#focus">About with query</A>
      </main>
    </div>
  );
}

function AboutPage(): JSX.Element {
  return (
    <div data-testid="page-about">
      <nav aria-label="Primary navigation">
        <A href="/">Home</A>
        <A href="/status/">Status</A>
      </nav>
      <main>
        <h1>About</h1>
        <A href="/about/#section">In-page section</A>
      </main>
    </div>
  );
}

function DownloadPage(): JSX.Element {
  return (
    <main data-testid="page-download">
      <h1>Downloads</h1>
    </main>
  );
}

function StatusPage(): JSX.Element {
  return (
    <main data-testid="page-status">
      <h1>Status</h1>
    </main>
  );
}

function AppPage(): JSX.Element {
  return (
    <main data-testid="page-app">
      <h1>{ROUTE_LIFECYCLE_APP_LABEL}</h1>
    </main>
  );
}

function LifecycleFixture(props: { history?: ReturnType<typeof createMemoryHistory> }): JSX.Element {
  return (
    <MemoryRouter root={RouteLifecycleRoot} history={props.history}>
      <Route path="/" component={HomePage} />
      <Route path="/about" component={AboutPage} />
      <Route path="/about/" component={AboutPage} />
      <Route path="/download" component={DownloadPage} />
      <Route path="/download/" component={DownloadPage} />
      <Route path="/install" component={DownloadPage} />
      <Route path="/install/" component={DownloadPage} />
      <Route path="/status" component={StatusPage} />
      <Route path="/status/" component={StatusPage} />
      <Route path="/app" component={AppPage} />
      <Route path="/app/" component={AppPage} />
    </MemoryRouter>
  );
}

async function expectAnnouncement(text: string): Promise<void> {
  await waitFor(() => {
    expect(liveRegion()).toHaveTextContent(text);
  });
}

describe('route lifecycle identity helpers', () => {
  it('normalizes trailing slashes and ignores query or hash', () => {
    expect(normalizeRouteLifecyclePath('/')).toBe('/');
    expect(normalizeRouteLifecyclePath('/about/')).toBe('/about');
    expect(normalizeRouteLifecyclePath('/download/?platform=linux#packages')).toBe('/download');
    expect(normalizeRouteLifecyclePath('/install/')).toBe('/install');
    expect(normalizeRouteLifecyclePath(undefined)).toBe('');
    expect(normalizeRouteLifecyclePath('?join=%23root')).toBe('');
  });

  it('maps every known public path plus app, and aliases install to download', () => {
    expect(Object.keys(ROUTE_LIFECYCLE_MAP).sort()).toEqual([
      '/',
      '/about',
      '/accessibility',
      '/agents',
      '/app',
      '/appearance',
      '/community',
      '/download',
      '/glossary',
      '/guides',
      '/integrations',
      '/invite',
      '/onyxos',
      '/roadmap',
      '/stats',
      '/status',
    ]);
    expect(resolveRouteLifecycleIdentity('/download/')).toBe('download');
    expect(resolveRouteLifecycleIdentity('/install/')).toBe('download');
    expect(resolveRouteLifecycleLabel('/install/?src=alias')).toBe('Download');
    expect(resolveRouteLifecycleLabel('/download')).toBe('Download');
    expect(resolveRouteLifecycleLabel('/invite/')).toBe('Join');
    expect(resolveRouteLifecycleEntry('/invite')?.publicNavigation).toBe(true);
    expect(resolveRouteLifecycleEntry('/status')?.publicNavigation).toBe(false);
    expect(resolveRouteLifecycleLabel('/app/')).toBe(ROUTE_LIFECYCLE_APP_LABEL);
    expect(resolveRouteLifecycleEntry('/app')?.publicNavigation).toBe(false);
    expect(resolveRouteLifecycleEntry('/download')?.publicNavigation).toBe(true);
    expect(resolveRouteLifecycleEntry('/missing')).toBeUndefined();
    expect(resolveRouteLifecycleLabel('/not-a-route/')).toBeUndefined();
    expect(resolveNotFoundRouteLifecycleEntry('/not-a-route/')?.label).toBe(ROUTE_LIFECYCLE_NOT_FOUND_LABEL);
    expect(resolveNotFoundRouteLifecycleEntry('/not-a-route/')?.id).toBe('not-found:/not-a-route');
  });
});

describe('RouteLifecycleRoot', () => {
  it('renders outlet children before the lazy controller is ready', async () => {
    render(() => <LifecycleFixture />);

    expect(screen.getByTestId('page-home')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();

    await awaitLifecycleReady();
    expect(liveRegion()).toHaveTextContent('');
  });

  it('seeds the initial route silently and hosts one polite atomic live region outside landmarks', async () => {
    const titleBefore = document.title;
    render(() => <LifecycleFixture />);
    const region = await awaitLifecycleReady();

    expect(document.querySelectorAll('[data-ui="route-announcer"]')).toHaveLength(1);
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toHaveAttribute('aria-label', DEFAULT_ROUTE_ANNOUNCER_LABEL);
    expect(region).toHaveClass(DEFAULT_ROUTE_ANNOUNCER_CLASS);
    expect(region).toHaveTextContent('');
    expect(region.closest('nav')).toBeNull();
    expect(region.closest('main')).toBeNull();
    expect(region.closest('[role="navigation"]')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(document.title).toBe(titleBefore);
    expect(document.activeElement).not.toBe(region);
  });

  it('announces one settled pathname transition and ignores query or hash-only changes', async () => {
    const history = createMemoryHistory();
    render(() => <LifecycleFixture history={history} />);
    await awaitLifecycleReady();
    expect(liveRegion()).toHaveTextContent('');

    history.set({ value: '/about/', scroll: false });
    await expectAnnouncement('About');
    const afterFirst = liveRegion().textContent;

    history.set({ value: '/about/?ref=shelf', scroll: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(liveRegion()).toHaveTextContent('About');
    expect(liveRegion().textContent).toBe(afterFirst);

    history.set({ value: '/about/?ref=shelf#section', scroll: false });
    await Promise.resolve();
    expect(liveRegion()).toHaveTextContent('About');
  });

  it('treats slash variants and install as the same download identity', async () => {
    const history = createMemoryHistory();
    render(() => <LifecycleFixture history={history} />);
    await awaitLifecycleReady();

    history.set({ value: '/download', scroll: false });
    await expectAnnouncement('Download');

    history.set({ value: '/download/', scroll: false });
    await Promise.resolve();
    expect(liveRegion()).toHaveTextContent('Download');

    history.set({ value: '/install', scroll: false });
    await Promise.resolve();
    expect(liveRegion()).toHaveTextContent('Download');

    history.set({ value: '/install/', scroll: false });
    await Promise.resolve();
    expect(liveRegion()).toHaveTextContent('Download');
    expect(document.querySelectorAll('[data-ui="route-announcer"]')).toHaveLength(1);
  });

  it('announces the explicit app lifecycle label', async () => {
    const history = createMemoryHistory();
    render(() => <LifecycleFixture history={history} />);
    await awaitLifecycleReady();

    history.set({ value: '/app/', scroll: false });
    await expectAnnouncement(ROUTE_LIFECYCLE_APP_LABEL);
    expect(screen.getByTestId('page-app')).toBeTruthy();
  });

  it('announces an unknown route without promoting it into the exact lifecycle map', async () => {
    const history = createMemoryHistory();
    render(() => <LifecycleFixture history={history} />);
    await awaitLifecycleReady();

    history.set({ value: '/about/', scroll: false });
    await expectAnnouncement('About');

    history.set({ value: '/definitely-missing', scroll: false });
    await expectAnnouncement(ROUTE_LIFECYCLE_NOT_FOUND_LABEL);
    expect(screen.queryByTestId('page-about')).toBeNull();
  });

  it('announces the first mapped route after an unknown initial identity', async () => {
    const history = createMemoryHistory();
    history.set({ value: '/definitely-missing', scroll: false });
    render(() => <LifecycleFixture history={history} />);
    await awaitLifecycleReady();
    expect(liveRegion()).toHaveTextContent('');

    history.set({ value: '/about/', scroll: false });
    await expectAnnouncement('About');
    expect(screen.getByTestId('page-about')).toBeTruthy();
  });

  it('suppresses a stale intermediate route when a later transition wins', async () => {
    let releaseAbout!: () => void;
    const aboutGate = new Promise<void>((resolve) => {
      releaseAbout = resolve;
    });
    const SlowAbout = lazy(async () => {
      await aboutGate;
      return { default: AboutPage };
    });

    const history = createMemoryHistory();
    render(() => (
      <MemoryRouter root={RouteLifecycleRoot} history={history}>
        <Route path="/" component={HomePage} />
        <Route path="/about" component={SlowAbout} />
        <Route path="/about/" component={SlowAbout} />
        <Route path="/status" component={StatusPage} />
        <Route path="/status/" component={StatusPage} />
      </MemoryRouter>
    ));
    await awaitLifecycleReady();

    history.set({ value: '/about/', scroll: false });
    history.set({ value: '/status/', scroll: false });
    await expectAnnouncement('Status');
    expect(liveRegion()).not.toHaveTextContent('About');

    releaseAbout();
    await Promise.resolve();
    await Promise.resolve();
    expect(liveRegion()).toHaveTextContent('Status');
    expect(liveRegion()).not.toHaveTextContent('About');
    expect(screen.getByTestId('page-status')).toBeTruthy();
  });

  it('announces the settled destination once for back and forward', async () => {
    const history = createMemoryHistory();
    render(() => <LifecycleFixture history={history} />);
    await awaitLifecycleReady();

    history.set({ value: '/about/', scroll: false });
    await expectAnnouncement('About');

    history.back();
    await expectAnnouncement('Home');

    history.forward();
    await expectAnnouncement('About');
  });

  it('does not re-announce when remounted on the same initial route', async () => {
    const first = render(() => <LifecycleFixture />);
    await awaitLifecycleReady();
    expect(liveRegion()).toHaveTextContent('');
    first.unmount();

    render(() => <LifecycleFixture />);
    await awaitLifecycleReady();
    await Promise.resolve();
    expect(document.querySelectorAll('[data-ui="route-announcer"]')).toHaveLength(1);
    expect(liveRegion()).toHaveTextContent('');
  });

  it('keeps the same live region across navigation and does not steal focus or mutate title or scroll', async () => {
    const history = createMemoryHistory();
    const titleBefore = document.title;
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    render(() => <LifecycleFixture history={history} />);
    await awaitLifecycleReady();

    const region = liveRegion();
    region.dataset.probe = 'same';
    const focused = document.createElement('button');
    focused.type = 'button';
    focused.textContent = 'keep-focus';
    document.body.append(focused);
    focused.focus();

    fireEvent.click(screen.getByRole('link', { name: 'About' }));
    await expectAnnouncement('About');

    expect(liveRegion()).toBe(region);
    expect(region.dataset.probe).toBe('same');
    expect(document.activeElement).toBe(focused);
    expect(document.title).toBe(titleBefore);
    expect(scrollTo).not.toHaveBeenCalled();
    focused.remove();
    scrollTo.mockRestore();
  });
});

describe('RouteLifecycleRoot host isolation', () => {
  it('composes the announcer without host globals, skip links, or navigation mutation', () => {
    const source = sourceWithoutComments('RouteLifecycle.tsx');
    expect(source).toMatch(/useIsRouting/);
    expect(source).toMatch(/RouteAnnouncer/);
    expect(source).not.toMatch(/SkipLinkSet/);
    expect(source).not.toMatch(/\bdocument\b/);
    expect(source).not.toMatch(/\bwindow\b/);
    expect(source).not.toMatch(/\blocalStorage\b/);
    expect(source).not.toMatch(/useStore|getState|createStore/);
    expect(source).not.toMatch(/from ['"][^'"]+\.css['"]/);
    expect(source).not.toMatch(/innerHTML|dangerouslySetInnerHTML/);
    expect(source).not.toMatch(/\.focus\s*\(/);
    expect(source).not.toMatch(/scrollTo|scrollIntoView|document\.title/);
    expect(source).not.toMatch(/history\.|pushState|replaceState/);
    expect(source).not.toMatch(/useNavigate|setPageMeta/);
  });

  it('does not leave a module-scope announcer singleton', () => {
    const source = sourceWithoutComments('RouteLifecycle.tsx');
    expect(source).not.toMatch(/^let |^var /m);
    const root = sourceWithoutComments('RouteLifecycleRoot.tsx');
    expect(root).toMatch(/lazy\(/);
    expect(root).toMatch(/props\.children/);
    expect(root).not.toMatch(/useIsRouting/);
    expect(root).not.toMatch(/from ['"]\.\/RouteAnnouncer['"]/);
    expect(root).not.toMatch(/^let |^var /m);
  });
});
