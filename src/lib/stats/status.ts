// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * status.ts — public mesh health feed.
 *
 * Onyx Server writes `status.json` next to the stats index. The website consumes it
 * defensively because dev builds usually do not have live exported data.
 */
import {
  boundedFeedInteger,
  boundedFeedNumber,
  boundedFeedText,
  boundedUnixSeconds,
  publicFeedFreshness,
  type PublicFeedFreshness,
} from './feedBounds';
import { fetchPublicJson } from './fetchPublicJson';

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
  /** False when invalid, duplicate, or over-cap peer rows were omitted. */
  peers_complete: boolean;
};

export type PublicMeshFeedState = PublicFeedFreshness | 'degraded' | 'unavailable';

export function publicMeshFeedState(
  status: (Pick<NetworkStatus, 'generated_at' | 'mesh'>
    & Partial<Pick<NetworkStatus, 'peers_complete'>>) | null,
  nowMs: number,
): PublicMeshFeedState {
  if (!status) return 'unavailable';
  const freshness = publicFeedFreshness(status.generated_at, nowMs);
  if (freshness !== 'current') return freshness;
  return status.mesh.quorum && !status.mesh.partitioned && status.peers_complete !== false
    ? 'current'
    : 'degraded';
}

export function publicMeshFeedLabel(state: PublicMeshFeedState): string {
  switch (state) {
    case 'current': return 'mesh online';
    case 'degraded': return 'mesh degraded';
    case 'stale': return 'status stale';
    case 'future': return 'status time mismatch';
    case 'unknown': return 'status undated';
    default: return 'status unavailable';
  }
}

export function normalizeStatus(raw: unknown): NetworkStatus | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const meshRaw = typeof r['mesh'] === 'object' && r['mesh'] !== null
    ? (r['mesh'] as Record<string, unknown>)
    : {};
  const peers: StatusPeer[] = [];
  let peersComplete = Array.isArray(r['peers']);
  if (Array.isArray(r['peers'])) {
    if (r['peers'].length > MAX_STATUS_PEERS) peersComplete = false;
    const seenPeerNames = new Set<string>();
    for (const entry of r['peers'].slice(0, MAX_STATUS_PEERS)) {
      if (typeof entry !== 'object' || entry === null) {
        peersComplete = false;
        continue;
      }
      const e = entry as Record<string, unknown>;
      if (typeof e['name'] !== 'string' || e['name'].length > MAX_STATUS_PEER_NAME_LENGTH) {
        peersComplete = false;
        continue;
      }
      const name = e['name'].trim();
      const peerKey = name.toLowerCase();
      if (!name || /[\u0000-\u001f\u007f]/u.test(name) || seenPeerNames.has(peerKey)) {
        peersComplete = false;
        continue;
      }
      seenPeerNames.add(peerKey);
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
    peers_complete: peersComplete,
  };
}

export async function fetchNetworkStatus(): Promise<NetworkStatus | null> {
  for (const path of ['/stats/data/status.json', '/stats/status.json', '/status.json']) {
    const status = normalizeStatus(await fetchPublicJson(path));
    if (status) return status;
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
