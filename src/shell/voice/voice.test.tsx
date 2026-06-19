/**
 * voice.test.tsx — Unit tests for the voice/video stage components.
 *
 * Coverage:
 *   VoiceStage  — renders a tile per participant (self + peers)
 *   ParticipantTile — speaking ring, role badges, mute badge
 *   VoiceBar    — mute button calls toggleMute, leave calls leaveVoiceChannel
 *
 * Store seeding: store.setState(…, true) with a Partial<OnyxState> that
 * includes voice and channels entries. Actions are vi.spyOn-mocked where
 * needed; the real zustand vanilla store is used otherwise.
 *
 * AAA structure throughout.
 */

import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import type { SuimyakuPeerState } from '@/lib/suimyaku-media/types';
import { VoiceStage } from './VoiceStage';
import { ParticipantTile } from './ParticipantTile';
import { VoiceBar } from './VoiceBar';

// ── Helpers ───────────────────────────────────────────────────────────────────

const initialState = store.getInitialState();

function makeChannelUser(nick: string, modes: string[] = []): ChannelUser {
  return { nick, modes: new Set(modes) };
}

function makeChannel(name: string, users: ChannelUser[]): Channel {
  const usersMap = new Map<string, ChannelUser>();
  for (const u of users) usersMap.set(u.nick.toLowerCase(), u);
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: usersMap,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function makePeer(nick: string, overrides: Partial<SuimyakuPeerState> = {}): SuimyakuPeerState {
  return {
    nick,
    channel: '#media',
    kind: 'voice',
    speaking: false,
    muted: false,
    hasVideo: false,
    canvas: null,
    ...overrides,
  };
}

/**
 * Seed the store with a voice call + a channel with users.
 * Resets store to initialState first to avoid cross-test bleed.
 */
function seedVoiceStore(
  peers: SuimyakuPeerState[],
  channelUsers: ChannelUser[] = [],
  extra: Partial<typeof initialState.voice> = {},
) {
  const peersMap = new Map<string, SuimyakuPeerState>();
  for (const p of peers) peersMap.set(p.nick, p);

  const channel = makeChannel('#media', channelUsers);
  const channels = new Map<string, Channel>();
  channels.set('#media', channel);

  store.setState(
    {
      ...initialState,
      ourNick: 'self',
      channels,
      voice: {
        ...initialState.voice,
        callState: 'in_call',
        callChannel: '#media',
        peers: peersMap,
        muted: false,
        deafened: false,
        cameraOn: false,
        cameraStream: null,
        screenshareActive: false,
        screenshareStream: null,
        videoParticipants: new Map(),
        ...extra,
      },
    },
    true,
  );
}

// ── VoiceStage ────────────────────────────────────────────────────────────────

describe('VoiceStage', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a tile for each participant (self + 2 peers)', () => {
    // Arrange
    const peers = [makePeer('alice'), makePeer('bob')];
    seedVoiceStore(peers, [
      makeChannelUser('self'),
      makeChannelUser('alice'),
      makeChannelUser('bob'),
    ]);

    // Act
    const { getAllByTestId } = render(() => <VoiceStage />);

    // Assert — 3 tiles: self + alice + bob
    const tiles = getAllByTestId('participant-tile');
    expect(tiles).toHaveLength(3);
  });

  it('renders only the self tile when no peers are in the call', () => {
    // Arrange
    seedVoiceStore([], [makeChannelUser('self')]);

    // Act
    const { getAllByTestId } = render(() => <VoiceStage />);

    // Assert — 1 tile: self only
    const tiles = getAllByTestId('participant-tile');
    expect(tiles).toHaveLength(1);
  });

  it('renders 5 tiles for 4 peers + self', () => {
    // Arrange
    const peers = ['alice', 'bob', 'carol', 'dave'].map(n => makePeer(n));
    seedVoiceStore(peers);

    // Act
    const { getAllByTestId } = render(() => <VoiceStage />);

    // Assert
    expect(getAllByTestId('participant-tile')).toHaveLength(5);
  });

  it('shows the stage region with accessible label', () => {
    // Arrange
    seedVoiceStore([]);

    // Act
    const { getByTestId } = render(() => <VoiceStage />);

    // Assert
    const stage = getByTestId('voice-stage');
    expect(stage).toHaveAttribute('aria-label', 'Voice call participants');
  });

  it('does not render a video element when peer has no video stream', () => {
    // Arrange
    seedVoiceStore([makePeer('alice', { hasVideo: false })]);

    // Act
    const { queryAllByTestId } = render(() => <VoiceStage />);

    // Assert — no video elements (hasVideo false, no streams)
    expect(queryAllByTestId('tile-video')).toHaveLength(0);
  });
});

// ── ParticipantTile ───────────────────────────────────────────────────────────

describe('ParticipantTile', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the speaking ring class when peer is speaking', () => {
    // Arrange
    const peer = makePeer('alice', { speaking: true });
    const channelUser = makeChannelUser('alice');

    // Act
    const { getByTestId } = render(() => (
      <ParticipantTile nick="alice" peer={peer} stream={null} channelUser={channelUser} />
    ));

    // Assert — tile has speaking modifier
    const tile = getByTestId('participant-tile');
    expect(tile.className).toContain('voice-tile--speaking');
    expect(tile).toHaveAttribute('data-speaking', 'true');
  });

  it('does not have the speaking class when peer is not speaking', () => {
    // Arrange
    const peer = makePeer('alice', { speaking: false });

    // Act
    const { getByTestId } = render(() => (
      <ParticipantTile nick="alice" peer={peer} stream={null} channelUser={undefined} />
    ));

    // Assert
    const tile = getByTestId('participant-tile');
    expect(tile.className).not.toContain('voice-tile--speaking');
  });

  it('renders the owner role badge (~) for mode q user', () => {
    // Arrange
    const peer = makePeer('alice');
    const channelUser = makeChannelUser('alice', ['q']);

    // Act
    const { getByTestId } = render(() => (
      <ParticipantTile nick="alice" peer={peer} stream={null} channelUser={channelUser} />
    ));

    // Assert
    const badge = getByTestId('role-badge-owner');
    expect(badge).toBeDefined();
    expect(badge.textContent).toBe('~');
    expect(badge.className).toContain('voice-tile__role--owner');
  });

  it('renders the op role badge (@) for mode o user', () => {
    // Arrange
    const peer = makePeer('bob');
    const channelUser = makeChannelUser('bob', ['o']);

    // Act
    const { getByTestId } = render(() => (
      <ParticipantTile nick="bob" peer={peer} stream={null} channelUser={channelUser} />
    ));

    // Assert
    const badge = getByTestId('role-badge-op');
    expect(badge.textContent).toBe('@');
    expect(badge.className).toContain('voice-tile__role--op');
  });

  it('renders the voice role badge (+) for mode v user', () => {
    // Arrange
    const peer = makePeer('carol');
    const channelUser = makeChannelUser('carol', ['v']);

    // Act
    const { getByTestId } = render(() => (
      <ParticipantTile nick="carol" peer={peer} stream={null} channelUser={channelUser} />
    ));

    // Assert
    const badge = getByTestId('role-badge-voice');
    expect(badge.textContent).toBe('+');
    expect(badge.className).toContain('voice-tile__role--voice');
  });

  it('renders no role badge when user has no privileged modes', () => {
    // Arrange
    const peer = makePeer('dave');
    const channelUser = makeChannelUser('dave');

    // Act
    const { queryByTestId } = render(() => (
      <ParticipantTile nick="dave" peer={peer} stream={null} channelUser={channelUser} />
    ));

    // Assert
    expect(queryByTestId('role-badge-owner')).toBeNull();
    expect(queryByTestId('role-badge-op')).toBeNull();
    expect(queryByTestId('role-badge-voice')).toBeNull();
  });

  it('shows mute badge when peer is muted', () => {
    // Arrange
    const peer = makePeer('alice', { muted: true });

    // Act
    const { getByTitle } = render(() => (
      <ParticipantTile nick="alice" peer={peer} stream={null} channelUser={undefined} />
    ));

    // Assert
    expect(getByTitle('Muted')).toBeDefined();
  });

  it('does not show mute badge when peer is not muted', () => {
    // Arrange
    const peer = makePeer('alice', { muted: false });

    // Act
    const { queryByTitle } = render(() => (
      <ParticipantTile nick="alice" peer={peer} stream={null} channelUser={undefined} />
    ));

    // Assert
    expect(queryByTitle('Muted')).toBeNull();
  });

  it('marks self tile with [you] label', () => {
    // Act
    const { getByTestId } = render(() => (
      <ParticipantTile nick="self" peer={null} stream={null} isSelf channelUser={undefined} />
    ));

    // Assert
    const tile = getByTestId('participant-tile');
    expect(tile.textContent).toContain('[you]');
  });

  it('has voice-tile--self class on the self tile', () => {
    // Act
    const { getByTestId } = render(() => (
      <ParticipantTile nick="self" peer={null} stream={null} isSelf channelUser={undefined} />
    ));

    // Assert
    expect(getByTestId('participant-tile').className).toContain('voice-tile--self');
  });
});

// ── VoiceBar ──────────────────────────────────────────────────────────────────

describe('VoiceBar', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
  });

  it('does not render when callState is idle', () => {
    // Arrange — store is at initialState (callState: 'idle')

    // Act
    const { queryByTestId } = render(() => <VoiceBar />);

    // Assert — bar is hidden
    expect(queryByTestId('voice-bar')).toBeNull();
  });

  it('renders the bar when callState is in_call', () => {
    // Arrange
    seedVoiceStore([]);

    // Act
    const { getByTestId } = render(() => <VoiceBar />);

    // Assert
    expect(getByTestId('voice-bar')).toBeDefined();
  });

  it('mute button calls toggleMute and reflects muted state', () => {
    // Arrange
    seedVoiceStore([]);
    const toggleMuteSpy = vi.spyOn(store.getState(), 'toggleMute').mockImplementation(() => {
      store.setState(s => ({ voice: { ...s.voice, muted: !s.voice.muted } }));
    });

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    const muteBtn = getByTestId('mute-button');

    // Initially not muted
    expect(muteBtn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(muteBtn);

    // Assert — spy was called
    expect(toggleMuteSpy).toHaveBeenCalledOnce();

    // State update reflected
    expect(muteBtn).toHaveAttribute('aria-pressed', 'true');

    toggleMuteSpy.mockRestore();
  });

  it('deafen button calls toggleDeafen', () => {
    // Arrange
    seedVoiceStore([]);
    const toggleDeafenSpy = vi.spyOn(store.getState(), 'toggleDeafen').mockImplementation(() => {});

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    fireEvent.click(getByTestId('deafen-button'));

    // Assert
    expect(toggleDeafenSpy).toHaveBeenCalledOnce();

    toggleDeafenSpy.mockRestore();
  });

  it('camera button calls toggleCamera', async () => {
    // Arrange
    seedVoiceStore([]);
    const toggleCameraSpy = vi.spyOn(store.getState(), 'toggleCamera').mockResolvedValue();

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    fireEvent.click(getByTestId('camera-button'));

    // Assert
    expect(toggleCameraSpy).toHaveBeenCalledOnce();

    toggleCameraSpy.mockRestore();
  });

  it('leave button calls leaveVoiceChannel', () => {
    // Arrange
    seedVoiceStore([]);
    const leaveSpy = vi.spyOn(store.getState(), 'leaveVoiceChannel').mockImplementation(() => {
      store.setState(s => ({ voice: { ...s.voice, callState: 'idle' } }));
    });

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    fireEvent.click(getByTestId('leave-button'));

    // Assert
    expect(leaveSpy).toHaveBeenCalledOnce();

    leaveSpy.mockRestore();
  });

  it('mute button aria-label reads "Unmute microphone" when muted', () => {
    // Arrange
    seedVoiceStore([], [], { muted: true });

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    const muteBtn = getByTestId('mute-button');

    // Assert
    expect(muteBtn).toHaveAttribute('aria-label', 'Unmute microphone');
    expect(muteBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('screenshare button shows active state when screenshareActive', () => {
    // Arrange
    const fakeStream = { getTracks: () => [] } as unknown as MediaStream;
    seedVoiceStore([], [], { screenshareActive: true, screenshareStream: fakeStream });

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    const btn = getByTestId('screenshare-button');

    // Assert
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveAttribute('aria-label', 'Stop sharing screen');
  });

  it('shows the call channel name in the identity zone', () => {
    // Arrange
    seedVoiceStore([]);

    // Act
    const { getByTestId } = render(() => <VoiceBar />);

    // Assert
    expect(getByTestId('voice-bar').textContent).toContain('#media');
  });

  it('renders toolbar with accessible label', () => {
    // Arrange
    seedVoiceStore([]);

    // Act
    const { getByRole } = render(() => <VoiceBar />);

    // Assert
    const toolbar = getByRole('toolbar', { name: 'Voice call controls' });
    expect(toolbar).toBeDefined();
  });
});
