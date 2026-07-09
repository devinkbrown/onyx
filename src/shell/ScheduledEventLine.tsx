/**
 * ScheduledEventLine.tsx — a channel's upcoming event in the channel intro
 * (Roadmap Phase 4.11, "voice rooms as places"). The event is an op-set
 * `ocean.event` channel prop (`<unix>|<title>`) that mesh-propagates, so
 * everyone sees the same schedule with a live countdown. When the channel has
 * a voice call, the line offers to join; an op can clear it.
 */
import { createMemo, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { useStore, getState, selectChannelEvent, selectIsChannelOp } from '@/lib/store';
import { eventCountdown, scheduledEventVisible } from '@/lib/notifications/scheduledEvents';

type ScheduledEventLineProps = { channel: string };

export function ScheduledEventLine(props: ScheduledEventLineProps): JSX.Element {
  const event = useStore((s) => selectChannelEvent(props.channel)(s));
  const canManage = useStore((s) => selectIsChannelOp(props.channel)(s));
  const voiceActive = useStore((s) => s.voice.callChannel?.toLowerCase() === props.channel.toLowerCase());

  // A ticking "now" so the countdown stays live without per-second store churn.
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(timer));

  const startMs = createMemo(() => (event()?.at ?? 0) * 1000);
  // Hide an event more than an hour after it started (it has happened).
  const visible = createMemo(() => {
    const e = event();
    return !!e && scheduledEventVisible(e, now());
  });

  const countdown = createMemo(() => {
    const e = event();
    return e ? eventCountdown(e, now()) : '';
  });

  const whenLabel = createMemo(() =>
    new Date(startMs()).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
  );

  const live = createMemo(() => now() >= startMs());

  function join(): void {
    void getState().joinVoiceChannel(props.channel);
  }
  function clear(): void {
    getState().clearChannelEvent(props.channel);
  }

  return (
    <Show when={visible()}>
      <div class={`shell-event-line${live() ? ' shell-event-line--live' : ''}`} data-testid="scheduled-event">
        <span class="shell-event-cal" aria-hidden="true">📅</span>
        <span class="shell-event-main">
          <span class="shell-event-title">{event()!.title}</span>
          <span class="shell-event-when">
            {whenLabel()} · <strong>{countdown()}</strong>
          </span>
        </span>
        <span class="shell-event-actions">
          <Show when={live() && !voiceActive()}>
            <button type="button" class="shell-event-join" onClick={join}>Join call</button>
          </Show>
          <Show when={canManage()}>
            <button
              type="button"
              class="shell-event-clear"
              aria-label="Clear scheduled event"
              title="Clear event"
              onClick={clear}
            >
              ×
            </button>
          </Show>
        </span>
      </div>
    </Show>
  );
}

export default ScheduledEventLine;
