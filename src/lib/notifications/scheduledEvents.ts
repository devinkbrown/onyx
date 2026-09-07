// SPDX-License-Identifier: AGPL-3.0-or-later
export interface ScheduledEvent {
  at: number;
  title: string;
}

export interface ScheduledEventItem extends ScheduledEvent {
  channel: string;
  live: boolean;
}

interface ChannelLike {
  name: string;
}

const EVENT_PROP = 'ocean.event';
const EVENT_GRACE_MS = 60 * 60 * 1000;
const MAX_VALID_DATE_MS = 8_640_000_000_000_000;

export function isValidScheduledTimestamp(at: number): boolean {
  if (!Number.isFinite(at) || at <= 0) return false;
  const milliseconds = at * 1000;
  return Number.isFinite(milliseconds)
    && Math.abs(milliseconds) <= MAX_VALID_DATE_MS
    && !Number.isNaN(new Date(milliseconds).getTime());
}

export function parseScheduledEvent(raw: string | undefined): ScheduledEvent | null {
  if (!raw) return null;

  const sep = raw.indexOf('|');
  if (sep < 1) return null;

  const at = Number(raw.slice(0, sep));
  const title = raw.slice(sep + 1).trim();
  if (!isValidScheduledTimestamp(at) || !title) return null;

  return { at, title };
}

/**
 * Value-equality for a parsed scheduled event, for use as a `useStore`
 * equality function. `parseScheduledEvent` allocates a fresh object on every
 * call, so a store selector that returns it would otherwise fire on *every*
 * store mutation (default Object.is never matches a new object). Comparing by
 * value keeps the subscription — and every countdown memo downstream — quiet
 * until the event actually changes.
 */
export function scheduledEventsEqual(
  a: ScheduledEvent | null,
  b: ScheduledEvent | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.at === b.at && a.title === b.title;
}

export function scheduledEventVisible(event: ScheduledEvent, nowMs: number): boolean {
  const startMs = event.at * 1000;
  return isValidScheduledTimestamp(event.at) && Number.isFinite(nowMs)
    && nowMs < startMs + EVENT_GRACE_MS;
}

export function eventCountdown(event: ScheduledEvent, nowMs: number): string {
  if (!isValidScheduledTimestamp(event.at) || !Number.isFinite(nowMs)) return '';
  const delta = event.at * 1000 - nowMs;
  if (delta <= 0) return 'happening now';

  // Clamp to 1: any positive delta is still upcoming, so a sub-minute event
  // (Math.round floors <30s to 0) must read "in 1 min", never "in 0 min" —
  // the latter contradicts the not-yet-live state (no Join button shown).
  const mins = Math.max(1, Math.round(delta / 60000));
  if (mins < 60) return `in ${mins} min`;

  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `in ${hrs}h`;

  return `in ${Math.round(hrs / 24)}d`;
}

export function collectScheduledEvents(
  channels: Iterable<ChannelLike>,
  channelProps: ReadonlyMap<string, Record<string, string>>,
  nowMs: number,
  limit = 4,
): ScheduledEventItem[] {
  const items: ScheduledEventItem[] = [];

  for (const channel of channels) {
    const props = channelProps.get(channel.name.toLowerCase());
    const event = parseScheduledEvent(props?.[EVENT_PROP]);
    if (!event || !scheduledEventVisible(event, nowMs)) continue;

    items.push({
      ...event,
      channel: channel.name,
      live: nowMs >= event.at * 1000,
    });
  }

  return items
    .sort((a, b) => Number(b.live) - Number(a.live) || a.at - b.at || a.channel.localeCompare(b.channel))
    .slice(0, limit);
}
