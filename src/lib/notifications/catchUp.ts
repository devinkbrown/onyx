// ─────────────────────────────────────────────────────────────────────────────
// Catch-up model — "what did I miss" across every joined room + DM.
//
// Turns the store's per-target unread/mention counters into a single ranked
// list for the Home surface, so catching up is the landing experience rather
// than "last channel you had open". Pure + unit-tested; the component just
// renders the result.
//
// Ranking: anything personal or addressed to you first (DMs, and channels where
// you were mentioned), then by most-recent activity. This matches the "calm
// notifications" intent — mentions/DMs surface, ambient chatter accumulates
// quietly below.
// ─────────────────────────────────────────────────────────────────────────────

export interface CatchUpItem {
  /** Stable key for keyed rendering. */
  key: string;
  kind: 'channel' | 'dm';
  /** Display label: '#channel' or a nick. */
  name: string;
  /** Navigation target: the channel name or the DM nick. */
  target: string;
  unread: number;
  /** Messages that mention you (channel highlights) — the priority signal. */
  highlights: number;
  /** Last activity, unix ms; 0 when unknown. */
  lastActivity: number;
}

interface ChannelLike {
  name: string;
  unread: number;
  highlights: number;
}

interface DmLike {
  nick: string;
  unread: number;
  highlights: number;
  lastSeen?: Date;
}

/**
 * Build the ranked catch-up list from joined channels + DMs. Only targets with
 * something unread appear. Priority: DMs and mentioned channels first, then by
 * recency; capped at `limit`.
 */
export function buildCatchUp(
  channels: Iterable<ChannelLike>,
  dms: Iterable<DmLike>,
  channelLastActivity: Map<string, number>,
  limit = 8,
): CatchUpItem[] {
  const items: CatchUpItem[] = [];

  for (const ch of channels) {
    if (ch.unread > 0 || ch.highlights > 0) {
      items.push({
        key: `c:${ch.name.toLowerCase()}`,
        kind: 'channel',
        name: ch.name,
        target: ch.name,
        unread: ch.unread,
        highlights: ch.highlights,
        lastActivity: channelLastActivity.get(ch.name.toLowerCase()) ?? 0,
      });
    }
  }

  for (const dm of dms) {
    if (dm.unread > 0 || dm.highlights > 0) {
      items.push({
        key: `d:${dm.nick.toLowerCase()}`,
        kind: 'dm',
        name: dm.nick,
        target: dm.nick,
        unread: dm.unread,
        highlights: dm.highlights,
        lastActivity: dm.lastSeen ? dm.lastSeen.getTime() : 0,
      });
    }
  }

  const priority = (i: CatchUpItem): number => (i.highlights > 0 || i.kind === 'dm' ? 1 : 0);

  return items
    .sort((a, b) => priority(b) - priority(a) || b.lastActivity - a.lastActivity)
    .slice(0, limit);
}

/** Aggregate unread + mention totals across a catch-up list. */
export function catchUpSummary(items: readonly CatchUpItem[]): {
  unread: number;
  mentions: number;
} {
  return items.reduce(
    (acc, i) => ({ unread: acc.unread + i.unread, mentions: acc.mentions + i.highlights }),
    { unread: 0, mentions: 0 },
  );
}
