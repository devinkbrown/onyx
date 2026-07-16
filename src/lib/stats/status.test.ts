// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  formatDuration,
  MAX_STATUS_PEER_NAME_LENGTH,
  MAX_STATUS_PEERS,
  normalizeStatus,
  publicMeshFeedLabel,
  publicMeshFeedState,
  type NetworkStatus,
} from './status';

const NOW_MS = Date.UTC(2026, 6, 16, 12, 0, 0);
const HEALTHY_STATUS: NetworkStatus = {
  generated_at: NOW_MS / 1000,
  network: 'Onyx',
  node: 'eshmaki.me',
  uptime_seconds: 60,
  users_online: 2,
  mesh: { quorum: true, partitioned: false, components: 1 },
  peers: [],
};

describe('normalizeStatus', () => {
  it('returns null for non-object status feeds', () => {
    expect(normalizeStatus(null)).toBeNull();
    expect(normalizeStatus('offline')).toBeNull();
  });

  it('accepts the Orochi public status shape', () => {
    const status = normalizeStatus({
      generated_at: 1783500000,
      network: 'IRCXNet',
      node: 'eshmaki.me',
      uptime_seconds: 93784,
      users_online: 12,
      mesh: { quorum: true, partitioned: false, components: 1 },
      peers: [
        { name: 'ircx.us', state: 'up', up: true, rtt_ms: 38, since_seconds: 3600 },
        { name: 'stale.node', state: 'down', up: false, rtt_ms: null, since_seconds: 120 },
      ],
    });

    expect(status?.mesh.quorum).toBe(true);
    expect(status?.peers[0]?.rtt_ms).toBe(38);
    expect(status?.peers[1]?.state).toBe('down');
  });

  it('defaults malformed mesh, counters, and peer fields defensively', () => {
    const status = normalizeStatus({
      generated_at: Number.NaN,
      network: 42,
      node: null,
      uptime_seconds: Number.POSITIVE_INFINITY,
      users_online: 'many',
      mesh: { quorum: 'yes', partitioned: true, components: 'split' },
      peers: [
        { name: 'edge', state: '', up: 'true', rtt_ms: Number.NaN, since_seconds: -3 },
        { name: '', state: 'up', up: true },
      ],
    });

    expect(status).toEqual({
      generated_at: 0,
      network: '',
      node: '',
      uptime_seconds: 0,
      users_online: 0,
      mesh: { quorum: false, partitioned: true, components: 1 },
      peers: [{ name: 'edge', state: 'unknown', up: false, rtt_ms: null, since_seconds: 0 }],
    });
  });

  it('bounds peer work, text, and non-negative finite counters', () => {
    const peers = Array.from({ length: MAX_STATUS_PEERS + 4 }, (_, index) => ({
      name: index === 1 ? 'n'.repeat(MAX_STATUS_PEER_NAME_LENGTH + 1) : `peer-${index}`,
      state: 's'.repeat(100),
      up: true,
      rtt_ms: index === 0 ? Number.POSITIVE_INFINITY : index,
      since_seconds: index === 0 ? -1 : index,
    }));

    const status = normalizeStatus({
      generated_at: Number.NaN,
      network: 'n'.repeat(300),
      node: 'o'.repeat(300),
      uptime_seconds: Number.POSITIVE_INFINITY,
      users_online: -5,
      mesh: { components: 10_000 },
      peers,
    })!;

    expect(status.peers).toHaveLength(MAX_STATUS_PEERS - 1);
    expect(status.peers[0]).toMatchObject({ rtt_ms: null, since_seconds: 0 });
    expect(status.peers.some((peer) => peer.name.length > MAX_STATUS_PEER_NAME_LENGTH)).toBe(false);
    expect(status.peers[0]!.state).toHaveLength(32);
    expect(status.generated_at).toBe(0);
    expect(status.uptime_seconds).toBe(0);
    expect(status.users_online).toBe(0);
    expect(status.mesh.components).toBe(1024);
    expect(status.network).toHaveLength(256);
    expect(status.node).toHaveLength(256);
  });

  it('formats compact durations for status rows', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(-10)).toBe('0s');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(3600 + 180)).toBe('1h 3m');
    expect(formatDuration(2 * 86400 + 3600)).toBe('2d 1h');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0s');
  });
});

describe('public mesh feed state', () => {
  it('reports online only for a fresh healthy quorum sample', () => {
    expect(publicMeshFeedState(HEALTHY_STATUS, NOW_MS)).toBe('current');
    expect(publicMeshFeedLabel('current')).toBe('mesh online');
  });

  it('keeps topology failures distinct from feed freshness failures', () => {
    expect(publicMeshFeedState({
      ...HEALTHY_STATUS,
      mesh: { quorum: false, partitioned: true, components: 2 },
    }, NOW_MS)).toBe('degraded');
    expect(publicMeshFeedState({
      ...HEALTHY_STATUS,
      generated_at: (NOW_MS - 10 * 60_000) / 1000,
    }, NOW_MS)).toBe('stale');
    expect(publicMeshFeedState({
      ...HEALTHY_STATUS,
      generated_at: (NOW_MS + 10 * 60_000) / 1000,
    }, NOW_MS)).toBe('future');
    expect(publicMeshFeedState({ ...HEALTHY_STATUS, generated_at: 0 }, NOW_MS)).toBe('unknown');
    expect(publicMeshFeedState(null, NOW_MS)).toBe('unavailable');
  });

  it('gives every non-current state truthful public wording', () => {
    expect([
      publicMeshFeedLabel('degraded'),
      publicMeshFeedLabel('stale'),
      publicMeshFeedLabel('future'),
      publicMeshFeedLabel('unknown'),
      publicMeshFeedLabel('unavailable'),
    ]).toEqual([
      'mesh degraded',
      'status stale',
      'status time mismatch',
      'status undated',
      'status unavailable',
    ]);
  });
});
