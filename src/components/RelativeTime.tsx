// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * RelativeTime.tsx — a self-updating, prop-driven relative-timestamp label.
 *
 * Renders a compact relative label ("just now" / "3m" / "2h" / "5d", an absolute
 * date past a week) that ticks itself forward on an interval, and exposes the
 * exact instant to assistive tech and tooltips via <time datetime> + title.
 *
 * Self-contained: it takes an epoch-millisecond `timestamp` and reads nothing
 * from the store, so integration is a pure add wherever a timestamp renders.
 * The clock is injectable (`now`) for deterministic tests.
 *
 * SOLID IDIOMS: component runs once; never destructure props; reads stay
 * reactive (memos + JSX); the interval is torn down in onCleanup.
 */

import { createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { formatRelative } from '@/lib/time/relativeTime';

const DEFAULT_INTERVAL_MS = 30_000;

export type RelativeTimeProps = {
  /** The instant to describe, in epoch milliseconds. */
  timestamp: number;
  /** How often to re-evaluate the label, in milliseconds. Defaults to 30s. */
  intervalMs?: number;
  /** Injectable clock (epoch ms); defaults to Date.now, overridable for tests. */
  now?: () => number;
};

export function RelativeTime(props: RelativeTimeProps): JSX.Element {
  const readNow = (): number => (props.now ?? Date.now)();
  const [nowMs, setNowMs] = createSignal(readNow());

  // Tick the clock forward on an interval. Reading intervalMs inside the effect
  // keeps the cadence reactive and re-arms the timer if it changes; onCleanup
  // clears the previous timer on every re-run and on unmount, so none leaks.
  createEffect(() => {
    const period = props.intervalMs ?? DEFAULT_INTERVAL_MS;
    const timer = setInterval(() => setNowMs(readNow()), period);
    onCleanup(() => clearInterval(timer));
  });

  const timestampDate = createMemo(() => new Date(props.timestamp));
  const validTimestamp = createMemo(() => Number.isFinite(timestampDate().getTime()));
  const label = createMemo(() => validTimestamp() ? formatRelative(props.timestamp, nowMs()) : '');
  const iso = createMemo(() => validTimestamp() ? timestampDate().toISOString() : undefined);

  return (
    <time class="relative-time" datetime={iso()} title={iso()}>
      {label()}
    </time>
  );
}
