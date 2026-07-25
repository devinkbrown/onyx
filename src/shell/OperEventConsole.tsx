// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * OperEventConsole.tsx — minimal Operator Event Spine surface (Era 2 B14).
 *
 * Renders recent service/oper notices that look like Event Spine traffic so
 * operators can glance without a full JSON console. Full EVENT REPLAY UI is a
 * later slice; this is the product foothold.
 */
import { createMemo, For, Show, type JSX } from 'solid-js';
import { useStore } from '@/lib/store';
import './stage-panel.css';

const SPINE_HINT =
  /\b(EVENT|WARD|MESH|WEBPUSH|RECOVERYCODES|MEDIA|S2S|UPGRADE|HELIX)\b/i;

export function OperEventConsole(): JSX.Element {
  const isOper = useStore((s) => s.isOper);
  const notices = useStore((s) => s.serviceNotices);

  const rows = createMemo(() => {
    const list = notices() ?? [];
    return list
      .filter((n) => SPINE_HINT.test(n.text) || n.source === 'Oper' || n.source === 'Server')
      .slice(-40)
      .reverse();
  });

  return (
    <Show when={isOper()}>
      <section
        class="oper-event-console"
        data-testid="oper-event-console"
        aria-labelledby="oper-event-console-title"
      >
        <h3 id="oper-event-console-title" class="acct-section-title">
          Event Spine (live notices)
        </h3>
        <p class="acct-section-hint">
          Operator-visible notices that match Event Spine traffic. Full JSON EVENT
          REPLAY console remains optional product work (B14).
        </p>
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
