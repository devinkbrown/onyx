// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * OperEventConsole.tsx — Operator Event Spine surface (Era 2 B14 + REPLAY).
 *
 * Renders recent service/oper notices that look like Event Spine traffic and
 * offers a bounded EVENT REPLAY request so operators can pull structured
 * history without a full external console.
 */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { useStore } from '@/lib/store';
import './stage-panel.css';

const SPINE_HINT =
  /\b(EVENT|WARD|MESH|WEBPUSH|RECOVERYCODES|MEDIA|S2S|UPGRADE|HELIX)\b/i;

const REPLAY_LIMITS = [25, 50, 100] as const;

export function OperEventConsole(): JSX.Element {
  const isOper = useStore((s) => s.isOper);
  const notices = useStore((s) => s.serviceNotices);
  const client = useStore((s) => s.client);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const [limit, setLimit] = createSignal<(typeof REPLAY_LIMITS)[number]>(50);
  const [lastRequest, setLastRequest] = createSignal<string | null>(null);

  const rows = createMemo(() => {
    const list = notices() ?? [];
    return list
      .filter((n) => SPINE_HINT.test(n.text) || n.source === 'Oper' || n.source === 'Server')
      .slice(-40)
      .reverse();
  });

  const canReplay = createMemo(
    () => connectionStatus() === 'connected' && !!client(),
  );

  function requestReplay(): void {
    const c = client();
    if (!c || connectionStatus() !== 'connected') return;
    const n = limit();
    // Bounded REPLAY — operators pull a window of Event Spine frames.
    // Wire shape matches Onyx Server EVENT REPLAY <limit> (fail closed if
    // unknown: server returns a standard error notice).
    c.sendRaw('EVENT', 'REPLAY', String(n));
    setLastRequest(`EVENT REPLAY ${n} · ${new Date().toLocaleTimeString()}`);
  }

  return (
    <Show when={isOper()}>
      <section
        class="oper-event-console"
        data-testid="oper-event-console"
        aria-labelledby="oper-event-console-title"
      >
        <h3 id="oper-event-console-title" class="acct-section-title">
          Event Spine
        </h3>
        <p class="acct-section-hint">
          Operator-visible notices that match Event Spine traffic, plus a bounded
          JSON REPLAY request against the live daemon.
        </p>

        <div class="oper-event-console__toolbar" data-testid="oper-event-replay-toolbar">
          <label class="oper-event-console__limit">
            <span class="sr-only">REPLAY limit</span>
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
            EVENT REPLAY
          </button>
        </div>
        <Show when={lastRequest()}>
          {(req) => (
            <p class="acct-session-placeholder-body" data-testid="oper-event-replay-status" role="status">
              Requested {req()}
            </p>
          )}
        </Show>

        <Show
          when={rows().length > 0}
          fallback={
            <p class="acct-session-placeholder-body" data-testid="oper-event-empty" role="status">
              No recent spine-tagged notices yet.
            </p>
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
      </section>
    </Show>
  );
}

export default OperEventConsole;
