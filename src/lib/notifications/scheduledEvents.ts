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

export function parseScheduledEvent(raw: string | undefined): ScheduledEvent | null {
  if (!raw) return null;

  const sep = raw.indexOf('|');
  if (sep < 1) return null;

  const at = Number(raw.slice(0, sep));
  const title = raw.slice(sep + 1).trim();
  if (!Number.isFinite(at) || at <= 0 || !title) return null;

  return { at, title };
}

export function scheduledEventVisible(event: ScheduledEvent, nowMs: number): boolean {
  return nowMs < event.at * 1000 + EVENT_GRACE_MS;
}

export function eventCountdown(event: ScheduledEvent, nowMs: number): string {
  const delta = event.at * 1000 - nowMs;
  if (delta <= 0) return 'happening now';

  const mins = Math.round(delta / 60000);
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
