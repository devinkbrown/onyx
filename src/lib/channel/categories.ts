// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * categories.ts — local channel category / folder hierarchy (Era 3 C5 client).
 *
 * Pure prefs for sidebar grouping until a server PROP schema ships. Categories
 * are owner-scoped device memory: never leak across accounts on one browser.
 */

import {
  deviceMemoryStorageKey,
  type DeviceMemoryOwner,
} from '@/lib/deviceMemoryOwner';

export const CHANNEL_CATEGORIES_KEY = 'onyx:channel-categories';
export const MAX_CATEGORIES = 32;
export const MAX_CATEGORY_NAME_LEN = 48;
export const MAX_CHANNELS_PER_CATEGORY = 128;
export const MAX_CATEGORIES_STORAGE_CHARS = 64 * 1024;

export type ChannelCategory = {
  id: string;
  name: string;
  /** Lower-cased channel names belonging to this folder. */
  channels: string[];
  collapsed: boolean;
  order: number;
};

export type CategoryState = {
  categories: ChannelCategory[];
};

const CONTROL = /[\u0000-\u001f\u007f]/u;

function storageKey(owner?: DeviceMemoryOwner): string | null {
  return owner ? deviceMemoryStorageKey(CHANNEL_CATEGORIES_KEY, owner) : null;
}

function sanitizeName(name: string): string | null {
  // Reject control characters on the raw input before whitespace collapse so a
  // crafted "bad\nname" cannot become a plausible folder label.
  if (CONTROL.test(name)) return null;
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > MAX_CATEGORY_NAME_LEN) {
    return null;
  }
  return trimmed;
}

function sanitizeChannel(channel: string): string | null {
  const trimmed = channel.trim();
  if (!trimmed || trimmed.length > 64 || CONTROL.test(trimmed)) return null;
  if (!/^[#&+]/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function emptyCategoryState(): CategoryState {
  return { categories: [] };
}

export function parseCategoryState(value: unknown): CategoryState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return emptyCategoryState();
  }
  const raw = value as { categories?: unknown };
  if (!Array.isArray(raw.categories)) return emptyCategoryState();

  const categories: ChannelCategory[] = [];
  const seenIds = new Set<string>();
  const claimed = new Set<string>();

  for (const entry of raw.categories.slice(0, MAX_CATEGORIES)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id || row.id.length > 64 || seenIds.has(row.id)) {
      continue;
    }
    const name = typeof row.name === 'string' ? sanitizeName(row.name) : null;
    if (!name) continue;
    const channels: string[] = [];
    if (Array.isArray(row.channels)) {
      for (const ch of row.channels.slice(0, MAX_CHANNELS_PER_CATEGORY)) {
        if (typeof ch !== 'string') continue;
        const safe = sanitizeChannel(ch);
        if (!safe || claimed.has(safe)) continue;
        claimed.add(safe);
        channels.push(safe);
      }
    }
    seenIds.add(row.id);
    categories.push({
      id: row.id,
      name,
      channels,
      collapsed: row.collapsed === true,
      order: typeof row.order === 'number' && Number.isFinite(row.order) ? row.order : categories.length,
    });
  }

  categories.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return { categories };
}

export function loadCategories(owner?: DeviceMemoryOwner): CategoryState {
  if (typeof localStorage === 'undefined') return emptyCategoryState();
  const key = storageKey(owner);
  if (!key) return emptyCategoryState();
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > MAX_CATEGORIES_STORAGE_CHARS) return emptyCategoryState();
    return parseCategoryState(JSON.parse(raw));
  } catch {
    return emptyCategoryState();
  }
}

export function saveCategories(state: CategoryState, owner?: DeviceMemoryOwner): boolean {
  if (typeof localStorage === 'undefined') return false;
  const key = storageKey(owner);
  if (!key) return false;
  try {
    const payload = JSON.stringify(parseCategoryState(state));
    if (payload.length > MAX_CATEGORIES_STORAGE_CHARS) return false;
    localStorage.setItem(key, payload);
    return true;
  } catch {
    return false;
  }
}

export function createCategory(
  state: CategoryState,
  name: string,
  id = `cat-${Date.now().toString(36)}`,
): CategoryState | null {
  if (state.categories.length >= MAX_CATEGORIES) return null;
  const safeName = sanitizeName(name);
  if (!safeName) return null;
  if (state.categories.some((c) => c.id === id)) return null;
  const next: ChannelCategory = {
    id,
    name: safeName,
    channels: [],
    collapsed: false,
    order: state.categories.length,
  };
  return { categories: [...state.categories, next] };
}

export function renameCategory(
  state: CategoryState,
  id: string,
  name: string,
): CategoryState | null {
  const safeName = sanitizeName(name);
  if (!safeName) return null;
  let found = false;
  const categories = state.categories.map((cat) => {
    if (cat.id !== id) return cat;
    found = true;
    return { ...cat, name: safeName };
  });
  return found ? { categories } : null;
}

export function deleteCategory(state: CategoryState, id: string): CategoryState {
  return {
    categories: state.categories
      .filter((cat) => cat.id !== id)
      .map((cat, index) => ({ ...cat, order: index })),
  };
}

export function assignChannel(
  state: CategoryState,
  categoryId: string,
  channel: string,
): CategoryState | null {
  const safe = sanitizeChannel(channel);
  if (!safe) return null;
  const stripped = state.categories.map((cat) => ({
    ...cat,
    channels: cat.channels.filter((ch) => ch !== safe),
  }));
  let found = false;
  const categories = stripped.map((cat) => {
    if (cat.id !== categoryId) return cat;
    found = true;
    if (cat.channels.length >= MAX_CHANNELS_PER_CATEGORY) return cat;
    return { ...cat, channels: [...cat.channels, safe] };
  });
  return found ? { categories } : null;
}

export function unassignChannel(state: CategoryState, channel: string): CategoryState {
  const safe = sanitizeChannel(channel);
  if (!safe) return state;
  return {
    categories: state.categories.map((cat) => ({
      ...cat,
      channels: cat.channels.filter((ch) => ch !== safe),
    })),
  };
}

export function toggleCategoryCollapsed(state: CategoryState, id: string): CategoryState {
  return {
    categories: state.categories.map((cat) =>
      cat.id === id ? { ...cat, collapsed: !cat.collapsed } : cat,
    ),
  };
}

/**
 * Partition channel names into ordered category buckets + uncategorized.
 * Unknown channels stay uncategorized; empty categories still appear.
 */
export function groupChannels(
  state: CategoryState,
  channelNames: readonly string[],
): { category: ChannelCategory | null; channels: string[] }[] {
  const remaining = new Map<string, string>();
  for (const name of channelNames) {
    const safe = sanitizeChannel(name);
    if (safe) remaining.set(safe, name);
  }

  const groups: { category: ChannelCategory | null; channels: string[] }[] = [];
  for (const cat of state.categories) {
    const channels: string[] = [];
    for (const key of cat.channels) {
      const original = remaining.get(key);
      if (original) {
        channels.push(original);
        remaining.delete(key);
      }
    }
    groups.push({ category: cat, channels });
  }
  const uncategorized = [...remaining.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
  groups.push({ category: null, channels: uncategorized });
  return groups;
}
