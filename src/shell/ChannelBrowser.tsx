// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ChannelBrowser — network-wide room discovery over IRC LIST.
 *
 * The store issues LIST on open (mesh-wide on Onyx Server) and folds 321/322/323
 * into `channelList`; this sheet renders a Discord/Twitch-maturity browse surface
 * with an instant text filter. Lazy-loaded from AppShell.
 */
import './channel-browser.css';
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import { Sheet } from '@/primitives/Sheet';
import { Spinner } from '@/primitives/Spinner';

type SortMode = 'live' | 'name';

export default function ChannelBrowser(): JSX.Element {
  const open = useStore((s) => s.showChannelBrowser);
  const loading = useStore((s) => s.channelListLoading);
  const list = useStore((s) => s.channelList);
  const joined = useStore((s) => s.channels);

  const [query, setQuery] = createSignal('');
  const [sortMode, setSortMode] = createSignal<SortMode>('live');

  // Sort depends only on the directory + mode — filter must not re-sort per keystroke.
  // Live: busiest first, then name asc (deterministic under mesh LIST reshuffles).
  // Name: alpha asc.
  const sorted = createMemo(() => {
    const rows = [...list()];
    if (sortMode() === 'name') {
      return rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    }
    return rows.sort((a, b) => b.count - a.count || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  });

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const rows = sorted();
    if (!q) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.topic.toLowerCase().includes(q),
    );
  });

  const statusMessage = createMemo(() => {
    if (loading() && list().length === 0) return 'Loading rooms from the network…';
    const total = list().length;
    if (total === 0) return 'No public rooms found.';
    const shown = filtered().length;
    const q = query().trim();
    if (shown === 0) return `No rooms match “${q}”.`;
    if (q) return `${shown} ${shown === 1 ? 'room matches' : 'rooms match'} “${q}”.`;
    return `${total} ${total === 1 ? 'room' : 'rooms'} available.`;
  });

  const [announced, setAnnounced] = createSignal('');
  let announceTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const message = statusMessage();
    if (announceTimer !== undefined) clearTimeout(announceTimer);
    announceTimer = setTimeout(() => setAnnounced(message), 250);
  });
  onCleanup(() => {
    if (announceTimer !== undefined) clearTimeout(announceTimer);
  });

  const close = () => getState().closeChannelBrowser();
  const enter = (name: string) => {
    void getState().joinChannel(name);
    close();
  };
  const isJoined = (name: string) => joined().has(name.toLowerCase());

  return (
    <Sheet
      open={open()}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Browse rooms"
      description="Public rooms on the network, live from LIST — busiest first."
    >
      <div class="chb">
        <div class="chb-toolbar" role="search" aria-label="Room directory search">
          <input
            class="chb-filter"
            type="search"
            placeholder="Filter rooms…"
            aria-label="Filter rooms"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <div class="chb-sort" role="group" aria-label="Sort rooms">
            <button
              type="button"
              class="chb-sort-btn"
              aria-pressed={sortMode() === 'live'}
              onClick={() => setSortMode('live')}
            >
              Live
            </button>
            <button
              type="button"
              class="chb-sort-btn"
              aria-pressed={sortMode() === 'name'}
              onClick={() => setSortMode('name')}
            >
              A–Z
            </button>
          </div>
          <button
            type="button"
            class="chb-refresh"
            disabled={loading()}
            onClick={() => getState().refreshChannelList()}
          >
            {loading() ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <Show when={!loading() || list().length > 0} fallback={
          <div class="chb-state"><Spinner /> Asking the network…</div>
        }>
          <Show
            when={filtered().length > 0}
            fallback={
              <div class="chb-state">
                <Show when={list().length === 0} fallback={<>Nothing matches “{query().trim()}”.</>}>
                  No public rooms yet — start one with{' '}
                  <span class="chb-mono">/join #yourhall</span>.
                </Show>
              </div>
            }
          >
            <ul class="chb-list" role="list" aria-label="Public room directory">
              <For each={filtered()}>
                {(row) => {
                  const member = () => isJoined(row.name);
                  return (
                    <li class={`chb-row${member() ? ' chb-row--joined' : ''}${row.count > 0 ? ' chb-row--live' : ''}`}>
                      <div class="chb-card" data-room-card>
                        <div class="chb-card-head">
                          <span class="chb-sigil" aria-hidden="true">#</span>
                          <span class="chb-name">{row.name}</span>
                          <Show when={member()}>
                            <span class="chb-pill chb-pill--in">In room</span>
                          </Show>
                          <span class={`chb-count${row.count > 0 ? ' chb-count--live' : ''}`}>
                            <i aria-hidden="true" />
                            {row.count} {row.count === 1 ? 'user' : 'users'}
                          </span>
                        </div>
                        <p class={`chb-topic${row.topic ? '' : ' is-empty'}`}>
                          {row.topic || 'No topic set.'}
                        </p>
                        <div class="chb-actions">
                          <a
                            class="chb-ledger"
                            href={statsRoomHref(row.name)}
                            aria-label={`Channel ledger for ${row.name}`}
                          >
                            Ledger
                          </a>
                          <button
                            type="button"
                            class="chb-join"
                            onClick={() => enter(row.name)}
                            aria-label={`${member() ? 'Open' : 'Join'} ${row.name}`}
                          >
                            {member() ? 'Open' : 'Join'}
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </Show>

        <span class="sr-only" role="status">{announced()}</span>
      </div>
    </Sheet>
  );
}
