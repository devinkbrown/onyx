// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * JumpToDateSheet.tsx — Era 1 A3 discoverable time-travel control.
 *
 * The time scrubber and spotlight `at:` grammar already call store.travelTo
 * (CHATHISTORY AROUND + ?at= moment links). This Sheet makes the same path
 * reachable without power-user knowledge: ribbon, composer tool, Cmd-K, and
 * the `g d` sequence all open it.
 *
 * SOLID IDIOMS: never destructure props; useStore for reactive reads; Sheet
 * owns focus trap / Esc / dialog role.
 */
import './JumpToDateSheet.css';

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from 'solid-js';
import { getState, useStore } from '@/lib/store';
import { buildMomentLink } from '@/lib/deeplink';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import { Button, FormField, Sheet } from '@/primitives';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;
const COPY_RESET_MS = 1800;

type CopyState = 'idle' | 'copied' | 'failed';

export type JumpPreset = {
  id: string;
  label: string;
  /** Days before UTC today (0 = today). */
  daysAgo: number;
};

export const JUMP_DATE_PRESETS: readonly JumpPreset[] = [
  { id: 'today', label: 'Today', daysAgo: 0 },
  { id: 'yesterday', label: 'Yesterday', daysAgo: 1 },
  { id: 'week', label: '7 days ago', daysAgo: 7 },
] as const;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Format a Date as YYYY-MM-DD in UTC (matches TimeScrubber). */
export function formatUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Format HH:mm in UTC. */
export function formatUtcTime(date: Date): string {
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

/**
 * Build a UTC Date from date (YYYY-MM-DD) + time (HH:mm) strings.
 * Invalid calendar days (e.g. 2026-02-31) return null.
 */
export function dateTimeAtUtc(dateValue: string, timeValue: string): Date | null {
  const dateMatch = DATE_RE.exec(dateValue);
  if (!dateMatch) return null;

  let hour = 12;
  let minute = 0;
  const timeMatch = TIME_RE.exec(timeValue.trim() || '12:00');
  if (timeMatch) {
    hour = Number(timeMatch[1] ?? '');
    minute = Number(timeMatch[2] ?? '');
  } else if (timeValue.trim().length > 0) {
    return null;
  }

  if (
    !Number.isInteger(hour)
    || !Number.isInteger(minute)
    || hour < 0
    || hour > 23
    || minute < 0
    || minute > 59
  ) {
    return null;
  }

  const year = Number(dateMatch[1] ?? '');
  const month = Number(dateMatch[2] ?? '');
  const day = Number(dateMatch[3] ?? '');
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

/** UTC midnight for `daysAgo` days before the reference instant. */
export function utcDateDaysAgo(daysAgo: number, nowMs = Date.now()): string {
  const safeDays = Math.max(0, Math.floor(daysAgo));
  const ref = new Date(nowMs);
  const dayStart = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  return formatUtcDate(new Date(dayStart - safeDays * 86_400_000));
}

function activeTravelTarget(view: { kind: string; channel?: string; nick?: string }): string | null {
  if (view.kind === 'channel' && typeof view.channel === 'string') return view.channel;
  if (view.kind === 'dm' && typeof view.nick === 'string') return view.nick;
  return null;
}

function targetLabel(target: string | null, viewKind: string): string {
  if (!target) return 'this conversation';
  if (viewKind === 'dm') return `@${target}`;
  return target;
}

export function JumpToDateSheet(): JSX.Element {
  const open = useStore((s) => s.showJumpToDate);
  const activeView = useStore((s) => s.activeView);
  const travelTo = useStore((s) => s.travelTo);

  const target = createMemo(() => activeTravelTarget(activeView()));
  const label = createMemo(() => targetLabel(target(), activeView().kind));

  const [dateValue, setDateValue] = createSignal(formatUtcDate(new Date()));
  const [timeValue, setTimeValue] = createSignal('12:00');
  const [error, setError] = createSignal<string | null>(null);
  const [copyState, setCopyState] = createSignal<CopyState>('idle');

  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
  let copyEpoch = 0;
  let disposed = false;

  const clearCopyReset = (): void => {
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = null;
  };

  // Seed defaults each time the sheet opens so "Today" reflects now.
  createEffect(() => {
    if (!open()) {
      copyEpoch += 1;
      clearCopyReset();
      setCopyState('idle');
      setError(null);
      return;
    }
    const now = new Date();
    setDateValue(formatUtcDate(now));
    setTimeValue('12:00');
    setError(null);
    copyEpoch += 1;
    clearCopyReset();
    setCopyState('idle');
  });

  createEffect(() => {
    // Room changes while open must not keep a stale moment-copy status.
    void target();
    copyEpoch += 1;
    clearCopyReset();
    setCopyState('idle');
  });

  onCleanup(() => {
    disposed = true;
    copyEpoch += 1;
    clearCopyReset();
  });

  const resolvedAt = createMemo(() => dateTimeAtUtc(dateValue(), timeValue()));

  function applyPreset(preset: JumpPreset): void {
    setDateValue(utcDateDaysAgo(preset.daysAgo));
    setTimeValue('12:00');
    setError(null);
  }

  function jump(): void {
    const channel = target();
    const at = resolvedAt();
    if (!channel) {
      setError('Open a room or DM first.');
      return;
    }
    if (!at) {
      setError('Enter a valid UTC date and time.');
      return;
    }
    setError(null);
    travelTo()(channel, at);
    getState().closeJumpToDate();
  }

  async function copyMoment(): Promise<void> {
    const channel = target();
    const at = resolvedAt();
    if (!channel || !at) {
      setError(channel ? 'Enter a valid UTC date and time.' : 'Open a room or DM first.');
      return;
    }
    setError(null);
    const href = typeof window !== 'undefined' ? window.location.href : undefined;
    const link = buildMomentLink(channel, at, href);
    const epoch = ++copyEpoch;
    clearCopyReset();
    setCopyState('idle');
    const copied = await writeClipboardText(link);
    if (disposed || epoch !== copyEpoch || !open() || target() !== channel) return;
    setCopyState(copied ? 'copied' : 'failed');
    if (copied) {
      copyResetTimer = setTimeout(() => {
        if (disposed || epoch !== copyEpoch) return;
        setCopyState('idle');
        copyResetTimer = null;
      }, COPY_RESET_MS);
    }
  }

  return (
    <Sheet
      open={open()}
      title="Jump to date"
      description={`Travel to a moment in ${label()}. Same path as ?at= links and the time scrubber.`}
      closeLabel="Close jump to date"
      onOpenChange={(next) => (next ? getState().openJumpToDate() : getState().closeJumpToDate())}
    >
      <div class="jump-to-date" data-testid="jump-to-date-sheet">
        <Show
          when={target()}
          fallback={
            <p class="jump-to-date__empty" role="status">
              Open a room or DM to jump through its history.
            </p>
          }
        >
          {(channel) => (
            <>
              <div class="jump-to-date__presets" role="group" aria-label="Quick dates">
                <For each={[...JUMP_DATE_PRESETS]}>
                  {(preset) => (
                    <button
                      type="button"
                      class="jump-to-date__preset"
                      onClick={() => applyPreset(preset)}
                    >
                      {preset.label}
                    </button>
                  )}
                </For>
              </div>

              <div class="jump-to-date__fields">
                <FormField
                  id="jump-to-date-date"
                  label="Date (UTC)"
                  type="date"
                  value={dateValue()}
                  data-jump-to-date-input=""
                  description={`Jump inside ${channel()}`}
                  error={error() && !resolvedAt() ? error()! : undefined}
                  onInput={(event) => {
                    setDateValue(event.currentTarget.value);
                    setError(null);
                  }}
                />
                <FormField
                  id="jump-to-date-time"
                  label="Time (UTC)"
                  type="time"
                  value={timeValue()}
                  description="Defaults to 12:00 UTC when you pick a date from the scrubber."
                  onInput={(event) => {
                    setTimeValue(event.currentTarget.value);
                    setError(null);
                  }}
                />
              </div>

              <Show when={error() && resolvedAt()}>
                <p class="jump-to-date__error" role="alert">{error()}</p>
              </Show>

              <div class="jump-to-date__actions">
                <Button
                  type="button"
                  variant="primary"
                  disabled={!resolvedAt()}
                  onClick={jump}
                >
                  Jump
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!resolvedAt()}
                  aria-label={`Copy moment link for ${channel()}`}
                  onClick={() => void copyMoment()}
                >
                  {copyState() === 'copied'
                    ? 'Copied'
                    : copyState() === 'failed'
                      ? 'Copy failed'
                      : 'Copy moment link'}
                </Button>
                <Show when={activeView().kind === 'channel'}>
                  <a
                    class="jump-to-date__ledger"
                    href={statsRoomHref(channel())}
                    aria-label={`Room ledger for ${channel()}`}
                  >
                    Room ledger
                  </a>
                </Show>
              </div>
              <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {copyState() === 'copied'
                  ? `Moment link copied for ${channel()}`
                  : copyState() === 'failed'
                    ? `Could not copy moment link for ${channel()}. Clipboard access is unavailable.`
                    : ''}
              </span>
            </>
          )}
        </Show>
      </div>
    </Sheet>
  );
}

export default JumpToDateSheet;
