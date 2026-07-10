/**
 * ChannelBrowser — network-wide channel discovery over IRC LIST.
 *
 * The store issues LIST on open (mesh-wide on Orochi) and folds 321/322/323
 * into `channelList`; this sheet renders it with an instant text filter.
 * Lazy-loaded from AppShell so it costs nothing until first opened.
 */
import './channel-browser.css';
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { Sheet } from '@/primitives/Sheet';
import { Spinner } from '@/primitives/Spinner';

export default function ChannelBrowser(): JSX.Element {
  const open = useStore((s) => s.showChannelBrowser);
  const loading = useStore((s) => s.channelListLoading);
  const list = useStore((s) => s.channelList);
  const joined = useStore((s) => s.channels);

  const [query, setQuery] = createSignal('');

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const rows = [...list()].sort((a, b) => b.count - a.count);
    if (!q) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.topic.toLowerCase().includes(q),
    );
  });

  // Advisory status for AT: what the sighted user reads in the spinner / empty
  // states and the live result count. Kept out of the visual flow via .sr-only.
  const statusMessage = createMemo(() => {
    if (loading() && list().length === 0) return 'Loading channels from the network…';
    const total = list().length;
    if (total === 0) return 'No public channels found.';
    const shown = filtered().length;
    const q = query().trim();
    if (shown === 0) return `No channels match “${q}”.`;
    if (q) return `${shown} ${shown === 1 ? 'channel matches' : 'channels match'} “${q}”.`;
    return `${total} ${total === 1 ? 'channel' : 'channels'} available.`;
  });

  // Debounce the announcement so per-keystroke filtering does not spam the
  // screen reader — only the settled result is spoken.
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

  return (
    <Sheet
      open={open()}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Browse channels"
      description="Every public channel on the network, live from LIST."
    >
      <div class="chb">
        <div class="chb-toolbar" role="search" aria-label="Channel directory search">
          <input
            class="chb-filter"
            type="search"
            placeholder="Filter channels…"
            aria-label="Filter channels"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
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
                  No public channels yet — start one with{' '}
                  <span class="chb-mono">/join #yourhall</span>.
                </Show>
              </div>
            }
          >
            <ul class="chb-list" role="list" aria-label="Public channel directory">
              <For each={filtered()}>
                {(row) => (
                  <li class="chb-row">
                    <div class="chb-row-main">
                      <span class="chb-name">{row.name}</span>
                      <span class="chb-count">
                        {row.count} {row.count === 1 ? 'user' : 'users'}
                      </span>
                    </div>
                    <p class={`chb-topic${row.topic ? '' : ' is-empty'}`}>
                      {row.topic || 'No topic set.'}
                    </p>
                    <button
                      type="button"
                      class="chb-join"
                      onClick={() => enter(row.name)}
                      aria-label={`${joined().has(row.name.toLowerCase()) ? 'Open' : 'Join'} ${row.name}`}
                    >
                      {joined().has(row.name.toLowerCase()) ? 'Open' : 'Join'}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>

        <span class="sr-only" role="status">{announced()}</span>
      </div>
    </Sheet>
  );
}
