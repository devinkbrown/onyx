// SPDX-License-Identifier: AGPL-3.0-or-later
import { createMemo, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import {
  formatWatchClock,
  parseWatchTogetherProp,
  watchTogetherStateLabel,
} from '@/lib/media/watchTogether';
import {
  isWatchHost,
  join,
  pause,
  play,
  seek,
  sessionFromActivity,
  tick,
  type WatchSession,
} from '@/lib/media/watchTogetherController';

const WATCH_PROP = 'ocean.watch';
const TICK_MS = 1000;

/** Only ever render an `ocean.watch` URL as a link when it is http(s) — a
 *  peer-published PROP must never yield a `javascript:`/`data:` href. */
function safeHttpUrl(u: string | null | undefined): string {
  const s = (u ?? '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

export function WatchTogetherActivity(): JSX.Element {
  const activeView = useStore((s) => s.activeView);
  const channelProps = useStore((s) => s.channelProps);
  const ourNick = useStore((s) => s.ourNick);

  // Reactive local clock: drives the smooth position advance between wire pushes.
  const [tickNow, setTickNow] = createSignal(Date.now());
  const timer = setInterval(() => setTickNow(Date.now()), TICK_MS);
  onCleanup(() => clearInterval(timer));

  const channel = createMemo(() => {
    const view = activeView();
    return view.kind === 'channel' ? view.channel : null;
  });

  // Memoize on the RAW prop string (a primitive). `channelProps` is a single
  // top-level Map that the store rebuilds on ANY prop write for any channel, and
  // `parseWatchTogetherProp` allocates a fresh object each call — so parsing
  // directly would re-emit `activity` on unrelated prop churn and spuriously
  // re-anchor the local tick (snapping the clock backward). Keying on the
  // primitive string lets `createMemo`'s `===` equality suppress that churn.
  const rawWatch = createMemo(() => {
    const ch = channel();
    if (!ch) return null;
    return channelProps().get(ch.toLowerCase())?.[WATCH_PROP] ?? null;
  });

  const activity = createMemo(() => parseWatchTogetherProp(rawWatch()));

  // Re-anchor a session whenever the wire activity changes; `live` then ticks it
  // against the reactive clock so playback advances locally without PROP chatter.
  const anchored = createMemo<WatchSession | null>(() => {
    const a = activity();
    return a ? sessionFromActivity(a, Date.now()) : null;
  });

  const live = createMemo<WatchSession | null>(() => {
    const s = anchored();
    return s ? tick(s, tickNow()) : null;
  });

  const liveActivity = createMemo(() => live()?.activity ?? null);
  const displayPosition = createMemo(() => liveActivity()?.positionSeconds ?? null);
  const isPlaying = createMemo(() => liveActivity()?.state === 'playing');

  const isHost = createMemo(() => {
    const s = live();
    return s ? isWatchHost(s, ourNick()) : false;
  });

  const isParticipant = createMemo(() => {
    const a = liveActivity();
    const me = ourNick();
    if (!a || !me) return false;
    return a.participants.some((p) => p.toLowerCase() === me.toLowerCase());
  });

  const participantLabel = createMemo(() => {
    const count = liveActivity()?.participants.length ?? 0;
    return `${count} watching`;
  });

  const progressLabel = createMemo(() => {
    const a = liveActivity();
    if (!a) return '';
    const position = formatWatchClock(displayPosition());
    const duration = formatWatchClock(a.durationSeconds);
    return a.durationSeconds === null ? position : `${position} / ${duration}`;
  });

  const stateLabel = createMemo(() => {
    const a = liveActivity();
    return a ? watchTogetherStateLabel(a) : '';
  });

  const ariaLabel = createMemo(() => {
    const a = liveActivity();
    if (!a) return 'Watch together';
    const parts = [`Watch together: ${a.title}`, stateLabel()];
    if (a.host) parts.push(`host ${a.host}`);
    parts.push(participantLabel());
    return parts.join(', ');
  });

  // ── Host / participant actions (publish the same ocean.watch PROP) ──────────
  function publish(next: WatchSession): void {
    const ch = channel();
    if (!ch) return;
    getState().client?.publishWatchTogether(ch, next.activity);
  }

  function onPlay(): void {
    const s = live();
    const me = ourNick();
    if (s && me) publish(play(s, Date.now(), me));
  }

  function onPause(): void {
    const s = live();
    const me = ourNick();
    if (s && me) publish(pause(s, Date.now(), me));
  }

  function onSeek(seconds: number): void {
    const s = live();
    const me = ourNick();
    if (s && me && Number.isFinite(seconds)) publish(seek(s, seconds, Date.now(), me));
  }

  function onJoin(): void {
    const s = live();
    const me = ourNick();
    if (s && me) publish(join(s, me, Date.now()));
  }

  return (
    <Show when={liveActivity()}>
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
            <span>{stateLabel()}</span>
            <Show when={item().positionSeconds !== null || item().durationSeconds !== null}>
              <span>{progressLabel()}</span>
            </Show>
            <Show when={item().host}>
              {(hostNick) => <span>Host {hostNick()}</span>}
            </Show>
            <span>{participantLabel()}</span>
          </div>

          <Show when={isHost()}>
            <div
              class="shell-watch-together__controls"
              role="group"
              aria-label="Playback controls"
            >
              <Show
                when={isPlaying()}
                fallback={
                  <button
                    type="button"
                    class="shell-watch-together__ctl"
                    aria-label="Play"
                    onClick={onPlay}
                  >
                    Play
                  </button>
                }
              >
                <button
                  type="button"
                  class="shell-watch-together__ctl"
                  aria-label="Pause"
                  onClick={onPause}
                >
                  Pause
                </button>
              </Show>
              <Show when={item().durationSeconds !== null}>
                <input
                  type="range"
                  class="shell-watch-together__seek"
                  min="0"
                  max={item().durationSeconds ?? 0}
                  step="1"
                  value={displayPosition() ?? 0}
                  aria-label="Seek position"
                  aria-valuetext={`${formatWatchClock(displayPosition())} of ${formatWatchClock(item().durationSeconds)}`}
                  onChange={(e) => onSeek(e.currentTarget.valueAsNumber)}
                />
              </Show>
            </div>
          </Show>

          <Show when={Boolean(ourNick()) && !isHost() && !isParticipant()}>
            <button
              type="button"
              class="shell-watch-together__join"
              aria-label={`Join watch: ${item().title}`}
              onClick={onJoin}
            >
              Join
            </button>
          </Show>

          <Show when={safeHttpUrl(item().url)}>
            {(url) => (
              <a
                class="shell-watch-together__open"
                href={url()}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Open ${item().title} in a new tab`}
              >
                Open
              </a>
            )}
          </Show>
        </section>
      )}
    </Show>
  );
}
