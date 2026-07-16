// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const CTCP_CONFIG_STORAGE_KEY = 'onyx:ctcp-config';
export const DEFAULT_CTCP_VERSION_REPLY = 'Onyx IRC Client';
const MAX_CTCP_VERSION_REPLY_LENGTH = 256;
const MAX_CTCP_CONFIG_STORAGE_CHARS = 64 * 1024;

export interface CtcpConfig {
  versionReply: string;
  timeEnabled: boolean;
}

export const DEFAULT_CTCP_CONFIG: Readonly<CtcpConfig> = {
  versionReply: DEFAULT_CTCP_VERSION_REPLY,
  timeEnabled: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function ownerStorageKey(owner?: DeviceMemoryOwner): string | null {
  return owner ? deviceMemoryStorageKey(CTCP_CONFIG_STORAGE_KEY, owner) : null;
}

/** Keep a CTCP reply inside one IRC line and exclude CTCP delimiters. */
export function normalizeCtcpVersionReply(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_CTCP_VERSION_REPLY;
  return value.replace(/[\0\r\n\x01]/g, '').slice(0, MAX_CTCP_VERSION_REPLY_LENGTH);
}

/** Sanitize one untrusted CTCP preference record without widening response behavior. */
export function normalizeCtcpConfig(value: unknown): CtcpConfig {
  if (!isRecord(value)) return { ...DEFAULT_CTCP_CONFIG };
  return {
    versionReply: normalizeCtcpVersionReply(value.versionReply),
    timeEnabled: typeof value.timeEnabled === 'boolean' ? value.timeEnabled : true,
  };
}

/** Ownerless network-facing reply text is ambiguous after upgrade and is never claimed. */
export function purgeLegacyCtcpConfig(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(CTCP_CONFIG_STORAGE_KEY);
    return store.getItem(CTCP_CONFIG_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

/** Load exactly one endpoint+account/guest namespace; ownerless reads use safe defaults. */
export function loadCtcpConfig(owner?: DeviceMemoryOwner): CtcpConfig {
  const store = storage();
  purgeLegacyCtcpConfig();
  const key = ownerStorageKey(owner);
  if (!store || !owner || !key) return { ...DEFAULT_CTCP_CONFIG };
  try {
    const raw = store.getItem(key);
    if (!raw || raw.length > MAX_CTCP_CONFIG_STORAGE_CHARS) return { ...DEFAULT_CTCP_CONFIG };
    return normalizeCtcpConfig(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_CTCP_CONFIG };
  }
}

/** Persist and verify one bounded owner config; callers retain live state on failure. */
export function saveCtcpConfig(
  value: unknown,
  owner?: DeviceMemoryOwner,
): CtcpConfig | null {
  const store = storage();
  purgeLegacyCtcpConfig();
  const key = ownerStorageKey(owner);
  if (!store || !owner || !key) return null;
  const config = normalizeCtcpConfig(value);
  const serialized = JSON.stringify(config);
  try {
    if (serialized === JSON.stringify(DEFAULT_CTCP_CONFIG)) store.removeItem(key);
    else store.setItem(key, serialized);
    const verified = loadCtcpConfig(owner);
    return JSON.stringify(verified) === serialized ? verified : null;
  } catch {
    return null;
  }
}
