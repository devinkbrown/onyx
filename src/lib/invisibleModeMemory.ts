// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const INVISIBLE_MODE_STORAGE_KEY = 'onyx:invisibleMode';

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function ownerStorageKey(owner?: DeviceMemoryOwner): string | null {
  return owner ? deviceMemoryStorageKey(INVISIBLE_MODE_STORAGE_KEY, owner) : null;
}

/** Ownerless user-mode state is ambiguous after upgrade and is never claimed. */
export function purgeLegacyInvisibleMode(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(INVISIBLE_MODE_STORAGE_KEY);
    return store.getItem(INVISIBLE_MODE_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

/** Load exactly one endpoint+account/guest namespace; ownerless reads fail closed. */
export function loadInvisibleMode(owner?: DeviceMemoryOwner): boolean {
  const store = storage();
  purgeLegacyInvisibleMode();
  const key = ownerStorageKey(owner);
  if (!store || !owner || !key) return false;
  try {
    return store.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Persist and verify one owner preference; callers retain live state on failure. */
export function saveInvisibleMode(
  enabled: boolean,
  owner?: DeviceMemoryOwner,
): boolean | null {
  const store = storage();
  purgeLegacyInvisibleMode();
  const key = ownerStorageKey(owner);
  if (!store || !owner || !key) return null;
  try {
    if (enabled) store.setItem(key, '1');
    else store.removeItem(key);
    const expected = enabled ? '1' : null;
    if (store.getItem(key) !== expected) return null;
    return loadInvisibleMode(owner) === enabled ? enabled : null;
  } catch {
    return null;
  }
}
