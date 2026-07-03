/**
 * PresenceHeatline.tsx — a live 24-hour activity rhythm for the channel ribbon
 * (Roadmap Phase 4.10). 24 slim bars fed by the channel's chanstats `hours[]`,
 * with the current UTC hour marked, so a room's pulse is visible before you
 * even read a message. Hidden when the channel has no recorded activity.
 */
import { createMemo, createResource, Index, onCleanup, Show, type JSX } from 'solid-js';
import { fetchChannelPulse } from '@/lib/stats/channelStats';

type PresenceHeatlineProps = {
  /** Active channel name, or null for non-channel views. */
  channel: () => string | null;
};

// A minute past the ~30s stats flush cadence keeps it fresh without hammering.
const REFRESH_MS = 60_000;

export function PresenceHeatline(props: PresenceHeatlineProps): JSX.Element {
  const [pulse, { refetch }] = createResource(
    () => props.channel(),
    async (channel) => (channel ? fetchChannelPulse(channel) : null),
  );

  // Poll while mounted; createResource re-fetches for the active channel key.
  const timer = setInterval(() => void refetch(), REFRESH_MS);
  onCleanup(() => clearInterval(timer));

  const hours = createMemo(() => pulse()?.hours ?? null);
  const peak = createMemo(() => {
    const h = hours();
    return h ? Math.max(1, ...h) : 1;
  });
  const nowHour = createMemo(() => new Date().getUTCHours());

  const hasActivity = createMemo(() => {
    const h = hours();
    return !!h && h.some((n) => n > 0);
  });

  return (
    <Show when={hasActivity()}>
      <div
        class="shell-ribbon-heatline"
        role="img"
        aria-label={`24-hour activity: ${pulse()?.total ?? 0} messages, busiest around ${busiestHour(hours())}:00 UTC`}
        title="Activity by hour (UTC) — the current hour is marked"
      >
        <Index each={hours()!}>
          {(count, h) => (
            <span
              class={`shell-heat-bar${h === nowHour() ? ' shell-heat-bar--now' : ''}${count() > 0 ? ' shell-heat-bar--live' : ''}`}
              style={{ '--heat': (count() / peak()).toFixed(3) }}
              aria-hidden="true"
            />
          )}
        </Index>
      </div>
    </Show>
  );
}

function busiestHour(hours: number[] | null): number {
  if (!hours) return 0;
  let best = 0;
  let bestVal = -1;
  for (let h = 0; h < hours.length; h++) {
    if (hours[h]! > bestVal) {
      bestVal = hours[h]!;
      best = h;
    }
  }
  return best;
}

export default PresenceHeatline;
