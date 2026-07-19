// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  deviceMemoryStorageKey,
  type DeviceMemoryOwner,
} from '@/lib/deviceMemoryOwner';

/** Owner-scoped pointer only; message bodies remain exclusively in IndexedDB. */
export const VAULT_RESUME_STORAGE_KEY = 'onyx:vault-resume-target';
const MAX_RESUME_TARGET_LENGTH = 512;
const MAX_RESUME_STORAGE_CHARS = 2_048;
const INVALID_TARGET_CHARACTERS = /[\u0000-\u0020\u007f,]/u;
const CHANNEL_SIGILS = '#&+!';

export interface VaultResumeTarget {
  kind: 'channel' | 'dm';
  target: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate persisted navigation before it can materialize a store buffer. */
export function normalizeVaultResumeTarget(value: unknown): VaultResumeTarget | null {
  if (!isRecord(value)) return null;
  const { kind, target } = value;
  if (
    (kind !== 'channel' && kind !== 'dm')
    || typeof target !== 'string'
    || target.length === 0
    || target.length > MAX_RESUME_TARGET_LENGTH
    || target !== target.trim()
    || INVALID_TARGET_CHARACTERS.test(target)
  ) return null;

  const startsWithChannelSigil = CHANNEL_SIGILS.includes(target[0] ?? '');
  if ((kind === 'channel' && (!startsWithChannelSigil || target.length < 2))
    || (kind === 'dm' && startsWithChannelSigil)) return null;

  return { kind, target: target.toLowerCase() };
}

function storageKey(owner: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(VAULT_RESUME_STORAGE_KEY, owner);
}

export function loadVaultResumeTarget(owner: DeviceMemoryOwner): VaultResumeTarget | null {
  const key = storageKey(owner);
  if (!key || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > MAX_RESUME_STORAGE_CHARS) return null;
    return normalizeVaultResumeTarget(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function saveVaultResumeTarget(
  value: VaultResumeTarget,
  owner: DeviceMemoryOwner,
): boolean {
  const key = storageKey(owner);
  const target = normalizeVaultResumeTarget(value);
  if (!key || !target || typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(key, JSON.stringify(target));
    return JSON.stringify(loadVaultResumeTarget(owner)) === JSON.stringify(target);
  } catch {
    return false;
  }
}
