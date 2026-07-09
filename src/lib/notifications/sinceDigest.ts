// ─────────────────────────────────────────────────────────────────────────────
// Since-you-left digest model for compact per-channel missed-message summaries.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_CHANNELS = 8;

export interface DigestMessage {
  channel: string;
  nick: string;
  at: Date;
  isMention: boolean;
}

export interface ChannelDigest {
  channel: string;
  count: number;
  mentions: number;
  participants: readonly string[];
  firstAt: Date;
  lastAt: Date;
}

export interface SinceDigest {
  since: Date;
  totalMessages: number;
  totalMentions: number;
  activeChannels: number;
  channels: ChannelDigest[];
}

interface ChannelAccumulator {
  channel: string;
  count: number;
  mentions: number;
  participants: string[];
  seenParticipants: Set<string>;
  firstAt: Date;
  lastAt: Date;
}

export function buildSinceDigest(
  messages: readonly DigestMessage[],
  since: Date,
  opts?: { maxChannels?: number },
): SinceDigest {
  const byChannel = new Map<string, ChannelAccumulator>();
  let totalMessages = 0;
  let totalMentions = 0;

  for (const message of messages) {
    if (message.at.getTime() <= since.getTime() || message.channel.length === 0) {
      continue;
    }

    const existing = byChannel.get(message.channel);
    const accumulator =
      existing ??
      {
        channel: message.channel,
        count: 0,
        mentions: 0,
        participants: [],
        seenParticipants: new Set<string>(),
        firstAt: message.at,
        lastAt: message.at,
      };

    if (!existing) {
      byChannel.set(message.channel, accumulator);
    }

    accumulator.count += 1;
    totalMessages += 1;

    if (message.isMention) {
      accumulator.mentions += 1;
      totalMentions += 1;
    }

    if (!accumulator.seenParticipants.has(message.nick)) {
      accumulator.seenParticipants.add(message.nick);
      accumulator.participants.push(message.nick);
    }

    if (message.at.getTime() < accumulator.firstAt.getTime()) {
      accumulator.firstAt = message.at;
    }

    if (message.at.getTime() > accumulator.lastAt.getTime()) {
      accumulator.lastAt = message.at;
    }
  }

  const maxChannels = opts?.maxChannels ?? DEFAULT_MAX_CHANNELS;
  const channels = Array.from(byChannel.values(), toChannelDigest)
    .sort(compareChannelDigest)
    .slice(0, maxChannels);

  return {
    since,
    totalMessages,
    totalMentions,
    activeChannels: byChannel.size,
    channels,
  };
}

export function digestHeadline(d: SinceDigest): string {
  if (d.totalMessages === 0) {
    return 'All caught up';
  }

  const messageSummary = `${d.totalMessages} ${pluralize(d.totalMessages, 'message')}`;
  const channelSummary = `${d.activeChannels} ${pluralize(d.activeChannels, 'channel')}`;

  if (d.totalMentions === 0) {
    return `${messageSummary} across ${channelSummary}`;
  }

  const mentionSummary = `${d.totalMentions} ${pluralize(d.totalMentions, 'mention')}`;
  return `${messageSummary} across ${channelSummary} · ${mentionSummary}`;
}

export function digestReaderNote(d: SinceDigest): string {
  if (d.totalMessages === 0) {
    return 'No new transcript lines since your last visit.';
  }

  const firstChannel = d.channels[0];
  const people = firstChannel?.participants.slice(0, 2) ?? [];
  const peopleText =
    people.length === 0
      ? 'the room'
      : people.length === 1
        ? people[0]
        : `${people[0]} and ${people[1]}`;
  const messageText = `${d.totalMessages} ${pluralize(d.totalMessages, 'line')}`;

  if (d.activeChannels <= 1) {
    return `Read from here: ${peopleText} added ${messageText}.`;
  }

  return `Read from here: ${messageText} across ${d.activeChannels} ${pluralize(d.activeChannels, 'room')}, led by ${firstChannel?.channel ?? 'the latest room'}.`;
}

function toChannelDigest(accumulator: ChannelAccumulator): ChannelDigest {
  return {
    channel: accumulator.channel,
    count: accumulator.count,
    mentions: accumulator.mentions,
    participants: [...accumulator.participants],
    firstAt: accumulator.firstAt,
    lastAt: accumulator.lastAt,
  };
}

function compareChannelDigest(a: ChannelDigest, b: ChannelDigest): number {
  return b.mentions - a.mentions || b.count - a.count || a.channel.localeCompare(b.channel);
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
