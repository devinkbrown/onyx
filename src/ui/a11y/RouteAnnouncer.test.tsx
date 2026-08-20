// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSignal } from 'solid-js';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTE_ANNOUNCER_CLASS,
  DEFAULT_ROUTE_ANNOUNCER_LABEL,
  ROUTE_ANNOUNCER_POLITENESS,
  RouteAnnouncer,
  formatRouteAnnouncement,
  isRouteTitleThenable,
  normalizeRouteTitle,
  resolveRouteAnnouncerPoliteness,
  shouldAnnounceRouteChange,
} from './index';

afterEach(cleanup);

function sourceWithoutComments(fileName: string): string {
  const source = readFileSync(join(process.cwd(), 'src/ui/a11y', fileName), 'utf8');
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('RouteAnnouncer helpers', () => {
  it('normalizes completed titles and rejects incomplete values', () => {
    expect(normalizeRouteTitle('  Status   page  ')).toBe('Status page');
    expect(normalizeRouteTitle('About')).toBe('About');
    expect(normalizeRouteTitle('')).toBeUndefined();
    expect(normalizeRouteTitle('   ')).toBeUndefined();
    expect(normalizeRouteTitle(null)).toBeUndefined();
    expect(normalizeRouteTitle(undefined)).toBeUndefined();
    expect(normalizeRouteTitle(12)).toBeUndefined();
  });

  it('formats an optional prefix without inventing copy', () => {
    expect(formatRouteAnnouncement('About')).toBe('About');
    expect(formatRouteAnnouncement('About', '  Navigated to  ')).toBe('Navigated to About');
    expect(formatRouteAnnouncement('About', '   ')).toBe('About');
  });

  it('detects thenables without assuming a host Promise implementation', () => {
    expect(isRouteTitleThenable('About')).toBe(false);
    expect(isRouteTitleThenable(null)).toBe(false);
    expect(isRouteTitleThenable(Promise.resolve('About'))).toBe(true);
    expect(isRouteTitleThenable({ then: (fn: (value: string) => void) => fn('About') })).toBe(true);
  });

  it('resolves politeness fail-closed to polite', () => {
    expect(resolveRouteAnnouncerPoliteness('polite')).toBe('polite');
    expect(resolveRouteAnnouncerPoliteness('assertive')).toBe('assertive');
    expect(resolveRouteAnnouncerPoliteness('off')).toBe('off');
    expect(resolveRouteAnnouncerPoliteness('loud')).toBe('polite');
    expect(resolveRouteAnnouncerPoliteness(undefined)).toBe('polite');
    expect(ROUTE_ANNOUNCER_POLITENESS).toEqual(['polite', 'assertive', 'off']);
  });

  it('dedups the initial title and identical later titles', () => {
    expect(shouldAnnounceRouteChange({
      seeded: false,
      title: 'Home',
      lastTitle: '',
    })).toBe(false);
    expect(shouldAnnounceRouteChange({
      seeded: true,
      title: 'Home',
      lastTitle: 'Home',
      routeKey: '/',
      lastRouteKey: '/',
    })).toBe(false);
    expect(shouldAnnounceRouteChange({
      seeded: true,
      title: 'About',
      lastTitle: 'Home',
      routeKey: '/about/',
      lastRouteKey: '/',
    })).toBe(true);
    expect(shouldAnnounceRouteChange({
      seeded: true,
      title: 'About',
      lastTitle: 'About',
      routeKey: '/about/team/',
      lastRouteKey: '/about/',
    })).toBe(true);
  });
});

describe('RouteAnnouncer', () => {
  it('does not announce the first completed title', () => {
    render(() => <RouteAnnouncer title="Home" routeKey="/" />);

    const region = document.querySelector('[data-ui="route-announcer"]');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toHaveAttribute('aria-label', DEFAULT_ROUTE_ANNOUNCER_LABEL);
    expect(region).toHaveClass(DEFAULT_ROUTE_ANNOUNCER_CLASS);
    expect(region).toHaveTextContent('');
    expect(document.title).not.toBe('Home');
  });

  it('announces a later completed title change exactly once', () => {
    const [title, setTitle] = createSignal('Home');
    const [routeKey, setRouteKey] = createSignal('/');

    render(() => <RouteAnnouncer title={title()} routeKey={routeKey()} />);
    expect(document.querySelector('[data-ui="route-announcer"]')).toHaveTextContent('');

    setTitle('About');
    setRouteKey('/about/');
    expect(screen.getByRole('status', { name: DEFAULT_ROUTE_ANNOUNCER_LABEL })).toHaveTextContent('About');

    setTitle('About');
    setRouteKey('/about/');
    expect(screen.getByRole('status')).toHaveTextContent('About');
  });

  it('re-announces the same title when the route identity changes', () => {
    const [title, setTitle] = createSignal('About');
    const [routeKey, setRouteKey] = createSignal('/about/');

    render(() => <RouteAnnouncer title={title()} routeKey={routeKey()} prefix="Navigated to" />);
    expect(document.querySelector('[data-ui="route-announcer"]')).toHaveTextContent('');

    setTitle('About');
    setRouteKey('/about/team/');
    expect(screen.getByRole('status')).toHaveTextContent('Navigated to About');
  });

  it('ignores incomplete titles and pending updates', () => {
    const [title, setTitle] = createSignal('Home');
    const [pending, setPending] = createSignal(false);

    render(() => <RouteAnnouncer title={title()} pending={pending()} />);

    setTitle('   ');
    expect(screen.getByRole('status')).toHaveTextContent('');

    setPending(true);
    setTitle('About');
    expect(screen.getByRole('status')).toHaveTextContent('');

    setPending(false);
    expect(screen.getByRole('status')).toHaveTextContent('About');
  });

  it('updates politeness and accessible name reactively', () => {
    const [politeness, setPoliteness] = createSignal<(typeof ROUTE_ANNOUNCER_POLITENESS)[number]>('polite');
    const [label, setLabel] = createSignal('Route');

    render(() => (
      <RouteAnnouncer
        title="Home"
        politeness={politeness()}
        label={label()}
        class="token-live"
      />
    ));

    let region = screen.getByRole('status', { name: 'Route' });
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('data-politeness', 'polite');
    expect(region).toHaveClass(DEFAULT_ROUTE_ANNOUNCER_CLASS, 'token-live');

    setPoliteness('assertive');
    setLabel('Page');
    region = screen.getByRole('alert', { name: 'Page' });
    expect(region).toHaveAttribute('aria-live', 'assertive');
    expect(region).toHaveAttribute('data-politeness', 'assertive');

    setPoliteness('off');
    region = screen.getByRole('status', { name: 'Page' });
    expect(region).toHaveAttribute('aria-live', 'off');
    expect(region).toHaveAttribute('data-politeness', 'off');
  });

  it('announces a completed async title and drops a stale earlier one', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const [title, setTitle] = createSignal<string | Promise<string>>('Home');
    const [routeKey, setRouteKey] = createSignal('/');

    render(() => <RouteAnnouncer title={title()} routeKey={routeKey()} />);

    setTitle(first.promise);
    setRouteKey('/stale/');
    setTitle(second.promise);
    setRouteKey('/about/');

    first.resolve('Stale');
    await Promise.resolve();
    expect(screen.getByRole('status')).toHaveTextContent('');

    second.resolve('About');
    await Promise.resolve();
    expect(screen.getByRole('status')).toHaveTextContent('About');
  });

  it('treats the first async resolution as a silent seed', async () => {
    const pending = deferred<string>();
    render(() => <RouteAnnouncer title={pending.promise} routeKey="/" />);

    pending.resolve('Home');
    await Promise.resolve();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('fails closed on a rejected title promise', async () => {
    const pending = deferred<string>();
    const [title, setTitle] = createSignal<string | Promise<string>>('Home');

    render(() => <RouteAnnouncer title={title()} />);
    setTitle(pending.promise);
    pending.reject(new Error('title failed'));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('invalidates in-flight titles on cleanup', async () => {
    const pending = deferred<string>();
    const [title, setTitle] = createSignal<string | Promise<string>>('Home');
    const { unmount } = render(() => <RouteAnnouncer title={title()} />);

    setTitle(pending.promise);
    unmount();
    pending.resolve('About');
    await Promise.resolve();
    await Promise.resolve();

    render(() => <RouteAnnouncer title="Later" />);
    expect(document.querySelector('[data-ui="route-announcer"]')).toHaveTextContent('');
  });

  it('honours a known initial seed without re-announcing the same identity', () => {
    const [title, setTitle] = createSignal('Home');
    const [routeKey, setRouteKey] = createSignal('home');

    render(() => (
      <RouteAnnouncer
        title={title()}
        routeKey={routeKey()}
        initial={{ title: 'Home', routeKey: 'home' }}
      />
    ));
    expect(document.querySelector('[data-ui="route-announcer"]')).toHaveTextContent('');

    setTitle('Home');
    setRouteKey('home');
    expect(document.querySelector('[data-ui="route-announcer"]')).toHaveTextContent('');

    setTitle('About');
    setRouteKey('about');
    expect(screen.getByRole('status')).toHaveTextContent('About');
  });

  it('treats an empty initial seed as seeded so the first known title announces', () => {
    const [title, setTitle] = createSignal<string | undefined>(undefined);
    const [routeKey, setRouteKey] = createSignal<string | undefined>(undefined);

    render(() => <RouteAnnouncer title={title()} routeKey={routeKey()} initial={{}} />);
    expect(document.querySelector('[data-ui="route-announcer"]')).toHaveTextContent('');

    setTitle('About');
    setRouteKey('about');
    expect(screen.getByRole('status')).toHaveTextContent('About');
  });

  it('keeps an off region silent while still accepting later polite changes', () => {
    const [title, setTitle] = createSignal('Home');
    const [politeness, setPoliteness] = createSignal<(typeof ROUTE_ANNOUNCER_POLITENESS)[number]>('off');

    render(() => <RouteAnnouncer title={title()} politeness={politeness()} />);
    setTitle('About');
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'off');
    expect(region).toHaveTextContent('About');

    setPoliteness('polite');
    setTitle('Status');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveTextContent('Status');
  });
});

describe('RouteAnnouncer host isolation', () => {
  it('has no host DOM, store, or stylesheet dependency', () => {
    const source = sourceWithoutComments('RouteAnnouncer.tsx');
    expect(source).not.toMatch(/\bdocument\b/);
    expect(source).not.toMatch(/\bwindow\b/);
    expect(source).not.toMatch(/\blocalStorage\b/);
    expect(source).not.toMatch(/useStore|getState|createStore/);
    expect(source).not.toMatch(/from ['"][^'"]+\.css['"]/);
    expect(source).not.toMatch(/innerHTML|dangerouslySetInnerHTML/);
  });

  it('runs title helpers without reading or writing the host document', () => {
    const titleBefore = document.title;
    expect(normalizeRouteTitle(' Status ')).toBe('Status');
    expect(formatRouteAnnouncement('Status', 'Now')).toBe('Now Status');
    expect(shouldAnnounceRouteChange({
      seeded: true,
      title: 'Status',
      lastTitle: 'Home',
    })).toBe(true);
    expect(document.title).toBe(titleBefore);
  });
});
