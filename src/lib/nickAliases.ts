// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const NICK_ALIASES_STORAGE_KEY = 'onyx:nick-aliases';
export const MAX_NICK_ALIASES = 16;
export const MAX_NICK_ALIAS_LENGTH = 64;
const MAX_NICK_ALIASES_STORAGE_CHARS = 8 * 1024;
const NICK_RE = /^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]*$/;

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function storageKey(owner?: DeviceMemoryOwner): string | null {
  return owner ? deviceMemoryStorageKey(NICK_ALIASES_STORAGE_KEY, owner) : null;
}

export function normalizeNickAlias(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const nick = value.trim();
  return nick.length > 0
    && nick.length <= MAX_NICK_ALIAS_LENGTH
    && NICK_RE.test(nick)
    ? nick
    : null;
}

/** Validate, case-fold-deduplicate, and exclude the owner's canonical identity. */
export function normalizeNickAliases(
  value: readonly unknown[],
  owner?: DeviceMemoryOwner,
): string[] {
  const canonical = owner?.identity.trim().toLowerCase() ?? '';
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (aliases.length >= MAX_NICK_ALIASES) break;
    const nick = normalizeNickAlias(raw);
    const key = nick?.toLowerCase() ?? '';
    if (!nick || key === canonical || seen.has(key)) continue;
    seen.add(key);
    aliases.push(nick);
  }
  return aliases;
}

function parseNickAliases(raw: string | null, owner: DeviceMemoryOwner): string[] {
  if (!raw || raw.length > MAX_NICK_ALIASES_STORAGE_CHARS) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeNickAliases(parsed, owner) : [];
  } catch {
    return [];
  }
}

/** Purge unsafe ownerless identity hints instead of assigning them to a session. */
export function purgeLegacyNickAliases(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(NICK_ALIASES_STORAGE_KEY);
    return store.getItem(NICK_ALIASES_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

/** Load only one explicit owner's aliases; ownerless reads always fail closed. */
export function loadNickAliases(owner?: DeviceMemoryOwner): string[] {
  const store = storage();
  purgeLegacyNickAliases();
  const key = storageKey(owner);
  if (!store || !key || !owner) return [];
  try {
    return parseNickAliases(store.getItem(key), owner);
  } catch {
    return [];
  }
}

/** Persist and verify one owner's bounded aliases; returns the exact durable list. */
export function saveNickAliases(
  value: readonly unknown[],
  owner?: DeviceMemoryOwner,
): string[] | null {
  const store = storage();
  purgeLegacyNickAliases();
  const key = storageKey(owner);
  if (!store || !key || !owner) return null;
  const aliases = normalizeNickAliases(value, owner);
  const serialized = JSON.stringify(aliases);
  try {
    if (aliases.length === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    const verified = loadNickAliases(owner);
    return JSON.stringify(verified) === serialized ? verified : null;
  } catch {
    return null;
  }
}
