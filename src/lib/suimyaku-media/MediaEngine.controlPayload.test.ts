// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import type { IRCClient } from '../irc/client';
import { SuimyakuMediaEngine } from './MediaEngine';
import { mediaStreamId } from './mediaStream';
import { OpcodecWasm } from './OpcodecWasm';
import {
  MAX_PEER_VIDEO_FPS,
  MAX_PEER_VIDEO_HEIGHT,
  MAX_PEER_VIDEO_WIDTH,
  type PeerMedia,
} from './PeerRegistry';
import type { SuimyakuMediaCallbacks } from './types';

function mediaClient(): IRCClient {
  return {
    binaryHandlers: new Set(),
    extraMessageHandlers: new Set(),
  } as unknown as IRCClient;
}

function callbacks(overrides: Partial<SuimyakuMediaCallbacks> = {}): SuimyakuMediaCallbacks {
  return {
    onCallState: vi.fn(),
    onPeerLeft: vi.fn(),
    onLocalStream: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

describe('SuimyakuMediaEngine control payload boundary', () => {
  it('tears down owner-bound media state on a direct client replacement', () => {
    const onCallState = vi.fn();
    const engine = new SuimyakuMediaEngine(callbacks({ onCallState }), { kind: 'voice' });
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
    const engine = new SuimyakuMediaEngine(callbacks({ onPresence }), { kind: 'voice' });

    engine.handleMediaMessage('bad nick', '#room', 'VOICE_JOIN', '');
    engine.handleMediaMessage('alice', '#bad room', 'VOICE_JOIN', '');
    engine.handleMediaMessage('alice', '#room', 'VOICE JOIN', '');
    engine.handleMediaMessage('alice', '#room', `AUDIO_FRAME/${'x'.repeat(129)}`, 'YQ==');
    engine.handleMediaMessage('alice', '#room', `MCHUNK/AUDIO/${'x'.repeat(129)}/1/1/1`, 'YQ==');

    expect(engine.getPeers().size).toBe(0);
    expect(onPresence).not.toHaveBeenCalled();
  });

  it('does not partially populate peers from wrong-shape roster fields', () => {
    const engine = new SuimyakuMediaEngine(callbacks(), { kind: 'voice' });

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
    const engine = new SuimyakuMediaEngine(callbacks({ onRoomStats, onReaction }), { kind: 'voice' });

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
    const engine = new SuimyakuMediaEngine(callbacks(), { kind: 'voice' });

    const subtypes = [
      'MCHUNK/AUDIO/1/1/1',
      'AUDIO_FRAME/Alice',
      'SCREEN_DATA',
      'AUDIO',
      'KEYFRAME',
      'FRAME',
      'CHANNEL_INFO_RESP',
      'TSUMUGI_HANDSHAKE',
      'TSUMUGI_DATA',
      'TSUMUGI_GROUP_KEY',
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
    const engine = new SuimyakuMediaEngine(callbacks(), { kind: 'voice' });
    const oversized = 'A'.repeat(Math.ceil((1024 * 1024) / 3) * 4 + 8);

    engine.handleMediaMessage('Alice', '#room', 'AUDIO', oversized);
    engine.handleMediaMessage('Alice', '#room', 'VIDEO_DATA', oversized);
    engine.handleMediaMessage('Alice', '#room', 'TSUMUGI_DATA', oversized);

    expect(engine.getPeers().size).toBe(0);
  });

  it('rejects oversized non-frame control payloads before parsing', () => {
    const onPresence = vi.fn();
    const engine = new SuimyakuMediaEngine(callbacks({ onPresence }), { kind: 'voice' });
    const oversized = '1 '.repeat(40_000);

    engine.handleMediaMessage('Alice', '#room', 'VIDEO_JOIN', oversized);
    engine.handleMediaMessage('Alice', '#room', 'PRESENCE', oversized);
    engine.handleMediaMessage('Alice', '#room', 'TSUMUGI_GROUP_KEY', oversized);

    expect(engine.getPeers().size).toBe(0);
    expect(onPresence).not.toHaveBeenCalled();
  });

  it('shares codec startup and bounds frames retained while WASM loads', () => {
    const load = vi.spyOn(OpcodecWasm, 'load')
      .mockReturnValue(new Promise<OpcodecWasm>(() => {}));
    const engine = new SuimyakuMediaEngine(callbacks(), { kind: 'voice' });

    for (let index = 0; index < 32; index += 1) {
      engine.handleMediaMessage(`peer-${index}`, '#room', 'AUDIO', 'YQ==');
    }

    const internals = engine as unknown as {
      pendingWasmFrames: Map<string, unknown>;
    };
    expect(load).toHaveBeenCalledOnce();
    expect(internals.pendingWasmFrames.size).toBe(8);

    engine.handleMediaMessage('server', '#room', 'HANGUP', '');
    expect(internals.pendingWasmFrames.size).toBe(0);
    load.mockRestore();
  });

  it('bounds channel roster creation before firing near-capacity state', () => {
    const onRoomNearFull = vi.fn();
    const engine = new SuimyakuMediaEngine(callbacks({ onRoomNearFull }), { kind: 'voice' });
    const roster = Array.from({ length: 200 }, (_, index) => ({ nick: `nick-${index}` }));

    engine.handleMediaMessage('server', '#room', 'CHANNEL_INFO', JSON.stringify(roster));
    engine.handleMediaMessage('server', '#room', 'CHANNEL_INFO', JSON.stringify(roster));

    expect(engine.getPeers().size).toBe(64);
    expect(onRoomNearFull).toHaveBeenCalledOnce();
  });

  it('bounds and retires per-peer presence and negotiation state', () => {
    const engine = new SuimyakuMediaEngine(callbacks(), { kind: 'voice' });
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
    const engine = new SuimyakuMediaEngine(callbacks(), { kind: 'voice' });
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
