// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const USER_NOTES_STORAGE_KEY = 'onyx:user-notes';
export const MAX_USER_NOTES = 512;
export const MAX_USER_NOTE_NICK_LENGTH = 128;
export const MAX_USER_NOTE_LENGTH = 2_048;
export const MAX_USER_NOTES_STORAGE_CHARS = 2 * 1024 * 1024;

const INVALID_NICK_CHARACTERS = /[\s,\x00-\x1f\x7f]/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalize a per-user note key without admitting wire-unsafe nicknames. */
export function normalizeUserNoteNick(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const nick = value.trim().toLowerCase();
  if (
    nick.length === 0
    || nick.length > MAX_USER_NOTE_NICK_LENGTH
    || INVALID_NICK_CHARACTERS.test(nick)
  ) return null;
  return nick;
}

/** Normalize one private note while preserving intentional internal spacing. */
export function normalizeUserNoteText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const note = value.trim();
  if (note.length === 0 || note.length > MAX_USER_NOTE_LENGTH) return null;
  return note;
}

/** Parse untrusted persisted notes into a bounded, canonical map. */
export function parseUserNotes(value: unknown): Map<string, string> {
  if (!isRecord(value)) return new Map();
  const notes = new Map<string, string>();
  for (const [rawNick, rawNote] of Object.entries(value)) {
    const nick = normalizeUserNoteNick(rawNick);
    const note = normalizeUserNoteText(rawNote);
    if (!nick || !note) continue;
    notes.set(nick, note);
    if (notes.size >= MAX_USER_NOTES) break;
  }
  return notes;
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function storageKey(owner: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(USER_NOTES_STORAGE_KEY, owner);
}

/** Purge ownerless private notes instead of assigning them to the next login. */
export function purgeLegacyUserNotes(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(USER_NOTES_STORAGE_KEY);
    return store.getItem(USER_NOTES_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

export function loadUserNotes(owner: DeviceMemoryOwner): Map<string, string> {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return new Map();
  purgeLegacyUserNotes();
  try {
    const raw = store.getItem(key);
    if (raw && raw.length > MAX_USER_NOTES_STORAGE_CHARS) return new Map();
    return raw ? parseUserNotes(JSON.parse(raw) as unknown) : new Map();
  } catch {
    return new Map();
  }
}

export function saveUserNotes(
  value: ReadonlyMap<string, string>,
  owner: DeviceMemoryOwner,
): boolean {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return false;
  const notes = parseUserNotes(Object.fromEntries(value));
  const serialized = JSON.stringify(Object.fromEntries(notes));
  try {
    purgeLegacyUserNotes();
    if (notes.size === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    return JSON.stringify(Object.fromEntries(loadUserNotes(owner))) === serialized;
  } catch {
    return false;
  }
}
