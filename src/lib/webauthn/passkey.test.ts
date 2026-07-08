import { describe, expect, test } from 'vitest';
import {
  b64urlToBytes,
  bytesToB64url,
  buildCreateOptions,
  buildGetOptions,
  encodeAssertion,
  encodeRegistration,
} from './passkey';

describe('base64url codec', () => {
  test('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63]);
    expect(Array.from(b64urlToBytes(bytesToB64url(bytes)))).toEqual(Array.from(bytes));
  });

  test('emits url-safe, unpadded output (no +, /, =)', () => {
    const b64 = bytesToB64url(new Uint8Array([0xfb, 0xff, 0xbf, 0x00]));
    expect(b64).not.toMatch(/[+/=]/);
    expect(Array.from(b64urlToBytes(b64))).toEqual([0xfb, 0xff, 0xbf, 0x00]);
  });

  test('decodes unpadded input of every length class', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const bytes = new Uint8Array(Array.from({ length: n }, (_, i) => i * 40));
      expect(Array.from(b64urlToBytes(bytesToB64url(bytes)))).toEqual(Array.from(bytes));
    }
  });
});

describe('buildCreateOptions', () => {
  test('decodes the challenge and sets ES256/EdDSA params + rp/user', () => {
    const challenge = bytesToB64url(new Uint8Array([9, 8, 7, 6]));
    const opts = buildCreateOptions(challenge, 'chat.example', 'alice');
    expect(Array.from(new Uint8Array(opts.challenge as ArrayBuffer))).toEqual([9, 8, 7, 6]);
    expect(opts.rp).toEqual({ id: 'chat.example', name: 'chat.example' });
    expect(opts.user.name).toBe('alice');
    expect(new TextDecoder().decode(opts.user.id as ArrayBuffer)).toBe('alice');
    expect(opts.pubKeyCredParams.map((p) => p.alg).sort((a, b) => a - b)).toEqual([-8, -7]);
  });
});

describe('buildGetOptions', () => {
  test('maps allow-cred ids into public-key descriptors', () => {
    const challenge = bytesToB64url(new Uint8Array([1, 2, 3]));
    const idA = bytesToB64url(new Uint8Array([0xaa, 0xbb]));
    const idB = bytesToB64url(new Uint8Array([0xcc]));
    const opts = buildGetOptions(challenge, 'chat.example', [idA, idB]);
    expect(opts.rpId).toBe('chat.example');
    expect(opts.allowCredentials).toHaveLength(2);
    expect(Array.from(new Uint8Array(opts.allowCredentials![0]!.id as ArrayBuffer))).toEqual([
      0xaa, 0xbb,
    ]);
  });

  test('empty allow-list yields an empty descriptor array', () => {
    const opts = buildGetOptions(bytesToB64url(new Uint8Array([1])), 'x', []);
    expect(opts.allowCredentials).toEqual([]);
  });
});

describe('response encoders', () => {
  const rawId = new Uint8Array([0x11, 0x22, 0x33]).buffer;
  const clientDataJSON = new Uint8Array([0x7b, 0x7d]).buffer; // "{}"
  const authData = new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer;
  const signature = new Uint8Array([0x01, 0x02]).buffer;

  test('encodeRegistration pulls credId, clientDataJSON, authData as b64url', () => {
    const cred = {
      rawId,
      response: { clientDataJSON, getAuthenticatorData: () => authData },
    } as unknown as PublicKeyCredential;
    const out = encodeRegistration(cred);
    expect(out).toEqual({
      credId: bytesToB64url(new Uint8Array(rawId)),
      clientDataJSON: bytesToB64url(new Uint8Array(clientDataJSON)),
      authData: bytesToB64url(new Uint8Array(authData)),
    });
  });

  test('encodeAssertion adds the signature field', () => {
    const cred = {
      rawId,
      response: { clientDataJSON, authenticatorData: authData, signature },
    } as unknown as PublicKeyCredential;
    const out = encodeAssertion(cred);
    expect(out.signature).toBe(bytesToB64url(new Uint8Array(signature)));
    expect(out.authData).toBe(bytesToB64url(new Uint8Array(authData)));
    expect(out.credId).toBe(bytesToB64url(new Uint8Array(rawId)));
  });
});
