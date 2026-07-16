// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const SOFT_IGNORE_STORAGE_KEY = 'onyx:soft-ignore';
export const NICK_COLORS_STORAGE_KEY = 'onyx:nick-colors';
export const DISPLAY_NAMES_STORAGE_KEY = 'onyx:display-names';

export const MAX_IDENTITY_OVERRIDES = 512;
export const MAX_IDENTITY_OVERRIDE_NICK_LENGTH = 128;
export const MAX_LOCAL_DISPLAY_NAME_LENGTH = 128;
const MAX_IDENTITY_OVERRIDE_STORAGE_CHARS = 256 * 1024;

const INVALID_NICK_CHARACTERS = /[\s,\x00-\x1f\x7f]/u;
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/u;
const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Canonical nickname key shared by the three private identity override stores. */
export function normalizeIdentityOverrideNick(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const nick = value.trim().toLowerCase();
  if (
    nick.length === 0
    || nick.length > MAX_IDENTITY_OVERRIDE_NICK_LENGTH
    || INVALID_NICK_CHARACTERS.test(nick)
  ) return null;
  return nick;
}

/** Persist only unambiguous CSS hex colors; arbitrary CSS tokens fail closed. */
export function normalizeNickColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim().toLowerCase();
  return HEX_COLOR.test(color) ? color : null;
}

/** Bound local aliases and reject control characters that can spoof surrounding UI. */
export function normalizeLocalDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const displayName = value.trim();
  if (
    displayName.length === 0
    || displayName.length > MAX_LOCAL_DISPLAY_NAME_LENGTH
    || CONTROL_CHARACTERS.test(displayName)
  ) return null;
  return displayName;
}

export function parseSoftIgnoreList(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  const ignored = new Set<string>();
  for (const raw of value) {
    const nick = normalizeIdentityOverrideNick(raw);
    if (!nick) continue;
    ignored.add(nick);
    if (ignored.size >= MAX_IDENTITY_OVERRIDES) break;
  }
  return ignored;
}

export function parseNickColorOverrides(value: unknown): Map<string, string> {
  if (!isRecord(value)) return new Map();
  const overrides = new Map<string, string>();
  for (const [rawNick, rawColor] of Object.entries(value)) {
    const nick = normalizeIdentityOverrideNick(rawNick);
    const color = normalizeNickColor(rawColor);
    if (!nick || !color) continue;
    if (!overrides.has(nick) && overrides.size >= MAX_IDENTITY_OVERRIDES) break;
    overrides.set(nick, color);
  }
  return overrides;
}

export function parseDisplayNameOverrides(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const overrides = new Map<string, string>();
  for (const [rawNick, rawDisplayName] of Object.entries(value)) {
    const nick = normalizeIdentityOverrideNick(rawNick);
    const displayName = normalizeLocalDisplayName(rawDisplayName);
    if (!nick || !displayName) continue;
    if (!overrides.has(nick) && overrides.size >= MAX_IDENTITY_OVERRIDES) break;
    overrides.set(nick, displayName);
  }
  return Object.fromEntries(overrides);
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function ownerStorageKey(baseKey: string, owner?: DeviceMemoryOwner): string | null {
  return owner ? deviceMemoryStorageKey(baseKey, owner) : null;
}

/** Ownerless identity hints are ambiguous after upgrade, so purge rather than claim them. */
export function purgeLegacyIdentityOverrides(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(SOFT_IGNORE_STORAGE_KEY);
    store.removeItem(NICK_COLORS_STORAGE_KEY);
    store.removeItem(DISPLAY_NAMES_STORAGE_KEY);
    return store.getItem(SOFT_IGNORE_STORAGE_KEY) === null
      && store.getItem(NICK_COLORS_STORAGE_KEY) === null
      && store.getItem(DISPLAY_NAMES_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

function readOwnedValue(baseKey: string, owner?: DeviceMemoryOwner): unknown {
  const store = storage();
  purgeLegacyIdentityOverrides();
  const key = ownerStorageKey(baseKey, owner);
  if (!store || !key || !owner) return null;
  try {
    const raw = store.getItem(key);
    if (!raw || raw.length > MAX_IDENTITY_OVERRIDE_STORAGE_CHARS) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function loadSoftIgnoreList(owner?: DeviceMemoryOwner): Set<string> {
  return parseSoftIgnoreList(readOwnedValue(SOFT_IGNORE_STORAGE_KEY, owner));
}

export function loadNickColorOverrides(owner?: DeviceMemoryOwner): Map<string, string> {
  return parseNickColorOverrides(readOwnedValue(NICK_COLORS_STORAGE_KEY, owner));
}

export function loadDisplayNameOverrides(owner?: DeviceMemoryOwner): Record<string, string> {
  return parseDisplayNameOverrides(readOwnedValue(DISPLAY_NAMES_STORAGE_KEY, owner));
}

function sortedRecord(value: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries([...value].sort(([left], [right]) => left.localeCompare(right)));
}

export function saveSoftIgnoreList(
  value: ReadonlySet<string>,
  owner?: DeviceMemoryOwner,
): Set<string> | null {
  const store = storage();
  purgeLegacyIdentityOverrides();
  const key = ownerStorageKey(SOFT_IGNORE_STORAGE_KEY, owner);
  if (!store || !key || !owner) return null;
  const normalized = parseSoftIgnoreList([...value]);
  const serialized = JSON.stringify([...normalized].sort());
  try {
    if (normalized.size === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    const verified = loadSoftIgnoreList(owner);
    return JSON.stringify([...verified].sort()) === serialized ? verified : null;
  } catch {
    return null;
  }
}

export function saveNickColorOverrides(
  value: ReadonlyMap<string, string>,
  owner?: DeviceMemoryOwner,
): Map<string, string> | null {
  const store = storage();
  purgeLegacyIdentityOverrides();
  const key = ownerStorageKey(NICK_COLORS_STORAGE_KEY, owner);
  if (!store || !key || !owner) return null;
  const normalized = parseNickColorOverrides(Object.fromEntries(value));
  const serialized = JSON.stringify(sortedRecord(normalized));
  try {
    if (normalized.size === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    const verified = loadNickColorOverrides(owner);
    return JSON.stringify(sortedRecord(verified)) === serialized ? verified : null;
  } catch {
    return null;
  }
}

export function saveDisplayNameOverrides(
  value: Readonly<Record<string, string>>,
  owner?: DeviceMemoryOwner,
): Record<string, string> | null {
  const store = storage();
  purgeLegacyIdentityOverrides();
  const key = ownerStorageKey(DISPLAY_NAMES_STORAGE_KEY, owner);
  if (!store || !key || !owner) return null;
  const normalized = parseDisplayNameOverrides(value);
  const serialized = JSON.stringify(sortedRecord(new Map(Object.entries(normalized))));
  try {
    if (Object.keys(normalized).length === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    const verified = loadDisplayNameOverrides(owner);
    return JSON.stringify(sortedRecord(new Map(Object.entries(verified)))) === serialized
      ? verified
      : null;
  } catch {
    return null;
  }
}
