// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * RoomInsightsStrip.tsx — in-app channel insights (Era 2 B10).
 *
 * Pulls the public chanstats room detail for the active channel and links to
 * the full /stats/?room= inspector. Aggregate-only (no per-user leaderboards).
 */
import { createMemo, createResource, Show, type JSX } from 'solid-js';
import { useStore } from '@/lib/store';
import {
  fetchChannelDetail,
  netMembershipFlow,
  peakHourShare,
  statsRoomHref,
} from '@/lib/stats/channelDetail';
import { relTime } from '@/lib/stats/networkIndex';
import './stage-panel.css';

function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatSigned(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n > 0) return `+${formatCount(n)}`;
  if (n < 0) return `−${formatCount(Math.abs(n))}`;
  return '0';
}

function formatHour(hour: number | null): string {
  if (hour === null) return '—';
  return `${String(hour).padStart(2, '0')}:00 UTC`;
}

export function RoomInsightsStrip(): JSX.Element {
  const activeView = useStore((s) => s.activeView);
  const channel = createMemo(() => {
    const v = activeView();
    return v.kind === 'channel' ? v.channel : null;
  });

  const [detail] = createResource(channel, async (ch) => {
    if (!ch) return null;
    return fetchChannelDetail(ch);
  });

  return (
    <Show when={channel()}>
      {(ch) => (
        <section
          class="room-insights"
          data-testid="room-insights"
          aria-label={`Insights for ${ch()}`}
        >
          <div class="room-insights__head">
            <h2 class="room-insights__title">Room pulse</h2>
            <a
              class="room-insights__link"
              href={statsRoomHref(ch())}
              data-testid="room-insights-open-stats"
            >
              Channel ledger
            </a>
          </div>
          <Show
            when={detail()}
            fallback={
              <p
                class="room-insights__empty"
                role="status"
                data-testid={detail.loading ? 'room-insights-loading' : detail.error ? 'room-insights-error' : 'room-insights-empty'}
              >
                {detail.loading
                  ? 'Loading public room stats…'
                  : detail.error
                    ? 'Could not load room stats. Try Channel ledger or check back later.'
                    : 'No public stats for this room yet.'}
              </p>
            }
          >
            {(d) => (
              <ul class="room-insights__metrics" data-testid="room-insights-metrics">
                <li>
                  <span>Present</span>
                  <strong>{formatCount(d().present)}</strong>
                </li>
                <li>
                  <span>Messages</span>
                  <strong>{formatCount(d().totals.messages)}</strong>
                </li>
                <li>
                  <span>Contributors</span>
                  <strong>{formatCount(d().totals.activeUsers)}</strong>
                </li>
                <li>
                  <span>Net joins</span>
                  <strong>{formatSigned(netMembershipFlow(d().totals))}</strong>
                </li>
                <li>
                  <span>Peak hour</span>
                  <strong title={d().peakHour === null ? undefined : `${peakHourShare(d().hours).toFixed(0)}% of the day`}>
                    {formatHour(d().peakHour)}
                  </strong>
                </li>
                <li>
                  <span>Last active</span>
                  <strong>{relTime(d().lastActive, Date.now())}</strong>
                </li>
              </ul>
            )}
          </Show>
        </section>
      )}
    </Show>
  );
}

export default RoomInsightsStrip;
