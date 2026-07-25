// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * portableIdentity.ts — Era 3 C10 portable residence export/import.
 *
 * Exports NON-SECRET client residence data (preferences snapshot, bookmarks,
 * categories, quiet-hours hours). Never includes device private keys, session
 * tokens, vault plaintext, or recovery codes.
 */

import type { Preferences } from '@/lib/prefs/preferences';
import { parsePreferencesSnapshot, DEFAULT_PREFERENCES } from '@/lib/prefs/preferences';
import { parseBookmarks, type BookmarkList } from '@/lib/channel/bookmarks';
import { parseCategoryState, type CategoryState } from '@/lib/channel/categories';

export const PORTABLE_IDENTITY_KIND = 'onyx.portable-identity' as const;
export const PORTABLE_IDENTITY_VERSION = 1 as const;
export const MAX_PORTABLE_IDENTITY_CHARS = 256 * 1024;

export type PortableIdentity = {
  kind: typeof PORTABLE_IDENTITY_KIND;
  version: typeof PORTABLE_IDENTITY_VERSION;
  exportedAt: string;
  networkHint?: string;
  preferences: Preferences;
  bookmarks: BookmarkList;
  categories: CategoryState;
  quietHours: { startHour: number; endHour: number };
};

function clampHour(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const hour = Math.floor(value);
  if (hour < 0 || hour > 23) return fallback;
  return hour;
}

export function buildPortableIdentity(input: {
  preferences?: unknown;
  bookmarks?: unknown;
  categories?: unknown;
  quietHours?: { startHour?: unknown; endHour?: unknown };
  networkHint?: string;
  now?: Date;
}): PortableIdentity {
  const prefs = parsePreferencesSnapshot(input.preferences) ?? { ...DEFAULT_PREFERENCES };
  const hint = input.networkHint?.trim().slice(0, 64) || undefined;
  return {
    kind: PORTABLE_IDENTITY_KIND,
    version: PORTABLE_IDENTITY_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    ...(hint ? { networkHint: hint } : {}),
    preferences: prefs,
    bookmarks: parseBookmarks(input.bookmarks ?? []),
    categories: parseCategoryState(input.categories ?? { categories: [] }),
    quietHours: {
      startHour: clampHour(input.quietHours?.startHour, 22),
      endHour: clampHour(input.quietHours?.endHour, 8),
    },
  };
}

export function serializePortableIdentity(identity: PortableIdentity): string {
  return `${JSON.stringify(identity, null, 2)}\n`;
}

/**
 * Parse and validate a portable identity document. Fail closed on wrong kind,
 * version, oversize, or non-object roots. Secret-looking keys are ignored.
 */
export function parsePortableIdentity(raw: string): PortableIdentity | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PORTABLE_IDENTITY_CHARS) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.kind !== PORTABLE_IDENTITY_KIND) return null;
  if (obj.version !== PORTABLE_IDENTITY_VERSION) return null;
  if (typeof obj.exportedAt !== 'string' || !Number.isFinite(Date.parse(obj.exportedAt))) {
    return null;
  }
  // Refuse documents that smuggle private key material under known secret names.
  const forbidden = ['privateKey', 'recoveryCodes', 'sessionToken', 'meshToken', 'password'];
  for (const key of Object.keys(obj)) {
    if (forbidden.includes(key)) return null;
  }

  return buildPortableIdentity({
    preferences: obj.preferences,
    bookmarks: obj.bookmarks,
    categories: obj.categories,
    quietHours: typeof obj.quietHours === 'object' && obj.quietHours !== null
      ? (obj.quietHours as { startHour?: unknown; endHour?: unknown })
      : undefined,
    networkHint: typeof obj.networkHint === 'string' ? obj.networkHint : undefined,
    now: new Date(obj.exportedAt),
  });
}
