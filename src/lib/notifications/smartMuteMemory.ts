// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * smartMuteMemory.ts — owner-scoped persistence for smart mute keyword rules.
 */
import {
  deviceMemoryStorageKey,
  type DeviceMemoryOwner,
} from '@/lib/deviceMemoryOwner';
import {
  parseSmartMute,
  type SmartMuteRules,
  EMPTY_SMART_MUTE,
} from './smartMute';

export const SMART_MUTE_STORAGE_KEY = 'onyx:smart-mute';
export const MAX_SMART_MUTE_STORAGE_CHARS = 16 * 1024;

function storageKey(owner?: DeviceMemoryOwner): string | null {
  return owner ? deviceMemoryStorageKey(SMART_MUTE_STORAGE_KEY, owner) : null;
}

export function loadSmartMute(owner?: DeviceMemoryOwner): SmartMuteRules {
  if (typeof localStorage === 'undefined') return { ...EMPTY_SMART_MUTE };
  const key = storageKey(owner);
  if (!key) return { ...EMPTY_SMART_MUTE };
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > MAX_SMART_MUTE_STORAGE_CHARS) return { ...EMPTY_SMART_MUTE };
    return parseSmartMute(JSON.parse(raw));
  } catch {
    return { ...EMPTY_SMART_MUTE };
  }
}

export function saveSmartMute(rules: SmartMuteRules, owner?: DeviceMemoryOwner): boolean {
  if (typeof localStorage === 'undefined') return false;
  const key = storageKey(owner);
  if (!key) return false;
  try {
    const payload = JSON.stringify(parseSmartMute(rules));
    if (payload.length > MAX_SMART_MUTE_STORAGE_CHARS) return false;
    localStorage.setItem(key, payload);
    return true;
  } catch {
    return false;
  }
}
