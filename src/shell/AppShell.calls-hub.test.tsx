// SPDX-License-Identifier: AGPL-3.0-or-later
/** AppShell → standalone CallsHub coherence and truthfulness regression tests. */

import 'fake-indexeddb/auto';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CallState } from '@/lib/cadence-media/types';
import { store } from '@/lib/store/store';

import { AppShell, _setMediaModuleLoaderForTests } from './AppShell';

const voiceBarHarness = vi.hoisted(() => ({ real: false }));

vi.mock('@/media/useCadenceMedia', () => ({ mountMedia: vi.fn() }));
vi.mock('./voice/VoiceStage', () => ({ VoiceStage: () => null }));
vi.mock('./voice/VoiceBar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./voice/VoiceBar')>();
  const { createComponent } = await import('solid-js');
  return {
    ...actual,
    VoiceBar: (props: object) => (
      voiceBarHarness.real
        ? createComponent(actual.VoiceBar, props)
        : null
    ),
  };
});
vi.mock('./voice/VoicePip', () => ({ VoicePip: () => null }));
vi.mock('./voice/settings/VoiceSettings', () => ({ VoiceSettings: () => null }));
vi.mock('./voice/overlays/IncomingCallOverlay', () => ({ IncomingCallOverlay: () => null }));
vi.mock('./voice/overlays/OutgoingCallOverlay', () => ({ OutgoingCallOverlay: () => null }));
vi.mock('./voice/overlays/CaptionsOverlay', () => ({ CaptionsOverlay: () => null }));
vi.mock('./voice/overlays/ReactionsOverlay', () => ({ ReactionsOverlay: () => null }));

const initialState = store.getInitialState();

function stubDesktopViewport(): void {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

async function mountCallsHub(voice: {
  callState: CallState;
  callChannel: string | null;
  callWith: string;
  callStartedAt: number | null;
}): Promise<HTMLElement> {
  store.setState({
    activeView: { kind: 'home' },
    connectionStatus: 'connected',
    voice: { ...store.getState().voice, ...voice },
  });

  render(() => <AppShell />);
  const desktopNav = screen.getByRole('navigation', { name: 'Primary' });
  fireEvent.click(within(desktopNav).getByRole('button', { name: 'Calls' }));
  await screen.findByTestId('calls-hub-status');
  return screen.getByRole('main');
}

beforeEach(() => {
  store.setState(initialState, true);
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  stubDesktopViewport();
});

afterEach(() => {
  cleanup();
  _setMediaModuleLoaderForTests();
  vi.unstubAllGlobals();
  voiceBarHarness.real = false;
});

describe('AppShell standalone CallsHub integration', () => {
  it('imports the shared component and has no private CallsHub implementation', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/shell/AppShell.tsx'),
      'utf8',
    );

    expect(source).toMatch(/import\('\.\/CallsHub'\)/u);
    expect(source).not.toMatch(/function\s+CallsHub\s*\(/u);
    expect(source).toContain("import { retryableLazy } from '@/app/StaleChunkRecovery';");
    expect(source).toMatch(
      /const CallsHub = retryableLazy<any>\(\(\) => import\('\.\/CallsHub'\)\.then\(\(m\) => \(\{ default: m\.CallsHub \}\)\), 'calls'\);/u,
    );
    expect(source).toContain('callState={voice().callState}');
    expect(source).toContain('callChannel={voice().callChannel}');
    expect(source).toContain('callWith={voice().callWith}');
    expect(source).toContain('callStartedAt={voice().callStartedAt}');
  });

  it('mounts provisional in-call truth without promoting it to established', async () => {
    const hub = await mountCallsHub({
      callState: 'in_call',
      callChannel: '#lounge',
      callWith: '',
      callStartedAt: null,
    });

    expect(hub).toHaveAttribute('data-call-presentation', 'provisional');
    expect(within(hub).getByRole('heading', { name: 'Connecting to the call…' })).toBeInTheDocument();
    expect(within(hub).getByTestId('calls-hub-status')).toHaveTextContent('Connecting');
    expect(within(hub).getByText(/Media is not established yet/i)).toBeInTheDocument();
    expect(within(hub).queryByRole('heading', { name: 'Your call is still here.' })).toBeNull();
  });

  it('mounts ringing truth even when a stale start timestamp is present', async () => {
    const hub = await mountCallsHub({
      callState: 'ringing_in',
      callChannel: null,
      callWith: 'alice',
      callStartedAt: 1_700_000_000_000,
    });

    expect(hub).toHaveAttribute('data-call-presentation', 'ringing_in');
    expect(within(hub).getByRole('heading', { name: 'Incoming call' })).toBeInTheDocument();
    expect(within(hub).getByTestId('calls-hub-status')).toHaveTextContent('Incoming');
    expect(within(hub).getByTestId('calls-hub-status')).toHaveTextContent('alice');
    expect(within(hub).queryByRole('button', { name: 'Return to call' })).toBeNull();
    expect(within(hub).queryByText('Your call is still here.')).toBeNull();
  });

  it('does not turn an established call into a media-protection claim', async () => {
    const hub = await mountCallsHub({
      callState: 'in_call',
      callChannel: '#lounge',
      callWith: '',
      callStartedAt: 1_700_000_000_000,
    });

    expect(hub).toHaveAttribute('data-call-presentation', 'established');
    expect(within(hub).getByRole('heading', { name: 'Your call is still here.' })).toBeInTheDocument();
    expect(hub.textContent).not.toMatch(/end-to-end|encrypted|secure call|protected call/iu);
  });

  it.each([null, 1_700_000_000_000])('returns to an existing DM call with start time %s without initiating media', async (callStartedAt) => {
    const startCall = vi.spyOn(store.getState(), 'startDmCall').mockImplementation(() => {});
    const joinVoice = vi.spyOn(store.getState(), 'joinVoiceChannel').mockImplementation(async () => {});
    const acceptCall = vi.spyOn(store.getState(), 'acceptDmCall').mockImplementation(() => {});
    try {
      const hub = await mountCallsHub({
        callState: 'in_call', callChannel: null, callWith: 'alice', callStartedAt,
      });
      const callBefore = store.getState().voice;
      expect(store.getState().activeView).toEqual({ kind: 'home' });
      expect(hub).toHaveAttribute('data-call-presentation', callStartedAt === null ? 'provisional' : 'established');
      fireEvent.click(within(hub).getByRole('button', { name: 'Return to call' }));
      expect(store.getState().activeView).toEqual({ kind: 'dm', nick: 'alice' });
      expect(store.getState().voice).toBe(callBefore);
      expect(startCall).not.toHaveBeenCalled();
      expect(joinVoice).not.toHaveBeenCalled();
      expect(acceptCall).not.toHaveBeenCalled();
    } finally {
      startCall.mockRestore();
      joinVoice.mockRestore();
      acceptCall.mockRestore();
    }
  });
});

const RECORDING_BLOB = new Blob(['saved-audio'], { type: 'audio/webm;codecs=opus' });

async function installAppShellRecording(opts: { deferred?: boolean } = {}) {
  const g = globalThis as unknown as { MediaRecorder?: unknown };
  const previousRecorder = g.MediaRecorder;
  g.MediaRecorder = class {
    static isTypeSupported() { return true; }
  };

  let settleStop = (_blob: Blob | null) => {};
  const startRecording = vi.fn().mockReturnValue({ started: true });
  const stopRecording = opts.deferred
    ? vi.fn().mockImplementation(() => new Promise<Blob | null>((resolve) => {
      settleStop = resolve;
    }))
    : vi.fn().mockResolvedValue(RECORDING_BLOB);

  const { setMountedCadenceMediaEngine } = await import('@/lib/cadence-media/MediaEngine');
  setMountedCadenceMediaEngine({
    startRecording,
    stopRecording,
    getLocalStream: vi.fn().mockReturnValue({ getTracks: () => [] } as unknown as MediaStream),
    leaveRoom: vi.fn(),
    hangup: vi.fn(),
  } as never);

  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:onyx-recording');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  return {
    startRecording,
    stopRecording,
    createObjectURL,
    resolveStop(blob: Blob | null = RECORDING_BLOB) {
      settleStop(blob);
    },
    restore() {
      setMountedCadenceMediaEngine(null);
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
      if (previousRecorder === undefined) {
        Reflect.deleteProperty(globalThis, 'MediaRecorder');
      } else {
        g.MediaRecorder = previousRecorder;
      }
    },
  };
}

describe('AppShell VoiceBar recording ownership', () => {
  beforeEach(() => {
    voiceBarHarness.real = true;
  });

  it('keeps the recording owner mounted through Record then Leave and still saves', async () => {
    const harness = await installAppShellRecording({ deferred: true });
    try {
      store.setState({
        activeView: { kind: 'home' },
        connectionStatus: 'connected',
        ourNick: 'self',
        voice: {
          ...store.getState().voice,
          callState: 'in_call',
          callChannel: '#lounge',
          callStartedAt: Date.now(),
        },
      });
      render(() => <AppShell />);
      await screen.findByTestId('voice-bar');
      fireEvent.click(screen.getByTestId('call-more-button'));
      fireEvent.click(screen.getByTestId('record-button'));
      expect(harness.startRecording).toHaveBeenCalledOnce();

      fireEvent.click(screen.getByTestId('leave-button'));
      expect(screen.queryByTestId('voice-bar')).toBeNull();
      expect(screen.getByTestId('voice-bar-owner')).toHaveAttribute('data-voice-bar-active', 'false');
      expect(screen.getAllByTestId('voice-bar-owner')).toHaveLength(1);
      expect(harness.startRecording).toHaveBeenCalledOnce();

      await waitFor(() => expect(harness.stopRecording).toHaveBeenCalledOnce());
      expect(harness.createObjectURL).not.toHaveBeenCalled();

      harness.resolveStop();
      await waitFor(() => expect(harness.createObjectURL).toHaveBeenCalledOnce());
      await waitFor(() => expect(screen.queryByTestId('voice-bar-owner')).toBeNull());
    } finally {
      harness.restore();
    }
  });

  it('keeps the owner mounted through deferred-blob Stop then Leave and still saves once', async () => {
    const harness = await installAppShellRecording({ deferred: true });
    try {
      store.setState({
        activeView: { kind: 'home' },
        connectionStatus: 'connected',
        ourNick: 'self',
        voice: {
          ...store.getState().voice,
          callState: 'in_call',
          callChannel: '#lounge',
          callStartedAt: Date.now(),
        },
      });
      render(() => <AppShell />);
      await screen.findByTestId('voice-bar');
      fireEvent.click(screen.getByTestId('call-more-button'));
      fireEvent.click(screen.getByTestId('record-button'));
      fireEvent.click(screen.getByTestId('record-button'));
      expect(harness.stopRecording).toHaveBeenCalledOnce();
      expect(harness.createObjectURL).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('leave-button'));
      expect(screen.queryByTestId('voice-bar')).toBeNull();
      expect(screen.getByTestId('voice-bar-owner')).toBeInTheDocument();
      expect(harness.stopRecording).toHaveBeenCalledOnce();
      expect(harness.startRecording).toHaveBeenCalledOnce();

      harness.resolveStop();
      await waitFor(() => expect(harness.createObjectURL).toHaveBeenCalledOnce());
      expect(harness.stopRecording).toHaveBeenCalledOnce();
      await waitFor(() => expect(screen.queryByTestId('voice-bar-owner')).toBeNull());
    } finally {
      harness.restore();
    }
  });
});
