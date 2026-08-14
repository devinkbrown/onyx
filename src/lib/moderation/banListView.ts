// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Derived ban-list view for the room desk. Protocol 367/368 parsing stays in
 * the store; this only describes what the UI may show.
 */

export type BanListEntry = {
  mask: string;
  setBy?: string;
  setAt?: number;
};

export type BanListRequestStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';

export type BanListMeta = {
  status: BanListRequestStatus;
  updatedAt: number | null;
  error: string | null;
  generation: number;
  epoch: number;
};

export const EMPTY_BAN_LIST_META: BanListMeta = {
  status: 'idle',
  updatedAt: null,
  error: null,
  generation: 0,
  epoch: 0,
};

export type BanListView =
  | { kind: 'idle'; entries: BanListEntry[] }
  | { kind: 'loading'; entries: BanListEntry[] }
  | { kind: 'populated'; entries: BanListEntry[]; updatedAt: number | null }
  | { kind: 'empty'; updatedAt: number | null }
  | { kind: 'error'; message: string; entries: BanListEntry[] }
  | { kind: 'unavailable'; message: string; entries: BanListEntry[] };

export function describeBanListView(input: {
  entries: readonly BanListEntry[] | undefined;
  meta: BanListMeta | undefined;
  connected: boolean;
}): BanListView {
  const entries = [...(input.entries ?? [])];
  const meta = input.meta ?? EMPTY_BAN_LIST_META;
  const hasAuthoritativeList = input.entries !== undefined;

  if (!input.connected && meta.status === 'loading') {
    return {
      kind: 'unavailable',
      message: meta.error ?? 'Reconnect to refresh the block list.',
      entries,
    };
  }

  if (meta.status === 'loading') return { kind: 'loading', entries };
  if (meta.status === 'error') {
    return {
      kind: 'error',
      message: meta.error ?? 'The block list could not be loaded.',
      entries,
    };
  }
  if (meta.status === 'unavailable') {
    return {
      kind: 'unavailable',
      message: meta.error ?? 'The block list is unavailable.',
      entries,
    };
  }
  if (meta.status === 'ready' && hasAuthoritativeList && entries.length === 0) {
    return { kind: 'empty', updatedAt: meta.updatedAt };
  }
  if (hasAuthoritativeList && entries.length > 0) {
    return { kind: 'populated', entries, updatedAt: meta.updatedAt };
  }
  return { kind: 'idle', entries };
}
