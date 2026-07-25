// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { connectionBanner } from './partitionBanner';

describe('partitionBanner', () => {
  it('hides when healthy and flags mesh partition', () => {
    expect(connectionBanner({
      connectionStatus: 'connected',
      meshLinksActive: 1,
      meshLinksExpected: 1,
    }).kind).toBe('hidden');
    expect(connectionBanner({
      connectionStatus: 'connected',
      meshLinksActive: 0,
      meshLinksExpected: 1,
    }).kind).toBe('mesh-partition');
    expect(connectionBanner({ connectionStatus: 'reconnecting', reconnectIn: 5 }).detail).toContain('5s');
  });
});
