/**
 * HomeView — the connected-but-idle surface (no active channel).
 *
 * A real community home rather than a placeholder: a live network pulse fed
 * by the same stats JSON the website uses (same-origin `/stats/data/index.json`),
 * a joinable channel directory with sparklines, quick actions, and the
 * recently-visited rooms strip.
 *
 * Solid notes: the stats fetch is a createResource behind a graceful
 * fallback (dev servers 404 it — the view must never look broken); one
 * shared 30s clock signal drives every relative-time label; sorted/joined
 * derivations are memos.
 */
import './home-view.css';
import {
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from 'solid-js';
import { useStore, getState } from '@/lib/store';

type StatsChannel = {
  channel: string;
  messages: number;
  active_users: number;
  last_active: number;
  topic: string;
  spark: number[];
};

type StatsIndex = {
  generated_at: number;
  network: string;
  node: string;
  channels: StatsChannel[];
};

function normalizeIndex(raw: unknown): StatsIndex | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r['channels'])) return null;
  const channels: StatsChannel[] = [];
  for (const entry of r['channels']) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e['channel'] !== 'string' || !e['channel']) continue;
    channels.push({
      channel: e['channel'],
      messages: typeof e['messages'] === 'number' ? e['messages'] : 0,
      active_users: typeof e['active_users'] === 'number' ? e['active_users'] : 0,
      last_active: typeof e['last_active'] === 'number' ? e['last_active'] : 0,
      topic: typeof e['topic'] === 'string' ? e['topic'] : '',
      spark: Array.isArray(e['spark'])
        ? e['spark'].map((n) => (typeof n === 'number' && n > 0 ? n : 0))
        : [],
    });
  }
  return {
    generated_at: typeof r['generated_at'] === 'number' ? r['generated_at'] : 0,
    network: typeof r['network'] === 'string' ? r['network'] : '',
    node: typeof r['node'] === 'string' ? r['node'] : '',
    channels,
  };
}

async function fetchStatsIndex(): Promise<StatsIndex | null> {
  try {
    const res = await fetch('/stats/data/index.json', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return normalizeIndex(await res.json());
  } catch {
    return null; // dev servers have no /stats — the pulse simply hides
  }
}

export function relTime(unixSec: number, nowMs: number): string {
  if (!unixSec) return 'a while ago';
  const s = Math.max(0, Math.floor(nowMs / 1000 - unixSec));
  if (s < 50) return `${s}s ago`;
  if (s < 3000) return `${Math.round(s / 60)}m ago`;
  if (s < 90000) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function Sparkline(props: { values: number[] }): JSX.Element {
  const points = createMemo(() => {
    const vals = props.values;
    if (vals.length < 2) return null;
    const w = 240;
    const h = 32;
    const pad = 3;
    const max = Math.max(...vals, 1);
    const step = (w - pad * 2) / (vals.length - 1);
    const xy = vals.map(
      (v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)] as const,
    );
    return {
      line: xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '),
      area:
        `${pad},${h - pad} ` +
        xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
        ` ${(pad + (vals.length - 1) * step).toFixed(1)},${h - pad}`,
    };
  });
  return (
    <Show when={points()}>
      {(p) => (
        <svg class="home-spark" viewBox="0 0 240 32" preserveAspectRatio="none" aria-hidden="true">
          <polygon class="home-spark-fill" points={p().area} />
          <polyline class="home-spark-line" points={p().line} />
        </svg>
      )}
    </Show>
  );
}

export function HomeView(): JSX.Element {
  const joinHistory = useStore((s) => s.joinHistory);
  const channels = useStore((s) => s.channels);
  const networkName = useStore((s) => s.networkName);

  const [stats] = createResource(fetchStatsIndex);

  // One shared clock for all relative-time labels.
  const [nowMs, setNowMs] = createSignal(Date.now());
  const clock = setInterval(() => setNowMs(Date.now()), 30_000);
  onCleanup(() => clearInterval(clock));

  const directory = createMemo(() => {
    const data = stats();
    if (!data || data.channels.length === 0) return [];
    return [...data.channels]
      .sort((a, b) => b.messages - a.messages)
      .slice(0, 9);
  });
  const totalMessages = createMemo(() =>
    (stats()?.channels ?? []).reduce((sum, c) => sum + c.messages, 0),
  );
  const totalChatting = createMemo(() =>
    (stats()?.channels ?? []).reduce((sum, c) => sum + c.active_users, 0),
  );
  const isJoined = (name: string) => channels().has(name.toLowerCase());

  // Recently-visited rooms the user has since left — one tap to rejoin.
  const recentRooms = createMemo(() =>
    joinHistory().filter((c) => !channels().has(c.toLowerCase())).slice(0, 6),
  );

  return (
    <div class="home" role="main" aria-label="Network home">
      <div class="home-inner">
        <header class="home-masthead">
          <p class="home-kicker">{networkName() || 'IRCXNet'}</p>
          <h2 class="home-title">You're in the current.</h2>
          <p class="home-sub">
            Pick a hall below, or press <b>/</b> to search rooms, people and commands —{' '}
            <b>⌘K</b> opens the palette, <b>?</b> shows every shortcut.
          </p>
        </header>

        <Show when={stats()}>
          {(data) => (
            <div class="home-pulse" aria-label="Live network figures">
              <div class="home-pulse-tile">
                <span class="home-pulse-num">{data().channels.length}</span>
                <span class="home-pulse-label">channels</span>
              </div>
              <div class="home-pulse-tile">
                <span class="home-pulse-num">{totalMessages().toLocaleString('en-US')}</span>
                <span class="home-pulse-label">messages tracked</span>
              </div>
              <div class="home-pulse-tile">
                <span class="home-pulse-num">{totalChatting().toLocaleString('en-US')}</span>
                <span class="home-pulse-label">chatting now</span>
              </div>
              <div class="home-pulse-tile">
                <span class="home-pulse-num">{relTime(data().generated_at, nowMs())}</span>
                <span class="home-pulse-label">stats updated</span>
              </div>
            </div>
          )}
        </Show>

        <div class="home-actions">
          <button
            type="button"
            class="home-cta"
            onClick={() => {
              getState().refreshChannelList();
              getState().openChannelBrowser();
            }}
          >
            Browse all channels
          </button>
          <button type="button" class="home-action" onClick={() => void getState().joinChannel('#root')}>
            Join #root →
          </button>
          <button type="button" class="home-action" onClick={() => getState().openAppearance()}>
            Appearance
          </button>
          <button type="button" class="home-action" onClick={() => getState().openKeyboardShortcuts()}>
            Shortcuts
          </button>
        </div>

        <Show when={directory().length > 0}>
          <section class="home-directory" aria-label="Active channels">
            <h3 class="home-section-label">The halls</h3>
            <div class="home-grid">
              <For each={directory()}>
                {(c) => (
                  <article class="home-card">
                    <header class="home-card-head">
                      <h4 class="home-card-name">{c.channel}</h4>
                      <span class="home-card-when">
                        {c.active_users > 0
                          ? `${c.active_users} chatting`
                          : relTime(c.last_active, nowMs())}
                      </span>
                    </header>
                    <p class={`home-card-topic${c.topic ? '' : ' is-empty'}`}>
                      {c.topic || 'No topic yet — set the tone.'}
                    </p>
                    <Sparkline values={c.spark} />
                    <footer class="home-card-foot">
                      <span class="home-card-msgs">
                        {c.messages.toLocaleString('en-US')} msgs
                      </span>
                      <button
                        type="button"
                        class="home-card-join"
                        onClick={() => void getState().joinChannel(c.channel)}
                      >
                        {isJoined(c.channel) ? 'Open →' : 'Join →'}
                      </button>
                    </footer>
                  </article>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={recentRooms().length > 0}>
          <div class="home-recent">
            <span class="home-section-label">Recent rooms</span>
            <div class="home-recent-chips">
              <For each={recentRooms()}>
                {(room) => (
                  <button
                    type="button"
                    class="home-recent-chip"
                    onClick={() => void getState().joinChannel(room)}
                  >
                    {room}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
