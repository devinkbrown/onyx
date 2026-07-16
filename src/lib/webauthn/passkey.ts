// SPDX-License-Identifier: AGPL-3.0-or-later
// ─────────────────────────────────────────────────────────────────────────────
// Passkey (WebAuthn) ceremony helpers — the browser half of the passwordless
// login flow, paired with the daemon's `WEBAUTHN` command.
//
// Wire contract. Client → server is the `WEBAUTHN <SUBTYPE> …` command; the
// server's replies ride the IRCX EVENT plane (the `NOTE` verb was removed) as
// `:server EVENT <me> WEBAUTHN <SUBTYPE> …` — store.ts consumes them there.
//   register:  REGISTER [label]            → REGISTER-CHALLENGE <chal_b64url> <rp_id> :<account>
//              REGISTER-FINISH <credId_b64url> <clientDataJSON_b64url> <authData_b64url>
//                                          → REGISTERED <credId_b64url> :<label>
//   auth:      AUTH <account>              → AUTH-CHALLENGE <chal_b64url> <rp_id> :<account>
//                                            + ALLOW-CRED <credId_b64url> (0..n)
//              AUTH-FINISH <credId_b64url> <clientDataJSON_b64url> <authData_b64url> <sig_b64url>
//                                          → (IDENTIFY login side effects)
//
// All binary fields on the wire are **base64url, no padding** (IRC-token-safe).
// The pure encoders/decoders + options builders here are unit-tested; the two
// navigator.credentials calls are the only browser-dependent seam.
// ─────────────────────────────────────────────────────────────────────────────

/** ES256 (-7) and EdDSA (-8) — the algorithms the daemon's COSE parser accepts. */
const PUBKEY_CRED_PARAMS: PublicKeyCredentialParameters[] = [
  { type: 'public-key', alg: -7 },
  { type: 'public-key', alg: -8 },
];

const CEREMONY_TIMEOUT_MS = 120_000;

/**
 * WebAuthn recommends a challenge of at least 16 random bytes (WebAuthn L2
 * §13.4.3 "Cryptographic Challenges"). A shorter challenge weakens replay
 * resistance, so we reject it fail-closed before ever prompting the device.
 */
export const MIN_CHALLENGE_BYTES = 16;

/** Base64url alphabet, no padding — the exact wire encoding for WEBAUTHN fields. */
const B64URL_RE = /^[A-Za-z0-9_-]*$/;

export function isPasskeySupported(): boolean {
  const credentials = typeof navigator !== 'undefined' ? navigator.credentials : undefined;
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof credentials?.create === 'function' &&
    typeof credentials.get === 'function'
  );
}

// ── base64url (no padding) ↔ bytes ──────────────────────────────────────────

export function bytesToB64url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Backed by a plain ArrayBuffer (not ArrayBufferLike) so the result satisfies
// the WebAuthn `BufferSource` option fields under strict lib.dom types.
//
// Strict + fail-closed: the wire is base64url with NO padding, so any '+', '/',
// '=' or out-of-alphabet byte is a protocol violation and throws rather than
// silently decoding to the wrong bytes (a length %4===1 is impossible base64).
export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  if (!B64URL_RE.test(s) || s.length % 4 === 1) {
    throw new Error('Invalid base64url input');
  }
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Copy bytes into a fresh ArrayBuffer-backed view (BufferSource-safe). */
function ownedBytes(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(src.length));
  out.set(src);
  return out;
}

// ── fail-closed validation of untrusted server fields ────────────────────────

/** A relying-party id must be a non-empty host label with no whitespace. The
 * browser additionally enforces it is a registrable suffix of the origin. */
function assertRpId(rpId: string): void {
  if (!rpId || /\s/.test(rpId)) throw new Error('Invalid relying-party id');
}

/** Decode a challenge and reject anything below the spec-minimum entropy. */
function decodeChallenge(challengeB64url: string): Uint8Array<ArrayBuffer> {
  const bytes = b64urlToBytes(challengeB64url); // throws on malformed base64url
  if (bytes.length < MIN_CHALLENGE_BYTES) throw new Error('Passkey challenge too short');
  return bytes;
}

// ── ceremony option builders ─────────────────────────────────────────────────

export function buildCreateOptions(
  challengeB64url: string,
  rpId: string,
  account: string,
): PublicKeyCredentialCreationOptions {
  assertRpId(rpId);
  if (!account) throw new Error('Missing account for passkey registration');
  return {
    challenge: decodeChallenge(challengeB64url),
    rp: { id: rpId, name: rpId },
    // The user handle binds the credential to the account. We use the account
    // name bytes — stable and non-secret (the server keys by credential id).
    user: {
      id: ownedBytes(new TextEncoder().encode(account)),
      name: account,
      displayName: account,
    },
    pubKeyCredParams: PUBKEY_CRED_PARAMS,
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    timeout: CEREMONY_TIMEOUT_MS,
    attestation: 'none',
  };
}

export function buildGetOptions(
  challengeB64url: string,
  rpId: string,
  allowCredIdsB64url: readonly string[],
): PublicKeyCredentialRequestOptions {
  assertRpId(rpId);
  return {
    challenge: decodeChallenge(challengeB64url),
    rpId,
    allowCredentials: allowCredIdsB64url.map((id) => {
      const bytes = b64urlToBytes(id); // throws on malformed base64url
      if (bytes.length === 0) throw new Error('Empty credential id in allow-list');
      return { type: 'public-key' as const, id: bytes };
    }),
    userVerification: 'preferred',
    timeout: CEREMONY_TIMEOUT_MS,
  };
}

// ── response encoders (browser credential → wire fields) ─────────────────────

export interface RegistrationFields {
  credId: string;
  clientDataJSON: string;
  authData: string;
}

export function encodeRegistration(cred: PublicKeyCredential): RegistrationFields {
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    credId: bytesToB64url(cred.rawId),
    clientDataJSON: bytesToB64url(r.clientDataJSON),
    authData: bytesToB64url(r.getAuthenticatorData()),
  };
}

export interface AssertionFields {
  credId: string;
  clientDataJSON: string;
  authData: string;
  signature: string;
}

export function encodeAssertion(cred: PublicKeyCredential): AssertionFields {
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    credId: bytesToB64url(cred.rawId),
    clientDataJSON: bytesToB64url(r.clientDataJSON),
    authData: bytesToB64url(r.authenticatorData),
    signature: bytesToB64url(r.signature),
  };
}

// ── ceremony runners (the only browser-dependent seam) ───────────────────────

export async function createPasskey(
  opts: PublicKeyCredentialCreationOptions,
): Promise<RegistrationFields> {
  const cred = (await navigator.credentials.create({ publicKey: opts })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Passkey creation was cancelled');
  return encodeRegistration(cred);
}

export async function getPasskeyAssertion(
  opts: PublicKeyCredentialRequestOptions,
): Promise<AssertionFields> {
  const cred = (await navigator.credentials.get({ publicKey: opts })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Passkey sign-in was cancelled');
  return encodeAssertion(cred);
}
