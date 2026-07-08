/**
 * followed.ts - localStorage-backed followed conversation keys for notification calm mode.
 *
 * SOLID IDIOMS: module-level createSignal; never mutate; setters return void.
 */

import { createSignal, type Accessor } from 'solid-js';

const STORAGE_KEY = 'onyx:followed';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function normalizePart(value: string): string {
  return value.trim().toLowerCase();
}

function sortedKeys(keys: ReadonlySet<string>): string[] {
  return Array.from(keys).sort();
}

/** Build the normalized followed-conversation key for a channel, DM, or topic. */
export function followKey(target: string, topic?: string | null): string {
  const normalizedTarget = normalizePart(target);
  const normalizedTopic = typeof topic === 'string' ? normalizePart(topic) : '';

  return normalizedTopic.length > 0 ? `${normalizedTarget}/${normalizedTopic}` : normalizedTarget;
}

/** Read the persisted followed set, ignoring malformed payloads. */
export function loadFollowed(): Set<string> {
  if (!hasStorage()) return new Set<string>();

  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed) || !parsed.every((key): key is string => typeof key === 'string')) {
      return new Set<string>();
    }

    return new Set(parsed.map((key) => followKey(key)));
  } catch {
    return new Set<string>();
  }
}

function persist(next: ReadonlySet<string>): void {
  if (!hasStorage()) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sortedKeys(next)));
  } catch {
    /* storage unavailable / quota - non-fatal */
  }
}

const [followedAccessor, setFollowedSignal] = createSignal<ReadonlySet<string>>(loadFollowed());

/** Accessor for followed conversation keys. */
export const followed: Accessor<ReadonlySet<string>> = followedAccessor;

function setFollowed(next: Set<string>): void {
  setFollowedSignal(next);
  persist(next);
}

/** Return whether the normalized conversation key is currently followed. */
export function isFollowed(target: string, topic?: string | null): boolean {
  return followed().has(followKey(target, topic));
}

/** Follow the normalized conversation key and persist the updated set. */
export function follow(target: string, topic?: string | null): void {
  const next = new Set(followed());
  next.add(followKey(target, topic));
  setFollowed(next);
}

/** Unfollow the normalized conversation key and persist the updated set. */
export function unfollow(target: string, topic?: string | null): void {
  const next = new Set(followed());
  next.delete(followKey(target, topic));
  setFollowed(next);
}

/** Flip the normalized conversation key and return the new followed state. */
export function toggleFollow(target: string, topic?: string | null): boolean {
  const key = followKey(target, topic);
  const next = new Set(followed());
  const shouldFollow = !next.has(key);

  if (shouldFollow) {
    next.add(key);
  } else {
    next.delete(key);
  }

  setFollowed(next);
  return shouldFollow;
}
