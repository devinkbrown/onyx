// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ChannelBrowser — room discovery and Start a room.
 *
 * Browse uses the existing `channelList` LIST fold. One-member rooms are
 * soft-launched: hidden from the default hall directory, or marked
 * "Just started" when search finds them. Start a room is a formation loop
 * (name + share) that reuses JOIN, TOPIC, and invite links.
 */
import './channel-browser.css';
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import { browseMemberLabel, isSoftLaunchRoom, visibleBrowseRooms } from '@/lib/rooms/createRoomFormation';
import { Sheet } from '@/primitives/index';
import { Spinner } from '@/primitives/Spinner';
import CreateRoomFormation from './CreateRoomFormation';

type SortMode = 'live' | 'name';

export default function ChannelBrowser(): JSX.Element {
  const open = useStore((s) => s.showChannelBrowser);
  const mode = useStore((s) => s.channelBrowserMode);
  const loading = useStore((s) => s.channelListLoading);
  const list = useStore((s) => s.channelList);
  const joined = useStore((s) => s.channels);

  const [query, setQuery] = createSignal('');
  const [sortMode, setSortMode] = createSignal<SortMode>('live');

  const sorted = createMemo(() => {
    const rows = [...list()];
    if (sortMode() === 'name') {
      return rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    }
    return rows.sort((a, b) => {
      const aSoft = isSoftLaunchRoom(a) ? 1 : 0;
      const bSoft = isSoftLaunchRoom(b) ? 1 : 0;
      return aSoft - bSoft || b.count - a.count || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
  });

  const filtered = createMemo(() => visibleBrowseRooms(sorted(), query()));

  const statusMessage = createMemo(() => {
    if (mode() === 'create') return '';
    if (loading() && list().length === 0) return 'Loading rooms…';
    const shown = filtered().length;
    const q = query().trim();
    if (shown === 0) {
      if (q) return `No rooms match “${q}”.`;
      return 'No rooms yet.';
    }
    if (q) return `${shown} ${shown === 1 ? 'room matches' : 'rooms match'} “${q}”.`;
    return `${shown} ${shown === 1 ? 'room' : 'rooms'} you can join.`;
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
  const showCreate = () => getState().openCreateRoom();
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
      title={mode() === 'create' ? 'Start a room' : 'Browse rooms'}
      description={
        mode() === 'create'
          ? 'Name it, share the invite with a few people, and walk in together.'
          : 'Public rooms with people in them. Start one if you do not see a fit.'
      }
    >
      <Show
        when={mode() === 'create'}
        fallback={
          <div class="chb">
            <div class="chb-toolbar" role="search" aria-label="Room directory search">
              <input
                class="chb-filter"
                type="search"
                placeholder="Search rooms…"
                aria-label="Search rooms"
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
              <button type="button" class="chb-start" onClick={showCreate}>
                Start a room
              </button>
            </div>

            <Show when={!loading() || list().length > 0} fallback={
              <div class="chb-state"><Spinner /> Loading rooms…</div>
            }>
              <Show
                when={filtered().length > 0}
                fallback={
                  <div class="chb-state">
                    <Show when={!query().trim()} fallback={<>Nothing matches “{query().trim()}”.</>}>
                      <p class="chb-empty-title">No rooms yet. Start one.</p>
                      <button type="button" class="chb-start chb-start--empty" onClick={showCreate}>
                        Start a room
                      </button>
                    </Show>
                  </div>
                }
              >
                <ul class="chb-list" role="list" aria-label="Public room directory">
                  <For each={filtered()}>
                    {(row) => {
                      const member = () => isJoined(row.name);
                      const soft = () => isSoftLaunchRoom(row);
                      return (
                        <li class={`chb-row${member() ? ' chb-row--joined' : ''}${!soft() && row.count > 0 ? ' chb-row--live' : ''}`}>
                          <div class="chb-card" data-room-card>
                            <div class="chb-card-head">
                              <span class="chb-sigil" aria-hidden="true">#</span>
                              <span class="chb-name">{row.name}</span>
                              <Show when={member()}>
                                <span class="chb-pill chb-pill--in">In room</span>
                              </Show>
                              <span class={`chb-count${!soft() && row.count > 0 ? ' chb-count--live' : ''}${soft() ? ' chb-count--started' : ''}`}>
                                <i aria-hidden="true" />
                                {browseMemberLabel(row)}
                              </span>
                            </div>
                            <p class={`chb-topic${row.topic ? '' : ' is-empty'}`}>
                              {row.topic || 'No topic set.'}
                            </p>
                            <div class="chb-actions">
                              <a
                                class="chb-ledger"
                                href={statsRoomHref(row.name)}
                                aria-label={`Room ledger for ${row.name}`}
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
        }
      >
        <CreateRoomFormation />
      </Show>
    </Sheet>
  );
}
