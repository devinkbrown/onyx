/**
 * networkIndex.ts — the live network pulse feed.
 *
 * Same-origin `/stats/data/index.json`, emitted by Orochi's chanstats engine
 * every ~30s. Shared by HomeView and the Connect screen's pulse panel.
 * Defensive normalization: the fetch 404s in dev and the shape is external —
 * consumers must always receive either `null` or a fully-typed value.
 */

export type StatsChannel = {
  channel: string;
  messages: number;
  active_users: number;
  last_active: number;
  topic: string;
  spark: number[];
};

export type StatsIndex = {
  generated_at: number;
  network: string;
  node: string;
  channels: StatsChannel[];
};

export function normalizeIndex(raw: unknown): StatsIndex | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r['channels'])) return null;
  const channels: StatsChannel[] = [];
  for (const entry of r['channels']) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e['channel'] !== 'string' || !e['channel']) continue;
    channels.push({
      channel: e['channel'],
      messages: typeof e['messages'] === 'number' ? e['messages'] : 0,
      active_users: typeof e['active_users'] === 'number' ? e['active_users'] : 0,
      last_active: typeof e['last_active'] === 'number' ? e['last_active'] : 0,
      topic: typeof e['topic'] === 'string' ? e['topic'] : '',
      spark: Array.isArray(e['spark'])
        ? e['spark'].map((n) => (typeof n === 'number' && n > 0 ? n : 0))
        : [],
    });
  }
  return {
    generated_at: typeof r['generated_at'] === 'number' ? r['generated_at'] : 0,
    network: typeof r['network'] === 'string' ? r['network'] : '',
    node: typeof r['node'] === 'string' ? r['node'] : '',
    channels,
  };
}

export async function fetchStatsIndex(): Promise<StatsIndex | null> {
  try {
    const res = await fetch('/stats/data/index.json', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return normalizeIndex(await res.json());
  } catch {
    return null; // dev servers have no /stats — consumers hide the pulse
  }
}

/** Compact relative time from a unix-seconds stamp. */
export function relTime(unixSec: number, nowMs: number): string {
  if (!unixSec) return 'a while ago';
  const s = Math.max(0, Math.floor(nowMs / 1000 - unixSec));
  if (s < 50) return `${s}s ago`;
  if (s < 3000) return `${Math.round(s / 60)}m ago`;
  if (s < 90000) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
