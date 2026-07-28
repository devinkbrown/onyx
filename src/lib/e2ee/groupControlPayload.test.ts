// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * groupControlPayload.test.ts — signed E2EEGROUP payload format.
 *
 * Covers round-trip, metadata substitution, signature tamper, magic prefix,
 * signer_pub binding, non-canonical wire encodings, and bound checks.
 * Fail-closed: every negative path is null.
 */
import { describe, expect, it } from 'vitest';

import { fromB64url, toB64url } from './dmCipher';
import {
  GROUP_CONTROL_PAYLOAD_DOMAIN,
  GROUP_CONTROL_PAYLOAD_MAGIC,
  GROUP_CONTROL_PAYLOAD_VERSION,
  MAX_GROUP_CONTROL_BODY_BYTES,
  MAX_GROUP_CONTROL_WIRE_B64,
  buildGroupControlTranscript,
  normalizeControlChannel,
  normalizeGroupControlRouting,
  packGroupControlPayload,
  parseGroupControlPayload,
  signGroupControlPayload,
  validControlEpoch,
  verifyGroupControlPayload,
  type GroupControlPayloadParts,
  type GroupControlRouting,
} from './groupControlPayload';

async function generateSigner(): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicRaw: Uint8Array;
}> {
  const kp = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', kp.publicKey),
  );
  return {
    privateKey: kp.privateKey,
    publicKey: kp.publicKey,
    publicRaw,
  };
}

const COMMIT_ROUTE: GroupControlRouting = {
  channel: '#Root',
  kind: 'commit',
  fromDevice: 'laptop.1',
};

const WELCOME_ROUTE: GroupControlRouting = {
  channel: '&staff',
  kind: 'welcome',
  fromDevice: 'desktop',
  toAccount: 'Kain',
  toDevice: 'phone-2',
};

function sampleBody(tag = 'body-v1'): Uint8Array {
  // Opaque public control material — never a raw room AES key.
  return new TextEncoder().encode(`pub-material:${tag}`);
}

/** Byte-for-byte compare (vitest toEqual on Uint8Array can false-fail on buffers). */
function expectBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(Array.from(actual)).toEqual(Array.from(expected));
}

/** Fixed envelope without body: magic(4)+ver(1)+kind(1)+epoch(4)+len(2)+pub(32)+sig(64) = 108. */
const FIXED_ENVELOPE = 108;

describe('normalizeControlChannel / routing', () => {
  it('normalizes channel case and rejects injection shapes', () => {
    expect(normalizeControlChannel('  #Root  ')).toBe('#root');
    expect(normalizeControlChannel('#root\r\nJOIN #bad')).toBeNull();
    expect(normalizeControlChannel('root')).toBeNull();
    expect(normalizeControlChannel('')).toBeNull();
  });

  it('welcome requires targets; non-welcome rejects them', () => {
    expect(normalizeGroupControlRouting(WELCOME_ROUTE)).toEqual({
      channel: '&staff',
      kind: 'welcome',
      fromDevice: 'desktop',
      toAccount: 'Kain',
      toDevice: 'phone-2',
    });
    expect(
      normalizeGroupControlRouting({
        channel: '#root',
        kind: 'commit',
        fromDevice: 'phone',
        toAccount: 'x',
      }),
    ).toBeNull();
    expect(
      normalizeGroupControlRouting({
        channel: '#root',
        kind: 'welcome',
        fromDevice: 'phone',
      }),
    ).toBeNull();
  });
});

describe('buildGroupControlTranscript', () => {
  it('binds domain, routing, version, epoch, body, and signer_pub in fixed order', () => {
    const body = sampleBody();
    const signerPub = new Uint8Array(32).fill(0xab);
    const t = buildGroupControlTranscript(COMMIT_ROUTE, 1, 7, body, signerPub);
    expect(t).not.toBeNull();
    const domain = new TextEncoder().encode(GROUP_CONTROL_PAYLOAD_DOMAIN);
    expectBytes(t!.slice(0, domain.length), domain);
    expect(t![domain.length]).toBe(0);
    // Normalized channel is lowercase #root
    const channelBytes = new TextEncoder().encode('#root');
    expect(t![domain.length + 1]).toBe(channelBytes.length);
    expectBytes(
      t!.slice(domain.length + 2, domain.length + 2 + channelBytes.length),
      channelBytes,
    );
    // signer_pub is the last 32 bytes of the transcript
    expectBytes(t!.slice(t!.length - 32), signerPub);
  });

  it('rejects empty body, oversized body, bad epoch/version, and bad signer_pub', () => {
    const pub = new Uint8Array(32);
    expect(
      buildGroupControlTranscript(COMMIT_ROUTE, 1, 1, new Uint8Array(0), pub),
    ).toBeNull();
    expect(
      buildGroupControlTranscript(
        COMMIT_ROUTE,
        1,
        1,
        new Uint8Array(MAX_GROUP_CONTROL_BODY_BYTES + 1),
        pub,
      ),
    ).toBeNull();
    expect(
      buildGroupControlTranscript(COMMIT_ROUTE, 2, 1, sampleBody(), pub),
    ).toBeNull();
    expect(
      buildGroupControlTranscript(COMMIT_ROUTE, 1, -1, sampleBody(), pub),
    ).toBeNull();
    expect(
      buildGroupControlTranscript(COMMIT_ROUTE, 1, 1.5, sampleBody(), pub),
    ).toBeNull();
    expect(
      buildGroupControlTranscript(
        COMMIT_ROUTE,
        1,
        1,
        sampleBody(),
        new Uint8Array(31),
      ),
    ).toBeNull();
    expect(validControlEpoch(0xffffffff)).toBe(true);
    expect(validControlEpoch(0x1_0000_0000)).toBe(false);
  });
});

describe('sign / parse / verify round-trip', () => {
  it('round-trips commit with explicit trusted signer', async () => {
    const signer = await generateSigner();
    const body = sampleBody('commit');
    const wire = await signGroupControlPayload({
      routing: COMMIT_ROUTE,
      epoch: 42,
      body,
      signerPub: signer.publicRaw,
      privateKey: signer.privateKey,
    });
    expect(wire).not.toBeNull();
    expect(wire!.length).toBeLessThanOrEqual(MAX_GROUP_CONTROL_WIRE_B64);
    expect(toB64url(fromB64url(wire!)!)).toBe(wire);

    const parsed = parseGroupControlPayload(wire!);
    expect(parsed).toMatchObject({
      version: GROUP_CONTROL_PAYLOAD_VERSION,
      kind: 'commit',
      epoch: 42,
    });
    expectBytes(parsed!.body, body);
    expectBytes(parsed!.signerPub, signer.publicRaw);

    // Magic prefix present on the binary form.
    const raw = fromB64url(wire!)!;
    const magic = new TextEncoder().encode(GROUP_CONTROL_PAYLOAD_MAGIC);
    expectBytes(raw.slice(0, 4), magic);

    const verified = await verifyGroupControlPayload(
      wire!,
      // Outer routing may differ only by channel case; transcript uses normalize.
      { ...COMMIT_ROUTE, channel: '#root' },
      signer.publicRaw,
    );
    expect(verified).not.toBeNull();
    expect(verified!.epoch).toBe(42);
    expectBytes(verified!.body, body);

    // CryptoKey form of the trusted signer also works (export + compare).
    const viaKey = await verifyGroupControlPayload(
      wire!,
      COMMIT_ROUTE,
      signer.publicKey,
    );
    expect(viaKey).not.toBeNull();
  });

  it('round-trips welcome with target account/device in the transcript', async () => {
    const signer = await generateSigner();
    const body = sampleBody('welcome-opaque');
    const wire = await signGroupControlPayload({
      routing: WELCOME_ROUTE,
      epoch: 3,
      body,
      signerPub: signer.publicRaw,
      privateKey: signer.privateKey,
    });
    expect(wire).not.toBeNull();
    const verified = await verifyGroupControlPayload(
      wire!,
      WELCOME_ROUTE,
      signer.publicRaw,
    );
    expect(verified).not.toBeNull();
    expect(verified!.kind).toBe('welcome');
  });

  it('round-trips key-package without embedding a room secret claim', async () => {
    const signer = await generateSigner();
    // Public leaf material only — intentionally not an AES key.
    const body = new Uint8Array([0x04, ...new Uint8Array(64).map((_, i) => i)]);
    const wire = await signGroupControlPayload({
      routing: {
        channel: '#room',
        kind: 'key-package',
        fromDevice: 'phone',
      },
      epoch: 1,
      body,
      signerPub: signer.publicRaw,
      privateKey: signer.privateKey,
    });
    expect(wire).not.toBeNull();
    const parts = await verifyGroupControlPayload(
      wire!,
      { channel: '#room', kind: 'key-package', fromDevice: 'phone' },
      signer.publicRaw,
    );
    expect(parts).not.toBeNull();
    expectBytes(parts!.body, body);
  });
});

describe('metadata substitution (fail closed)', () => {
  async function signedCommit() {
    const signer = await generateSigner();
    const wire = await signGroupControlPayload({
      routing: COMMIT_ROUTE,
      epoch: 9,
      body: sampleBody('meta'),
      signerPub: signer.publicRaw,
      privateKey: signer.privateKey,
    });
    return { signer, wire: wire! };
  }

  it('rejects channel substitution', async () => {
    const { signer, wire } = await signedCommit();
    expect(
      await verifyGroupControlPayload(
        wire,
        { ...COMMIT_ROUTE, channel: '#other' },
        signer.publicRaw,
      ),
    ).toBeNull();
  });

  it('rejects kind substitution', async () => {
    const { signer, wire } = await signedCommit();
    expect(
      await verifyGroupControlPayload(
        wire,
        { channel: '#root', kind: 'key-package', fromDevice: 'laptop.1' },
        signer.publicRaw,
      ),
    ).toBeNull();
  });

  it('rejects from-device substitution', async () => {
    const { signer, wire } = await signedCommit();
    expect(
      await verifyGroupControlPayload(
        wire,
        { ...COMMIT_ROUTE, fromDevice: 'evil-device' },
        signer.publicRaw,
      ),
    ).toBeNull();
  });

  it('rejects welcome target substitution', async () => {
    const signer = await generateSigner();
    const wire = await signGroupControlPayload({
      routing: WELCOME_ROUTE,
      epoch: 1,
      body: sampleBody('w'),
      signerPub: signer.publicRaw,
      privateKey: signer.privateKey,
    });
    expect(wire).not.toBeNull();
    expect(
      await verifyGroupControlPayload(
        wire!,
        { ...WELCOME_ROUTE, toAccount: 'Mallory' },
        signer.publicRaw,
      ),
    ).toBeNull();
    expect(
      await verifyGroupControlPayload(
        wire!,
        { ...WELCOME_ROUTE, toDevice: 'other-phone' },
        signer.publicRaw,
      ),
    ).toBeNull();
  });
});

describe('signature tamper / wrong trusted key / signer_pub binding', () => {
  it('rejects a flipped signature byte', async () => {
    const signer = await generateSigner();
    const wire = await signGroupControlPayload({
      routing: COMMIT_ROUTE,
      epoch: 1,
      body: sampleBody('tamper'),
      signerPub: signer.publicRaw,
      privateKey: signer.privateKey,
    });
    expect(wire).not.toBeNull();
    const parts = parseGroupControlPayload(wire!)!;
    const badSig = new Uint8Array(parts.signature);
    badSig[0] = (badSig[0]! ^ 0xff) & 0xff;
    const tampered = packGroupControlPayload({ ...parts, signature: badSig });
    expect(tampered).not.toBeNull();
    expect(
      await verifyGroupControlPayload(tampered!, COMMIT_ROUTE, signer.publicRaw),
    ).toBeNull();
  });

  it('rejects body mutation under a still-valid-looking envelope', async () => {
    const signer = await generateSigner();
    const wire = await signGroupControlPayload({
      routing: COMMIT_ROUTE,
      epoch: 1,
      body: sampleBody('orig'),
      signerPub: signer.publicRaw,
      privateKey: signer.privateKey,
    });
    const parts = parseGroupControlPayload(wire!)!;
    const mutatedBody = new Uint8Array(parts.body);
    mutatedBody[0] = (mutatedBody[0]! ^ 0x55) & 0xff;
    // Re-sign is not done — pack with original signature over old body.
    const tampered = packGroupControlPayload({ ...parts, body: mutatedBody });
    expect(tampered).not.toBeNull();
    expect(
      await verifyGroupControlPayload(tampered!, COMMIT_ROUTE, signer.publicRaw),
    ).toBeNull();
  });

  it('rejects swapped wire signer_pub even under the real trusted key', async () => {
    const real = await generateSigner();
    const impostor = await generateSigner();
    const wire = await signGroupControlPayload({
      routing: COMMIT_ROUTE,
      epoch: 1,
      body: sampleBody('trust'),
      signerPub: real.publicRaw,
      privateKey: real.privateKey,
    });
    // Caller supplies impostor's key as "trusted" — equality or sig fails.
    expect(
      await verifyGroupControlPayload(wire!, COMMIT_ROUTE, impostor.publicRaw),
    ).toBeNull();
    // Attacker rewrites the wire field to the impostor pub without re-signing.
    // Fail closed: wire signer_pub must equal trusted, AND is bound in transcript.
    const parts = parseGroupControlPayload(wire!)!;
    const swappedHint = packGroupControlPayload({
      ...parts,
      signerPub: impostor.publicRaw,
    });
    expect(swappedHint).not.toBeNull();
    // Real trusted key rejects (wire field ≠ trusted).
    expect(
      await verifyGroupControlPayload(
        swappedHint!,
        COMMIT_ROUTE,
        real.publicRaw,
      ),
    ).toBeNull();
    // Impostor trusted key rejects (signature is over real.pub in transcript).
    expect(
      await verifyGroupControlPayload(
        swappedHint!,
        COMMIT_ROUTE,
        impostor.publicRaw,
      ),
    ).toBeNull();
  });
});

describe('magic prefix (fail closed)', () => {
  it('rejects magic tamper and missing magic', async () => {
    const signer = await generateSigner();
    const wire = await signGroupControlPayload({
      routing: COMMIT_ROUTE,
      epoch: 1,
      body: sampleBody('magic'),
      signerPub: signer.publicRaw,
      privateKey: signer.privateKey,
    });
    expect(wire).not.toBeNull();
    const raw = fromB64url(wire!)!;
    // Flip first magic byte.
    const flipped = new Uint8Array(raw);
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;
    expect(parseGroupControlPayload(toB64url(flipped))).toBeNull();
    expect(
      await verifyGroupControlPayload(
        toB64url(flipped),
        COMMIT_ROUTE,
        signer.publicRaw,
      ),
    ).toBeNull();
    // Zero magic
    const zeroed = new Uint8Array(raw);
    zeroed[0] = 0;
    zeroed[1] = 0;
    zeroed[2] = 0;
    zeroed[3] = 0;
    expect(parseGroupControlPayload(toB64url(zeroed))).toBeNull();
  });

  it('rejects legacy layout without OGC1 prefix', () => {
    const body = sampleBody('legacy');
    // Pre-magic layout: version|kind|epoch|len|body|pub|sig
    const raw = new Uint8Array(1 + 1 + 4 + 2 + body.length + 32 + 64);
    raw[0] = GROUP_CONTROL_PAYLOAD_VERSION;
    raw[1] = 3; // commit
    raw[5] = 1; // epoch low byte
    raw[6] = (body.length >> 8) & 0xff;
    raw[7] = body.length & 0xff;
    raw.set(body, 8);
    expect(parseGroupControlPayload(toB64url(raw))).toBeNull();
  });
});

describe('non-canonical payload and bounds', () => {
  it('rejects standard base64, padding, and alphabet drift', async () => {
    const signer = await generateSigner();
    const wire = await signGroupControlPayload({
      routing: COMMIT_ROUTE,
      epoch: 1,
      body: sampleBody('canon'),
      signerPub: signer.publicRaw,
      privateKey: signer.privateKey,
    });
    expect(wire).not.toBeNull();
    // Padding is non-canonical for this wire.
    expect(parseGroupControlPayload(`${wire}=`)).toBeNull();
    expect(parseGroupControlPayload(`${wire}==`)).toBeNull();
    // '+' / '/' are not base64url.
    const raw = fromB64url(wire!)!;
    const std = btoa(String.fromCharCode(...raw));
    if (!std.includes('+') && !std.includes('/')) {
      // Force a non-url character path: inject illegal char.
      expect(parseGroupControlPayload(wire!.slice(0, -1) + '+')).toBeNull();
    } else {
      expect(parseGroupControlPayload(std.replace(/=+$/, ''))).toBeNull();
    }
    expect(parseGroupControlPayload('')).toBeNull();
    expect(parseGroupControlPayload('A')).toBeNull(); // length % 4 === 1
  });

  it('rejects truncated and elongated binary envelopes', async () => {
    const signer = await generateSigner();
    const wire = await signGroupControlPayload({
      routing: COMMIT_ROUTE,
      epoch: 1,
      body: sampleBody('len'),
      signerPub: signer.publicRaw,
      privateKey: signer.privateKey,
    });
    const raw = fromB64url(wire!)!;
    expect(parseGroupControlPayload(toB64url(raw.slice(0, raw.length - 1)))).toBeNull();
    const longer = new Uint8Array(raw.length + 1);
    longer.set(raw);
    expect(parseGroupControlPayload(toB64url(longer))).toBeNull();
  });

  it('rejects unknown version and kind codes', () => {
    const body = sampleBody('ver');
    // Manual wire: OGC1 | version | kind | epoch | body_len | body | pub | sig
    const raw = new Uint8Array(FIXED_ENVELOPE + body.length);
    raw.set(new TextEncoder().encode(GROUP_CONTROL_PAYLOAD_MAGIC), 0);
    raw[4] = 9; // bad version
    raw[5] = 1;
    raw[9] = 1; // epoch low byte at offset 6+3
    raw[10] = (body.length >> 8) & 0xff;
    raw[11] = body.length & 0xff;
    raw.set(body, 12);
    expect(parseGroupControlPayload(toB64url(raw))).toBeNull();

    raw[4] = GROUP_CONTROL_PAYLOAD_VERSION;
    raw[5] = 0xff; // bad kind
    expect(parseGroupControlPayload(toB64url(raw))).toBeNull();
  });

  it('rejects empty body length and body over max', () => {
    const empty = new Uint8Array(FIXED_ENVELOPE);
    empty.set(new TextEncoder().encode(GROUP_CONTROL_PAYLOAD_MAGIC), 0);
    empty[4] = 1;
    empty[5] = 3; // commit
    // body_len stays 0 → reject
    expect(parseGroupControlPayload(toB64url(empty))).toBeNull();

    const over = new Uint8Array(
      FIXED_ENVELOPE + (MAX_GROUP_CONTROL_BODY_BYTES + 1),
    );
    over.set(new TextEncoder().encode(GROUP_CONTROL_PAYLOAD_MAGIC), 0);
    over[4] = 1;
    over[5] = 3;
    const bl = MAX_GROUP_CONTROL_BODY_BYTES + 1;
    over[10] = (bl >> 8) & 0xff;
    over[11] = bl & 0xff;
    expect(parseGroupControlPayload(toB64url(over))).toBeNull();
  });

  it('packGroupControlPayload rejects oversized wire and bad field sizes', () => {
    const bad: GroupControlPayloadParts = {
      version: 1,
      kind: 'commit',
      epoch: 1,
      body: sampleBody(),
      signerPub: new Uint8Array(31),
      signature: new Uint8Array(64),
    };
    expect(packGroupControlPayload(bad)).toBeNull();
    expect(
      packGroupControlPayload({
        ...bad,
        signerPub: new Uint8Array(32),
        signature: new Uint8Array(63),
      }),
    ).toBeNull();
    expect(
      packGroupControlPayload({
        ...bad,
        version: 99,
        signerPub: new Uint8Array(32),
        signature: new Uint8Array(64),
      }),
    ).toBeNull();
  });

  it('sign rejects empty body and invalid routing', async () => {
    const signer = await generateSigner();
    expect(
      await signGroupControlPayload({
        routing: COMMIT_ROUTE,
        epoch: 1,
        body: new Uint8Array(0),
        signerPub: signer.publicRaw,
        privateKey: signer.privateKey,
      }),
    ).toBeNull();
    expect(
      await signGroupControlPayload({
        routing: {
          channel: '#root',
          kind: 'welcome',
          fromDevice: 'x',
        },
        epoch: 1,
        body: sampleBody(),
        signerPub: signer.publicRaw,
        privateKey: signer.privateKey,
      }),
    ).toBeNull();
  });
});
