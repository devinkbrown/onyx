// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_LIVE_MEDIA_PARTICIPANTS, store } from '@/lib/store';
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

function peer(nick: string, channel = '#video'): SuimyakuPeerState {
  return {
    nick,
    channel,
    kind: 'voice',
    speaking: false,
    muted: false,
    hasVideo: false,
    canvas: null,
  };
}

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

  it('bounds callback peers and replaces casing instead of duplicating identities', async () => {
    const { mountMedia } = await import('./useSuimyakuMedia');

    createRoot(dispose => {
      mountMedia();
      const engine = mediaMock.instances[0];
      expect(engine).toBeDefined();

      engine?.callbacks.onPeerState?.(peer('Alice'));
      engine?.callbacks.onPeerState?.(peer('aLiCe'));
      for (let index = 1; index < MAX_LIVE_MEDIA_PARTICIPANTS + 8; index += 1) {
        engine?.callbacks.onPeerState?.(peer(`peer-${index}`));
      }
      engine?.callbacks.onPeerState?.(peer('bad nick'));
      engine?.callbacks.onPeerState?.(peer('outside', 'not-a-channel'));

      const state = store.getState();
      expect(state.voice.peers.size).toBe(MAX_LIVE_MEDIA_PARTICIPANTS);
      expect(state.voice.peers.has('Alice')).toBe(false);
      expect(state.voice.peers.has('aLiCe')).toBe(true);
      expect(state.voice.peers.has(`peer-${MAX_LIVE_MEDIA_PARTICIPANTS}`)).toBe(false);
      expect(state.voiceChannelParticipants.get('#video')?.size)
        .toBe(MAX_LIVE_MEDIA_PARTICIPANTS);

      engine?.callbacks.onPeerLeft?.('ALICE');
      expect(store.getState().voice.peers.has('aLiCe')).toBe(false);
      expect(store.getState().voiceChannelParticipants.get('#video')?.has('aLiCe')).toBe(false);

      dispose();
    });
  });

  it('dispatches bounded reactions only for known peers', async () => {
    const { mountMedia } = await import('./useSuimyakuMedia');
    const reactions: Array<{ nick: string; emoji: string }> = [];
    const handler = (event: Event) => reactions.push((event as CustomEvent).detail);
    window.addEventListener('ocean:voice-reaction', handler);

    createRoot(dispose => {
      mountMedia();
      const callbacks = mediaMock.instances[0]?.callbacks;
      callbacks?.onReaction?.('stranger', 'wave');
      callbacks?.onPeerState?.(peer('mika'));
      callbacks?.onReaction?.('MIKA', 'wave');
      callbacks?.onReaction?.('mika', 'x'.repeat(65));

      expect(reactions).toEqual([{ nick: 'MIKA', emoji: 'wave' }]);
      dispose();
    });

    window.removeEventListener('ocean:voice-reaction', handler);
  });
});
