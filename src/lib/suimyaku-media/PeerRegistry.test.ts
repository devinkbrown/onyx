import { describe, expect, it, vi } from 'vitest';

import { PeerRegistry, type PeerMedia } from './PeerRegistry';
import type { OpcodecWasm } from './OpcodecWasm';

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
});
