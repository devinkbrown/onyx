// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { filterEventReplayRows, normalizeEventFilter } from './eventFilters';

const rows = [
  { category: 'kill', categoryCode: 'KILL', severity: 'warn', origin: 'node-a', message: 'killed badactor' },
  { category: 'mesh', categoryCode: 'MESH', severity: 'info', origin: 'node-b', message: 'peer up' },
];

describe('filterEventReplayRows', () => {
  it('filters locally by category, severity, and text without mutating the source', () => {
    expect(filterEventReplayRows(rows, { category: 'KILL', severity: '', text: '' })).toHaveLength(1);
    expect(filterEventReplayRows(rows, { category: '', severity: 'info', text: '' })[0]?.category).toBe('mesh');
    expect(filterEventReplayRows(rows, { category: '', severity: '', text: 'badactor' })).toHaveLength(1);
    expect(rows).toHaveLength(2);
  });

  it('strips control characters and ignores blank filters', () => {
    expect(normalizeEventFilter('  ki\u0007ll  ')).toBe('kill');
    expect(filterEventReplayRows(rows, { category: '   ', severity: '   ', text: '   ' })).toHaveLength(2);
  });
});
