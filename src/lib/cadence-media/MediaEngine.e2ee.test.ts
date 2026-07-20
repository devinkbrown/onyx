// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IRCClient } from '@/lib/irc/client';
import { toB64url, type DeviceKeys } from '@/lib/e2ee/dmCipher';
import { CadenceMediaEngine } from './MediaEngine';
import type { CadenceMediaCallbacks } from './types';
import type { MooringGroup } from './MooringGroup';
import { _resetDeviceSigningForTests } from '@/lib/e2ee/deviceSign';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDeviceSigningForTests();
});

type EngineInternals = {
  activeRoom: string | null;
  mediaIdentity: DeviceKeys | null;
  mediaAttachmentId: Uint8Array;
  mediaE2eeEpoch: number;
  mediaCallNonce: Uint8Array | null;
  mediaEphemeralKeyPair: CryptoKeyPair | null;
  selfDetachedEpochFloor: {
    room: string;
    epoch: number;
    participants: Set<string>;
  } | null;
  mooringGroupKey: MooringGroup | null;
  mooringSessions: Map<string, unknown>;
  pendingMooringPeers: Map<string, number>;
  sendMooringHandshake(channel: string): Promise<void>;
  setActiveRoom(channel: string): void;
};

async function identity(): Promise<DeviceKeys> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  return { keyPair, publicB64: toB64url(raw) };
}

function callbacks(
  nick: string,
  state: (active: boolean, degraded: boolean, epoch: number) => void,
): CadenceMediaCallbacks {
  return {
    onCallState: vi.fn(),
    onPeerLeft: vi.fn(),
    onLocalStream: vi.fn(),
    onError: vi.fn(),
    onMediaE2eeState: state,
    getLocalNick: () => nick,
    verifyPeerMediaKey: async () => true,
  };
}

function relayClient(
  sender: string,
  recipient: CadenceMediaEngine,
): IRCClient {
  return {
    currentNick: sender,
    binaryHandlers: new Set(),
    extraMessageHandlers: new Set(),
    sendRaw: vi.fn((command: string, subtype: string, channel: string, ...params: string[]) => {
      if (command === 'MEDIA' && subtype.startsWith('E2EE-')) {
        recipient.handleMediaMessage(sender, channel, subtype, params.join(' '));
      }
      return true;
    }),
    sendBinary: vi.fn(() => true),
  } as unknown as IRCClient;
}

describe('CadenceMediaEngine media E2EE negotiation', () => {
  it('negotiates one client-held group key and rotates it away on membership loss', async () => {
    const aliceState = vi.fn();
    const bobState = vi.fn();
    const alice = new CadenceMediaEngine(callbacks('alice', aliceState), { kind: 'video' });
    const bob = new CadenceMediaEngine(callbacks('bob', bobState), { kind: 'video' });
    const aliceInternal = alice as unknown as EngineInternals;
    const bobInternal = bob as unknown as EngineInternals;
    aliceInternal.mediaIdentity = await identity();
    bobInternal.mediaIdentity = await identity();
    alice.setClient(relayClient('alice', bob));
    bob.setClient(relayClient('bob', alice));
    aliceInternal.setActiveRoom('#root');
    bobInternal.setActiveRoom('#root');

    await aliceInternal.sendMooringHandshake('#root');

    await vi.waitFor(() => {
      expect(aliceInternal.mooringGroupKey).not.toBeNull();
      expect(bobInternal.mooringGroupKey).not.toBeNull();
    });
    expect(aliceState).toHaveBeenCalledWith(true, false, 1);
    expect(bobState).toHaveBeenCalledWith(true, false, 1);

    const ciphertext = await aliceInternal.mooringGroupKey!.encrypt(
      new TextEncoder().encode('client-only media payload'),
    );
    const plaintext = await bobInternal.mooringGroupKey!.decrypt(ciphertext);
    expect(new TextDecoder().decode(plaintext)).toBe('client-only media payload');

    alice.handleMediaMessage('bob', '#root', 'LEAVE', '');
    await vi.waitFor(() => expect(aliceInternal.mooringGroupKey).toBeNull());
    expect(aliceState).toHaveBeenLastCalledWith(false, false, 0);

    alice.destroy();
    bob.destroy();
  });

  it('wraps one room key for every physical attachment sharing the same nick', async () => {
    const alice = new CadenceMediaEngine(callbacks('alice', vi.fn()), { kind: 'video' });
    const bobPhone = new CadenceMediaEngine(callbacks('bob', vi.fn()), { kind: 'video' });
    const bobDesktop = new CadenceMediaEngine(callbacks('bob', vi.fn()), { kind: 'video' });
    const nodes = [
      { nick: 'alice', engine: alice },
      { nick: 'bob', engine: bobPhone },
      { nick: 'bob', engine: bobDesktop },
    ];
    for (const node of nodes) {
      node.engine.setClient({
        currentNick: node.nick,
        binaryHandlers: new Set(),
        extraMessageHandlers: new Set(),
        sendRaw: vi.fn((command: string, subtype: string, channel: string, ...params: string[]) => {
          if (command === 'MEDIA' && subtype.startsWith('E2EE-')) {
            for (const recipient of nodes) {
              recipient.engine.handleMediaMessage(node.nick, channel, subtype, params.join(' '));
            }
          }
          return true;
        }),
        sendBinary: vi.fn(() => true),
      } as unknown as IRCClient);
    }
    const aliceInternal = alice as unknown as EngineInternals;
    const phoneInternal = bobPhone as unknown as EngineInternals;
    const desktopInternal = bobDesktop as unknown as EngineInternals;
    aliceInternal.mediaIdentity = await identity();
    phoneInternal.mediaIdentity = await identity();
    desktopInternal.mediaIdentity = await identity();
    aliceInternal.setActiveRoom('#root');
    phoneInternal.setActiveRoom('#root');
    desktopInternal.setActiveRoom('#root');

    await Promise.all([
      aliceInternal.sendMooringHandshake('#root'),
      phoneInternal.sendMooringHandshake('#root'),
      desktopInternal.sendMooringHandshake('#root'),
    ]);
    await vi.waitFor(() => {
      expect(aliceInternal.mooringGroupKey).not.toBeNull();
      expect(phoneInternal.mooringGroupKey).not.toBeNull();
      expect(desktopInternal.mooringGroupKey).not.toBeNull();
    });

    const ciphertext = await aliceInternal.mooringGroupKey!.encrypt(
      new TextEncoder().encode('same room, two bob attachments'),
    );
    expect(new TextDecoder().decode(await phoneInternal.mooringGroupKey!.decrypt(ciphertext)))
      .toBe('same room, two bob attachments');
    const secondCiphertext = await aliceInternal.mooringGroupKey!.encrypt(
      new TextEncoder().encode('same room, two bob attachments'),
    );
    expect(new TextDecoder().decode(await desktopInternal.mooringGroupKey!.decrypt(secondCiphertext)))
      .toBe('same room, two bob attachments');

    const priorEpoch = aliceInternal.mediaE2eeEpoch;
    alice.handleMediaMessage(
      'bob',
      '#root',
      'E2EE-DETACH',
      toB64url(desktopInternal.mediaAttachmentId),
    );
    await vi.waitFor(() => {
      expect([...aliceInternal.mooringSessions.keys()].filter(key => key.startsWith('bob:')))
        .toHaveLength(1);
      expect(aliceInternal.mediaE2eeEpoch).toBeGreaterThan(priorEpoch);
    });

    alice.destroy();
    bobPhone.destroy();
    bobDesktop.destroy();
  });

  it.each([
    ['E2EE-DETACH', true],
    ['LEAVE', false],
  ] as const)('does not resurrect an attachment when %s races its handshake', async (subtype, attachmentScoped) => {
    let resolveVerification!: (trusted: boolean) => void;
    const verification = new Promise<boolean>((resolve) => {
      resolveVerification = resolve;
    });
    const aliceCallbacks: CadenceMediaCallbacks = {
      ...callbacks('alice', vi.fn()),
      verifyPeerMediaKey: vi.fn(() => verification),
    };
    const alice = new CadenceMediaEngine(aliceCallbacks, { kind: 'video' });
    const bob = new CadenceMediaEngine(callbacks('bob', vi.fn()), { kind: 'video' });
    const aliceInternal = alice as unknown as EngineInternals;
    const bobInternal = bob as unknown as EngineInternals;
    aliceInternal.mediaIdentity = await identity();
    bobInternal.mediaIdentity = await identity();
    alice.setClient(relayClient('alice', bob));
    bob.setClient(relayClient('bob', alice));
    aliceInternal.setActiveRoom('#root');
    bobInternal.setActiveRoom('#root');

    await bobInternal.sendMooringHandshake('#root');
    await vi.waitFor(() => expect(aliceCallbacks.verifyPeerMediaKey).toHaveBeenCalledOnce());

    const attachment = attachmentScoped ? toB64url(bobInternal.mediaAttachmentId) : '';
    alice.handleMediaMessage('bob', '#root', subtype, attachment);
    resolveVerification(true);

    await vi.waitFor(() => expect(aliceInternal.pendingMooringPeers.size).toBe(0));
    expect([...aliceInternal.mooringSessions.keys()].filter(key => key.startsWith('bob:')))
      .toHaveLength(0);

    alice.destroy();
    bob.destroy();
  });

  it('self detach rejoins above the epoch rotated by remaining participants', async () => {
    const aliceState = vi.fn();
    const alice = new CadenceMediaEngine(callbacks('alice', aliceState), { kind: 'video' });
    const bob = new CadenceMediaEngine(callbacks('bob', vi.fn()), { kind: 'video' });
    const carol = new CadenceMediaEngine(callbacks('carol', vi.fn()), { kind: 'video' });
    const nodes = [
      { nick: 'alice', engine: alice },
      { nick: 'bob', engine: bob },
      { nick: 'carol', engine: carol },
    ];
    for (const node of nodes) {
      node.engine.setClient({
        currentNick: node.nick,
        binaryHandlers: new Set(),
        extraMessageHandlers: new Set(),
        sendRaw: vi.fn((command: string, subtype: string, channel: string, ...params: string[]) => {
          if (command === 'MEDIA' && subtype.startsWith('E2EE-')) {
            for (const recipient of nodes) {
              recipient.engine.handleMediaMessage(node.nick, channel, subtype, params.join(' '));
            }
          }
          return true;
        }),
        sendBinary: vi.fn(() => true),
      } as unknown as IRCClient);
    }
    const aliceInternal = alice as unknown as EngineInternals;
    const bobInternal = bob as unknown as EngineInternals;
    const carolInternal = carol as unknown as EngineInternals;
    aliceInternal.mediaIdentity = await identity();
    bobInternal.mediaIdentity = await identity();
    carolInternal.mediaIdentity = await identity();
    aliceInternal.setActiveRoom('#root');
    bobInternal.setActiveRoom('#root');
    carolInternal.setActiveRoom('#root');
    await Promise.all([
      aliceInternal.sendMooringHandshake('#root'),
      bobInternal.sendMooringHandshake('#root'),
      carolInternal.sendMooringHandshake('#root'),
    ]);
    await vi.waitFor(() => {
      expect(aliceInternal.mooringGroupKey).not.toBeNull();
      expect(bobInternal.mooringGroupKey).not.toBeNull();
      expect(carolInternal.mooringGroupKey).not.toBeNull();
    });

    const detachedEpoch = aliceInternal.mediaE2eeEpoch;
    const aliceAttachment = toB64url(aliceInternal.mediaAttachmentId);
    for (const node of nodes) {
      node.engine.handleMediaMessage('alice', '#root', 'E2EE-DETACH', aliceAttachment);
    }

    expect(aliceInternal.activeRoom).toBeNull();
    expect(aliceInternal.mooringGroupKey).toBeNull();
    expect(aliceInternal.mooringSessions.size).toBe(0);
    expect(aliceInternal.mediaE2eeEpoch).toBe(0);
    expect(aliceInternal.mediaCallNonce).toBeNull();
    expect(aliceInternal.mediaEphemeralKeyPair).toBeNull();
    expect(aliceState).toHaveBeenLastCalledWith(false, false, 0);

    await vi.waitFor(() => {
      expect([...bobInternal.mooringSessions.keys()].filter(key => key.startsWith('alice:')))
        .toHaveLength(0);
      expect(bobInternal.mooringGroupKey).not.toBeNull();
      expect(carolInternal.mooringGroupKey).not.toBeNull();
      expect(bobInternal.mediaE2eeEpoch).toBeGreaterThan(detachedEpoch);
    });
    const remainingEpoch = bobInternal.mediaE2eeEpoch;
    // The remaining leader can leave while this client is still detached.
    // Preserve the observed floor and recompute leadership from Carol.
    bob.setClient(null);
    alice.handleMediaMessage('bob', '#root', 'LEAVE', '');
    carol.handleMediaMessage('bob', '#root', 'LEAVE', '');
    await vi.waitFor(() => {
      expect([...carolInternal.mooringSessions.keys()].filter(key => key.startsWith('bob:')))
        .toHaveLength(0);
      expect(aliceInternal.selfDetachedEpochFloor?.epoch).toBe(remainingEpoch);
      expect([...aliceInternal.selfDetachedEpochFloor!.participants]
        .some(key => key.startsWith('bob:'))).toBe(false);
    });
    aliceInternal.setActiveRoom('#root');
    await aliceInternal.sendMooringHandshake('#root');
    await vi.waitFor(() => {
      expect(aliceInternal.mooringGroupKey).not.toBeNull();
      expect(carolInternal.mooringGroupKey).not.toBeNull();
      expect(aliceInternal.mediaE2eeEpoch).toBeGreaterThan(remainingEpoch);
      expect([...carolInternal.mooringSessions.keys()].filter(key => key.startsWith('alice:')))
        .toHaveLength(1);
    }, { timeout: 5_000 });

    alice.destroy();
    bob.destroy();
    carol.destroy();
  });

  it('tracks a lower remaining leader whose handshake is pending at self detach', async () => {
    let resolveVerification!: (trusted: boolean) => void;
    const verification = new Promise<boolean>((resolve) => {
      resolveVerification = resolve;
    });
    const zaraCallbacks: CadenceMediaCallbacks = {
      ...callbacks('zara', vi.fn()),
      verifyPeerMediaKey: vi.fn(() => verification),
    };
    const zara = new CadenceMediaEngine(zaraCallbacks, { kind: 'video' });
    const bob = new CadenceMediaEngine(callbacks('bob', vi.fn()), { kind: 'video' });
    const zaraInternal = zara as unknown as EngineInternals;
    const bobInternal = bob as unknown as EngineInternals;
    zaraInternal.mediaIdentity = await identity();
    bobInternal.mediaIdentity = await identity();
    zara.setClient(relayClient('zara', bob));
    bob.setClient(relayClient('bob', zara));
    zaraInternal.setActiveRoom('#root');
    bobInternal.setActiveRoom('#root');

    await bobInternal.sendMooringHandshake('#root');
    await vi.waitFor(() => expect(zaraCallbacks.verifyPeerMediaKey).toHaveBeenCalledOnce());
    const bobKey = `bob:${toB64url(bobInternal.mediaAttachmentId)}`;
    zara.handleMediaMessage(
      'zara',
      '#root',
      'E2EE-DETACH',
      toB64url(zaraInternal.mediaAttachmentId),
    );
    expect(zaraInternal.selfDetachedEpochFloor?.participants.has(bobKey)).toBe(true);

    const otherAttachment = toB64url(crypto.getRandomValues(new Uint8Array(16)));
    zara.handleMediaMessage(
      'bob',
      '#root',
      'E2EE-GROUPKEY',
      `${toB64url(bobInternal.mediaAttachmentId)} carol ${otherAttachment} 7 AA==`,
    );
    expect(zaraInternal.selfDetachedEpochFloor?.epoch).toBe(7);
    resolveVerification(true);

    zara.destroy();
    bob.destroy();
  });
});
