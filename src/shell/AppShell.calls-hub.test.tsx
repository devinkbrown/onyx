// SPDX-License-Identifier: AGPL-3.0-or-later
/** AppShell → standalone CallsHub coherence and truthfulness regression tests. */

import 'fake-indexeddb/auto';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CallState } from '@/lib/cadence-media/types';
import { store } from '@/lib/store/store';

import { AppShell, _setMediaModuleLoaderForTests } from './AppShell';

vi.mock('@/media/useCadenceMedia', () => ({ mountMedia: vi.fn() }));
vi.mock('./voice/VoiceStage', () => ({ VoiceStage: () => null }));
vi.mock('./voice/VoiceBar', () => ({ VoiceBar: () => null }));
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
});
