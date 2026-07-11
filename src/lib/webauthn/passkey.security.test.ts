// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  MIN_CHALLENGE_BYTES,
  b64urlToBytes,
  buildCreateOptions,
  buildGetOptions,
  bytesToB64url,
  encodeAssertion,
  encodeRegistration,
} from './passkey';

function seededBytes(length: number, seed: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length));
  let state = seed >>> 0;
  for (let i = 0; i < out.length; i++) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    out[i] = state & 0xff;
  }
  return out;
}

function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(values.length));
  out.set(values);
  return out;
}

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`${label} unexpectedly missing`);
  return value;
}

function expectSameBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(Array.from(actual)).toEqual(Array.from(expected));
}

function bufferSourceBytes(source: BufferSource): Uint8Array {
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
}

function validChallenge(): string {
  return bytesToB64url(seededBytes(MIN_CHALLENGE_BYTES, 0xdecafbad));
}

describe('passkey base64url security contract', () => {
  it('round-trips deterministic random byte arrays without padding or standard-base64 characters', () => {
    for (const length of [0, 1, 2, 3, 15, 16, 31, 32, 64]) {
      const input = seededBytes(length, 0x1234_5678 + length);
      const first = bytesToB64url(input);
      const second = bytesToB64url(input);

      expect(second).toBe(first);
      expect(first).not.toMatch(/[+/=\s]/);
      expectSameBytes(b64urlToBytes(first), input);
    }
  });

  it('rejects malformed base64url instead of mis-decoding protocol violations', () => {
    const embeddedNul = `AA${String.fromCharCode(0)}A`;

    for (const input of ['AA+A', 'AA/A', 'AA==', 'AA A', 'AA\nA', 'AA.A', embeddedNul, 'A']) {
      expect(() => b64urlToBytes(input)).toThrow('Invalid base64url input');
    }
  });
});

describe('passkey option-builder security contract', () => {
  it('rejects challenges shorter than the WebAuthn minimum through both builders', () => {
    const shortChallenge = bytesToB64url(seededBytes(MIN_CHALLENGE_BYTES - 1, 0x0102_0304));

    expect(() => buildCreateOptions(shortChallenge, 'example.com', 'alice')).toThrow(
      'Passkey challenge too short',
    );
    expect(() => buildGetOptions(shortChallenge, 'example.com', [bytesToB64url(bytes(1))])).toThrow(
      'Passkey challenge too short',
    );
  });

  it('accepts a valid challenge and preserves it exactly in create and get options', () => {
    const challengeBytes = seededBytes(MIN_CHALLENGE_BYTES, 0xfeed_c0de);
    const challenge = bytesToB64url(challengeBytes);
    const allowCred = bytes(1, 2, 3, 4);

    const createOptions = buildCreateOptions(challenge, 'example.com', 'alice');
    const getOptions = buildGetOptions(challenge, 'example.com', [bytesToB64url(allowCred)]);
    const firstAllowCredential = requireValue(getOptions.allowCredentials?.[0], 'allow credential');

    expectSameBytes(bufferSourceBytes(createOptions.challenge), challengeBytes);
    expectSameBytes(bufferSourceBytes(getOptions.challenge), challengeBytes);
    expectSameBytes(bufferSourceBytes(firstAllowCredential.id), allowCred);
  });

  it('fails closed for invalid untrusted server fields', () => {
    const challenge = validChallenge();

    expect(() => buildCreateOptions(challenge, '', 'alice')).toThrow('Invalid relying-party id');
    expect(() => buildCreateOptions(challenge, '   ', 'alice')).toThrow('Invalid relying-party id');
    expect(() => buildCreateOptions(challenge, 'exam ple.com', 'alice')).toThrow('Invalid relying-party id');
    expect(() => buildCreateOptions(challenge, 'example.com', '')).toThrow(
      'Missing account for passkey registration',
    );

    expect(() => buildGetOptions(challenge, '', [bytesToB64url(bytes(1))])).toThrow(
      'Invalid relying-party id',
    );
    expect(() => buildGetOptions(challenge, '   ', [bytesToB64url(bytes(1))])).toThrow(
      'Invalid relying-party id',
    );
    expect(() => buildGetOptions(challenge, 'example.com', [''])).toThrow(
      'Empty credential id in allow-list',
    );
  });

  it('offers only ES256 and EdDSA COSE algorithms', () => {
    const options = buildCreateOptions(validChallenge(), 'example.com', 'alice');
    const offeredAlgs = options.pubKeyCredParams.map((param) => param.alg);

    expect(offeredAlgs).toEqual([-7, -8]);
    expect(offeredAlgs).not.toContain(-257);
  });
});

describe('passkey response-encoder security contract', () => {
  it('encodes attestation response fields as base64url wire tokens', () => {
    const rawId = bytes(1, 2, 3);
    const clientDataJSON = bytes(4, 5, 6);
    const authenticatorData = bytes(7, 8, 9);
    const credential = {
      rawId: rawId.buffer,
      response: {
        clientDataJSON: clientDataJSON.buffer,
        getAuthenticatorData: () => authenticatorData.buffer,
      },
    } as unknown as PublicKeyCredential;

    expect(encodeRegistration(credential)).toEqual({
      credId: bytesToB64url(rawId),
      clientDataJSON: bytesToB64url(clientDataJSON),
      authData: bytesToB64url(authenticatorData),
    });
  });

  it('encodes assertion response fields as base64url wire tokens', () => {
    const rawId = bytes(10, 11, 12);
    const clientDataJSON = bytes(13, 14, 15);
    const authenticatorData = bytes(16, 17, 18);
    const signature = bytes(19, 20, 21);
    const credential = {
      rawId: rawId.buffer,
      response: {
        clientDataJSON: clientDataJSON.buffer,
        authenticatorData: authenticatorData.buffer,
        signature: signature.buffer,
      },
    } as unknown as PublicKeyCredential;

    expect(encodeAssertion(credential)).toEqual({
      credId: bytesToB64url(rawId),
      clientDataJSON: bytesToB64url(clientDataJSON),
      authData: bytesToB64url(authenticatorData),
      signature: bytesToB64url(signature),
    });
  });
});
