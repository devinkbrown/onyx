// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { sfuCascadeView } from './sfuCascade';

describe('sfuCascade (C8 UX)', () => {
  it('labels local vs cascade vs degraded', () => {
    expect(sfuCascadeView({ localSfu: true, remoteForwarders: 0 }).mode).toBe('local');
    expect(sfuCascadeView({ remoteForwarders: 2 }).label).toContain('3 hops');
    expect(sfuCascadeView({ remoteForwarders: 1, packetLoss: 0.2 }).mode).toBe('degraded');
    expect(sfuCascadeView({ known: false }).mode).toBe('unknown');
  });
});
