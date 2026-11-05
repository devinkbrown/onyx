// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { CadenceMediaEngine } from './MediaEngine';

describe('Cadence quality policy', () => {
  it('keeps observed network feedback separate from local policy caps', () => {
    const engine = new CadenceMediaEngine({ onCallState() {}, onPeerLeft() {}, onLocalStream() {}, onError() {} }, { kind: 'voice' });
    const internals = engine as unknown as { applyNetworkBitrate(bps: number): void; networkTier: number };
    internals.applyNetworkBitrate(2_000_000);
    expect(engine.getQualityObservation().observedNetworkTier).toBe(0);
    engine.setQualityPolicy('balanced');
    expect(engine.getQualityObservation().observedNetworkTier).toBe(0);
    expect(internals.networkTier).toBe(1);
    engine.setQualityPolicy('audio-priority');
    expect(engine.getQualityObservation().observedNetworkTier).toBe(0);
    expect(internals.networkTier).toBe(2);
    engine.setQualityPolicy('auto');
    expect(engine.getQualityObservation().observedNetworkTier).toBe(0);
    expect(internals.networkTier).toBe(0);
    expect(engine.getQualityObservation().videoState).toBe('inactive');
  });

  it('does not invent feedback when a policy changes before network samples arrive', () => {
    const engine = new CadenceMediaEngine({ onCallState() {}, onPeerLeft() {}, onLocalStream() {}, onError() {} }, { kind: 'voice' });
    engine.setQualityPolicy('balanced');
    expect(engine.getQualityObservation()).toEqual({ observedNetworkTier: null, observedAudioQuality: null, videoState: 'inactive' });
  });

  it('publishes network feedback only after the snapshot and policy tier have both advanced', () => {
    let engine: CadenceMediaEngine | null = null;
    const callbacks: Array<{ observed: number | null; effectiveTier: number }> = [];
    engine = new CadenceMediaEngine({
      onCallState() {}, onPeerLeft() {}, onLocalStream() {}, onError() {},
      onNetworkQuality() {
        callbacks.push({ observed: engine?.getQualityObservation().observedNetworkTier ?? null,
          effectiveTier: (engine as unknown as { networkTier: number }).networkTier });
      },
    }, { kind: 'voice' });
    engine.setQualityPolicy('balanced');
    (engine as unknown as { applyNetworkBitrate(bps: number): void }).applyNetworkBitrate(2_000_000);
    expect(callbacks).toEqual([{ observed: 0, effectiveTier: 1 }]);
  });

  it('starts every owned audio context resume before awaiting gesture-sensitive recovery', async () => {
    const engine = new CadenceMediaEngine({ onCallState() {}, onPeerLeft() {}, onLocalStream() {}, onError() {} }, { kind: 'voice' });
    const internals = engine as unknown as { audioCtx: AudioContext | null; speakingCtx: AudioContext | null; registry: { getOrCreate(nick: string, room: string, kind: 'voice'): { audCtx: AudioContext | null } } };
    const calls: string[] = [];
    const makeContext = (name: string) => {
      let state: AudioContextState = 'suspended';
      let release!: () => void;
      const context = {
        get state() { return state; },
        resume() { calls.push(name); return new Promise<void>(resolve => { release = () => { state = 'running'; resolve(); }; }); },
      } as unknown as AudioContext;
      return { context, release: () => release() };
    };
    const capture = makeContext('capture');
    const speaking = makeContext('speaking');
    const playout = makeContext('playout');
    internals.audioCtx = capture.context;
    internals.speakingCtx = speaking.context;
    internals.registry.getOrCreate('peer', '#room', 'voice').audCtx = playout.context;

    const recovery = engine.recoverAudio();
    expect(calls).toEqual(['capture', 'speaking', 'playout']);
    capture.release(); speaking.release(); playout.release();
    await expect(recovery).resolves.toEqual({ state: 'applied', reason: null });
  });
});
