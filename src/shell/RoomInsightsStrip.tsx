// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * RoomInsightsStrip.tsx — in-app channel insights (Era 2 B10).
 *
 * Pulls the public chanstats room detail for the active channel and links to
 * the full /stats/?room= inspector. Aggregate-only (no per-user leaderboards).
 */
import { createMemo, createResource, createUniqueId, Index, Show, type JSX } from 'solid-js';
import { useStore } from '@/lib/store';
import {
  fetchChannelDetail,
  netMembershipFlow,
  peakHourShare,
  statsRoomHref,
} from '@/lib/stats/channelDetail';
import { relTime } from '@/lib/stats/networkIndex';
import './stage-panel.css';
import './participant-presence.css';

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

function safeHourCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function peakHourCount(hours: readonly number[]): number {
  return Math.max(1, ...hours.map(safeHourCount));
}

function hourBarScale(value: number, peak: number): string {
  return (safeHourCount(value) / Math.max(1, peak)).toFixed(3);
}

type RoomRhythmProps = {
  hours: readonly number[];
  peakHour: number | null;
};

function RoomRhythm(props: RoomRhythmProps): JSX.Element {
  const peak = createMemo(() => peakHourCount(props.hours));
  const total = createMemo(() => props.hours.reduce((sum, value) => sum + safeHourCount(value), 0));
  const hasActivity = createMemo(() => total() > 0);
  const captionId = `room-rhythm-caption-${createUniqueId()}`;
  const peakLabel = () => props.peakHour === null ? 'No peak hour recorded' : `Peak ${formatHour(props.peakHour)}`;

  return (
    <Show when={hasActivity()}>
      <figure class="room-insights__rhythm" data-testid="room-insights-rhythm">
        <div class="room-insights__rhythm-head">
          <div class="room-insights__rhythm-heading">
            <span class="room-insights__rhythm-kicker">24-hour rhythm</span>
            <strong class="room-insights__rhythm-title">Messages by hour</strong>
          </div>
          <span class="room-insights__rhythm-peak">{peakLabel()}</span>
        </div>
        <div
          class="room-insights__rhythm-bars"
          role="img"
          aria-labelledby={captionId}
          data-testid="room-insights-rhythm-bars"
        >
          <Index each={props.hours}>
            {(count, hour) => (
              <span
                class="room-insights__rhythm-bar"
                classList={{ 'room-insights__rhythm-bar--peak': props.peakHour === hour }}
                data-hour={hour}
                aria-hidden="true"
              >
                <span
                  class="room-insights__rhythm-fill"
                  style={{ '--room-heat': hourBarScale(count(), peak()) }}
                />
              </span>
            )}
          </Index>
        </div>
        <div class="room-insights__rhythm-axis" aria-hidden="true">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
        <figcaption id={captionId} class="room-insights__rhythm-caption">
          {formatCount(total())} messages in UTC · {peakLabel().toLowerCase()}
        </figcaption>
      </figure>
    </Show>
  );
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
              Room ledger
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
                    ? 'Could not load room stats. Try Room ledger or check back later.'
                    : 'No public stats for this room yet.'}
              </p>
            }
          >
            {(d) => (
              <>
                <div class="room-insights__meta" data-testid="room-insights-meta">
                  <span>Public aggregate</span>
                  <span aria-hidden="true">·</span>
                  <span>Updated {relTime(d().generatedAt, Date.now())}</span>
                  <Show when={!d().complete}>
                    <span class="room-insights__meta-quiet">Partial snapshot</span>
                  </Show>
                </div>
                <RoomRhythm hours={d().hours} peakHour={d().peakHour} />
                <ul class="room-insights__metrics" data-testid="room-insights-metrics">
                  <li>
                  <span>Observed present</span>
                  <strong title="Aggregate room observation; not a live online count">{formatCount(d().present)}</strong>
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
                    <span>Last speaker</span>
                    <strong class="room-insights__metric-text" title={d().lastSpeaker || undefined}>
                      {d().lastSpeaker || '—'}
                    </strong>
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
              </>
            )}
          </Show>
        </section>
      )}
    </Show>
  );
}

export default RoomInsightsStrip;
