// SPDX-License-Identifier: AGPL-3.0-or-later

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IRCClient } from '../irc/client';
import { CadenceMediaEngine } from './MediaEngine';
import { mediaStreamId } from './mediaStream';
import { MooringGroup } from './MooringGroup';
import { decodeCadenceFrame } from './cadenceFrame';
import { importMediaMacKey } from './mediaMac';
import { toB64url, type DeviceKeys } from '@/lib/e2ee/dmCipher';
import {
  MAX_PEER_VIDEO_FPS,
  MAX_PEER_VIDEO_HEIGHT,
  MAX_PEER_VIDEO_WIDTH,
  type PeerMedia,
} from './PeerRegistry';
import type { CadenceMediaCallbacks } from './types';
import { _resetDeviceSigningForTests, deviceSigningKeys } from '@/lib/e2ee/deviceSign';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDeviceSigningForTests();
});

function mediaClient(): IRCClient {
  return {
    binaryHandlers: new Set(),
    extraMessageHandlers: new Set(),
    sendRaw: vi.fn(() => true),
    sendBinary: vi.fn(() => true),
  } as unknown as IRCClient;
}

function callbacks(overrides: Partial<CadenceMediaCallbacks> = {}): CadenceMediaCallbacks {
  return {
    onCallState: vi.fn(),
    onPeerLeft: vi.fn(),
    onLocalStream: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

describe('CadenceMediaEngine control payload boundary', () => {
  it('fails closed instead of emitting plaintext media before a group key exists', async () => {
    const onMediaE2eeState = vi.fn();
    const client = mediaClient();
    const engine = new CadenceMediaEngine(callbacks({ onMediaE2eeState }), { kind: 'voice' });
    engine.setClient(client);
    const internals = engine as unknown as {
      activeRoom: string | null;
      wsMyNick: string;
      wsMediaKey: CryptoKey | null;
      sendFrame(channel: string, type: string, data: Uint8Array): void;
    };
    internals.activeRoom = '#root';
    internals.wsMyNick = 'alice';
    internals.wsMediaKey = await importMediaMacKey(new Uint8Array(32).fill(7));

    internals.sendFrame('#root', 'AUDIO', new Uint8Array([1, 2, 3]));
    await Promise.resolve();

    expect(client.sendBinary).not.toHaveBeenCalled();
    expect(onMediaE2eeState).toHaveBeenCalledWith(false, true, 0);
  });

  it('encrypts both audio and video payloads into dedicated E2EE media bands', async () => {
    const client = mediaClient();
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'video' });
    engine.setClient(client);
    const internals = engine as unknown as {
      activeRoom: string | null;
      wsMyNick: string;
      wsMediaKey: CryptoKey | null;
      mooringGroupKey: MooringGroup | null;
      mediaE2eeEpoch: number;
      sendFrame(channel: string, type: string, data: Uint8Array): void;
    };
    internals.activeRoom = '#root';
    internals.wsMyNick = 'alice';
    internals.wsMediaKey = await importMediaMacKey(new Uint8Array(32).fill(9));
    internals.mooringGroupKey = await MooringGroup.create();
    internals.mediaE2eeEpoch = 1;

    internals.sendFrame('#root', 'AUDIO', new Uint8Array([1, 2, 3]));
    internals.sendFrame('#root', 'KEYFRAME', new Uint8Array([4, 5, 6]));

    await vi.waitFor(() => expect(client.sendBinary).toHaveBeenCalledTimes(2));
    const frames = (client.sendBinary as ReturnType<typeof vi.fn>).mock.calls
      .map(([datagram]) => decodeCadenceFrame(datagram as Uint8Array));
    expect(frames.map((frame) => frame?.bandId).sort()).toEqual([66, 67]);
    expect(frames.every((frame) => (frame?.payload.length ?? 0) > 3)).toBe(true);
    const audio = frames.find((frame) => frame?.bandId === 66)!;
    const ciphertext = audio.payload.slice(16, -64);
    const signature = audio.payload.slice(-64);
    const aad = new TextEncoder().encode(
      'onyx-media-e2ee-v1\u0000#root\u0000alice\u0000audio\u00000',
    );
    const domain = new TextEncoder().encode('onyx-media-frame-signature-v2\u0000');
    const attachment = audio.payload.slice(0, 16);
    const transcript = new Uint8Array(domain.length + 4 + 16 + aad.length + ciphertext.length);
    transcript.set(domain, 0);
    new DataView(transcript.buffer).setUint32(domain.length, 1, false);
    transcript.set(attachment, domain.length + 4);
    transcript.set(aad, domain.length + 4 + 16);
    transcript.set(ciphertext, domain.length + 4 + 16 + aad.length);
    const signing = await deviceSigningKeys();
    expect(signing).not.toBeNull();
    expect(await crypto.subtle.verify(
      'Ed25519',
      signing!.keyPair.publicKey,
      signature as BufferSource,
      transcript as BufferSource,
    )).toBe(true);
    transcript[transcript.length - 1] = transcript[transcript.length - 1]! ^ 1;
    expect(await crypto.subtle.verify(
      'Ed25519',
      signing!.keyPair.publicKey,
      signature as BufferSource,
      transcript as BufferSource,
    )).toBe(false);
  });

  it('puts the account-bound device public key on the opaque E2EE handshake wire', async () => {
    const client = mediaClient();
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    engine.setClient(client);
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
    const publicB64 = toB64url(new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey)));
    const internals = engine as unknown as {
      activeRoom: string | null;
      mediaIdentity: DeviceKeys | null;
      sendMooringHandshake(channel: string): Promise<void>;
    };
    internals.activeRoom = '#root';
    internals.mediaIdentity = { keyPair, publicB64 };

    await internals.sendMooringHandshake('#root');

    expect(client.sendRaw).toHaveBeenCalledWith(
      'MEDIA',
      'E2EE-HANDSHAKE',
      '#root',
      expect.any(String),
    );
    const wire = (client.sendRaw as ReturnType<typeof vi.fn>).mock.calls[0]![3] as string;
    const envelope = Uint8Array.from(atob(wire), char => char.charCodeAt(0));
    expect(envelope).toHaveLength(275);
    expect(envelope[0]).toBe(2);
    expect(toB64url(envelope.slice(17, 82))).toBe(publicB64);
    expect(envelope[82]).toBe(0x04);
    expect(toB64url(envelope.slice(82, 147))).not.toBe(publicB64);
    const handshakeSigningKey = await crypto.subtle.importKey(
      'raw', envelope.slice(179, 211), 'Ed25519', false, ['verify'],
    );
    const prefix = new TextEncoder().encode('onyx-media-handshake-v2\u0000#root\u0000');
    const signed = new Uint8Array(prefix.length + 211);
    signed.set(prefix, 0);
    signed.set(envelope.slice(0, 211), prefix.length);
    expect(await crypto.subtle.verify(
      'Ed25519',
      handshakeSigningKey,
      envelope.slice(211) as BufferSource,
      signed as BufferSource,
    )).toBe(true);
  });

  it('tears down owner-bound media state on a direct client replacement', () => {
    const onCallState = vi.fn();
    const engine = new CadenceMediaEngine(callbacks({ onCallState }), { kind: 'voice' });
    const aliceClient = mediaClient();
    const bobClient = mediaClient();
    engine.setClient(aliceClient);

    const internals = engine as unknown as {
      activeRoom: string | null;
      callState: 'idle' | 'in_call';
      presenceList: Set<string>;
      streamRouter: {
        setRoster(channel: string, nicks: readonly string[]): void;
        resolve(streamId: number): unknown;
      };
    };
    internals.activeRoom = '#alice';
    internals.callState = 'in_call';
    internals.presenceList.add('peer');
    internals.streamRouter.setRoster('#alice', ['peer']);
    expect(internals.streamRouter.resolve(mediaStreamId('#alice', 'peer', 'audio'))).not.toBeNull();

    engine.setClient(bobClient);

    expect(engine.getCallState()).toEqual({ callState: 'idle', callWith: '', callChannel: null });
    expect(internals.presenceList.size).toBe(0);
    expect(internals.streamRouter.resolve(mediaStreamId('#alice', 'peer', 'audio'))).toBeNull();
    expect((aliceClient.binaryHandlers as Set<unknown>).size).toBe(0);
    expect((aliceClient.extraMessageHandlers as Set<unknown>).size).toBe(0);
    expect((bobClient.binaryHandlers as Set<unknown>).size).toBe(1);
    expect((bobClient.extraMessageHandlers as Set<unknown>).size).toBe(1);
    expect(onCallState).toHaveBeenLastCalledWith('idle', '', null);
  });

  it('rejects malformed media envelopes before allocating peer state', () => {
    const onPresence = vi.fn();
    const engine = new CadenceMediaEngine(callbacks({ onPresence }), { kind: 'voice' });

    engine.handleMediaMessage('bad nick', '#room', 'VOICE_JOIN', '');
    engine.handleMediaMessage('alice', '#bad room', 'VOICE_JOIN', '');
    engine.handleMediaMessage('alice', '#room', 'VOICE JOIN', '');
    engine.handleMediaMessage('alice', '#room', `AUDIO_FRAME/${'x'.repeat(129)}`, 'YQ==');
    engine.handleMediaMessage('alice', '#room', `MCHUNK/AUDIO/${'x'.repeat(129)}/1/1/1`, 'YQ==');

    expect(engine.getPeers().size).toBe(0);
    expect(onPresence).not.toHaveBeenCalled();
  });

  it('does not partially populate peers from wrong-shape roster fields', () => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });

    expect(() => {
      engine.handleMediaMessage('server', '#room', 'ROSTER', JSON.stringify({
        voice: 'Alice',
        video: [{ nick: 'not-a-string-entry' }],
      }));
    }).not.toThrow();
    expect(engine.getPeers().size).toBe(0);

    engine.handleMediaMessage('server', '#room', 'ROSTER', JSON.stringify({
      voice: ['Alice', 'alice', 7],
      video: ['Bob'],
    }));
    expect([...engine.getPeers().keys()]).toEqual(['Alice', 'Bob']);
  });

  it('publishes only validated room statistics and bounded reactions', () => {
    const onRoomStats = vi.fn();
    const onReaction = vi.fn();
    const engine = new CadenceMediaEngine(callbacks({ onRoomStats, onReaction }), { kind: 'voice' });

    engine.handleMediaMessage('server', '#room', 'STATS', '{"active_senders":"many"}');
    engine.handleMediaMessage('server', '#room', 'STATS', JSON.stringify({
      active_senders: 2,
      total_viewers: 8,
      video_fps: 60,
      audio_kbps: 128,
    }));
    engine.handleMediaMessage('Alice', '#room', 'REACTION', `  ${'🔥'.repeat(100)}  `);

    expect(onRoomStats).toHaveBeenCalledOnce();
    expect(onRoomStats).toHaveBeenCalledWith('#room', {
      active_senders: 2,
      total_viewers: 8,
      video_fps: 60,
      audio_kbps: 128,
    });
    expect(Array.from(onReaction.mock.calls[0]?.[1] as string)).toHaveLength(64);
  });

  it('contains malformed base64 in every inline media and crypto path', () => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });

    const subtypes = [
      'MCHUNK/AUDIO/1/1/1',
      'AUDIO_FRAME/Alice',
      'SCREEN_DATA',
      'AUDIO',
      'KEYFRAME',
      'FRAME',
      'CHANNEL_INFO_RESP',
      'E2EE-HANDSHAKE',
      'E2EE_DATA',
      'E2EE-GROUPKEY',
      'VOICE_DATA',
      'VIDEO_DATA',
    ];
    for (const subtype of subtypes) {
      expect(() => engine.handleMediaMessage('Alice', '#room', subtype, '%%%bad%%%'))
        .not.toThrow();
    }
    expect(engine.getPeers().size).toBe(0);
  });

  it('rejects oversized inline frames before decoding or allocating peers', () => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    const oversized = 'A'.repeat(Math.ceil((1024 * 1024) / 3) * 4 + 8);

    engine.handleMediaMessage('Alice', '#room', 'AUDIO', oversized);
    engine.handleMediaMessage('Alice', '#room', 'VIDEO_DATA', oversized);
    engine.handleMediaMessage('Alice', '#room', 'SCREEN_DATA', oversized);

    expect(engine.getPeers().size).toBe(0);
  });

  it('rejects oversized non-frame control payloads before parsing', () => {
    const onPresence = vi.fn();
    const engine = new CadenceMediaEngine(callbacks({ onPresence }), { kind: 'voice' });
    const oversized = '1 '.repeat(40_000);

    engine.handleMediaMessage('Alice', '#room', 'VIDEO_JOIN', oversized);
    engine.handleMediaMessage('Alice', '#room', 'PRESENCE', oversized);
    engine.handleMediaMessage('Alice', '#room', 'E2EE-GROUPKEY', oversized);

    expect(engine.getPeers().size).toBe(0);
    expect(onPresence).not.toHaveBeenCalled();
  });

  it('rejects every unsigned legacy frame without starting a decoder', () => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });

    for (let index = 0; index < 32; index += 1) {
      engine.handleMediaMessage(`peer-${index}`, '#room', 'AUDIO', 'YQ==');
    }

    const internals = engine as unknown as {
      pendingWasmFrames: Map<string, unknown>;
    };
    expect(internals.pendingWasmFrames.size).toBe(0);

    engine.handleMediaMessage('server', '#room', 'HANGUP', '');
    expect(internals.pendingWasmFrames.size).toBe(0);
  });

  it('bounds channel roster creation before firing near-capacity state', () => {
    const onRoomNearFull = vi.fn();
    const engine = new CadenceMediaEngine(callbacks({ onRoomNearFull }), { kind: 'voice' });
    const roster = Array.from({ length: 200 }, (_, index) => ({ nick: `nick-${index}` }));

    engine.handleMediaMessage('server', '#room', 'CHANNEL_INFO', JSON.stringify(roster));
    engine.handleMediaMessage('server', '#room', 'CHANNEL_INFO', JSON.stringify(roster));

    expect(engine.getPeers().size).toBe(64);
    expect(onRoomNearFull).toHaveBeenCalledOnce();
  });

  it('bounds and retires per-peer presence and negotiation state', () => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    const negotiation = JSON.stringify({ max_bitrate_kbps: 128 });

    for (let index = 0; index < 72; index += 1) {
      engine.handleMediaMessage(`peer-${index}`, '#room', 'PRESENCE', 'true');
      engine.handleMediaMessage(`peer-${index}`, '#room', 'NEGO_ANSWER', negotiation);
    }

    const internals = engine as unknown as {
      negotiatedBitrate: Map<string, number>;
    };
    expect(engine.getPresenceList()).toHaveLength(64);
    expect(internals.negotiatedBitrate.size).toBe(64);
    expect(engine.getPresenceList()).not.toContain('peer-64');
    expect(internals.negotiatedBitrate.has('peer-64')).toBe(false);

    engine.handleMediaMessage('PEER-0', '#room', 'PRESENCE', 'true');
    expect(engine.getPresenceList()).toHaveLength(64);
    expect(engine.getPresenceList()).toContain('PEER-0');

    engine.handleMediaMessage('peer-0', '#room', 'MEDIA_BYE', '');
    expect(engine.getPresenceList()).not.toContain('PEER-0');
    expect(internals.negotiatedBitrate.has('peer-0')).toBe(false);

    engine.handleMediaMessage('server', '#room', 'HANGUP', '');
    expect(engine.getPresenceList()).toEqual([]);
    expect(internals.negotiatedBitrate.size).toBe(0);
  });

  it('clamps hostile VIDEO_JOIN capture geometry before peer allocation', () => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    engine.handleMediaMessage('alice', '#room', 'VIDEO_JOIN', '999999 999999 200 999 true');

    const internals = engine as unknown as {
      registry: { get(nick: string): PeerMedia | undefined };
    };
    const peer = internals.registry.get('alice');
    expect(peer?.screenW).toBe(MAX_PEER_VIDEO_WIDTH);
    expect(peer?.screenH).toBe(MAX_PEER_VIDEO_HEIGHT);
    expect(peer?.screenFps).toBe(MAX_PEER_VIDEO_FPS);
  });
});
