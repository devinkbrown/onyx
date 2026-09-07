// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { store } from '@/lib/store';
import { StagePanel } from './StagePanel';
import type { Channel } from '@/lib/irc/types';

const initial = store.getInitialState();

function room(modes = ''): Channel {
  return {
    name: '#stage',
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes,
    users: new Map([['me', { nick: 'me', modes: new Set(['o']), away: false }]]),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

beforeEach(() => {
  store.setState(initial, true);
  store.setState({
    connectionStatus: 'connected',
    ourNick: 'me',
    activeView: { kind: 'channel', channel: '#stage' },
    channels: new Map([['#stage', room()]]),
    client: { sendRaw: vi.fn(() => true), isupport: {}, negotiatedCaps: new Set() } as never,
  });
});

afterEach(() => {
  cleanup();
  store.setState(initial, true);
});

describe('StagePanel', () => {
  it('lets an op start a stage in the active room', () => {
    const start = vi.spyOn(store.getState(), 'startStage');
    render(() => <StagePanel />);
    expect(screen.getByRole('status', { name: 'Stage controls available' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('stage-start'));
    expect(start).toHaveBeenCalledWith('#stage');
    start.mockRestore();
  });

  it('names the unavailable reconnecting state and disables mutations', () => {
    store.setState({ connectionStatus: 'connecting' });
    render(() => <StagePanel />);
    expect(screen.getByRole('status', { name: /Stage controls unavailable while reconnecting/i })).toBeInTheDocument();
    expect(screen.getByText(/unavailable while Onyx reconnects/i)).toBeInTheDocument();
    expect(screen.getByTestId('stage-start')).toBeDisabled();
  });

  it('keeps speaking and microphone readiness truthful for an active audience member', () => {
    store.setState({
      stageChannel: '#stage',
      channelProps: new Map([['#stage', { STAGE: '1' }]]),
    });
    render(() => <StagePanel />);
    expect(screen.getByText(/you are in the audience/i)).toBeInTheDocument();
    expect(screen.getByText(/microphone access are managed separately/i)).toBeInTheDocument();
    expect(screen.getByTestId('stage-hand')).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows raised hands and invite for the host', () => {
    store.setState({
      stageChannel: '#stage',
      isStageHost: true,
      isStageSpeaker: true,
      stageRaisedHands: ['alice'],
      channelProps: new Map([['#stage', { STAGE: '1' }]]),
    });
    const invite = vi.spyOn(store.getState(), 'inviteToSpeak');
    render(() => <StagePanel />);
    expect(screen.getByTestId('stage-hands')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('stage-invite-alice'));
    expect(invite).toHaveBeenCalledWith('alice');
    invite.mockRestore();
  });

  it('offers accept/decline when a speak invite is pending', () => {
    store.setState({
      stageChannel: '#stage',
      isStageHost: false,
      isStageSpeaker: false,
      pendingSpeakInvite: 'host',
      channelProps: new Map([['#stage', { STAGE: '1' }]]),
    });
    const accept = vi.spyOn(store.getState(), 'acceptSpeakInvite');
    render(() => <StagePanel />);
    expect(screen.getByRole('alert')).toHaveTextContent(/host invited you to speak/i);
    fireEvent.click(screen.getByTestId('stage-accept'));
    expect(accept).toHaveBeenCalled();
    accept.mockRestore();
  });
});
