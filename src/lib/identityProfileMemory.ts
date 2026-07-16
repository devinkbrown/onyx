// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const IDENTITY_PROFILE_STORAGE_KEY = 'onyx:identity-profile';
export const MAX_CUSTOM_STATUS_LENGTH = 256;
export const MAX_SELF_DISPLAY_NAME_LENGTH = 128;
export const MAX_SELF_BIO_LENGTH = 2_048;
export const MAX_SELF_PRONOUNS_LENGTH = 64;
export const MAX_SELF_BANNER_URL_LENGTH = 2_048;
/** The fixed owner-profile schema serializes below 5 KiB at its field limits. */
export const MAX_IDENTITY_PROFILE_STORAGE_CHARS = 16 * 1024;

export const LEGACY_IDENTITY_PROFILE_STORAGE_KEYS = [
  'onyx:custom-status',
  'onyx:custom-status-expiry',
  'onyx:self-display-name',
  'onyx:selfBio',
  'onyx:selfPronouns',
  'onyx:selfBannerUrl',
  'ocean-custom-status',
  'ocean-custom-status-expiry',
  'ocean-self-display-name',
  'ocean-selfBio',
  'ocean-selfPronouns',
  'ocean-selfBannerUrl',
] as const;

const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/u;

export interface IdentityProfileMemory {
  customStatus: string;
  customStatusExpiry: Date | null;
  selfDisplayName: string;
  selfBio: string;
  selfPronouns: string;
  selfBannerUrl: string;
}

export function emptyIdentityProfileMemory(): IdentityProfileMemory {
  return {
    customStatus: '',
    customStatusExpiry: null,
    selfDisplayName: '',
    selfBio: '',
    selfPronouns: '',
    selfBannerUrl: '',
  };
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length > maxLength || CONTROL_CHARACTERS.test(text)) return null;
  return text;
}

export const normalizeCustomStatus = (value: unknown): string | null =>
  normalizeText(value, MAX_CUSTOM_STATUS_LENGTH);

export const normalizeSelfDisplayName = (value: unknown): string | null =>
  normalizeText(value, MAX_SELF_DISPLAY_NAME_LENGTH);

export const normalizeSelfBio = (value: unknown): string | null =>
  normalizeText(value, MAX_SELF_BIO_LENGTH);

export const normalizeSelfPronouns = (value: unknown): string | null =>
  normalizeText(value, MAX_SELF_PRONOUNS_LENGTH);

export function normalizeSelfBannerUrl(value: unknown): string | null {
  const text = normalizeText(value, MAX_SELF_BANNER_URL_LENGTH);
  if (text === null || text === '') return text;
  try {
    const url = new URL(text);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || !url.hostname
      || url.username
      || url.password
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeCustomStatusExpiry(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const expiry = value instanceof Date ? new Date(value) : new Date(typeof value === 'string' ? value : Number.NaN);
  return Number.isFinite(expiry.getTime()) ? expiry : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Canonicalize untrusted device-local identity drafts at the storage edge. */
export function parseIdentityProfileMemory(value: unknown): IdentityProfileMemory {
  if (!isRecord(value)) return emptyIdentityProfileMemory();
  return {
    customStatus: normalizeCustomStatus(value.customStatus) ?? '',
    customStatusExpiry: normalizeCustomStatusExpiry(value.customStatusExpiry),
    selfDisplayName: normalizeSelfDisplayName(value.selfDisplayName) ?? '',
    selfBio: normalizeSelfBio(value.selfBio) ?? '',
    selfPronouns: normalizeSelfPronouns(value.selfPronouns) ?? '',
    selfBannerUrl: normalizeSelfBannerUrl(value.selfBannerUrl) ?? '',
  };
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

/** Ownerless identity drafts cannot safely be attributed after an upgrade. */
export function purgeLegacyIdentityProfileMemory(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(IDENTITY_PROFILE_STORAGE_KEY);
    for (const key of LEGACY_IDENTITY_PROFILE_STORAGE_KEYS) store.removeItem(key);
    return store.getItem(IDENTITY_PROFILE_STORAGE_KEY) === null
      && LEGACY_IDENTITY_PROFILE_STORAGE_KEYS.every((key) => store.getItem(key) === null);
  } catch {
    return false;
  }
}

function ownerStorageKey(owner: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(IDENTITY_PROFILE_STORAGE_KEY, owner);
}

function serializable(value: IdentityProfileMemory): Record<string, string> {
  return {
    ...(value.customStatus ? { customStatus: value.customStatus } : {}),
    ...(value.customStatusExpiry ? { customStatusExpiry: value.customStatusExpiry.toISOString() } : {}),
    ...(value.selfDisplayName ? { selfDisplayName: value.selfDisplayName } : {}),
    ...(value.selfBio ? { selfBio: value.selfBio } : {}),
    ...(value.selfPronouns ? { selfPronouns: value.selfPronouns } : {}),
    ...(value.selfBannerUrl ? { selfBannerUrl: value.selfBannerUrl } : {}),
  };
}

export function loadIdentityProfileMemory(owner: DeviceMemoryOwner): IdentityProfileMemory {
  const store = storage();
  const key = ownerStorageKey(owner);
  if (!store || !key) return emptyIdentityProfileMemory();
  purgeLegacyIdentityProfileMemory();
  try {
    const raw = store.getItem(key);
    if (raw && raw.length > MAX_IDENTITY_PROFILE_STORAGE_CHARS) {
      return emptyIdentityProfileMemory();
    }
    return raw ? parseIdentityProfileMemory(JSON.parse(raw) as unknown) : emptyIdentityProfileMemory();
  } catch {
    return emptyIdentityProfileMemory();
  }
}

export function saveIdentityProfileMemory(
  value: IdentityProfileMemory,
  owner: DeviceMemoryOwner,
): boolean {
  const store = storage();
  const key = ownerStorageKey(owner);
  if (!store || !key) return false;
  const profile = parseIdentityProfileMemory({
    ...value,
    customStatusExpiry: value.customStatusExpiry?.toISOString() ?? null,
  });
  const serialized = JSON.stringify(serializable(profile));
  try {
    purgeLegacyIdentityProfileMemory();
    if (serialized === '{}') store.removeItem(key);
    else store.setItem(key, serialized);
    return JSON.stringify(serializable(loadIdentityProfileMemory(owner))) === serialized;
  } catch {
    return false;
  }
}
