// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { provenanceAriaLabel, provenanceLabel } from './provenance';

describe('provenance labels', () => {
  it('names local, server, and external execution scopes', () => {
    expect(provenanceLabel('device')).toMatchObject({
      label: 'This device',
      description: expect.stringContaining('locally'),
    });
    expect(provenanceLabel('server')).toMatchObject({
      label: 'This server',
      description: expect.stringContaining('server-side history'),
    });
    expect(provenanceLabel('external')).toMatchObject({
      label: 'External',
      description: expect.stringContaining('external endpoint'),
    });
  });

  it('builds accessible subject-specific provenance descriptions', () => {
    expect(provenanceAriaLabel('device', 'Search results')).toBe(
      'Search results provenance: This device. Computed locally in this browser from loaded or saved Onyx data.',
    );
  });
});
