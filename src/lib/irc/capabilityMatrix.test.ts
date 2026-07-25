// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { buildCapabilityMatrix, capabilitySummary } from './capabilityMatrix';

describe('capabilityMatrix', () => {
  it('marks negotiated vs available vs missing', () => {
    const rows = buildCapabilityMatrix({
      negotiated: ['sasl', 'message-tags'],
      available: ['sasl', 'message-tags', 'draft/chathistory', 'onyx/e2ee'],
    });
    expect(rows.find((r) => r.id === 'sasl')?.status).toBe('active');
    expect(rows.find((r) => r.id === 'draft/chathistory')?.status).toBe('available');
    expect(rows.find((r) => r.id === 'onyx/media')?.status).toBe('missing');
    expect(capabilitySummary(rows)).toMatch(/2\//);
  });
});
