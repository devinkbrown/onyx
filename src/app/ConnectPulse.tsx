/**
 * ConnectPulse — the live half of the connect stage.
 *
 * Before you've even connected, the door shows the water: live channel
 * activity from the stats feed, node latency (measured the same way the
 * auto-router measures it), and where a ?join= deep link will land you.
 * Everything degrades silently — in dev (no /stats), the panel simply
 * shows the network identity.
 */
import './connect-pulse.css';
import {
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from 'solid-js';
import { fetchStatsIndex, relTime } from '@/lib/stats/networkIndex';
import { NODES, pingNode } from './nodes';

type NodePing = { host: string; ms: number };

/** The connect screen never names hostnames (design intent: nothing to pick,
    nothing to configure — enforced by Connect tests). Nodes show as roles. */
const NODE_ROLE: Record<string, string> = {
  'eshmaki.me': 'home node',
  'ircx.us': 'mesh peer',
};

async function pingAll(): Promise<NodePing[]> {
  const results = await Promise.all(
    NODES.map(async (n) => ({ host: n.host, ms: await pingNode(n, 2500) })),
  );
  return results;
}

export function ConnectPulse(props: { deepLink?: string | null }): JSX.Element {
  const [stats] = createResource(fetchStatsIndex);
  const [pings] = createResource(pingAll);

  const [nowMs, setNowMs] = createSignal(Date.now());
  const clock = setInterval(() => setNowMs(Date.now()), 30_000);
  onCleanup(() => clearInterval(clock));

  const rooms = createMemo(() => {
    const data = stats();
    if (!data) return [];
    return [...data.channels].sort((a, b) => b.messages - a.messages).slice(0, 3);
  });
  const totalMessages = createMemo(() =>
    (stats()?.channels ?? []).reduce((sum, c) => sum + c.messages, 0),
  );
  const fastest = createMemo(() => {
    const list = pings() ?? [];
    const finite = list.filter((p) => Number.isFinite(p.ms));
    if (finite.length === 0) return null;
    return finite.reduce((a, b) => (a.ms <= b.ms ? a : b)).host;
  });

  return (
    <aside class="cpulse" aria-label="Live network activity">
      <header class="cpulse-head">
        <p class="cpulse-eyebrow">tonight, on the water</p>
        <Show
          when={stats()}
          fallback={
            <p class="cpulse-wire">
              <span class="cpulse-wire-live" aria-hidden="true" />
              <span class="cpulse-wire-body">the mesh is listening</span>
            </p>
          }
        >
          {(data) => (
            <p class="cpulse-wire" aria-live="polite">
              <span class="cpulse-wire-live" aria-hidden="true" />
              <span class="cpulse-wire-body">
                <b>{data().channels.length}</b> channel{data().channels.length === 1 ? '' : 's'}
                <span class="cpulse-wire-sep">·</span>
                <b>{totalMessages().toLocaleString('en-US')}</b> messages
                <span class="cpulse-wire-sep">·</span>
                updated {relTime(data().generated_at, nowMs())}
              </span>
            </p>
          )}
        </Show>
      </header>

      <Show when={props.deepLink}>
        {(target) => (
          <div class="cpulse-deeplink" data-testid="pulse-deeplink">
            <span class="cpulse-deeplink-label">you're headed to</span>
            <span class="cpulse-deeplink-chan">{target()}</span>
          </div>
        )}
      </Show>

      <Show when={rooms().length > 0}>
        <ul class="cpulse-rooms" role="list" aria-label="Active channels right now">
          <For each={rooms()}>
            {(room) => (
              <li class="cpulse-room">
                <div class="cpulse-room-head">
                  <span class="cpulse-room-name">{room.channel}</span>
                  <span class="cpulse-room-meta">
                    {room.active_users > 0
                      ? `${room.active_users} chatting`
                      : relTime(room.last_active, nowMs())}
                  </span>
                </div>
                <p class={`cpulse-room-topic${room.topic ? '' : ' is-empty'}`}>
                  {room.topic || 'no topic yet'}
                </p>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <footer class="cpulse-nodes" aria-label="Mesh nodes">
        <For each={NODES}>
          {(node) => {
            const ping = createMemo(() => pings()?.find((p) => p.host === node.host));
            return (
              <span class="cpulse-node" data-nearest={fastest() === node.host ? 'true' : 'false'}>
                <span class="cpulse-node-dot" aria-hidden="true" />
                <span class="cpulse-node-host">{NODE_ROLE[node.host] ?? 'node'}</span>
                <span class="cpulse-node-ms">
                  {(() => {
                    const p = ping();
                    if (!p) return '…';
                    if (!Number.isFinite(p.ms)) return 'n/a';
                    return `${Math.round(p.ms)}ms${fastest() === node.host ? ' · nearest' : ''}`;
                  })()}
                </span>
              </span>
            );
          }}
        </For>
      </footer>
    </aside>
  );
}
