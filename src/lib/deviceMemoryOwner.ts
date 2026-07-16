// SPDX-License-Identifier: AGPL-3.0-or-later

/** Account identity that owns plaintext or history retained on this device. */
export interface DeviceMemoryOwner {
  /** Exact WebSocket endpoint that owned the session. */
  serverUrl: string;
  /** Account name, or guest nick when no account was authenticated. */
  identity: string;
}

const MAX_DEVICE_MEMORY_SERVER_LENGTH = 2_048;
const MAX_DEVICE_MEMORY_IDENTITY_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate and canonicalize one owner at every persistence boundary. */
export function normalizeDeviceMemoryOwner(value: unknown): DeviceMemoryOwner | null {
  if (!isRecord(value)) return null;
  const { serverUrl, identity } = value;
  if (
    typeof serverUrl !== 'string'
    || serverUrl.length === 0
    || serverUrl.length > MAX_DEVICE_MEMORY_SERVER_LENGTH
    || serverUrl !== serverUrl.trim()
    || typeof identity !== 'string'
    || identity.length === 0
    || identity.length > MAX_DEVICE_MEMORY_IDENTITY_LENGTH
    || identity !== identity.trim()
  ) return null;
  return { serverUrl, identity: identity.toLowerCase() };
}

/** Stable normalized owner key shared by IndexedDB and localStorage journals. */
export function deviceMemoryOwnerKey(owner: DeviceMemoryOwner): string | null {
  const safe = normalizeDeviceMemoryOwner(owner);
  return safe ? JSON.stringify([safe.serverUrl, safe.identity]) : null;
}

/**
 * Resolve a localStorage key for one owner. Omitting the owner intentionally
 * addresses only the old ownerless key; signed sessions always pass an owner,
 * so legacy plaintext remains quarantined instead of being claimed by the
 * first account opened after upgrade.
 */
export function deviceMemoryStorageKey(
  baseKey: string,
  owner?: DeviceMemoryOwner,
): string | null {
  if (!baseKey) return null;
  if (owner === undefined) return baseKey;
  const ownerKey = deviceMemoryOwnerKey(owner);
  return ownerKey ? `${baseKey}:owner:${encodeURIComponent(ownerKey)}` : null;
}
