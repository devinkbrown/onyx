// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadenceMediaEngine } from './MediaEngine';

function fakeTrack(kind: 'audio' | 'video') {
  return { kind, readyState: 'live', enabled: true, stop: vi.fn(), addEventListener: vi.fn() } as unknown as MediaStreamTrack;
}

class TestMediaStream {
  constructor(private readonly tracks: MediaStreamTrack[]) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('Cadence audio pipeline ownership', () => {
  it('stages a replacement pipeline while the old encoder remains live, then applies the latest mute at transfer', async () => {
    vi.stubGlobal('MediaStream', TestMediaStream);
    const engine = new CadenceMediaEngine({ onCallState() {}, onPeerLeft() {}, onLocalStream() {}, onError() {} }, { kind: 'voice' });
    const oldTrack = fakeTrack('audio');
    const replacementTrack = fakeTrack('audio');
    const prior = new TestMediaStream([oldTrack]) as unknown as MediaStream;
    const incoming = new TestMediaStream([replacementTrack]) as unknown as MediaStream;
    const oldDispose = vi.fn();
    const oldPipeline = { context: {}, encoder: {}, quality: 2 as const, noiseSuppress: true, source: {}, processor: {}, activate() {}, dispose: oldDispose };
    const nextActivate = vi.fn();
    const nextDispose = vi.fn();
    const nextPipeline = { context: {}, encoder: {}, quality: 2 as const, noiseSuppress: true, source: {}, processor: {}, activate: nextActivate, dispose: nextDispose };
    let finishPreparation!: (value: typeof nextPipeline) => void;
    const internals = engine as unknown as {
      callState: string; activeRoom: string | null; localStream: MediaStream | null; localKind: string | null;
      callOperationGeneration: number; client: unknown; audioPipeline: typeof oldPipeline | null; audEnc: unknown;
      prepareAudioPipeline(stream: MediaStream, context: AudioContext | null, current: () => boolean): Promise<typeof nextPipeline>;
      startSpeakingMeter(stream: MediaStream): void;
    };
    internals.callState = 'in_call'; internals.activeRoom = '#room'; internals.localStream = prior; internals.localKind = 'voice';
    internals.callOperationGeneration = 7; internals.client = null; internals.audioPipeline = oldPipeline; internals.audEnc = oldPipeline.encoder;
    vi.spyOn(internals, 'prepareAudioPipeline').mockImplementation(() => new Promise(resolve => { finishPreparation = resolve; }));
    vi.spyOn(internals, 'startSpeakingMeter').mockImplementation(() => {});

    const switching = engine.replaceAudioInput(incoming, null);
    expect(internals.audioPipeline).toBe(oldPipeline);
    expect(oldDispose).not.toHaveBeenCalled();
    oldTrack.enabled = false;
    finishPreparation(nextPipeline);
    await expect(switching).resolves.toBe(true);
    expect(replacementTrack.enabled).toBe(false);
    expect(internals.audioPipeline).toBe(nextPipeline);
    expect(oldDispose).toHaveBeenCalledOnce();
    expect(nextActivate).toHaveBeenCalledOnce();
    expect(oldTrack.stop).toHaveBeenCalledOnce();
  });

  it('keeps the existing encoder and local stream when replacement pipeline setup fails', async () => {
    vi.stubGlobal('MediaStream', TestMediaStream);
    const engine = new CadenceMediaEngine({ onCallState() {}, onPeerLeft() {}, onLocalStream() {}, onError() {} }, { kind: 'voice' });
    const oldTrack = fakeTrack('audio');
    const replacementTrack = fakeTrack('audio');
    const prior = new TestMediaStream([oldTrack]) as unknown as MediaStream;
    const incoming = new TestMediaStream([replacementTrack]) as unknown as MediaStream;
    const oldDispose = vi.fn();
    const oldPipeline = { context: {}, encoder: {}, source: {}, processor: {}, activate() {}, dispose: oldDispose };
    const internals = engine as unknown as {
      callState: string; activeRoom: string | null; localStream: MediaStream | null; localKind: string | null;
      callOperationGeneration: number; client: unknown; audioPipeline: typeof oldPipeline | null;
      prepareAudioPipeline(stream: MediaStream, context: AudioContext | null, current: () => boolean): Promise<never>;
    };
    internals.callState = 'in_call'; internals.activeRoom = '#room'; internals.localStream = prior; internals.localKind = 'voice';
    internals.callOperationGeneration = 7; internals.client = null; internals.audioPipeline = oldPipeline;
    vi.spyOn(internals, 'prepareAudioPipeline').mockRejectedValue(new Error('context setup failed'));

    await expect(engine.replaceAudioInput(incoming, null)).resolves.toBe(false);
    expect(internals.localStream).toBe(prior);
    expect(internals.audioPipeline).toBe(oldPipeline);
    expect(oldDispose).not.toHaveBeenCalled();
    expect(replacementTrack.stop).toHaveBeenCalledOnce();
  });

  it('reconciles a staged replacement encoder with the latest audio policy before exposing its observation', async () => {
    vi.stubGlobal('MediaStream', TestMediaStream);
    const engine = new CadenceMediaEngine({ onCallState() {}, onPeerLeft() {}, onLocalStream() {}, onError() {} }, { kind: 'voice' });
    const oldTrack = fakeTrack('audio');
    const replacementTrack = fakeTrack('audio');
    const prior = new TestMediaStream([oldTrack]) as unknown as MediaStream;
    const incoming = new TestMediaStream([replacementTrack]) as unknown as MediaStream;
    const stagedEncoder = { destroy: vi.fn() };
    const installedEncoders: Array<{ destroy: ReturnType<typeof vi.fn>; framesEncoded: number }> = [];
    const stagedPipeline = {
      context: {}, encoder: stagedEncoder, quality: 2 as const, noiseSuppress: true,
      source: {}, processor: {}, activate: vi.fn(), dispose: vi.fn(),
    };
    const oldPipeline = { ...stagedPipeline, encoder: { destroy: vi.fn() }, dispose: vi.fn() };
    let finishPreparation!: (value: typeof stagedPipeline) => void;
    const internals = engine as unknown as {
      callState: string; activeRoom: string | null; localStream: MediaStream | null; localKind: string | null;
      callOperationGeneration: number; client: unknown; audioPipeline: typeof oldPipeline | null; audEnc: unknown;
      audioQuality: 0 | 1 | 2; wasm: { audioEncoder: ReturnType<typeof vi.fn> } | null;
      applyNetworkBitrate(bps: number): void;
      prepareAudioPipeline(stream: MediaStream, context: AudioContext | null, current: () => boolean): Promise<typeof stagedPipeline>;
      startSpeakingMeter(stream: MediaStream): void;
    };
    internals.callState = 'in_call'; internals.activeRoom = '#room'; internals.localStream = prior; internals.localKind = 'voice';
    internals.callOperationGeneration = 3; internals.client = null; internals.audioPipeline = oldPipeline; internals.audEnc = oldPipeline.encoder;
    internals.audioQuality = 2;
    internals.wasm = { audioEncoder: vi.fn((_rate, quality) => {
      expect(quality).toBe(0);
      const encoder = { destroy: vi.fn(), framesEncoded: 0 };
      installedEncoders.push(encoder);
      return encoder;
    }) };
    vi.spyOn(internals, 'prepareAudioPipeline').mockImplementation(() => new Promise(resolve => { finishPreparation = resolve; }));
    vi.spyOn(internals, 'startSpeakingMeter').mockImplementation(() => {});

    const switching = engine.replaceAudioInput(incoming, null);
    // A poor-network observation changes the effective audio policy while
    // capture/context setup awaits.
    internals.applyNetworkBitrate(0);
    finishPreparation(stagedPipeline);
    await expect(switching).resolves.toBe(true);
    expect(internals.wasm.audioEncoder).toHaveBeenCalledTimes(2);
    expect(stagedEncoder.destroy).toHaveBeenCalledOnce();
    expect(stagedPipeline.encoder).toBe(installedEncoders[1]);
    expect(stagedPipeline.quality).toBe(0);
    expect(engine.getQualityObservation().observedAudioQuality).toBe(0);
  });

  it('keeps old stream and pipeline when pre-transfer quality reconciliation fails', async () => {
    vi.stubGlobal('MediaStream', TestMediaStream);
    const engine = new CadenceMediaEngine({ onCallState() {}, onPeerLeft() {}, onLocalStream() {}, onError() {} }, { kind: 'voice' });
    const oldTrack = fakeTrack('audio');
    const replacementTrack = fakeTrack('audio');
    const prior = new TestMediaStream([oldTrack]) as unknown as MediaStream;
    const incoming = new TestMediaStream([replacementTrack]) as unknown as MediaStream;
    const oldPipeline = { context: {}, encoder: {}, quality: 2 as const, noiseSuppress: true, source: {}, processor: {}, activate() {}, dispose: vi.fn() };
    const stagedPipeline = { ...oldPipeline, encoder: { destroy: vi.fn() }, dispose: vi.fn() };
    const internals = engine as unknown as {
      callState: string; activeRoom: string | null; localStream: MediaStream | null; localKind: string | null;
      callOperationGeneration: number; client: unknown; audioPipeline: typeof oldPipeline | null; audEnc: unknown;
      audioQuality: 0 | 1 | 2; wasm: { audioEncoder: ReturnType<typeof vi.fn> } | null;
      prepareAudioPipeline(stream: MediaStream, context: AudioContext | null, current: () => boolean): Promise<typeof stagedPipeline>;
    };
    internals.callState = 'in_call'; internals.activeRoom = '#room'; internals.localStream = prior; internals.localKind = 'voice';
    internals.callOperationGeneration = 4; internals.client = null; internals.audioPipeline = oldPipeline; internals.audEnc = oldPipeline.encoder;
    internals.audioQuality = 0; internals.wasm = { audioEncoder: vi.fn(() => { throw new Error('allocation failed'); }) };
    vi.spyOn(internals, 'prepareAudioPipeline').mockResolvedValue(stagedPipeline);

    await expect(engine.replaceAudioInput(incoming, null)).resolves.toBe(false);
    expect(internals.localStream).toBe(prior);
    expect(internals.audioPipeline).toBe(oldPipeline);
    expect(oldPipeline.dispose).not.toHaveBeenCalled();
    expect(replacementTrack.stop).toHaveBeenCalledOnce();
    expect(stagedPipeline.dispose).toHaveBeenCalledOnce();
  });

  it('cancels a pending replacement promptly and never stops borrowed video tracks', async () => {
    vi.stubGlobal('MediaStream', TestMediaStream);
    const engine = new CadenceMediaEngine({ onCallState() {}, onPeerLeft() {}, onLocalStream() {}, onError() {} }, { kind: 'voice' });
    const oldTrack = fakeTrack('audio');
    const borrowedVideo = fakeTrack('video');
    const replacementTrack = fakeTrack('audio');
    const prior = new TestMediaStream([oldTrack, borrowedVideo]) as unknown as MediaStream;
    const incoming = new TestMediaStream([replacementTrack]) as unknown as MediaStream;
    let contextState: AudioContextState = 'running';
    const context = { get state() { return contextState; }, close: vi.fn(async () => { contextState = 'closed'; }) } as unknown as AudioContext;
    const stagedPipeline = { context: {}, encoder: {}, quality: 2 as const, noiseSuppress: true, source: {}, processor: {}, activate() {}, dispose: vi.fn() };
    let finishPreparation!: (value: typeof stagedPipeline) => void;
    const internals = engine as unknown as {
      callState: string; activeRoom: string | null; localStream: MediaStream | null; localKind: string | null;
      callOperationGeneration: number; client: unknown;
      prepareAudioPipeline(stream: MediaStream, context: AudioContext | null, current: () => boolean): Promise<typeof stagedPipeline>;
      advanceCallOperationGeneration(): number;
    };
    internals.callState = 'in_call'; internals.activeRoom = '#room'; internals.localStream = prior; internals.localKind = 'voice';
    internals.callOperationGeneration = 9; internals.client = null;
    vi.spyOn(internals, 'prepareAudioPipeline').mockImplementation(() => new Promise(resolve => { finishPreparation = resolve; }));

    const switching = engine.replaceAudioInput(incoming, context);
    internals.advanceCallOperationGeneration();
    await expect(switching).resolves.toBe(false);
    expect(replacementTrack.stop).toHaveBeenCalledOnce();
    expect(borrowedVideo.stop).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
    const lateDispose = vi.fn();
    finishPreparation({ ...stagedPipeline, dispose: lateDispose });
    await Promise.resolve();
    expect(lateDispose).toHaveBeenCalledOnce();
    expect(internals.localStream).toBe(prior);
  });

  it('applies persistent mute intent when a fresh stream is adopted', () => {
    vi.stubGlobal('MediaStream', TestMediaStream);
    const engine = new CadenceMediaEngine({ onCallState() {}, onPeerLeft() {}, onLocalStream() {}, onError() {} }, { kind: 'voice' });
    const track = fakeTrack('audio');
    const stream = new TestMediaStream([track]) as unknown as MediaStream;
    const internals = engine as unknown as { adoptLocalStream(stream: MediaStream, kind: 'voice'): MediaStream };
    engine.setMuted(true);
    internals.adoptLocalStream(stream, 'voice');
    expect(track.enabled).toBe(false);
  });
});
