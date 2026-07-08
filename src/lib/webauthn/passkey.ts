// ─────────────────────────────────────────────────────────────────────────────
// Passkey (WebAuthn) ceremony helpers — the browser half of the passwordless
// login flow, paired with the daemon's `WEBAUTHN` command.
//
// Wire contract (server → client `NOTE WEBAUTHN …`, client → server `WEBAUTHN …`):
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

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator !== 'undefined' &&
    !!navigator.credentials
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
export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
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

// ── ceremony option builders ─────────────────────────────────────────────────

export function buildCreateOptions(
  challengeB64url: string,
  rpId: string,
  account: string,
): PublicKeyCredentialCreationOptions {
  return {
    challenge: b64urlToBytes(challengeB64url),
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
  return {
    challenge: b64urlToBytes(challengeB64url),
    rpId,
    allowCredentials: allowCredIdsB64url.map((id) => ({
      type: 'public-key' as const,
      id: b64urlToBytes(id),
    })),
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
