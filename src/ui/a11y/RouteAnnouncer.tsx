// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';

/**
 * Unmounted route-title live region for later strangler wiring.
 * Callers pass the completed title; this primitive never reads host DOM globals.
 */
export const ROUTE_ANNOUNCER_POLITENESS = ['polite', 'assertive', 'off'] as const;
export type RouteAnnouncerPoliteness = (typeof ROUTE_ANNOUNCER_POLITENESS)[number];

export const DEFAULT_ROUTE_ANNOUNCER_LABEL = 'Route';
export const DEFAULT_ROUTE_ANNOUNCER_CLASS = 'ui-visually-hidden';

export type RouteTitleInput = string | PromiseLike<string> | null | undefined;

export type RouteAnnouncerProps = {
  /** Completed route title. Incomplete or pending values stay silent. */
  title?: RouteTitleInput;
  /** Live-region politeness. `off` keeps the region mounted but silent. */
  politeness?: RouteAnnouncerPoliteness;
  /** Identity of the current route. A new key may re-announce the same title. */
  routeKey?: string;
  /** Optional spoken prefix applied when a completed change is announced. */
  prefix?: string;
  /** When true, the current title is not yet complete. */
  pending?: boolean;
  /** Accessible name for the live region. */
  label?: string;
  /** Extra classes. The default token utility is always applied. */
  class?: string;
  /** Construction-time seed. Presence marks the announcer already seeded. */
  initial?: Readonly<{ title?: string; routeKey?: string }>;
};

export function resolveRouteAnnouncerPoliteness(value: unknown): RouteAnnouncerPoliteness {
  return value === 'assertive' || value === 'off' || value === 'polite' ? value : 'polite';
}

export function normalizeRouteTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const title = value.trim().replace(/\s+/g, ' ');
  return title.length > 0 ? title : undefined;
}

export function formatRouteAnnouncement(title: string, prefix?: string): string {
  const cleanedPrefix = typeof prefix === 'string' ? prefix.trim() : '';
  if (cleanedPrefix.length === 0) return title;
  return `${cleanedPrefix} ${title}`;
}

export function isRouteTitleThenable(value: unknown): value is PromiseLike<string> {
  return typeof value === 'object' && value !== null && typeof (value as PromiseLike<string>).then === 'function';
}

export function shouldAnnounceRouteChange(input: {
  seeded: boolean;
  title: string;
  lastTitle: string;
  routeKey?: string;
  lastRouteKey?: string;
}): boolean {
  if (!input.seeded) return false;
  return input.title !== input.lastTitle || (input.routeKey ?? '') !== (input.lastRouteKey ?? '');
}

function liveRole(politeness: RouteAnnouncerPoliteness): 'status' | 'alert' {
  return politeness === 'assertive' ? 'alert' : 'status';
}

export function RouteAnnouncer(props: RouteAnnouncerProps): JSX.Element {
  const [announcement, setAnnouncement] = createSignal('');
  let generation = 0;
  const initial = props.initial;
  let seeded = initial !== undefined;
  let lastTitle = initial !== undefined ? (normalizeRouteTitle(initial.title) ?? '') : '';
  let lastRouteKey = initial !== undefined ? (initial.routeKey ?? '') : '';

  const politeness = createMemo(() => resolveRouteAnnouncerPoliteness(props.politeness));
  const className = createMemo(() =>
    [DEFAULT_ROUTE_ANNOUNCER_CLASS, props.class].filter(Boolean).join(' '),
  );
  const label = createMemo(() => {
    const named = typeof props.label === 'string' ? props.label.trim() : '';
    return named.length > 0 ? named : DEFAULT_ROUTE_ANNOUNCER_LABEL;
  });

  createEffect(() => {
    const routeKey = props.routeKey ?? '';
    const input = props.title;
    const prefix = props.prefix;
    const pending = props.pending === true;
    const gen = ++generation;

    const apply = (raw: unknown) => {
      if (gen !== generation) return;
      const title = normalizeRouteTitle(raw);
      if (title === undefined) return;
      if (!shouldAnnounceRouteChange({
        seeded,
        title,
        lastTitle,
        routeKey,
        lastRouteKey,
      })) {
        seeded = true;
        lastTitle = title;
        lastRouteKey = routeKey;
        return;
      }
      lastTitle = title;
      lastRouteKey = routeKey;
      setAnnouncement(formatRouteAnnouncement(title, prefix));
    };

    if (pending) return;

    if (isRouteTitleThenable(input)) {
      void Promise.resolve(input).then(
        (value) => apply(value),
        () => undefined,
      );
      return;
    }

    apply(input);
  });

  onCleanup(() => {
    generation += 1;
  });

  return (
    <div
      data-ui="route-announcer"
      data-politeness={politeness()}
      class={className()}
      role={liveRole(politeness())}
      aria-live={politeness()}
      aria-atomic="true"
      aria-label={label()}
    >
      {announcement()}
    </div>
  );
}
