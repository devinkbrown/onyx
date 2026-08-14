// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { describeBanListView, EMPTY_BAN_LIST_META, type BanListMeta } from './banListView';

const ready: BanListMeta = { ...EMPTY_BAN_LIST_META, status: 'ready', updatedAt: 10 };
const loading: BanListMeta = { ...EMPTY_BAN_LIST_META, status: 'loading' };

describe('describeBanListView', () => {
  it('reports idle before any authoritative list arrives', () => {
    expect(describeBanListView({ entries: undefined, meta: undefined, connected: true }).kind).toBe('idle');
  });

  it('reports loading, known-empty, and populated lists', () => {
    expect(describeBanListView({ entries: undefined, meta: loading, connected: true }).kind).toBe('loading');
    expect(describeBanListView({ entries: [], meta: ready, connected: true })).toEqual({
      kind: 'empty',
      updatedAt: 10,
    });
    expect(describeBanListView({
      entries: [{ mask: 'bad!*@*' }],
      meta: ready,
      connected: true,
    }).kind).toBe('populated');
  });

  it('keeps last-known entries on error and unavailable', () => {
    const error = describeBanListView({
      entries: [{ mask: 'old!*@*' }],
      meta: { ...EMPTY_BAN_LIST_META, status: 'error', error: 'Need permission' },
      connected: true,
    });
    expect(error).toMatchObject({ kind: 'error', message: 'Need permission' });
    if (error.kind === 'error') expect(error.entries).toEqual([{ mask: 'old!*@*' }]);

    const unavailable = describeBanListView({
      entries: [{ mask: 'old!*@*' }],
      meta: loading,
      connected: false,
    });
    expect(unavailable.kind).toBe('unavailable');
  });
});
