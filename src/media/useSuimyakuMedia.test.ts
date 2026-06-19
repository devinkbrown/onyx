import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store';
import type { SuimyakuMediaCallbacks, SuimyakuPeerState } from '@/lib/suimyaku-media/types';

const mediaMock = vi.hoisted(() => {
  type MockEngineInstance = {
    callbacks: SuimyakuMediaCallbacks;
    options: { kind: string };
    setClient: ReturnType<typeof vi.fn>;
    setDeafened: ReturnType<typeof vi.fn>;
    setOutput: ReturnType<typeof vi.fn>;
    getScreenStream: ReturnType<typeof vi.fn>;
    getLocalKind: ReturnType<typeof vi.fn>;
    getLocalStream: ReturnType<typeof vi.fn>;
    startScreenShare: ReturnType<typeof vi.fn>;
    startBroadcast: ReturnType<typeof vi.fn>;
    stopBroadcast: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };

  let mounted: MockEngineInstance | null = null;
  const instances: MockEngineInstance[] = [];

  class MockSuimyakuMediaEngine implements MockEngineInstance {
    callbacks: SuimyakuMediaCallbacks;
    options: { kind: string };
    setClient = vi.fn();
    setDeafened = vi.fn();
    setOutput = vi.fn();
    getScreenStream = vi.fn(() => null);
    getLocalKind = vi.fn(() => null);
    getLocalStream = vi.fn(() => null);
    startScreenShare = vi.fn();
    startBroadcast = vi.fn();
    stopBroadcast = vi.fn();
    destroy = vi.fn();

    constructor(callbacks: SuimyakuMediaCallbacks, options: { kind: string }) {
      this.callbacks = callbacks;
      this.options = options;
      instances.push(this);
    }
  }

  return {
    instances,
    reset() {
      mounted = null;
      instances.length = 0;
    },
    getMounted() {
      return mounted;
    },
    setMounted(engine: MockEngineInstance | null) {
      mounted = engine;
    },
    MockSuimyakuMediaEngine,
  };
});

vi.mock('@/lib/suimyaku-media/MediaEngine', () => ({
  SuimyakuMediaEngine: mediaMock.MockSuimyakuMediaEngine,
  getMountedSuimyakuMediaEngine: mediaMock.getMounted,
  setMountedSuimyakuMediaEngine: mediaMock.setMounted,
}));

const initialState = store.getInitialState();

describe('mountMedia', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    mediaMock.reset();
  });

  it('sets the mounted engine singleton under a Solid root', async () => {
    const { mountMedia } = await import('./useSuimyakuMedia');

    createRoot(dispose => {
      mountMedia();

      expect(mediaMock.getMounted()).not.toBeNull();
      expect(mediaMock.instances).toHaveLength(1);
      expect(mediaMock.instances[0]?.options).toEqual({ kind: 'video' });

      dispose();
    });

    expect(mediaMock.getMounted()).toBeNull();
    expect(mediaMock.instances[0]?.destroy).toHaveBeenCalledTimes(1);
  });

  it('updates voice peers and video participants from onPeerState', async () => {
    const { mountMedia } = await import('./useSuimyakuMedia');
    const stream = { getTracks: vi.fn(() => []) } as unknown as MediaStream;
    const canvas = {
      captureStream: vi.fn(() => stream),
    } as unknown as HTMLCanvasElement & {
      captureStream: ReturnType<typeof vi.fn>;
    };

    createRoot(dispose => {
      mountMedia();
      const engine = mediaMock.instances[0];
      expect(engine).toBeDefined();

      const peer: SuimyakuPeerState = {
        nick: 'mika',
        channel: '#video',
        kind: 'video',
        speaking: false,
        muted: false,
        hasVideo: true,
        canvas,
      };

      engine?.callbacks.onPeerState?.(peer);
      engine?.callbacks.onPeerState?.({ ...peer, speaking: true });

      const voice = store.getState().voice;
      expect(voice.peers.get('mika')).toMatchObject({ nick: 'mika', speaking: true });
      expect(voice.videoParticipants.get('mika')).toBe(stream);
      expect(canvas.captureStream).toHaveBeenCalledTimes(1);
      expect(canvas.captureStream).toHaveBeenCalledWith(60);

      dispose();
    });
  });

  it('sends client changes to engine.setClient', async () => {
    const { mountMedia } = await import('./useSuimyakuMedia');
    const client = { id: 'irc-client' };
    const dispose = createRoot(disposeRoot => {
      mountMedia();
      return disposeRoot;
    });
    const engine = mediaMock.instances[0];

    expect(engine).toBeDefined();

    store.setState({ client: client as never });
    await Promise.resolve();

    expect(engine?.setClient).toHaveBeenLastCalledWith(client);

    dispose();
  });
});
