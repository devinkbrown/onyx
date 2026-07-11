// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { formatDuration, normalizeStatus } from './status';

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
      peers: [{ name: 'edge', state: 'unknown', up: false, rtt_ms: null, since_seconds: -3 }],
    });
  });

  it('formats compact durations for status rows', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(-10)).toBe('0s');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(3600 + 180)).toBe('1h 3m');
    expect(formatDuration(2 * 86400 + 3600)).toBe('2d 1h');
  });
});
