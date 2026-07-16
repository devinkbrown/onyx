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
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
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
type CopyState = 'idle' | 'copied' | 'failed';

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
  const initialNowMs = Date.now();
  const [selectedDate, setSelectedDate] = createSignal(formatUtcDate(new Date(initialNowMs)));
  const [selectedMoment, setSelectedMoment] = createSignal(new Date(initialNowMs));
  const [copyState, setCopyState] = createSignal<CopyState>('idle');
  const [nowMs, setNowMs] = createSignal(initialNowMs);
  const [rovingHour, setRovingHour] = createSignal(new Date(initialNowMs).getUTCHours());
  const hourButtons: (HTMLButtonElement | undefined)[] = [];
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
  let followsCurrentUtcDay = true;

  const activeChannel = createMemo(() => {
    const view = activeView();
    return view.kind === 'channel' ? view.channel : null;
  });

  const [pulse, { refetch }] = createResource(
    () => activeChannel(),
    async (channel) => (channel ? fetchChannelPulse(channel) : null),
    // The scrubber has its own quiet/loading UI. Seeding a resolved null makes
    // `pulse.latest` non-suspending even before the first request completes.
    { initialValue: null },
  );

  const timer = setInterval(() => {
    const nextNowMs = Date.now();
    setNowMs(nextNowMs);
    if (followsCurrentUtcDay) {
      setSelectedDate(formatUtcDate(new Date(nextNowMs)));
    }
    void refetch();
  }, REFRESH_MS);
  onCleanup(() => {
    clearInterval(timer);
    if (copyResetTimer) clearTimeout(copyResetTimer);
  });

  const bars = createMemo(() =>
    buildTimeScrubberBars(pulse.latest?.hours ?? null, new Date(nowMs()).getUTCHours()),
  );
  const status = createMemo(() => {
    // `latest` reads the most recently resolved value without registering this
    // component as a Suspense dependency. The scrubber owns an explicit
    // loading state, so suspending its lazy AppShell ancestor would otherwise
    // blank the entire connected UI while this optional stats request is slow.
    const data = pulse.latest;
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
    setCopyState('idle');
    travelTo()(channel, at);
  }

  function handleBarClick(hour: number): void {
    followsCurrentUtcDay = false;
    jumpTo(hour, 0);
  }

  function focusHour(hour: number): void {
    const next = ((hour % HOUR_COUNT) + HOUR_COUNT) % HOUR_COUNT;
    setRovingHour(next);
    hourButtons[next]?.focus({ preventScroll: true });
  }

  function handleHourKeyDown(event: KeyboardEvent, hour: number): void {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        focusHour(hour + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        focusHour(hour - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusHour(0);
        break;
      case 'End':
        event.preventDefault();
        focusHour(HOUR_COUNT - 1);
        break;
    }
  }

  function handleDateInput(event: InputEvent & { currentTarget: HTMLInputElement }): void {
    const next = event.currentTarget.value;
    followsCurrentUtcDay = false;
    setSelectedDate(next);
    const channel = activeChannel();
    const at = dateAtUtc(next, 12, 0);
    if (!channel || !at) return;
    setSelectedMoment(at);
    setCopyState('idle');
    travelTo()(channel, at);
  }

  async function copyMoment(): Promise<void> {
    const channel = activeChannel();
    if (!channel) return;
    const href = typeof window !== 'undefined' ? window.location.href : undefined;
    const link = buildMomentLink(channel, selectedMoment(), href);

    if (copyResetTimer) {
      clearTimeout(copyResetTimer);
      copyResetTimer = null;
    }
    setCopyState('idle');

    const copied = await writeClipboardText(link);
    setCopyState(copied ? 'copied' : 'failed');
    if (copied) {
      copyResetTimer = setTimeout(() => {
        setCopyState('idle');
        copyResetTimer = null;
      }, COPY_RESET_MS);
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
                role="toolbar"
                aria-label={`Activity by UTC hour for ${channel()}`}
              >
                <For each={bars()}>
                  {(bar) => (
                    <button
                      ref={(element) => (hourButtons[bar.hour] = element)}
                      type="button"
                      class="time-scrubber__bar"
                      classList={{
                        'time-scrubber__bar--live': bar.active,
                        'time-scrubber__bar--now': bar.isNow,
                      }}
                      style={{ '--scrub-heat': bar.heat.toFixed(3) }}
                      aria-label={barLabel(bar, selectedDate())}
                      title={`${pad2(bar.hour)}:00 UTC - ${bar.count} msgs`}
                      tabindex={rovingHour() === bar.hour ? 0 : -1}
                      onFocus={() => setRovingHour(bar.hour)}
                      onKeyDown={(event) => handleHourKeyDown(event, bar.hour)}
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
              {copyState() === 'copied'
                ? 'Copied'
                : copyState() === 'failed'
                  ? 'Copy failed'
                  : 'Copy moment'}
            </button>
            <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {copyState() === 'copied'
                ? `Moment link copied for ${channel()}`
                : copyState() === 'failed'
                  ? `Could not copy moment link for ${channel()}. Clipboard access is unavailable.`
                  : ''}
            </span>
          </div>
        </section>
      )}
    </Show>
  );
}

export default TimeScrubber;
