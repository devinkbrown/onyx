// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * channelAccess.ts — IRCX ACCESS list helpers (levels, masks, entry identity).
 *
 * Wire (Onyx Server `ircx_access_store`):
 *   ACCESS <#chan> LIST [level [mask]]
 *   ACCESS <#chan> ADD <level> <mask> [<timeout-secs>] [:<reason>]
 *   ACCESS <#chan> DELETE <level> <mask>
 *   ACCESS <#chan> CLEAR [level]
 *
 * Numerics: 801 ADD · 802 DELETE · 803 START · 804 ENTRY · 805 END
 * Entry line: `:server 804 me #chan HOST nick!*@* oper 25`
 *
 * Pure + coverage-counting — store folds numerics; ChannelSettings renders.
 */

export const ACCESS_LEVELS = [
  'FOUNDER',
  'OWNER',
  'HOST',
  'VOICE',
  'GRANT',
  'DENY',
] as const;

export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export interface ChannelAccessEntry {
  level: AccessLevel;
  mask: string;
  setBy?: string;
  /** Original timeout seconds from the wire (0/undefined = permanent). */
  duration?: number;
}

export const MAX_ACCESS_LIST_ENTRIES = 256;
export const MAX_ACCESS_LIST_CHANNELS = 32;
export const MAX_ACCESS_MASK_LENGTH = 128;
export const MAX_ACCESS_SETTER_LENGTH = 64;
export const MAX_ACCESS_TIMEOUT_SECONDS = 30 * 24 * 60 * 60;

const LEVEL_SET = new Set<string>(ACCESS_LEVELS);

const LEVEL_LABELS: Record<AccessLevel, string> = {
  FOUNDER: 'Founder',
  OWNER: 'Owner',
  HOST: 'Operator (host)',
  VOICE: 'Voice',
  GRANT: 'Grant (bypass deny)',
  DENY: 'Deny',
};

const LEVEL_HINTS: Record<AccessLevel, string> = {
  FOUNDER: 'Highest persistent rank on join.',
  OWNER: 'Owner (+q) on join.',
  HOST: 'Channel operator (+o) on join.',
  VOICE: 'Voice (+v) on join.',
  GRANT: 'Bypass a matching network-level deny.',
  DENY: 'Block matching hosts from joining.',
};

/** Control chars and spaces are never valid in an ACCESS mask. */
const UNSAFE_MASK = /[\u0000-\u001f\u007f\s]/u;

export function isAccessLevel(value: string): value is AccessLevel {
  return LEVEL_SET.has(value.toUpperCase());
}

export function parseAccessLevel(raw: string | null | undefined): AccessLevel | null {
  if (typeof raw !== 'string') return null;
  const token = raw.trim().toUpperCase();
  return isAccessLevel(token) ? token : null;
}

export function accessLevelLabel(level: AccessLevel): string {
  return LEVEL_LABELS[level];
}

export function accessLevelHint(level: AccessLevel): string {
  return LEVEL_HINTS[level];
}

/**
 * Accept a full hostmask or a bare nick. Bare nicks expand to `nick!*@*` so
 * room admins can grant roles without typing IRCX mask syntax.
 */
export function normalizeAccessMask(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = trimmed.includes('!')
    ? trimmed
    : `${trimmed}!*@*`;
  if (candidate.length > MAX_ACCESS_MASK_LENGTH) return null;
  if (UNSAFE_MASK.test(candidate)) return null;
  // Reject path-escape / injection-shaped tokens and empty nick/user/host parts
  // of a structured mask. Server still re-validates; this is the UI boundary.
  if (candidate.includes('!') || candidate.includes('@')) {
    const bang = candidate.indexOf('!');
    const at = candidate.indexOf('@');
    if (bang <= 0 || at <= bang + 1 || at === candidate.length - 1) return null;
  }
  return candidate;
}

export function parseAccessDuration(
  raw: string | number | null | undefined,
): number | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const n = typeof raw === 'number' ? raw : Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_ACCESS_TIMEOUT_SECONDS) return undefined;
  return n === 0 ? undefined : n;
}

/**
 * Wire/UI input for an ACCESS row. Level/mask stay free strings until
 * `normalizeAccessEntry` / `parseAccessLevel` accept or drop them — do not
 * type these as `AccessLevel` here or raw wire tokens (e.g. "host") fail tsc.
 * Duration may be a numeric timeout or a raw wire token string.
 */
export type AccessEntryInput = {
  level?: string;
  mask?: string;
  setBy?: string;
  duration?: number | string;
};

export function normalizeAccessEntry(
  value: AccessEntryInput,
): ChannelAccessEntry | null {
  const level = parseAccessLevel(value.level);
  const mask = normalizeAccessMask(value.mask);
  if (!level || !mask) return null;
  const setByRaw = typeof value.setBy === 'string'
    ? value.setBy.trim().slice(0, MAX_ACCESS_SETTER_LENGTH)
    : '';
  const setBy = setByRaw && !UNSAFE_MASK.test(setByRaw) ? setByRaw : undefined;
  const duration = parseAccessDuration(
    value.duration === undefined ? undefined : value.duration,
  );
  return {
    level,
    mask,
    ...(setBy ? { setBy } : {}),
    ...(duration !== undefined ? { duration } : {}),
  };
}

export function accessEntryKey(entry: Pick<ChannelAccessEntry, 'level' | 'mask'>): string {
  return `${entry.level}\0${entry.mask.toLowerCase()}`;
}

/** Immutable append/replace by (level, mask). Caps list length. */
export function upsertAccessEntry(
  list: readonly ChannelAccessEntry[],
  entry: ChannelAccessEntry,
): ChannelAccessEntry[] {
  const key = accessEntryKey(entry);
  const next = list.filter((row) => accessEntryKey(row) !== key);
  next.push(entry);
  if (next.length > MAX_ACCESS_LIST_ENTRIES) {
    return next.slice(next.length - MAX_ACCESS_LIST_ENTRIES);
  }
  return next;
}

export function removeAccessEntry(
  list: readonly ChannelAccessEntry[],
  level: AccessLevel,
  mask: string,
): ChannelAccessEntry[] {
  const normalized = normalizeAccessMask(mask);
  if (!normalized) return [...list];
  const key = accessEntryKey({ level, mask: normalized });
  return list.filter((row) => accessEntryKey(row) !== key);
}

export function normalizeAccessList(
  values: readonly AccessEntryInput[],
): ChannelAccessEntry[] {
  const out: ChannelAccessEntry[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (out.length >= MAX_ACCESS_LIST_ENTRIES) break;
    const entry = normalizeAccessEntry(value);
    if (!entry) continue;
    const key = accessEntryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** Stable sort: DENY first (security-visible), then rank, then mask. */
export function sortAccessEntries(
  entries: readonly ChannelAccessEntry[],
): ChannelAccessEntry[] {
  const rank: Record<AccessLevel, number> = {
    DENY: 0,
    FOUNDER: 1,
    OWNER: 2,
    HOST: 3,
    GRANT: 4,
    VOICE: 5,
  };
  return [...entries].sort((a, b) => {
    const byLevel = rank[a.level] - rank[b.level];
    if (byLevel !== 0) return byLevel;
    return a.mask.localeCompare(b.mask, undefined, { sensitivity: 'base' });
  });
}

export function formatAccessDuration(seconds: number | undefined): string {
  if (seconds == null || seconds <= 0) return 'Permanent';
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return days === 1 ? '1 day' : `${days} days`;
  }
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }
  return `${seconds}s`;
}
