// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { formatDuration, normalizeStatus } from './status';

describe('normalizeStatus', () => {
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

  it('formats compact durations for status rows', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(3600 + 180)).toBe('1h 3m');
    expect(formatDuration(2 * 86400 + 3600)).toBe('2d 1h');
  });
});
