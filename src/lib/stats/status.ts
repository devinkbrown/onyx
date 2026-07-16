// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * status.ts — public mesh health feed.
 *
 * Orochi writes `status.json` next to the stats index. The website consumes it
 * defensively because dev builds usually do not have live exported data.
 */
import {
  boundedFeedInteger,
  boundedFeedNumber,
  boundedFeedText,
  boundedUnixSeconds,
} from './feedBounds';

export const MAX_STATUS_PEERS = 128;
export const MAX_STATUS_PEER_NAME_LENGTH = 128;
const MAX_STATUS_META_LENGTH = 256;
const MAX_STATUS_STATE_LENGTH = 32;

export type MeshEnvelope = {
  quorum: boolean;
  partitioned: boolean;
  components: number;
};

export type StatusPeer = {
  name: string;
  state: string;
  up: boolean;
  rtt_ms: number | null;
  since_seconds: number;
};

export type NetworkStatus = {
  generated_at: number;
  network: string;
  node: string;
  uptime_seconds: number;
  users_online: number;
  mesh: MeshEnvelope;
  peers: StatusPeer[];
};

export function normalizeStatus(raw: unknown): NetworkStatus | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const meshRaw = typeof r['mesh'] === 'object' && r['mesh'] !== null
    ? (r['mesh'] as Record<string, unknown>)
    : {};
  const peers: StatusPeer[] = [];
  if (Array.isArray(r['peers'])) {
    for (const entry of r['peers'].slice(0, MAX_STATUS_PEERS)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      if (typeof e['name'] !== 'string' || e['name'].length > MAX_STATUS_PEER_NAME_LENGTH) continue;
      const name = e['name'];
      if (!name || /[\u0000\r\n]/u.test(name)) continue;
      const rtt = e['rtt_ms'];
      peers.push({
        name,
        state: boundedFeedText(e['state'], MAX_STATUS_STATE_LENGTH) || 'unknown',
        up: e['up'] === true,
        rtt_ms: typeof rtt === 'number' && Number.isFinite(rtt) && rtt >= 0
          ? boundedFeedNumber(rtt)
          : null,
        since_seconds: boundedFeedInteger(e['since_seconds']),
      });
    }
  }
  return {
    generated_at: boundedUnixSeconds(r['generated_at']),
    network: boundedFeedText(r['network'], MAX_STATUS_META_LENGTH),
    node: boundedFeedText(r['node'], MAX_STATUS_META_LENGTH),
    uptime_seconds: boundedFeedInteger(r['uptime_seconds']),
    users_online: boundedFeedInteger(r['users_online']),
    mesh: {
      quorum: meshRaw['quorum'] === true,
      partitioned: meshRaw['partitioned'] === true,
      components: Math.max(1, boundedFeedInteger(meshRaw['components'], 1024)),
    },
    peers,
  };
}

export async function fetchNetworkStatus(): Promise<NetworkStatus | null> {
  for (const path of ['/stats/data/status.json', '/stats/status.json', '/status.json']) {
    try {
      const res = await fetch(path, { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const status = normalizeStatus(await res.json());
      if (status) return status;
    } catch {
      // Try the next known deployment path.
    }
  }
  return null;
}

export function formatDuration(totalSeconds: number): string {
  const s = boundedFeedInteger(totalSeconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${s}s`;
}
