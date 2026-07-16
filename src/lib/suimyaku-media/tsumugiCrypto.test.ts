// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * tsumugiCrypto.test.ts — E2E media crypto pins for TsumugiSession / TsumugiGroup.
 *
 * jsdom ships a real crypto.subtle, so P-256 ECDH + HKDF + AES-256-GCM run
 * end-to-end here. These specs lock down the security-critical behaviour:
 * handshake direction-separation, IV monotonicity + exhaustion, replay
 * rejection (including the bounded group replay window), ratchet epoch advance,
 * destroyed-refuses-ops, and self-key rejection.
 */
import { describe, expect, it } from 'vitest';

import { TsumugiSession } from './TsumugiSession';
import { TsumugiGroup } from './TsumugiGroup';
import { REPLAY_WINDOW_BITS } from './replayWindow';

const enc = new TextEncoder();
function bytes(s: string): Uint8Array {
  return enc.encode(s);
}
function text(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

/** Establish a mutually-keyed pair of sessions. */
async function handshakePair(): Promise<[TsumugiSession, TsumugiSession]> {
  const a = await TsumugiSession.create();
  const b = await TsumugiSession.create();
  const [ak, bk] = await Promise.all([a.exportPublicKey(), b.exportPublicKey()]);
  await a.ingestPeerKey(bk);
  await b.ingestPeerKey(ak);
  return [a, b];
}

describe('TsumugiSession — handshake + direction separation', () => {
  it('two parties derive complementary send/receive keys and interoperate', async () => {
    const [a, b] = await handshakePair();
    expect(a.established).toBe(true);
    expect(b.established).toBe(true);

    const msg = bytes('hello over the wire');
    const ct = await a.encrypt(msg);
    expect(text(await b.decrypt(ct))).toBe('hello over the wire');

    const reply = await b.encrypt(bytes('ack'));
    expect(text(await a.decrypt(reply))).toBe('ack');
  });

  it("a party cannot decrypt its OWN ciphertext (send key != own receive key)", async () => {
    const [a] = await handshakePair();
    const ct = await a.encrypt(bytes('self'));
    await expect(a.decrypt(ct)).rejects.toThrow();
  });

  it('refuses ingesting its own public key', async () => {
    const a = await TsumugiSession.create();
    const ak = await a.exportPublicKey();
    await expect(a.ingestPeerKey(ak)).rejects.toThrow(/self public key/);
  });

  it('rejects a malformed peer public key', async () => {
    const a = await TsumugiSession.create();
    await expect(a.ingestPeerKey(new Uint8Array(65))).rejects.toThrow(/invalid P-256/);
  });
});

describe('TsumugiSession — IV monotonicity + replay guard', () => {
  it('assigns a distinct, monotonically-increasing counter per encrypt', async () => {
    const [a] = await handshakePair();
    const first = await a.encrypt(bytes('x'));
    const second = await a.encrypt(bytes('y'));
    // IV = 8-byte prefix + 4-byte BE counter; prefix stable, counter increments.
    expect(first.slice(0, 8)).toEqual(second.slice(0, 8));
    const c1 = new DataView(first.buffer, first.byteOffset, 12).getUint32(8, false);
    const c2 = new DataView(second.buffer, second.byteOffset, 12).getUint32(8, false);
    expect(c2).toBe(c1 + 1);
  });

  it('rejects a replayed frame and does not double-record', async () => {
    const [a, b] = await handshakePair();
    const ct = await a.encrypt(bytes('once'));
    expect(text(await b.decrypt(ct))).toBe('once');
    await expect(b.decrypt(ct)).rejects.toThrow(/replayed/);
  });

  it('rejects a forged/tampered frame without poisoning the replay window', async () => {
    const [a, b] = await handshakePair();
    const ct = await a.encrypt(bytes('genuine'));
    const forged = ct.slice();
    const last = forged.length - 1;
    forged[last] = (forged[last]! ^ 0xff) & 0xff; // corrupt the GCM tag
    await expect(b.decrypt(forged)).rejects.toThrow();
    // The genuine frame (same IV) must still decrypt — forged IV was not remembered.
    expect(text(await b.decrypt(ct))).toBe('genuine');
  });

  it('keeps pairwise replay protection bounded across a long session', async () => {
    const [a, b] = await handshakePair();
    const total = REPLAY_WINDOW_BITS + 64;
    let first: Uint8Array | null = null;
    let last: Uint8Array | null = null;

    for (let index = 0; index < total; index += 1) {
      const frame = await a.encrypt(bytes(`pair-${index}`));
      first ??= frame;
      last = frame;
      expect(text(await b.decrypt(frame))).toBe(`pair-${index}`);
    }

    await expect(b.decrypt(last!)).rejects.toThrow(/replayed/);
    await expect(b.decrypt(first!)).rejects.toThrow(/replayed/);
  });

  it('rejects a too-short frame', async () => {
    const [, b] = await handshakePair();
    await expect(b.decrypt(new Uint8Array(12 + 15))).rejects.toThrow(/too short/);
  });
});

describe('TsumugiSession — ratchet', () => {
  it('advances the epoch and both sides stay in sync', async () => {
    const [a, b] = await handshakePair();
    expect(a.epoch).toBe(0);
    await a.ratchet();
    await b.ratchet();
    expect(a.epoch).toBe(1);
    expect(b.epoch).toBe(1);
    const ct = await a.encrypt(bytes('post-ratchet'));
    expect(text(await b.decrypt(ct))).toBe('post-ratchet');
  });

  it('a ratcheted sender cannot be decrypted by a non-ratcheted receiver', async () => {
    const [a, b] = await handshakePair();
    await a.ratchet();
    const ct = await a.encrypt(bytes('drift'));
    await expect(b.decrypt(ct)).rejects.toThrow();
  });

  it('refuses to ratchet before establishment', async () => {
    const a = await TsumugiSession.create();
    await expect(a.ratchet()).rejects.toThrow(/not yet established/);
  });
});

describe('TsumugiSession — destroyed refuses ops', () => {
  it('assertLive blocks use after destroy()', async () => {
    const [a, b] = await handshakePair();
    a.destroy();
    await expect(a.encrypt(bytes('nope'))).rejects.toThrow(/destroyed/);
    await expect(a.exportPublicKey()).rejects.toThrow(/destroyed/);
    await expect(a.getFingerprint()).rejects.toThrow(/destroyed/);
    // The still-live peer is unaffected.
    expect(b.established).toBe(true);
  });
});

describe('TsumugiGroup — wrap/unwrap + shared-key round-trip', () => {
  it('distributes the group key pairwise and members interoperate', async () => {
    const [creatorToMember, member] = await handshakePair();
    const group = await TsumugiGroup.create();

    const wrapped = await group.exportKeyFor(creatorToMember);
    const memberGroup = await TsumugiGroup.importKey(wrapped, member);

    const ct = await group.encrypt(bytes('group broadcast'));
    expect(text(await memberGroup.decrypt(ct))).toBe('group broadcast');

    // And the reverse direction (member -> creator) with the same shared key.
    const ct2 = await memberGroup.encrypt(bytes('reply'));
    expect(text(await group.decrypt(ct2))).toBe('reply');
  });

  it('rejects a wrapped key of the wrong length', async () => {
    const [creatorToMember, member] = await handshakePair();
    // Wrap arbitrary 16-byte material through the session, then try to import.
    const bogus = await creatorToMember.encrypt(new Uint8Array(16));
    await expect(TsumugiGroup.importKey(bogus, member)).rejects.toThrow(/invalid key length/);
  });

  it('refuses ops after destroy()', async () => {
    const group = await TsumugiGroup.create();
    group.destroy();
    await expect(group.encrypt(bytes('x'))).rejects.toThrow(/destroyed/);
    const other = await TsumugiGroup.create();
    const ct = await other.encrypt(bytes('y'));
    await expect(group.decrypt(ct)).rejects.toThrow(/destroyed/);
  });
});

describe('TsumugiGroup — bounded replay window', () => {
  it('rejects an exact replayed group frame', async () => {
    const group = await TsumugiGroup.create();
    const ct = await group.encrypt(bytes('frame'));
    // Round-trip through a member so decrypt is a genuine receive path.
    const [creatorToMember, member] = await handshakePair();
    const wrapped = await group.exportKeyFor(creatorToMember);
    const memberGroup = await TsumugiGroup.importKey(wrapped, member);

    expect(text(await memberGroup.decrypt(ct))).toBe('frame');
    await expect(memberGroup.decrypt(ct)).rejects.toThrow(/replayed/);
  });

  it('tolerates in-window reordering across two senders but rejects duplicates', async () => {
    // One receiver decrypting frames from two independent senders — all three
    // hold the SAME group key but carry distinct random IV prefixes.
    const origin = await TsumugiGroup.create();
    const importFor = async (): Promise<TsumugiGroup> => {
      const [c2m, m] = await handshakePair();
      return TsumugiGroup.importKey(await origin.exportKeyFor(c2m), m);
    };
    const receiver = await importFor();
    const senderA = await importFor();
    const senderB = await importFor();

    const a1 = await senderA.encrypt(bytes('a1'));
    const a2 = await senderA.encrypt(bytes('a2'));
    const b1 = await senderB.encrypt(bytes('b1'));

    // Out-of-order arrival: a2 before a1, interleaved with b1 — all accepted once.
    expect(text(await receiver.decrypt(a2))).toBe('a2');
    expect(text(await receiver.decrypt(b1))).toBe('b1');
    expect(text(await receiver.decrypt(a1))).toBe('a1');

    // Replays of each are rejected.
    await expect(receiver.decrypt(a1)).rejects.toThrow(/replayed/);
    await expect(receiver.decrypt(a2)).rejects.toThrow(/replayed/);
    await expect(receiver.decrypt(b1)).rejects.toThrow(/replayed/);
  });

  it('does not grow memory unboundedly across many frames from one sender', async () => {
    const [c2m, m] = await handshakePair();
    const sender = await TsumugiGroup.create();
    const receiver = await TsumugiGroup.importKey(await sender.exportKeyFor(c2m), m);

    const total = REPLAY_WINDOW_BITS + 200;
    let lastCt: Uint8Array | null = null;
    for (let i = 0; i < total; i++) {
      const ct = await sender.encrypt(bytes(`f${i}`));
      expect(text(await receiver.decrypt(ct))).toBe(`f${i}`);
      lastCt = ct;
    }
    // The most-recent frame is still remembered (replay rejected) despite the
    // sliding window having advanced well past its width.
    await expect(receiver.decrypt(lastCt!)).rejects.toThrow(/replayed/);
  });
});
