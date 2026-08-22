// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import { store } from '@/lib/store/store';

const platformMocks = vi.hoisted(() => ({
  surface: 'browser' as 'browser' | 'pwa' | 'zig-desktop',
  standalone: false,
  userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0 Mobile Safari/537.36',
}));

vi.mock('@/lib/platform', () => ({
  detectClientSurface: () => platformMocks.surface,
  isStandaloneDisplayMode: () => platformMocks.standalone,
}));

vi.mock('./addToHomeScreen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./addToHomeScreen')>();
  return {
    ...actual,
    detectA2hsPlatform: () => actual.detectA2hsPlatform({ userAgent: platformMocks.userAgent }),
  };
});

import { AddToHomeScreenSheet } from './AddToHomeScreenSheet';
import {
  A2HS_IOS_LEDE,
  A2HS_IOS_PUSH,
  A2HS_TITLE,
  captureBeforeInstallPrompt,
  dismissAddToHomeScreen,
  markHomeScreenMessageSent,
  rememberHomeScreenVisit,
  resetAddToHomeScreenState,
} from './addToHomeScreen';

const initialState = store.getInitialState();

function emptyChannel(): Channel {
  return {
    name: '#general',
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map<string, ChannelUser>(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [{
      id: 'join-1',
      time: new Date('2026-08-22T12:00:00.000Z'),
      from: 'me',
      text: 'joined',
      type: 'join',
      target: '#general',
    }],
  };
}

function sentMessage(): ChatMessage {
  return {
    id: 'm1',
    time: new Date('2026-08-22T12:00:00.000Z'),
    from: 'me',
    text: 'hello',
    type: 'msg',
    target: '#general',
  };
}

function promptEvent(prompt = vi.fn(async () => {})) {
  return {
    preventDefault: vi.fn(),
    prompt,
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  };
}

describe('AddToHomeScreenSheet', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    resetAddToHomeScreenState();
    localStorage.clear();
    sessionStorage.clear();
    platformMocks.surface = 'browser';
    platformMocks.standalone = false;
    platformMocks.userAgent = 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0 Mobile Safari/537.36';
  });

  afterEach(() => {
    cleanup();
    resetAddToHomeScreenState();
    store.setState(initialState, true);
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows no install UI on first paint', () => {
    render(() => <AddToHomeScreenSheet />);
    expect(screen.queryByTestId('a2hs-sheet')).not.toBeInTheDocument();
    expect(screen.queryByText(A2HS_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add to home screen/i })).not.toBeInTheDocument();
  });

  it('can offer Chromium Add to Home Screen after a sent message and a captured prompt', () => {
    const event = promptEvent();
    captureBeforeInstallPrompt(event);
    markHomeScreenMessageSent();

    render(() => <AddToHomeScreenSheet />);

    expect(screen.getByTestId('a2hs-sheet')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: A2HS_TITLE })).toBeInTheDocument();
    expect(screen.getByTestId('a2hs-add')).toHaveTextContent('Add to Home Screen');
    expect(screen.getByTestId('a2hs-sheet').textContent).not.toMatch(/install the app/i);
    expect(event.prompt).not.toHaveBeenCalled();
  });

  it('offers iOS Share → Add to Home Screen copy with no fake install button', () => {
    platformMocks.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
    markHomeScreenMessageSent();

    render(() => <AddToHomeScreenSheet />);

    const sheet = screen.getByTestId('a2hs-sheet');
    expect(sheet).toHaveTextContent(A2HS_IOS_LEDE);
    expect(sheet).toHaveTextContent(A2HS_IOS_PUSH);
    expect(sheet.textContent).not.toMatch(/beforeinstallprompt/i);
    expect(sheet.textContent).not.toMatch(/install the app/i);
    expect(screen.queryByTestId('a2hs-add')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add to home screen/i })).not.toBeInTheDocument();
  });

  it('stays dismissed after Not now', () => {
    const event = promptEvent();
    captureBeforeInstallPrompt(event);
    markHomeScreenMessageSent();

    const view = render(() => <AddToHomeScreenSheet />);
    fireEvent.click(screen.getByTestId('a2hs-dismiss'));
    expect(screen.queryByTestId('a2hs-sheet')).not.toBeInTheDocument();

    view.unmount();
    captureBeforeInstallPrompt(event);
    render(() => <AddToHomeScreenSheet />);
    expect(screen.queryByTestId('a2hs-sheet')).not.toBeInTheDocument();
  });

  it('can offer after a later visit once a room is joined', () => {
    rememberHomeScreenVisit();
    sessionStorage.clear();
    rememberHomeScreenVisit();
    captureBeforeInstallPrompt(promptEvent());
    store.setState({
      ourNick: 'me',
      channels: new Map([['#general', emptyChannel()]]),
    });

    render(() => <AddToHomeScreenSheet />);
    expect(screen.getByTestId('a2hs-sheet')).toBeInTheDocument();
  });

  it('does not treat a first-visit joined room as enough, until a message is sent', () => {
    captureBeforeInstallPrompt(promptEvent());
    store.setState({
      ourNick: 'me',
      channels: new Map([['#general', emptyChannel()]]),
    });
    render(() => <AddToHomeScreenSheet />);
    expect(screen.queryByTestId('a2hs-sheet')).not.toBeInTheDocument();

    store.setState({
      ourNick: 'me',
      channels: new Map([['#general', {
        ...emptyChannel(),
        messages: [sentMessage()],
      }]]),
    });
    expect(screen.getByTestId('a2hs-sheet')).toBeInTheDocument();
  });

  it('does not offer inside an installed PWA', () => {
    platformMocks.surface = 'pwa';
    platformMocks.standalone = true;
    markHomeScreenMessageSent();
    captureBeforeInstallPrompt(promptEvent());
    render(() => <AddToHomeScreenSheet />);
    expect(screen.queryByTestId('a2hs-sheet')).not.toBeInTheDocument();
  });
});

describe('Add to Home Screen dismiss persistence', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    resetAddToHomeScreenState();
    localStorage.clear();
    sessionStorage.clear();
    platformMocks.surface = 'browser';
    platformMocks.standalone = false;
    platformMocks.userAgent = 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0 Mobile Safari/537.36';
  });

  afterEach(() => {
    cleanup();
    resetAddToHomeScreenState();
    store.setState(initialState, true);
    localStorage.clear();
    sessionStorage.clear();
  });

  it('does not reopen after a persisted dismiss in a new session', () => {
    dismissAddToHomeScreen();
    markHomeScreenMessageSent();
    captureBeforeInstallPrompt(promptEvent());
    render(() => <AddToHomeScreenSheet />);
    expect(screen.queryByTestId('a2hs-sheet')).not.toBeInTheDocument();
  });
});
