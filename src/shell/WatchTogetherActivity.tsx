import { createMemo, Show, type JSX } from 'solid-js';
import { useStore } from '@/lib/store';
import {
  formatWatchClock,
  parseWatchTogetherProp,
  watchTogetherStateLabel,
} from '@/lib/media/watchTogether';

const WATCH_PROP = 'ocean.watch';

export function WatchTogetherActivity(): JSX.Element {
  const activeView = useStore((s) => s.activeView);
  const channelProps = useStore((s) => s.channelProps);

  const channel = createMemo(() => {
    const view = activeView();
    return view.kind === 'channel' ? view.channel : null;
  });

  const activity = createMemo(() => {
    const ch = channel();
    if (!ch) return null;
    return parseWatchTogetherProp(channelProps().get(ch.toLowerCase())?.[WATCH_PROP]);
  });

  const participantLabel = createMemo(() => {
    const count = activity()?.participants.length ?? 0;
    if (count === 0) return '0 watching';
    return `${count} ${count === 1 ? 'watching' : 'watching'}`;
  });

  const progressLabel = createMemo(() => {
    const item = activity();
    if (!item) return '';
    const position = formatWatchClock(item.positionSeconds);
    const duration = formatWatchClock(item.durationSeconds);
    return item.durationSeconds === null ? position : `${position} / ${duration}`;
  });

  const ariaLabel = createMemo(() => {
    const item = activity();
    if (!item) return 'Watch together';
    const parts = [`Watch together: ${item.title}`, watchTogetherStateLabel(item)];
    if (item.host) parts.push(`host ${item.host}`);
    parts.push(participantLabel());
    return parts.join(', ');
  });

  return (
    <Show when={activity()}>
      {(item) => (
        <section
          class="shell-watch-together"
          data-state={item().state}
          aria-label={ariaLabel()}
        >
          <div class="shell-watch-together__pulse" aria-hidden="true" />
          <div class="shell-watch-together__main">
            <span class="shell-watch-together__label">Watch together</span>
            <strong class="shell-watch-together__title">{item().title}</strong>
          </div>
          <div class="shell-watch-together__meta" aria-label="Watch together status">
            <span>{watchTogetherStateLabel(item())}</span>
            <Show when={item().positionSeconds !== null || item().durationSeconds !== null}>
              <span>{progressLabel()}</span>
            </Show>
            <Show when={item().host}>
              {(host) => <span>Host {host()}</span>}
            </Show>
            <span>{participantLabel()}</span>
          </div>
          <Show when={item().url}>
            {(url) => (
              <a class="shell-watch-together__open" href={url()} target="_blank" rel="noreferrer">
                Open
              </a>
            )}
          </Show>
        </section>
      )}
    </Show>
  );
}
