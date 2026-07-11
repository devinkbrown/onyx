// SPDX-License-Identifier: AGPL-3.0-or-later
import './time-scrubber.css';

import {
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from 'solid-js';
import { useStore } from '@/lib/store';
import { buildMomentLink } from '@/lib/deeplink';
import { fetchChannelPulse } from '@/lib/stats/channelStats';

type TimeScrubberBar = {
  hour: number;
  count: number;
  heat: number;
  active: boolean;
  isNow: boolean;
};

const HOUR_COUNT = 24;
const REFRESH_MS = 60_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const COPY_RESET_MS = 1800;

export function buildTimeScrubberBars(
  hours: readonly number[] | null | undefined,
  nowHour: number,
): TimeScrubberBar[] {
  const validHours = Array.isArray(hours) && hours.length === HOUR_COUNT ? hours : null;
  const counts = Array.from({ length: HOUR_COUNT }, (_, hour) => {
    const raw = validHours?.[hour] ?? 0;
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  });
  const peak = Math.max(1, ...counts);
  const markedHour = Number.isInteger(nowHour) && nowHour >= 0 && nowHour < HOUR_COUNT ? nowHour : -1;

  return counts.map((count, hour) => ({
    hour,
    count,
    heat: count / peak,
    active: count > 0,
    isNow: hour === markedHour,
  }));
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function dateAtUtc(value: string, hour: number, minute: number): Date | null {
  const match = DATE_RE.exec(value);
  if (!match) return null;

  const year = Number(match[1] ?? '');
  const month = Number(match[2] ?? '');
  const day = Number(match[3] ?? '');
  const safeHour = Math.min(23, Math.max(0, Math.floor(hour)));
  const safeMinute = Math.min(59, Math.max(0, Math.floor(minute)));
  const date = new Date(Date.UTC(year, month - 1, day, safeHour, safeMinute, 0, 0));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function barLabel(bar: TimeScrubberBar, dateValue: string): string {
  const countText = bar.count === 1 ? '1 message' : `${bar.count} messages`;
  return `Jump to ${dateValue} ${pad2(bar.hour)}:00 UTC, ${countText}`;
}

export { buildMomentLink };

export function TimeScrubber(): JSX.Element {
  const activeView = useStore((s) => s.activeView);
  const travelTo = useStore((s) => s.travelTo);
  const [selectedDate, setSelectedDate] = createSignal(formatUtcDate(new Date()));
  const [selectedMoment, setSelectedMoment] = createSignal(new Date());
  const [copied, setCopied] = createSignal(false);
  const [nowMs, setNowMs] = createSignal(Date.now());
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  const activeChannel = createMemo(() => {
    const view = activeView();
    return view.kind === 'channel' ? view.channel : null;
  });

  const [pulse, { refetch }] = createResource(
    () => activeChannel(),
    async (channel) => (channel ? fetchChannelPulse(channel) : null),
  );

  const timer = setInterval(() => {
    setNowMs(Date.now());
    void refetch();
  }, REFRESH_MS);
  onCleanup(() => {
    clearInterval(timer);
    if (copyResetTimer) clearTimeout(copyResetTimer);
  });

  const bars = createMemo(() =>
    buildTimeScrubberBars(pulse()?.hours ?? null, new Date(nowMs()).getUTCHours()),
  );
  const status = createMemo(() => {
    const data = pulse();
    if (pulse.loading && !data) return 'loading';
    if (!data) return 'no stats yet';
    if (data.total <= 0) return 'quiet';
    return `${data.total.toLocaleString()} msgs`;
  });

  function jumpTo(hour: number, minute: number): void {
    const channel = activeChannel();
    const at = dateAtUtc(selectedDate(), hour, minute);
    if (!channel || !at) return;
    setSelectedMoment(at);
    setCopied(false);
    travelTo()(channel, at);
  }

  function handleBarClick(hour: number): void {
    jumpTo(hour, 0);
  }

  function handleDateInput(event: InputEvent & { currentTarget: HTMLInputElement }): void {
    const next = event.currentTarget.value;
    setSelectedDate(next);
    const channel = activeChannel();
    const at = dateAtUtc(next, 12, 0);
    if (!channel || !at) return;
    setSelectedMoment(at);
    setCopied(false);
    travelTo()(channel, at);
  }

  async function copyMoment(): Promise<void> {
    const channel = activeChannel();
    if (!channel) return;
    const href = typeof window !== 'undefined' ? window.location.href : undefined;
    const link = buildMomentLink(channel, selectedMoment(), href);

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem('onyx:last-copied-moment', link);
      }
      setCopied(true);
      if (copyResetTimer) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => setCopied(false), COPY_RESET_MS);
    } catch {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem('onyx:last-copied-moment', link);
        setCopied(true);
      } catch {
        setCopied(false);
      }
    }
  }

  return (
    <Show when={activeChannel()}>
      {(channel) => (
        <section
          class="time-scrubber"
          aria-label={`Time scrubber for ${channel()}`}
          aria-describedby="time-scrubber-status"
        >
          <div class="time-scrubber__inner">
            <div class="time-scrubber__main">
              <div class="time-scrubber__head">
                <span class="time-scrubber__label">24h UTC</span>
                <span id="time-scrubber-status" class="time-scrubber__status" aria-live="polite">{status()}</span>
              </div>
              <div
                class="time-scrubber__track"
                role="group"
                aria-label={`Activity by UTC hour for ${channel()}`}
              >
                <For each={bars()}>
                  {(bar) => (
                    <button
                      type="button"
                      class="time-scrubber__bar"
                      classList={{
                        'time-scrubber__bar--live': bar.active,
                        'time-scrubber__bar--now': bar.isNow,
                      }}
                      style={{ '--scrub-heat': bar.heat.toFixed(3) }}
                      aria-label={barLabel(bar, selectedDate())}
                      title={`${pad2(bar.hour)}:00 UTC - ${bar.count} msgs`}
                      onClick={() => handleBarClick(bar.hour)}
                    >
                      <span class="time-scrubber__bar-fill" aria-hidden="true" />
                    </button>
                  )}
                </For>
              </div>
            </div>
            <label class="time-scrubber__date">
              <span>jump date</span>
              <input
                data-time-scrubber-date
                type="date"
                value={selectedDate()}
                onInput={handleDateInput}
                aria-label="Jump to date at 12:00 UTC"
              />
            </label>
            <button
              type="button"
              class="time-scrubber__copy"
              aria-label={`Copy moment link for ${channel()}`}
              onClick={() => void copyMoment()}
            >
              {copied() ? 'Copied' : 'Copy moment'}
            </button>
          </div>
        </section>
      )}
    </Show>
  );
}

export default TimeScrubber;
