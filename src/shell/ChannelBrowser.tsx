// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ChannelBrowser — room discovery and Start a room.
 *
 * Browse uses the existing `channelList` LIST fold. Start a room reuses
 * `createRoom` → JOIN + optional TOPIC. No second rooms store.
 */
import './channel-browser.css';
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { normalizeCreateRoomName, sanitizeCreateRoomTopic } from '@/lib/deeplink';
import { useStore, getState } from '@/lib/store';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import { Button, FormField, Sheet } from '@/primitives/index';
import { Spinner } from '@/primitives/Spinner';

type SortMode = 'live' | 'name';

export default function ChannelBrowser(): JSX.Element {
  const open = useStore((s) => s.showChannelBrowser);
  const mode = useStore((s) => s.channelBrowserMode);
  const loading = useStore((s) => s.channelListLoading);
  const list = useStore((s) => s.channelList);
  const joined = useStore((s) => s.channels);

  const [query, setQuery] = createSignal('');
  const [sortMode, setSortMode] = createSignal<SortMode>('live');
  const [nameInput, setNameInput] = createSignal('');
  const [topicInput, setTopicInput] = createSignal('');
  const [nameError, setNameError] = createSignal('');
  const [topicError, setTopicError] = createSignal('');

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
    if (mode() === 'create') return '';
    if (loading() && list().length === 0) return 'Loading rooms…';
    const total = list().length;
    if (total === 0) return 'No rooms yet.';
    const shown = filtered().length;
    const q = query().trim();
    if (shown === 0) return `No rooms match “${q}”.`;
    if (q) return `${shown} ${shown === 1 ? 'room matches' : 'rooms match'} “${q}”.`;
    return `${total} ${total === 1 ? 'room' : 'rooms'} you can join.`;
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
  const showBrowse = () => getState().openChannelBrowser();
  const showCreate = () => getState().openCreateRoom();
  const enter = (name: string) => {
    void getState().joinChannel(name);
    close();
  };
  const isJoined = (name: string) => joined().has(name.toLowerCase());

  const submitCreate = (event: SubmitEvent) => {
    event.preventDefault();
    const name = normalizeCreateRoomName(nameInput());
    if (!name) {
      setNameError('Enter a short room name — letters or numbers, no spaces.');
      return;
    }
    const topic = sanitizeCreateRoomTopic(topicInput());
    if (topic === null) {
      setTopicError('Keep the topic short, without special control characters.');
      return;
    }
    setNameError('');
    setTopicError('');
    getState().createRoom(name, topic);
  };

  return (
    <Sheet
      open={open()}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={mode() === 'create' ? 'Start a room' : 'Browse rooms'}
      description={
        mode() === 'create'
          ? 'Name it, add a short topic if you want, and invite your friends.'
          : 'Public rooms you can join. Start one if you do not see a fit.'
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
                    <Show when={list().length === 0} fallback={<>Nothing matches “{query().trim()}”.</>}>
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
                                {row.count} {row.count === 1 ? 'person' : 'people'}
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
        <form class="chb-create" onSubmit={submitCreate}>
          <FormField
            id="chb-create-name"
            label="Room name"
            description="Friends will see this name when they join."
            error={nameError() || undefined}
            type="text"
            autocomplete="off"
            spellcheck={false}
            placeholder="book club"
            value={nameInput()}
            onInput={(e) => {
              setNameInput(e.currentTarget.value);
              if (nameError()) setNameError('');
            }}
          />
          <FormField
            id="chb-create-topic"
            label="Topic (optional)"
            description="A short line about what this room is for."
            error={topicError() || undefined}
            type="text"
            autocomplete="off"
            placeholder="Weekly reads and recs"
            value={topicInput()}
            onInput={(e) => {
              setTopicInput(e.currentTarget.value);
              if (topicError()) setTopicError('');
            }}
          />
          <details class="chb-advanced">
            <summary>Advanced</summary>
            <p>
              Room rules, keys, and who can join stay in This room after you start.
              This form only names the place and sets an optional topic.
            </p>
          </details>
          <div class="chb-create-actions">
            <Button type="button" variant="ghost" onClick={showBrowse}>
              Browse rooms
            </Button>
            <Button type="submit">Start room</Button>
          </div>
        </form>
      </Show>
    </Sheet>
  );
}
