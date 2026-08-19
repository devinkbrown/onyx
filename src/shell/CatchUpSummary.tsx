// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CatchUpSummary.tsx — "where do I have unread?" at-a-glance card.
 *
 * A self-contained catch-up panel for the connected-but-idle Home surface: the
 * rooms + DMs with unread messages, ranked by unread count (busiest first),
 * each row a button that navigates to that target. The unread-ranked ordering
 * and totals come from the pure {@link summarizeCatchUp} / {@link catchUpTotals}
 * — this component only wires the store to the render.
 *
 * SOLID IDIOMS: never destructure props; splitProps; derived state in
 * createMemo; For/Show; the component body runs once and reactivity lives in the
 * graph. Store reads go through useStore (reactive); the click handler reads the
 * navigate action via getState() (a non-reactive snapshot — correct for an
 * event handler).
 */

import './catch-up-summary.css';

import { createMemo, createSignal, For, onCleanup, Show, splitProps, type JSX } from 'solid-js';

import { getState, useStore } from '@/lib/store';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import { formatRelative } from '@/lib/time/relativeTime';
import {
  catchUpTotals,
  summarizeCatchUp,
  type CatchUpRow,
} from '@/lib/catchup/summary';

const CLOCK_TICK_MS = 30_000;

export type CatchUpSummaryProps = {
  /** Maximum rooms to list. Defaults to the summary module default. */
  limit?: number;
  /** Optional callback fired after a row navigates (e.g. to close a sheet). */
  onNavigate?: (row: CatchUpRow) => void;
};

function rowAriaLabel(row: CatchUpRow, relative: string): string {
  const kind = row.kind === 'dm' ? 'direct messages from' : 'channel';
  const unread = `${row.unread} unread ${row.unread === 1 ? 'message' : 'messages'}`;
  const mentions = row.highlights > 0 ? `, ${row.highlights} mentioning you` : '';
  const when = relative ? `, last active ${relative}` : '';
  return `Open ${kind} ${row.name}, ${unread}${mentions}${when}`;
}

export function CatchUpSummary(props: CatchUpSummaryProps): JSX.Element {
  const [local] = splitProps(props, ['limit', 'onNavigate']);

  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);
  const channelLastActivity = useStore((s) => s.channelLastActivity);
  const ourNick = useStore((s) => s.ourNick);

  // One shared clock so every relative-time label ticks together (and stays
  // deterministic per render pass rather than reading Date.now() inline).
  const [nowMs, setNowMs] = createSignal(Date.now());
  const timer = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
  onCleanup(() => clearInterval(timer));

  const rows = createMemo<CatchUpRow[]>(() =>
    summarizeCatchUp(
      channels().values(),
      dms().values(),
      channelLastActivity(),
      local.limit,
    ),
  );

  const totals = createMemo(() => catchUpTotals(rows()));

  // Only meaningful once connected (we have a nick); before then, render nothing
  // rather than an empty "all caught up" that would look broken pre-connect.
  const connected = createMemo(() => ourNick().length > 0);

  const handleOpen = (row: CatchUpRow): void => {
    const view =
      row.kind === 'dm'
        ? ({ kind: 'dm', nick: row.target } as const)
        : ({ kind: 'channel', channel: row.target } as const);
    getState().navigate(view);
    local.onNavigate?.(row);
  };

  return (
    <Show when={connected()}>
      <section class="catchup" aria-labelledby="catchup-heading">
        <header class="catchup-header">
          <h2 id="catchup-heading" class="catchup-title">
            Catch up
          </h2>
          <Show when={rows().length > 0}>
            <p class="catchup-totals" aria-live="polite">
              {totals().unread} unread across {totals().rooms}{' '}
              {totals().rooms === 1 ? 'room' : 'rooms'}
              <Show when={totals().mentions > 0}>
                {' · '}
                <span class="catchup-mentions">{totals().mentions} mentioning you</span>
              </Show>
            </p>
          </Show>
        </header>

        <Show
          when={rows().length > 0}
          fallback={
            <p class="catchup-empty">You&rsquo;re all caught up — no unread rooms.</p>
          }
        >
          <ul class="catchup-list" aria-label="Rooms with unread activity">
            <For each={rows()}>
              {(row) => {
                const relative = createMemo(() =>
                  row.lastActive > 0 ? formatRelative(row.lastActive, nowMs()) : '',
                );
                return (
                  <li class="catchup-item">
                    <button
                      type="button"
                      class="catchup-row"
                      classList={{ 'catchup-row--mention': row.highlights > 0 }}
                      aria-label={rowAriaLabel(row, relative())}
                      onClick={() => handleOpen(row)}
                    >
                      <span class="catchup-name">{row.name}</span>
                      <Show when={relative()}>
                        <span class="catchup-when">{relative()}</span>
                      </Show>
                      <span class="catchup-badges">
                        <Show when={row.highlights > 0}>
                          <span class="catchup-badge catchup-badge--mention" aria-hidden="true">
                            @{row.highlights}
                          </span>
                        </Show>
                        <span class="catchup-badge catchup-badge--unread" aria-hidden="true">
                          {row.unread}
                        </span>
                      </span>
                    </button>
                    <Show when={row.kind === 'channel' && /^[#&]/.test(row.target.trim())}>
                      <a
                        class="catchup-ledger shell-ribbon-stats"
                        href={statsRoomHref(row.target)}
                        aria-label={`Channel ledger for ${row.target}`}
                        data-testid="catchup-channel-ledger"
                      >
                        Ledger
                      </a>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </section>
    </Show>
  );
}
