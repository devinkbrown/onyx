// SPDX-License-Identifier: AGPL-3.0-or-later
/** Local recording lifetime: delayed MediaRecorder events vs engine call-end. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IRCClient } from '../irc/client';
import { CadenceMediaEngine } from './MediaEngine';
import type { CadenceMediaCallbacks, CallState } from './types';

type DelayedRecorder = {
  state: 'inactive' | 'recording' | 'paused';
  stopCount: number;
  payload: string;
  ondataavailable: ((ev: { data: Blob }) => void) | null;
  onstop: ((ev: Event) => void) | null;
  start(_timeslice?: number): void;
  stop(): void;
  becomeInactiveNow(): void;
  deliverFinalEvents(): void;
};

type EngineHarness = {
  localStream: MediaStream | null;
  activeRoom: string | null;
  callState: CallState;
};

const recorders: DelayedRecorder[] = [];
let payloadSeq = 0;
let previousRecorder: unknown;

class DelayedMediaRecorder {
  static isTypeSupported(type: string): boolean {
    return type.includes('webm');
  }

  state: DelayedRecorder['state'] = 'inactive';
  stopCount = 0;
  payload: string;
  mimeType: string;
  ondataavailable: DelayedRecorder['ondataavailable'] = null;
  onstop: DelayedRecorder['onstop'] = null;
  private readonly dataListeners: Array<(ev: { data: Blob }) => void> = [];
  private readonly stopListeners: Array<(ev: Event) => void> = [];

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? '';
    payloadSeq += 1;
    this.payload = `rec-${payloadSeq}`;
    recorders.push(this);
  }

  start(_timeslice?: number): void {
    this.state = 'recording';
  }

  addEventListener(type: string, handler: (ev: Event | { data: Blob }) => void): void {
    if (type === 'dataavailable') this.dataListeners.push(handler as (ev: { data: Blob }) => void);
    if (type === 'stop') this.stopListeners.push(handler as (ev: Event) => void);
  }

  becomeInactiveNow(): void {
    this.state = 'inactive';
  }

  deliverFinalEvents(): void {
    this.emitData(new Blob([this.payload], { type: this.mimeType }));
    this.emitStop();
  }

  stop(): void {
    if (this.state === 'inactive') return;
    this.stopCount += 1;
    this.state = 'inactive';
    const payload = this.payload;
    const mimeType = this.mimeType;
    // Spec-shaped delay: stop() returns, then dataavailable, then onstop.
    setTimeout(() => {
      this.emitData(new Blob([payload], { type: mimeType }));
      setTimeout(() => {
        this.emitStop();
      }, 0);
    }, 0);
  }

  private emitData(blob: Blob): void {
    const ev = { data: blob };
    this.ondataavailable?.(ev);
    for (const handler of this.dataListeners) handler(ev);
  }

  private emitStop(): void {
    const ev = new Event('stop');
    this.onstop?.(ev);
    for (const handler of this.stopListeners) handler(ev);
  }
}

function mediaClient(): IRCClient {
  return {
    binaryHandlers: new Set(),
    extraMessageHandlers: new Set(),
    sendRaw: vi.fn(() => true),
    sendBinary: vi.fn(() => true),
  } as unknown as IRCClient;
}

function callbacks(): CadenceMediaCallbacks {
  return {
    onCallState: vi.fn(),
    onPeerLeft: vi.fn(),
    onLocalStream: vi.fn(),
    onError: vi.fn(),
  };
}

function fakeStream(): { stream: MediaStream; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn();
  const track = {
    stop,
    readyState: 'live',
    kind: 'audio',
    enabled: true,
  } as unknown as MediaStreamTrack;
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
  return { stream, stop };
}

function armInCall(engine: CadenceMediaEngine, stream: MediaStream, room = '#lounge'): EngineHarness {
  const internals = engine as unknown as EngineHarness;
  internals.localStream = stream;
  internals.activeRoom = room;
  internals.callState = 'in_call';
  return internals;
}

beforeEach(() => {
  recorders.length = 0;
  payloadSeq = 0;
  const g = globalThis as unknown as { MediaRecorder?: unknown };
  previousRecorder = g.MediaRecorder;
  g.MediaRecorder = DelayedMediaRecorder;
});

afterEach(() => {
  vi.restoreAllMocks();
  const g = globalThis as unknown as { MediaRecorder?: unknown };
  if (previousRecorder === undefined) Reflect.deleteProperty(g, 'MediaRecorder');
  else g.MediaRecorder = previousRecorder;
});

describe('CadenceMediaEngine local recording lifetime', () => {
  it('reports no media without constructing a recorder', async () => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    expect(engine.startRecording()).toEqual({ started: false, reason: 'no-media' });
    expect(recorders).toHaveLength(0);
    expect(await engine.stopRecording()).toBeNull();
  });

  it('reports an unavailable recorder without claiming a capture', async () => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    armInCall(engine, fakeStream().stream);
    Reflect.deleteProperty(globalThis, 'MediaRecorder');
    expect(engine.startRecording()).toEqual({ started: false, reason: 'unavailable' });
    expect(await engine.stopRecording()).toBeNull();
  });

  it.each(['mime', 'constructor', 'start'] as const)('reports a %s failure and permits a later successful start', async (stage) => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    const client = mediaClient();
    engine.setClient(client);
    armInCall(engine, fakeStream().stream);
    const fail = () => { throw new Error('Recorder start failed'); };
    if (stage === 'mime') vi.spyOn(DelayedMediaRecorder, 'isTypeSupported').mockImplementation(fail);
    if (stage === 'start') vi.spyOn(DelayedMediaRecorder.prototype, 'start').mockImplementation(fail);
    if (stage === 'constructor') {
      (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = class extends DelayedMediaRecorder {
        constructor(stream: MediaStream) { super(stream); throw new Error('Constructor failed'); }
      };
    }
    expect(engine.startRecording()).toEqual({ started: false, reason: 'failed' });
    expect(await engine.stopRecording()).toBeNull();
    expect(client.sendRaw).not.toHaveBeenCalled();
    expect(recorders.every((rec) => rec.state === 'inactive')).toBe(true);

    vi.restoreAllMocks();
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = DelayedMediaRecorder;
    expect(engine.startRecording()).toEqual({ started: true });
    expect((await engine.stopRecording())?.size).toBeGreaterThan(0);
  });

  it('refuses a duplicate start and preserves the original capture', async () => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    armInCall(engine, fakeStream().stream);
    expect(engine.startRecording()).toEqual({ started: true });
    expect(engine.startRecording()).toEqual({ started: false, reason: 'already-recording' });
    expect(recorders).toHaveLength(1);
    expect(await (await engine.stopRecording())!.text()).toBe('rec-1');
  });

  it('keeps delayed recorder chunks across leaveRoom until stopRecording consumes them', async () => {
    const client = mediaClient();
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    engine.setClient(client);
    const { stream } = fakeStream();
    armInCall(engine, stream);
    engine.startRecording();

    engine.leaveRoom('#lounge');
    let settled = false;
    const pending = engine.stopRecording().then((blob) => {
      settled = true;
      return blob;
    });
    expect(settled).toBe(false);
    expect(recorders[0]?.stopCount).toBe(1);

    const blob = await pending;
    expect(settled).toBe(true);
    expect(blob).not.toBeNull();
    expect(await blob!.text()).toBe('rec-1');
    expect(await engine.stopRecording()).toBeNull();
  });

  it('coalesces stopRecording then leaveRoom into one recorder.stop and still returns the blob', async () => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    engine.setClient(mediaClient());
    const { stream } = fakeStream();
    armInCall(engine, stream);
    engine.startRecording();

    const first = engine.stopRecording();
    engine.leaveRoom('#lounge');
    const second = engine.stopRecording();

    const [a, b] = await Promise.all([first, second]);
    expect(recorders[0]?.stopCount).toBe(1);
    expect(await a!.text()).toBe('rec-1');
    expect(await b!.text()).toBe('rec-1');
  });

  it('releases local media immediately on call-end before onstop', async () => {
    const cb = callbacks();
    const engine = new CadenceMediaEngine(cb, { kind: 'voice' });
    engine.setClient(mediaClient());
    const { stream, stop } = fakeStream();
    armInCall(engine, stream);
    engine.startRecording();

    engine.leaveRoom('#lounge');

    expect(stop).toHaveBeenCalledOnce();
    expect(cb.onCallState).toHaveBeenCalledWith('idle', '', null);
    expect(engine.getLocalStream()).toBeNull();
    expect(recorders[0]?.stopCount).toBe(1);

    const blob = await engine.stopRecording();
    expect(await blob!.text()).toBe('rec-1');
  });

  it('does not mix a previous recording\'s chunks into a later capture', async () => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    engine.setClient(mediaClient());
    const firstStream = fakeStream();
    armInCall(engine, firstStream.stream);
    engine.startRecording();
    engine.leaveRoom('#lounge');
    const firstBlob = await engine.stopRecording();
    expect(await firstBlob!.text()).toBe('rec-1');

    const secondStream = fakeStream();
    armInCall(engine, secondStream.stream);
    engine.startRecording();
    expect(recorders).toHaveLength(2);
    const secondBlob = await engine.stopRecording();
    expect(await secondBlob!.text()).toBe('rec-2');
  });

  it('does not start a new capture while a previous onstop is still in flight', async () => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    engine.setClient(mediaClient());
    armInCall(engine, fakeStream().stream);
    expect(engine.startRecording()).toEqual({ started: true });
    engine.leaveRoom('#lounge');

    armInCall(engine, fakeStream().stream, '#other');
    expect(engine.startRecording()).toEqual({ started: false, reason: 'finalizing' });
    expect(recorders).toHaveLength(1);
    expect(await (await engine.stopRecording())!.text()).toBe('rec-1');
    expect(engine.startRecording()).toEqual({ started: true });
    expect(await (await engine.stopRecording())!.text()).toBe('rec-2');
  });

  it('does not send a new RECORD_STOP protocol verb', async () => {
    const client = mediaClient();
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    engine.setClient(client);
    armInCall(engine, fakeStream().stream);
    engine.startRecording();
    engine.leaveRoom('#lounge');
    await engine.stopRecording();

    const verbs = (client.sendRaw as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1]);
    expect(verbs).not.toContain('RECORD_STOP');
    expect(verbs).not.toContain('RECORD_START');
  });

  it('hangup preserves the same recording lifetime as leaveRoom', async () => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    engine.setClient(mediaClient());
    const armed = fakeStream();
    armInCall(engine, armed.stream);
    engine.startRecording();

    engine.hangup('alice');
    expect(armed.stop).toHaveBeenCalledOnce();
    const blob = await engine.stopRecording();
    expect(await blob!.text()).toBe('rec-1');
    expect(recorders[0]?.stopCount).toBe(1);
  });

  it('stopRecording returns null when nothing was captured', async () => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    expect(await engine.stopRecording()).toBeNull();
  });

  it('waits for delayed dataavailable+onstop after state is already inactive', async () => {
    const engine = new CadenceMediaEngine(callbacks(), { kind: 'voice' });
    engine.setClient(mediaClient());
    armInCall(engine, fakeStream().stream);
    engine.startRecording();
    const rec = recorders[0];
    expect(rec).toBeDefined();
    rec!.becomeInactiveNow();

    engine.leaveRoom('#lounge');
    let settled = false;
    const pending = engine.stopRecording().then((blob) => {
      settled = true;
      return blob;
    });
    expect(settled).toBe(false);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(rec!.stopCount).toBe(0);

    rec!.deliverFinalEvents();
    const blob = await pending;
    expect(settled).toBe(true);
    expect(await blob!.text()).toBe('rec-1');
    expect(await engine.stopRecording()).toBeNull();
    expect(rec!.stopCount).toBe(0);
  });
});
