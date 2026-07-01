/**
 * ChannelBrowser — network-wide channel discovery over IRC LIST.
 *
 * The store issues LIST on open (mesh-wide on Orochi) and folds 321/322/323
 * into `channelList`; this sheet renders it with an instant text filter.
 * Lazy-loaded from AppShell so it costs nothing until first opened.
 */
import './channel-browser.css';
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
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
        <div class="chb-toolbar">
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
            <ul class="chb-list" role="list">
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
                    <button type="button" class="chb-join" onClick={() => enter(row.name)}>
                      {joined().has(row.name.toLowerCase()) ? 'Open' : 'Join'}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </div>
    </Sheet>
  );
}
