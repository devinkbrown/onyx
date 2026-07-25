// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * encryptionPolicyBadge.ts — show room encryption policy on invite cards (g12).
 */

export type EncryptionPolicy = 'optional' | 'required' | 'forbidden' | 'unknown';

export type EncryptionPolicyBadge = {
  policy: EncryptionPolicy;
  label: string;
  tone: 'private' | 'open' | 'warn' | 'neutral';
  /** Short chip text for invite cards / share sheets. */
  chip: string;
};

const POLICY_RE = /^(optional|required|forbidden)$/i;

export function parseEncryptionPolicy(raw: string | null | undefined): EncryptionPolicy {
  if (!raw) return 'unknown';
  const trimmed = raw.trim().toLowerCase();
  if (!POLICY_RE.test(trimmed)) return 'unknown';
  return trimmed as EncryptionPolicy;
}

export function encryptionPolicyBadge(policy: EncryptionPolicy): EncryptionPolicyBadge {
  switch (policy) {
    case 'required':
      return {
        policy,
        label: 'End-to-end encryption required in this room',
        tone: 'private',
        chip: 'E2EE required',
      };
    case 'forbidden':
      return {
        policy,
        label: 'Encryption is disabled in this room',
        tone: 'warn',
        chip: 'E2EE off',
      };
    case 'optional':
      return {
        policy,
        label: 'Encryption available — not required',
        tone: 'open',
        chip: 'E2EE optional',
      };
    case 'unknown':
    default:
      return {
        policy: 'unknown',
        label: 'Encryption policy not advertised',
        tone: 'neutral',
        chip: 'E2EE ?',
      };
  }
}

/** Append policy query param to a share URL when known. */
export function withEncryptionPolicyParam(shareUrl: string, policy: EncryptionPolicy): string {
  if (policy === 'unknown') return shareUrl;
  try {
    const url = new URL(shareUrl, 'https://onyx.invalid');
    url.searchParams.set('e2ee', policy);
    // Preserve relative inputs.
    if (!/^[a-z][a-z\d+.-]*:/iu.test(shareUrl)) {
      return `${url.pathname}${url.search}${url.hash}`.replace(/^\//, shareUrl.startsWith('/') ? '/' : '')
        || `?${url.searchParams.toString()}`;
    }
    return url.toString();
  } catch {
    return shareUrl;
  }
}
