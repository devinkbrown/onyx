// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel } from '@/lib/irc/types';
import { store } from '@/lib/store/store';
import { AppShell } from './AppShell';

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

function channel(over: Partial<Channel> = {}): Channel {
  return {
    name: '#root', topic: '', topicSetBy: '', topicSetAt: null, modes: '',
    users: new Map(), unread: 3, highlights: 1, createdAt: null, messages: [],
    ...over,
  };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  store.setState({
    ...initialState,
    connectionStatus: 'connected',
    activeView: { kind: 'channel', channel: '#root' },
    channels: new Map([['#root', channel()]]),
  }, true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  store.setState(initialState, true);
  localStorage.clear();
});

describe('AppShell room current', () => {
  it('projects the active store room and unread state without making an E2EE claim', () => {
    render(() => <AppShell />);
    const current = screen.getByLabelText('Room current: #root, 3 unread · 1 mention');
    expect(current).toHaveAttribute('data-shell-current-kind', 'room');
    expect(current.textContent).toContain('Room current');
    expect(current.textContent).not.toMatch(/encrypt|secure|protect/i);
  });

  it('returns focus to the Context trigger when the rail closes', async () => {
    render(() => <AppShell />);
    const trigger = screen.getByRole('button', { name: 'Context' });
    fireEvent.click(trigger);
    const close = screen.getByRole('button', { name: 'Close room context' });
    close.focus();
    fireEvent.click(close);
    await Promise.resolve();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
