// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * followed.ts - localStorage-backed followed conversation keys for notification calm mode.
 *
 * SOLID IDIOMS: module-level createSignal; never mutate; setters return void.
 */

import { createSignal } from 'solid-js';
import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const FOLLOWED_STORAGE_KEY = 'onyx:followed';
export const MAX_FOLLOWED_KEYS = 256;
export const MAX_FOLLOWED_KEY_LENGTH = 160;

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function normalizePart(value: string): string {
  return value.trim().toLowerCase();
}

function sortedKeys(keys: ReadonlySet<string>): string[] {
  return Array.from(keys).sort();
}

function sanitizeFollowedKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = followKey(value);
  return key.length > 0 && key.length <= MAX_FOLLOWED_KEY_LENGTH ? key : null;
}

function boundedFollowedKeys(values: Iterable<unknown>): Set<string> {
  const keys = new Set<string>();
  for (const value of values) {
    const key = sanitizeFollowedKey(value);
    if (key) keys.add(key);
    if (keys.size >= MAX_FOLLOWED_KEYS) break;
  }
  return keys;
}

/** Build the normalized followed-conversation key for a channel, DM, or topic. */
export function followKey(target: string, topic?: string | null): string {
  const normalizedTarget = normalizePart(target);
  const normalizedTopic = typeof topic === 'string' ? normalizePart(topic) : '';

  return normalizedTopic.length > 0 ? `${normalizedTarget}/${normalizedTopic}` : normalizedTarget;
}

/** Read the persisted followed set, ignoring malformed payloads. */
function followedStorageKey(owner?: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(FOLLOWED_STORAGE_KEY, owner);
}

export function loadFollowed(owner?: DeviceMemoryOwner): Set<string> {
  if (!hasStorage()) return new Set<string>();
  const storageKey = followedStorageKey(owner);
  if (!storageKey) return new Set<string>();

  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(parsed) ? boundedFollowedKeys(parsed) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function persist(next: ReadonlySet<string>, owner?: DeviceMemoryOwner): void {
  if (!hasStorage()) return;
  const storageKey = followedStorageKey(owner);
  if (!storageKey) return;

  try {
    localStorage.setItem(storageKey, JSON.stringify(sortedKeys(next)));
  } catch {
    /* storage unavailable / quota - non-fatal */
  }
}

const [followedRevision, setFollowedRevision] = createSignal(0);

/** Reactive accessor for one account's followed conversation keys. */
export function followed(owner?: DeviceMemoryOwner): ReadonlySet<string> {
  followedRevision();
  return loadFollowed(owner);
}

function setFollowed(
  next: ReadonlySet<string>,
  owner?: DeviceMemoryOwner,
): ReadonlySet<string> {
  // This is the single state boundary. Every loader, mutation, and portable
  // merge is normalized and capped here so no call path can grow the signal or
  // persisted payload beyond the advertised limits.
  const bounded = boundedFollowedKeys(next);
  persist(bounded, owner);
  setFollowedRevision((revision) => revision + 1);
  return bounded;
}

export function parseFollowedKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return sortedKeys(boundedFollowedKeys(value));
}

export function exportFollowedKeys(owner?: DeviceMemoryOwner): string[] {
  return sortedKeys(followed(owner));
}

export function mergeFollowedKeys(
  keys: readonly string[],
  owner?: DeviceMemoryOwner,
): { imported: number; total: number } {
  const parsed = parseFollowedKeys(keys);
  const next = new Set(followed(owner));
  for (const key of parsed) next.add(key);
  const bounded = setFollowed(next, owner);
  return {
    imported: parsed.filter((key) => bounded.has(key)).length,
    total: bounded.size,
  };
}

export interface ClearFollowedResult {
  success: boolean;
  cleared: number;
  remaining: number;
}

/**
 * Forget followed room/topic metadata only after the physical key and
 * sanitized storage readback are both empty. The same-tab signal changes only
 * after storage verification, so a failed clear cannot disappear from the UI.
 */
export function clearFollowed(owner?: DeviceMemoryOwner): ClearFollowedResult {
  const before = followed(owner).size;
  if (!hasStorage()) return { success: false, cleared: 0, remaining: before };
  const storageKey = followedStorageKey(owner);
  if (!storageKey) return { success: false, cleared: 0, remaining: before };

  try {
    localStorage.removeItem(storageKey);
    const storageCleared = localStorage.getItem(storageKey) === null
      && loadFollowed(owner).size === 0;
    if (!storageCleared) {
      return { success: false, cleared: 0, remaining: followed(owner).size };
    }
    setFollowedRevision((revision) => revision + 1);
    const success = followed(owner).size === 0;
    return {
      success,
      cleared: success ? before : 0,
      remaining: followed(owner).size,
    };
  } catch {
    return { success: false, cleared: 0, remaining: followed(owner).size };
  }
}

/** Return whether the normalized conversation key is currently followed. */
export function isFollowed(
  target: string,
  topic?: string | null,
  owner?: DeviceMemoryOwner,
): boolean {
  return followed(owner).has(followKey(target, topic));
}

/** Follow the normalized conversation key and persist the updated set. */
export function follow(target: string, topic?: string | null, owner?: DeviceMemoryOwner): void {
  const next = new Set(followed(owner));
  next.add(followKey(target, topic));
  setFollowed(next, owner);
}

/** Unfollow the normalized conversation key and persist the updated set. */
export function unfollow(target: string, topic?: string | null, owner?: DeviceMemoryOwner): void {
  const next = new Set(followed(owner));
  next.delete(followKey(target, topic));
  setFollowed(next, owner);
}

/** Flip the normalized conversation key and return the new followed state. */
export function toggleFollow(
  target: string,
  topic?: string | null,
  owner?: DeviceMemoryOwner,
): boolean {
  const key = followKey(target, topic);
  const next = new Set(followed(owner));
  const shouldFollow = !next.has(key);

  if (shouldFollow) {
    next.add(key);
  } else {
    next.delete(key);
  }

  const bounded = setFollowed(next, owner);
  return shouldFollow ? bounded.has(key) : false;
}
