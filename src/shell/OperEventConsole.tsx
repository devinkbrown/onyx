// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * OperEventConsole.tsx — Operator Event Spine surface (Era 2 B14 + REPLAY JSON).
 *
 * Renders recent service/oper notices that look like Event Spine traffic and
 * offers a bounded EVENT REPLAY JSON request so operators can pull a structured
 * history feed without scraping prose notices.
 */
import { createMemo, createSignal, createUniqueId, For, Show, type JSX } from 'solid-js';
import { getState, useStore } from '@/lib/store';
import { formatEventReplayEvent } from '@/lib/irc/eventReplayJson';
import { filterEventReplayRows, normalizeEventFilter } from '@/lib/moderation/eventFilters';
import './stage-panel.css';

const SPINE_HINT =
  /\b(EVENT|WARD|MESH|WEBPUSH|RECOVERYCODES|MEDIA|S2S|UPGRADE|HELIX)\b/i;

const REPLAY_LIMITS = [25, 50, 100] as const;

export function OperEventConsole(): JSX.Element {
  const instanceId = createUniqueId();
  const titleId = `oper-event-console-title-${instanceId}`;
  const categoryId = `oper-event-filter-category-${instanceId}`;
  const severityId = `oper-event-filter-severity-${instanceId}`;
  const textId = `oper-event-filter-text-${instanceId}`;
  const isOper = useStore((s) => s.isOper);
  const notices = useStore((s) => s.serviceNotices);
  const client = useStore((s) => s.client);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const operEventReplay = useStore((s) => s.operEventReplay);
  const [limit, setLimit] = createSignal<(typeof REPLAY_LIMITS)[number]>(50);
  const [lastRequest, setLastRequest] = createSignal<string | null>(null);
  const [category, setCategory] = createSignal('');
  const [severity, setSeverity] = createSignal('');
  const [text, setText] = createSignal('');

  const rows = createMemo(() => {
    const list = notices() ?? [];
    return list
      .filter((n) => SPINE_HINT.test(n.text) || n.source === 'Oper' || n.source === 'Server')
      .slice(-40)
      .reverse();
  });

  const feed = createMemo(() => operEventReplay());
  const structuredRows = createMemo(() => filterEventReplayRows(feed().events, {
    category: category(),
    severity: severity(),
    text: text(),
  }));
  const categories = createMemo(() => {
    const seen = new Set<string>();
    for (const event of feed().events) {
      if (event.categoryCode) seen.add(event.categoryCode);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  });
  const severities = createMemo(() => {
    const seen = new Set<string>();
    for (const event of feed().events) {
      if (event.severity) seen.add(event.severity);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  });

  const canReplay = createMemo(
    () => connectionStatus() === 'connected' && !!client(),
  );

  function requestReplay(): void {
    if (!canReplay()) return;
    const n = limit();
    // Structured feed: EVENT REPLAY JSON ALL <limit> — parsed into
    // store.operEventReplay via server NOTICE intercept (fail closed).
    getState().requestOperEventReplay(n);
    setLastRequest(`EVENT REPLAY JSON ALL ${n} · ${new Date().toLocaleTimeString()}`);
  }

  return (
    <Show when={isOper()}>
      <section
        class="oper-event-console"
        data-testid="oper-event-console"
        aria-labelledby={titleId}
      >
        <h3 id={titleId} class="acct-section-title">
          Event Spine
        </h3>
        <p class="acct-section-hint">
          Operator-visible notices that match Event Spine traffic, plus a bounded
          refresh of the structured history feed.
        </p>

        <div class="oper-event-console__toolbar" data-testid="oper-event-replay-toolbar">
          <label class="oper-event-console__limit">
            <span class="sr-only">Number of events to refresh</span>
            <select
              data-testid="oper-event-replay-limit"
              value={String(limit())}
              onChange={(e) => {
                const next = Number(e.currentTarget.value);
                if ((REPLAY_LIMITS as readonly number[]).includes(next)) {
                  setLimit(next as (typeof REPLAY_LIMITS)[number]);
                }
              }}
            >
              <For each={[...REPLAY_LIMITS]}>
                {(n) => <option value={String(n)}>{n} events</option>}
              </For>
            </select>
          </label>
          <button
            type="button"
            class="acct-btn"
            data-testid="oper-event-replay"
            disabled={!canReplay()}
            onClick={() => requestReplay()}
          >
            Refresh events
          </button>
        </div>
        <Show when={lastRequest()}>
          {(req) => (
            <p class="acct-session-placeholder-body" data-testid="oper-event-replay-status" role="status">
              Requested {req()}
              <Show when={feed().pending}>
                <span data-testid="oper-event-replay-pending"> · waiting…</span>
              </Show>
              <Show when={feed().complete}>
                <span data-testid="oper-event-replay-complete">
                  {' '}· {structuredRows().length}
                  {feed().expectedCount != null ? `/${feed().expectedCount}` : ''} events
                  {feed().severityFloor ? ` · floor ${feed().severityFloor}` : ''}
                </span>
              </Show>
            </p>
          )}
        </Show>

        <Show when={feed().events.length > 0}>
          <div class="oper-event-console__filters" data-testid="oper-event-filters">
            <label for={categoryId}>
              <span class="sr-only">Filter by category</span>
              <select
                id={categoryId}
                data-testid="oper-event-filter-category"
                value={category()}
                onChange={(event) => setCategory(normalizeEventFilter(event.currentTarget.value, 32))}
              >
                <option value="">All categories</option>
                <For each={categories()}>
                  {(value) => <option value={value}>{value}</option>}
                </For>
              </select>
            </label>
            <label for={severityId}>
              <span class="sr-only">Filter by severity</span>
              <select
                id={severityId}
                data-testid="oper-event-filter-severity"
                value={severity()}
                onChange={(event) => setSeverity(normalizeEventFilter(event.currentTarget.value, 24))}
              >
                <option value="">All severities</option>
                <For each={severities()}>
                  {(value) => <option value={value}>{value}</option>}
                </For>
              </select>
            </label>
            <label for={textId}>
              <span class="sr-only">Filter events by text</span>
              <input
                id={textId}
                data-testid="oper-event-filter-text"
                type="search"
                value={text()}
                placeholder="Filter text"
                onInput={(event) => setText(normalizeEventFilter(event.currentTarget.value))}
              />
            </label>
          </div>
        </Show>

        <Show when={structuredRows().length > 0}>
          <ul
            class="oper-event-console__list oper-event-console__list--json"
            aria-label="Structured event feed"
            data-testid="oper-event-json-list"
          >
            <For each={structuredRows()}>
              {(ev) => (
                <li class="oper-event-console__row oper-event-console__row--json" data-testid="oper-event-json-row">
                  <span class="oper-event-console__src" data-testid="oper-event-json-cat">
                    {ev.categoryCode}
                  </span>
                  <span class="oper-event-console__sev" data-testid="oper-event-json-sev">
                    {ev.severity}
                  </span>
                  <span class="oper-event-console__text" data-testid="oper-event-json-text">
                    {formatEventReplayEvent(ev)}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={feed().events.length > 0 && structuredRows().length === 0}>
          <p class="acct-session-placeholder-body" data-testid="oper-event-filter-empty" role="status">
            No events match these local filters.
          </p>
        </Show>

        <Show
          when={rows().length > 0}
          fallback={
            <Show when={structuredRows().length === 0 && feed().events.length === 0}>
              <p class="acct-session-placeholder-body" data-testid="oper-event-empty" role="status">
                No recent spine-tagged notices yet.
              </p>
            </Show>
          }
        >
          <ul class="oper-event-console__list" aria-label="Recent oper event notices">
            <For each={rows()}>
              {(row) => (
                <li class="oper-event-console__row" data-testid="oper-event-row">
                  <span class="oper-event-console__src">{row.source}</span>
                  <span class="oper-event-console__text">{row.text}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <details class="moderation-cockpit__protocol">
          <summary>Open-wire details</summary>
          <p>Raw command used to refresh the structured feed. This does not send extra server commands when you filter locally.</p>
          <code data-testid="oper-event-replay-wire">EVENT REPLAY JSON ALL {limit()}</code>
        </details>
      </section>
    </Show>
  );
}

export default OperEventConsole;
