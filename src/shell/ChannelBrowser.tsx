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
  const channelJoinPrompt = useStore((s) => s.channelJoinPrompt);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const disconnected = createMemo(() => connectionStatus() !== 'connected');
  // Keep a previously received directory usable while reconnecting; only
  // show the offline empty state when there is no cached directory at all.
  const isOffline = createMemo(() => disconnected() && list().length === 0);

  const [query, setQuery] = createSignal('');
  const [sortMode, setSortMode] = createSignal<SortMode>('live');
  const [pendingJoin, setPendingJoin] = createSignal<string | null>(null);
  const [attemptedJoin, setAttemptedJoin] = createSignal<string | null>(null);
  const [joinState, setJoinState] = createSignal<'idle' | 'pending' | 'rejected' | 'uncertain'>('idle');
  let joinTimer: ReturnType<typeof setTimeout> | undefined;

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
    if (isOffline()) return 'Room discovery is unavailable offline. Reconnect to refresh and join.';
    if (loading() && list().length === 0) return 'Loading rooms…';
    const shown = filtered().length;
    const q = query().trim();
    if (shown === 0) {
      if (q) return `No rooms match “${q}”.`;
      return 'No rooms yet.';
    }
    if (disconnected()) return `${shown} saved ${shown === 1 ? 'room' : 'rooms'} offline. Reconnect to join.`;
    if (q) return `${shown} ${shown === 1 ? 'room matches' : 'rooms match'} “${q}”.`;
    return `${shown} ${shown === 1 ? 'room' : 'rooms'} you can join.`;
  });

  const [announced, setAnnounced] = createSignal('');
  let announceTimer: ReturnType<typeof setTimeout> | undefined;
  const close = () => getState().closeChannelBrowser();
  const showCreate = () => getState().openCreateRoom();
  createEffect(() => {
    const message = statusMessage();
    if (announceTimer !== undefined) clearTimeout(announceTimer);
    announceTimer = setTimeout(() => setAnnounced(message), 250);
  });
  onCleanup(() => {
    if (announceTimer !== undefined) clearTimeout(announceTimer);
    if (joinTimer !== undefined) clearTimeout(joinTimer);
  });

  createEffect(() => {
    const target = pendingJoin();
    if (!target) return;
    if (joined().has(target.toLowerCase())) {
      if (joinTimer !== undefined) clearTimeout(joinTimer);
      setPendingJoin(null);
      setAttemptedJoin(null);
      setJoinState('idle');
      close();
    }
  });

  createEffect(() => {
    // A JOIN can arrive after the uncertainty timer. Once there is no newer
    // pending attempt, reconcile it against the room we actually attempted.
    const target = attemptedJoin();
    if (pendingJoin() || joinState() !== 'uncertain' || !target) return;
    if (joined().has(target.toLowerCase())) {
      setAttemptedJoin(null);
      setJoinState('idle');
      close();
    }
  });

  createEffect(() => {
    const target = pendingJoin() ?? (joinState() === 'uncertain' ? attemptedJoin() : null);
    const prompt = channelJoinPrompt();
    if (!target || !prompt || prompt.channel.toLowerCase() !== target.toLowerCase()) return;
    if (attemptedJoin() !== target) return;
    if (joinTimer !== undefined) clearTimeout(joinTimer);
    setPendingJoin(null);
    setAttemptedJoin(target);
    setJoinState('rejected');
  });

  const enter = (name: string) => {
    if (isJoined(name)) {
      const room = list().find((row) => row.name.toLowerCase() === name.toLowerCase());
      getState().openChannelConversation(name, room?.topic || null);
      close();
      return;
    }
    if (disconnected()) return;
    const target = name.toLowerCase();
    if (pendingJoin() === target && joinState() === 'pending') return;
    getState().clearChannelJoinPrompt();
    setAttemptedJoin(target);
    setPendingJoin(target);
    setJoinState('pending');
    if (joinTimer !== undefined) clearTimeout(joinTimer);
    joinTimer = setTimeout(() => {
      if (pendingJoin() === target) {
        setPendingJoin(null);
        setJoinState('uncertain');
      }
    }, 8000);
    void getState().joinChannel(name);
  };
  const isJoined = (name: string) => joined().has(name.toLowerCase());
  const admissionMessage = createMemo(() => {
    const target = pendingJoin();
    if (joinState() === 'pending' && target) return `Joining ${target}… Waiting for server admission.`;
    const attempted = attemptedJoin();
    if (joinState() === 'uncertain' && attempted) {
      return `The server did not confirm joining ${attempted}. You are still in this room browser; retry ${attempted} when ready.`;
    }
    if (joinState() === 'rejected') {
      const prompt = channelJoinPrompt();
      const room = attempted ?? prompt?.channel;
      return prompt?.error && room
        ? `Could not join ${room}: ${prompt.error}. Choose Retry to try again.`
        : room
          ? `The server rejected joining ${room}. Choose Retry to try again.`
          : 'The server rejected that join. Choose Retry to try again.';
    }
    return '';
  });

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
                disabled={loading() || disconnected()}
                onClick={() => getState().refreshChannelList()}
              >
                {disconnected() ? 'Reconnect to refresh' : loading() ? 'Refreshing…' : 'Refresh'}
              </button>
              <button type="button" class="chb-start" onClick={showCreate}>
                Start a room
              </button>
            </div>

            <Show when={!loading() || list().length > 0} fallback={
              <div class="chb-state"><Spinner /> Loading rooms…</div>
            }>
              <Show when={disconnected() && list().length > 0}>
                <div class="chb-state chb-state--offline">
                  <p class="chb-empty-title">Browsing a saved directory</p>
                  <p>These rooms are from your last connection. Reconnect to join them.</p>
                </div>
              </Show>
              <Show when={isOffline()}>
                <div class="chb-state chb-state--offline">
                  <p class="chb-empty-title">You’re offline</p>
                  <p>Room discovery is paused. Reconnect to browse or join rooms.</p>
                </div>
              </Show>
              <Show when={!isOffline()} fallback={null}>
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
                        <li
                          class={`chb-row${member() ? ' chb-row--joined' : ''}${!soft() && row.count > 0 ? ' chb-row--live' : ''}`}
                          data-room-state={member() ? 'joined' : soft() ? 'new' : row.count > 0 ? 'active' : 'quiet'}
                        >
                          <div class="chb-card" data-room-card>
                            <div class="chb-card-head">
                              <span class="chb-sigil" aria-hidden="true">#</span>
                              <span class="chb-room-copy">
                                <span class="chb-name">{row.name}</span>
                              </span>
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
                                Room details
                              </a>
                              <button
                                type="button"
                                class="chb-join"
                                onClick={() => enter(row.name)}
                                disabled={!member() && (disconnected() || (pendingJoin() === row.name.toLowerCase() && joinState() === 'pending'))}
                                title={!member() && disconnected() ? 'Reconnect to join this room' : undefined}
                                aria-label={
                                  member()
                                    ? `Open ${row.name}`
                                    : pendingJoin() === row.name.toLowerCase() && joinState() === 'pending'
                                      ? `Joining ${row.name}`
                                      : attemptedJoin() === row.name.toLowerCase() && (joinState() === 'rejected' || joinState() === 'uncertain')
                                        ? `Retry ${row.name}`
                                        : `Join ${row.name}`
                                }
                              >
                                {member()
                                  ? 'Open'
                                  : pendingJoin() === row.name.toLowerCase() && joinState() === 'pending'
                                    ? 'Joining…'
                                    : attemptedJoin() === row.name.toLowerCase() && (joinState() === 'rejected' || joinState() === 'uncertain')
                                      ? 'Retry'
                                      : 'Join'}
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
            </Show>

            <span class="sr-only" role="status">{announced()}</span>
            <Show when={admissionMessage()}>
              <div class="chb-admission" role="status" aria-live="polite" aria-atomic="true">
                {admissionMessage()}
              </div>
            </Show>
          </div>
        }
      >
        <CreateRoomFormation />
      </Show>
    </Sheet>
  );
}
