/**
 * status.ts — public mesh health feed.
 *
 * Orochi writes `status.json` next to the stats index. The website consumes it
 * defensively because dev builds usually do not have live exported data.
 */

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

function numberOr(raw: unknown, fallback = 0): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

export function normalizeStatus(raw: unknown): NetworkStatus | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const meshRaw = typeof r['mesh'] === 'object' && r['mesh'] !== null
    ? (r['mesh'] as Record<string, unknown>)
    : {};
  const peers: StatusPeer[] = [];
  if (Array.isArray(r['peers'])) {
    for (const entry of r['peers']) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      if (typeof e['name'] !== 'string' || !e['name']) continue;
      const rtt = e['rtt_ms'];
      peers.push({
        name: e['name'],
        state: typeof e['state'] === 'string' && e['state'] ? e['state'] : 'unknown',
        up: e['up'] === true,
        rtt_ms: typeof rtt === 'number' && Number.isFinite(rtt) ? rtt : null,
        since_seconds: numberOr(e['since_seconds']),
      });
    }
  }
  return {
    generated_at: numberOr(r['generated_at']),
    network: typeof r['network'] === 'string' ? r['network'] : '',
    node: typeof r['node'] === 'string' ? r['node'] : '',
    uptime_seconds: numberOr(r['uptime_seconds']),
    users_online: numberOr(r['users_online']),
    mesh: {
      quorum: meshRaw['quorum'] === true,
      partitioned: meshRaw['partitioned'] === true,
      components: numberOr(meshRaw['components'], 1),
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
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${s}s`;
}
