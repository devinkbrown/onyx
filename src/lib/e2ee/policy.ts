// SPDX-License-Identifier: AGPL-3.0-or-later
export const E2EE_CAP = 'orochi/e2ee';
export const E2EE_TAG = '+orochi/e2ee';
export const ENCRYPTION_POLICY_PROP = 'encryption-policy';
export const E2EE_DEVICE_PROP_PREFIX = 'e2ee.device.';

export type EncryptionPolicy = 'off' | 'optional' | 'required';
export type E2eeMessageKind = 'generic' | 'mls' | 'sframe';

const POLICY_VALUES: readonly EncryptionPolicy[] = ['off', 'optional', 'required'];
const DEVICE_ID_RE = /^[A-Za-z0-9_.-]{1,32}$/;
const ALGORITHM_RE = /^[A-Za-z0-9_-]{1,32}$/;
const PUBLIC_KEY_RE = /^[A-Za-z0-9_\-+/=.: ]{1,180}$/;

export function parseEncryptionPolicy(raw: string | null | undefined): EncryptionPolicy {
  const clean = (raw ?? '').trim().toLowerCase();
  return POLICY_VALUES.includes(clean as EncryptionPolicy) ? clean as EncryptionPolicy : 'off';
}

export function e2eeMessageTag(kind: E2eeMessageKind = 'mls'): Record<string, string> {
  return { [E2EE_TAG]: kind === 'generic' ? '1' : kind };
}

export function parseE2eeMessageTag(tags: Record<string, string>): E2eeMessageKind | null {
  const raw = tags[E2EE_TAG] ?? tags[E2EE_TAG.slice(1)];
  if (raw == null) return null;
  const clean = raw.trim().toLowerCase();
  if (!clean || clean === '1') return 'generic';
  if (clean === 'mls' || clean === 'sframe') return clean;
  return null;
}

export function e2eeDevicePropKey(deviceId: string): string | null {
  const clean = deviceId.trim();
  return DEVICE_ID_RE.test(clean) ? `${E2EE_DEVICE_PROP_PREFIX}${clean}` : null;
}

export function e2eeDeviceValue(algorithm: string, publicKey: string): string | null {
  const alg = algorithm.trim();
  const key = publicKey.trim();
  if (!ALGORITHM_RE.test(alg) || !PUBLIC_KEY_RE.test(key)) return null;
  return `${alg}:${key}`;
}

export function parseE2eeDeviceValue(raw: string | null | undefined): { algorithm: string; publicKey: string } | null {
  const value = (raw ?? '').trim();
  const colon = value.indexOf(':');
  if (colon <= 0 || colon === value.length - 1) return null;
  const algorithm = value.slice(0, colon);
  const publicKey = value.slice(colon + 1);
  if (!ALGORITHM_RE.test(algorithm) || !PUBLIC_KEY_RE.test(publicKey)) return null;
  return { algorithm, publicKey };
}
