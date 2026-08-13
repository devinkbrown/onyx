// SPDX-License-Identifier: AGPL-3.0-or-later
import { type JSX } from 'solid-js';
import { A, MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteLifecycleRoot } from './RouteLifecycleRoot';

const lifecycleImport = vi.hoisted(() => {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = () => {
      resolve();
    };
  });
  return {
    release() {
      release();
    },
    held,
  };
});

vi.mock('./RouteLifecycle', async () => {
  await lifecycleImport.held;
  return await vi.importActual<typeof import('./RouteLifecycle')>('./RouteLifecycle');
});

afterEach(cleanup);

function HomePage(): JSX.Element {
  return (
    <div data-testid="page-home">
      <A href="/about/">About</A>
    </div>
  );
}

function AboutPage(): JSX.Element {
  return (
    <main data-testid="page-about">
      <h1>About</h1>
    </main>
  );
}

function Fixture(props: { history?: ReturnType<typeof createMemoryHistory> }): JSX.Element {
  return (
    <MemoryRouter root={RouteLifecycleRoot} history={props.history}>
      <Route path="/" component={HomePage} />
      <Route path="/about" component={AboutPage} />
      <Route path="/about/" component={AboutPage} />
    </MemoryRouter>
  );
}

function liveRegions(): NodeListOf<HTMLElement> {
  return document.querySelectorAll<HTMLElement>('[data-ui="route-announcer"]');
}

describe('RouteLifecycleRoot lazy controller race', () => {
  it('renders the outlet before the live region and announces a held pre-chunk navigation', async () => {
    const history = createMemoryHistory();
    render(() => <Fixture history={history} />);

    expect(screen.getByTestId('page-home')).toBeTruthy();
    expect(liveRegions()).toHaveLength(0);

    history.set({ value: '/about/', scroll: false });
    await waitFor(() => {
      expect(screen.getByTestId('page-about')).toBeTruthy();
    });
    expect(liveRegions()).toHaveLength(0);

    lifecycleImport.release();
    await waitFor(() => {
      expect(liveRegions()).toHaveLength(1);
    });

    const region = liveRegions()[0];
    if (!region) throw new Error('expected the persistent route live region');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveTextContent('About');
  });

  it('announces unknown then known after the controller is ready', async () => {
    lifecycleImport.release();
    const history = createMemoryHistory();
    history.set({ value: '/definitely-missing', scroll: false });
    render(() => <Fixture history={history} />);

    await waitFor(() => {
      expect(liveRegions()).toHaveLength(1);
    });
    expect(liveRegions()[0]).toHaveTextContent('');

    history.set({ value: '/about/', scroll: false });
    await waitFor(() => {
      expect(liveRegions()[0]).toHaveTextContent('About');
    });
    expect(liveRegions()).toHaveLength(1);
    expect(screen.getByTestId('page-about')).toBeTruthy();
  });
});
