// SPDX-License-Identifier: AGPL-3.0-or-later
export interface DurationFormatOptions {
  compact?: boolean;
  maxUnits?: number;
}

const INVALID_DURATION = '—';
const DEFAULT_MAX_UNITS = 2;

const DURATION_UNITS = [
  { seconds: 604_800, compact: 'w', singular: 'week', plural: 'weeks' },
  { seconds: 86_400, compact: 'd', singular: 'day', plural: 'days' },
  { seconds: 3_600, compact: 'h', singular: 'hour', plural: 'hours' },
  { seconds: 60, compact: 'm', singular: 'minute', plural: 'minutes' },
  { seconds: 1, compact: 's', singular: 'second', plural: 'seconds' },
] as const;

type DurationUnit = typeof DURATION_UNITS[number];

function normalizeMaxUnits(maxUnits: number | undefined): number {
  if (maxUnits === undefined || !Number.isFinite(maxUnits)) {
    return DEFAULT_MAX_UNITS;
  }

  return Math.min(DURATION_UNITS.length, Math.max(1, Math.floor(maxUnits)));
}

function formatPart(value: number, unit: DurationUnit, compact: boolean): string {
  if (compact) {
    return `${value}${unit.compact}`;
  }

  return `${value} ${value === 1 ? unit.singular : unit.plural}`;
}

function formatZero(compact: boolean): string {
  return compact ? '0s' : '0 seconds';
}

export function formatDuration(ms: number, options: DurationFormatOptions = {}): string {
  if (!Number.isFinite(ms)) {
    return INVALID_DURATION;
  }

  const compact = options.compact !== false;
  const maxUnits = normalizeMaxUnits(options.maxUnits);
  let remainingSeconds = Math.max(0, Math.floor(ms / 1_000));

  if (remainingSeconds === 0) {
    return formatZero(compact);
  }

  const parts: string[] = [];

  for (const unit of DURATION_UNITS) {
    if (remainingSeconds < unit.seconds) {
      continue;
    }

    const value = Math.floor(remainingSeconds / unit.seconds);
    remainingSeconds -= value * unit.seconds;
    parts.push(formatPart(value, unit, compact));

    if (parts.length >= maxUnits) {
      break;
    }
  }

  return parts.length > 0 ? parts.join(' ') : formatZero(compact);
}
