// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import {
  MAX_PEER_VIDEO_FPS,
  MAX_PEER_VIDEO_HEIGHT,
  MAX_PEER_VIDEO_WIDTH,
  PeerRegistry,
  type PeerMedia,
} from './PeerRegistry';
import type { OpcodecWasm } from './OpcodecWasm';
import type { SpatialAudioPosition } from './spatialAudio';

type PeerRegistryInternals = {
  spatialPositions: Map<string, SpatialAudioPosition>;
};

function spatialPositions(registry: PeerRegistry): Map<string, SpatialAudioPosition> {
  return (registry as unknown as PeerRegistryInternals).spatialPositions;
}

function createRegistry(): PeerRegistry {
  return new PeerRegistry({
    sampleRate: 48_000,
    audioQuality: () => 2,
    videoW: 1280,
    videoH: 720,
    speakingRms: 0.012,
  });
}

function destroyable() {
  return { destroy: vi.fn() };
}

describe('PeerRegistry', () => {
  it('registers peers case-insensitively and tears them down on remove', () => {
    const registry = createRegistry();
    const onPeerStateChanged = vi.fn();
    const onPeerLeft = vi.fn();
    registry.onPeerStateChanged = onPeerStateChanged;
    registry.onPeerLeft = onPeerLeft;

    const pm = registry.getOrCreate('Mika', '#root', 'voice');

    expect(registry.get('mika')).toBe(pm);
    expect(registry.getOrCreate('MIKA', '#elsewhere', 'video')).toBe(pm);
    expect(Array.from(registry.allNicks())).toEqual(['mika']);
    expect(onPeerStateChanged).toHaveBeenCalledTimes(1);

    const audDec = destroyable();
    const vidDec = destroyable();
    const screenVidDec = destroyable();
    const close = vi.fn(() => Promise.resolve());
    const disconnect = vi.fn(() => {
      throw new Error('already disconnected');
    });
    const stop = vi.fn();

    pm.audDec = audDec as unknown as PeerMedia['audDec'];
    pm.vidDec = vidDec as unknown as PeerMedia['vidDec'];
    pm.screenVidDec = screenVidDec as unknown as PeerMedia['screenVidDec'];
    pm.audCtx = { close } as unknown as AudioContext;
    pm.panner = { disconnect } as unknown as StereoPannerNode;
    pm.outputGain = { disconnect } as unknown as GainNode;
    pm.screenStream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    registry.peerLevels.set('mika', 0.75);
    registry.decodeErrors.set('mika', 3);

    expect(() => registry.remove('MIKA')).not.toThrow();

    expect(audDec.destroy).toHaveBeenCalledTimes(1);
    expect(vidDec.destroy).toHaveBeenCalledTimes(1);
    expect(screenVidDec.destroy).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(registry.get('mika')).toBeUndefined();
    expect(registry.peerLevels.has('mika')).toBe(false);
    expect(registry.decodeErrors.has('mika')).toBe(false);
    expect(onPeerLeft).toHaveBeenCalledWith('Mika');
  });

  it('clears manual spatial position on remove so stale pan does not leak to a rejoining nick', () => {
    const registry = createRegistry();
    registry.getOrCreate('Bob', '#root', 'voice');

    // User pans Bob hard-left on the spatial pad.
    registry.setPositionForNick('Bob', { x: -3.5, y: 0, z: 0.5 });
    expect(spatialPositions(registry).has('bob')).toBe(true);

    // Bob leaves the call — full teardown.
    registry.remove('Bob');

    // The stale manual position must not survive teardown: a different person
    // later grabbing the recycled nick "bob" would otherwise be silently panned
    // to the position the user set for the previous, unrelated Bob (and the map
    // would grow unbounded across peer churn).
    expect(spatialPositions(registry).has('bob')).toBe(false);
  });

  it('does not resurrect an AudioContext for a peer removed mid-flight', async () => {
    // decodeAudio is async; a frame can already be in flight when the peer's
    // MEDIA LEAVE arrives. After remove(), the PeerMedia is out of the map, so a
    // late decode must NOT lazily re-create an AudioContext/decoder on it — that
    // context would be unreachable and never closed (camera-light / leaked-ctx
    // class). remove() marks the peer detached to guarantee the late frame no-ops.
    const registry = createRegistry();
    const audioDecoder = vi.fn();
    registry.setWasm({ audioDecoder, videoDecoder: vi.fn() } as unknown as OpcodecWasm);

    const pm = registry.getOrCreate('Kai', '#root', 'voice');
    registry.remove('Kai');

    await registry.decodeAudio(pm, new Uint8Array([1, 2, 3]));

    expect(audioDecoder).not.toHaveBeenCalled();
    expect(pm.audCtx).toBeNull();
    expect(pm.audDec).toBeNull();
  });

  it('releases every peer resource when clearing the whole call', () => {
    // setIdle() tears the call down via registry.clear(). This asserts the
    // invariant that leaving a call releases EVERY tracked peer's AudioContext,
    // decoders, panner/gain graph, and screen-capture tracks — not just one.
    const registry = createRegistry();
    const closes: ReturnType<typeof vi.fn>[] = [];
    const stops: ReturnType<typeof vi.fn>[] = [];
    const destroys: ReturnType<typeof vi.fn>[] = [];

    for (let i = 0; i < 3; i++) {
      const pm = registry.getOrCreate(`peer${i}`, '#root', 'voice');
      const close = vi.fn(() => Promise.resolve());
      const stop = vi.fn();
      const audDec = destroyable();
      const vidDec = destroyable();
      closes.push(close);
      stops.push(stop);
      destroys.push(audDec.destroy, vidDec.destroy);
      pm.audCtx = { close } as unknown as AudioContext;
      pm.audDec = audDec as unknown as PeerMedia['audDec'];
      pm.vidDec = vidDec as unknown as PeerMedia['vidDec'];
      pm.panner = { disconnect: vi.fn() } as unknown as StereoPannerNode;
      pm.outputGain = { disconnect: vi.fn() } as unknown as GainNode;
      pm.screenStream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
      registry.peerLevels.set(`peer${i}`, 0.5);
    }

    registry.clear();

    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
    for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1);
    for (const destroy of destroys) expect(destroy).toHaveBeenCalledTimes(1);
    expect(Array.from(registry.allNicks())).toHaveLength(0);
    expect(registry.peerLevels.size).toBe(0);
  });

  it('does not register over-cap peers or allocate decoders for them', async () => {
    const registry = createRegistry();
    const onPeerStateChanged = vi.fn();
    registry.onPeerStateChanged = onPeerStateChanged;

    for (let i = 0; i < 64; i++) {
      registry.getOrCreate(`peer${i}`, '#root', 'voice');
    }

    expect(Array.from(registry.allNicks())).toHaveLength(64);
    expect(onPeerStateChanged).toHaveBeenCalledTimes(64);

    const overflow = registry.getOrCreate('overflow', '#root', 'voice');
    expect(registry.get('overflow')).toBeUndefined();
    expect(onPeerStateChanged).toHaveBeenCalledTimes(64);

    const wasm = {
      audioDecoder: vi.fn(),
      videoDecoder: vi.fn(),
    } as unknown as OpcodecWasm;
    registry.setWasm(wasm);

    await registry.decodeAudio(overflow, new Uint8Array([1, 2, 3]));
    registry.setVideoParams('overflow-video', 640, 480, 'video');

    expect(wasm.audioDecoder).not.toHaveBeenCalled();
    expect(wasm.videoDecoder).not.toHaveBeenCalled();
    expect(overflow.audCtx).toBeNull();
    expect(registry.get('overflow-video')).toBeUndefined();
    expect(onPeerStateChanged).toHaveBeenCalledTimes(64);
  });

  it('bounds video dimensions and frame rate at the registry boundary', () => {
    const registry = createRegistry();

    registry.setVideoParams('camera', Number.POSITIVE_INFINITY, 999_999, 'video', 10_000);
    registry.setVideoParams('screen', 999_999, Number.NaN, 'screen', Number.NaN);

    const camera = registry.get('camera');
    expect(camera?.videoW).toBe(1280);
    expect(camera?.videoH).toBe(MAX_PEER_VIDEO_HEIGHT);
    expect(camera?.videoFps).toBe(MAX_PEER_VIDEO_FPS);

    const screen = registry.get('screen');
    expect(screen?.screenW).toBe(MAX_PEER_VIDEO_WIDTH);
    expect(screen?.screenH).toBe(720);
    expect(screen?.screenFps).toBe(MAX_PEER_VIDEO_FPS);
  });
});
