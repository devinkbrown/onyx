// SPDX-License-Identifier: AGPL-3.0-or-later
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

import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import type { SuimyakuPeerState } from '@/lib/suimyaku-media/types';
import { VoiceStage } from './VoiceStage';
import { ParticipantTile } from './ParticipantTile';
import { VoiceBar } from './VoiceBar';
import { CallStatusAnnouncer } from './CallStatusAnnouncer';

// ── Helpers ───────────────────────────────────────────────────────────────────

const initialState = store.getInitialState();
const displayMediaDescriptor = Object.getOwnPropertyDescriptor(
  navigator.mediaDevices,
  'getDisplayMedia',
);
const wakeLockDescriptor = Object.getOwnPropertyDescriptor(navigator, 'wakeLock');

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

function setDisplayCapture(method?: MediaDevices['getDisplayMedia']): void {
  if (method) {
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      writable: true,
      value: method,
    });
  } else {
    Reflect.deleteProperty(navigator.mediaDevices, 'getDisplayMedia');
  }
}

function restoreDisplayCapture(): void {
  if (displayMediaDescriptor) {
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', displayMediaDescriptor);
  } else {
    Reflect.deleteProperty(navigator.mediaDevices, 'getDisplayMedia');
  }
}

function setWakeLock(request: (type: 'screen') => Promise<{
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}>): void {
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request },
  });
}

function restoreWakeLock(): void {
  if (wakeLockDescriptor) {
    Object.defineProperty(navigator, 'wakeLock', wakeLockDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'wakeLock');
  }
}

function makeWakeLockSentinel() {
  return {
    released: false,
    release: vi.fn(async () => {}),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

// ── VoiceStage ────────────────────────────────────────────────────────────────

describe('VoiceStage', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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

  it('preserves an unchanged peer video element across unrelated voice state updates', () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }],
      getVideoTracks: () => [],
    } as unknown as MediaStream;
    seedVoiceStore(
      [makePeer('alice', { hasVideo: true })],
      [],
      { videoParticipants: new Map([['alice', stream]]) },
    );

    const view = render(() => <VoiceStage />);
    const initialVideo = view.getByTestId('tile-video') as HTMLVideoElement;
    expect(initialVideo.srcObject).toBe(stream);

    store.getState().setVoiceCallState({ muted: true });

    const currentVideo = view.getByTestId('tile-video') as HTMLVideoElement;
    expect(currentVideo).toBe(initialVideo);
    expect(currentVideo.srcObject).toBe(stream);

    view.unmount();
    expect(initialVideo.srcObject).toBeNull();
    // Media streams are owned by the media engine; a presentational tile only
    // detaches its element and must not stop a track shared with another view.
    expect(stop).not.toHaveBeenCalled();
  });

  it('keeps roster-only cross-node participants in the screenshare filmstrip without duplicates', () => {
    // Arrange — Alice is a decoded peer while differently-cased Alice and bob
    // also arrive through the mesh-wide room roster.
    const screenStream = {
      getTracks: () => [],
      getVideoTracks: () => [],
    } as unknown as MediaStream;
    seedVoiceStore([makePeer('alice')], [], {
      screenshareActive: true,
      screenshareStream: screenStream,
      raisedHands: new Set(['BoB']),
    });
    store.setState({
      voiceChannelParticipants: new Map([['#media', new Set(['self', 'Alice', 'bob'])]]),
      speakingNicks: new Set(['Alice']),
      mutedNicks: new Set(['BOB']),
    });

    // Act
    const { getAllByTestId, getByTestId } = render(() => <VoiceStage />);

    // Assert — one self screenshare primary plus one tile per remote identity.
    expect(getByTestId('voice-stage')).toHaveAttribute('data-layout', 'screenshare');
    const tiles = getAllByTestId('participant-tile');
    expect(tiles).toHaveLength(3);
    expect(tiles.filter(tile => tile.dataset.nick?.toLowerCase() === 'self')).toHaveLength(1);
    expect(tiles.filter(tile => tile.dataset.nick?.toLowerCase() === 'alice')).toHaveLength(1);
    expect(tiles.filter(tile => tile.dataset.nick?.toLowerCase() === 'bob')).toHaveLength(1);
    expect(tiles.find(tile => tile.dataset.nick === 'self')?.className).toContain('voice-tile--screenshare');
    expect(tiles.find(tile => tile.dataset.nick === 'alice')).toHaveAttribute('aria-label', 'alice, speaking');
    expect(tiles.find(tile => tile.dataset.nick === 'bob')).toHaveAttribute('aria-label', 'bob, hand raised, muted');
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

  it('suppresses the speaking ring, data-speaking, and aria for a muted peer', () => {
    // Arrange — a muted peer whose (stale/independent) speaking flag is set.
    // A muted mic transmits nothing, so the tile must not glow "speaking" nor
    // announce it: ring + aria must agree with the bars, which already suppress
    // on mute (speaking && !muted).
    const peer = makePeer('alice', { speaking: true, muted: true });

    // Act
    const { getByTestId } = render(() => (
      <ParticipantTile nick="alice" peer={peer} stream={null} channelUser={undefined} />
    ));

    // Assert
    const tile = getByTestId('participant-tile');
    expect(tile.className).not.toContain('voice-tile--speaking');
    expect(tile).not.toHaveAttribute('data-speaking');
    expect(tile.getAttribute('aria-label')).not.toContain('speaking');
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

  it('reflects the speaking override on the self tile (local VAD)', () => {
    // Arrange — self tile has no per-peer flag; the local detector drives the
    // `speaking` override so the ring can light for the local user.
    const { getByTestId } = render(() => (
      <ParticipantTile nick="self" peer={null} stream={null} isSelf speaking channelUser={undefined} />
    ));

    // Assert
    const tile = getByTestId('participant-tile');
    expect(tile.className).toContain('voice-tile--speaking');
    expect(tile).toHaveAttribute('data-speaking', 'true');
  });

  it('keeps the self tile silent when the speaking override is false', () => {
    // Act
    const { getByTestId } = render(() => (
      <ParticipantTile nick="self" peer={null} stream={null} isSelf speaking={false} channelUser={undefined} />
    ));

    // Assert
    expect(getByTestId('participant-tile').className).not.toContain('voice-tile--speaking');
  });
});

// ── VoiceBar ──────────────────────────────────────────────────────────────────

describe('VoiceBar', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    restoreDisplayCapture();
    restoreWakeLock();
  });

  afterEach(() => {
    cleanup();
    restoreDisplayCapture();
    restoreWakeLock();
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

  it('holds a screen wake lock only for accepted media and releases it on call end', async () => {
    const sentinel = makeWakeLockSentinel();
    const request = vi.fn(async () => sentinel);
    setWakeLock(request);
    const { queryByTestId } = render(() => <VoiceBar />);

    expect(request).not.toHaveBeenCalled();
    store.setState(s => ({ voice: { ...s.voice, callState: 'ringing_in' } }));
    expect(queryByTestId('voice-bar')).toBeDefined();
    expect(request).not.toHaveBeenCalled();

    store.setState(s => ({ voice: { ...s.voice, callState: 'in_call' } }));
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith('screen');

    store.setState(s => ({ voice: { ...s.voice, callState: 'idle' } }));
    await waitFor(() => expect(sentinel.release).toHaveBeenCalledOnce());
  });

  it('releases the active screen wake lock when VoiceBar unmounts', async () => {
    const sentinel = makeWakeLockSentinel();
    const request = vi.fn(async () => sentinel);
    setWakeLock(request);
    seedVoiceStore([]);

    const { unmount } = render(() => <VoiceBar />);
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    unmount();

    await waitFor(() => expect(sentinel.release).toHaveBeenCalledOnce());
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

  it('disables unavailable screen sharing with an exact accessible label and no invocation', () => {
    // Arrange — server media is ready, but this browser cannot capture a display.
    seedVoiceStore([]);
    store.setState({ mediaAvailable: true });
    setDisplayCapture();
    const startSpy = vi.spyOn(store.getState().voice, 'startScreenshare').mockResolvedValue();

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    const btn = getByTestId('screenshare-button');
    fireEvent.click(btn);

    // Assert
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-label', 'Screen sharing unavailable');
    expect(btn).toHaveAttribute('title', 'Screen sharing unavailable');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(startSpy).not.toHaveBeenCalled();
    startSpy.mockRestore();
  });

  it('allows only one pending screen-share request and reports a truthful empty completion', async () => {
    // Arrange
    seedVoiceStore([]);
    store.setState({ mediaAvailable: true });
    setDisplayCapture(vi.fn().mockResolvedValue({} as MediaStream));
    let resolveStart: (() => void) | undefined;
    const pendingStart = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
    const startSpy = vi.spyOn(store.getState().voice, 'startScreenshare').mockReturnValue(pendingStart);

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    const btn = getByTestId('screenshare-button');
    fireEvent.click(btn);
    fireEvent.click(btn);

    // Assert — the permission gap is visibly busy and cannot launch a second prompt.
    expect(startSpy).toHaveBeenCalledOnce();
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveAttribute('aria-label', 'Starting screen sharing');
    expect(getByTestId('screenshare-status')).toHaveTextContent('Requesting screen sharing permission');

    resolveStart?.();
    await waitFor(() => expect(btn).toBeEnabled());
    expect(btn).toHaveAttribute('aria-busy', 'false');
    expect(btn).toHaveAttribute('aria-label', 'Share screen');
    expect(getByTestId('screenshare-status')).toHaveTextContent(
      'Screen sharing did not start. Check browser permission and try again',
    );
    startSpy.mockRestore();
  });

  it('catches a rejected screen-share request and exposes a retryable status', async () => {
    seedVoiceStore([]);
    store.setState({ mediaAvailable: true });
    setDisplayCapture(vi.fn().mockResolvedValue({} as MediaStream));
    const startSpy = vi.spyOn(store.getState().voice, 'startScreenshare')
      .mockRejectedValue(new Error('permission denied'));

    const { getByTestId } = render(() => <VoiceBar />);
    const btn = getByTestId('screenshare-button');
    fireEvent.click(btn);

    await waitFor(() => expect(btn).toBeEnabled());
    expect(startSpy).toHaveBeenCalledOnce();
    expect(getByTestId('screenshare-status')).toHaveTextContent(
      'Screen sharing could not start. Check browser permission and try again',
    );
    expect(btn).toHaveAttribute('aria-label', 'Share screen');
    startSpy.mockRestore();
  });

  it('always keeps active screen sharing stoppable when capabilities disappear', () => {
    // Arrange
    const fakeStream = { getTracks: () => [] } as unknown as MediaStream;
    seedVoiceStore([], [], { screenshareActive: true, screenshareStream: fakeStream });
    store.setState({ mediaAvailable: true });
    setDisplayCapture(vi.fn().mockResolvedValue({} as MediaStream));
    const stopSpy = vi.spyOn(store.getState().voice, 'stopScreenshare').mockImplementation(() => {});

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    const btn = getByTestId('screenshare-button');
    setDisplayCapture();
    store.setState({ mediaAvailable: false });
    fireEvent.click(btn);

    // Assert
    expect(btn).toBeEnabled();
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveAttribute('aria-label', 'Stop sharing screen');
    expect(btn).toHaveAttribute('title', 'Stop sharing screen');
    expect(stopSpy).toHaveBeenCalledOnce();
    stopSpy.mockRestore();
  });

  it('keeps the screenshare control in place while server availability changes', () => {
    // Arrange
    seedVoiceStore([]);
    setDisplayCapture(vi.fn().mockResolvedValue({} as MediaStream));

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    const btn = getByTestId('screenshare-button');
    const originalClass = btn.className;
    store.setState({ mediaAvailable: true });

    // Assert — capability state changes the action, not its toolbar footprint.
    expect(getByTestId('screenshare-button')).toBe(btn);
    expect(btn.className).toBe(originalClass);
    expect(btn.closest('[role="group"]')).toHaveAttribute('aria-label', 'Media controls');
    expect(btn).toBeEnabled();
    expect(btn).toHaveAttribute('aria-label', 'Share screen');
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

  it('raise-hand button calls toggleRaiseHand and reflects pressed state', () => {
    // Arrange
    seedVoiceStore([]);
    const spy = vi.spyOn(store.getState(), 'toggleRaiseHand').mockImplementation(() => {
      store.setState(s => ({ voice: { ...s.voice, handRaised: !s.voice.handRaised } }));
    });

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    const btn = getByTestId('raise-hand-button');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);

    // Assert
    expect(spy).toHaveBeenCalledOnce();
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    spy.mockRestore();
  });

  it('captions button calls toggleCaptions and reflects pressed state', () => {
    // Arrange
    seedVoiceStore([]);
    const spy = vi.spyOn(store.getState(), 'toggleCaptions').mockImplementation(() => {
      store.setState(s => ({ voice: { ...s.voice, captionsEnabled: !s.voice.captionsEnabled } }));
    });

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    const btn = getByTestId('captions-button');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);

    // Assert
    expect(spy).toHaveBeenCalledOnce();
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    spy.mockRestore();
  });

  it('layout button toggles between grid and spotlight', () => {
    // Arrange
    seedVoiceStore([]);
    const spy = vi.spyOn(store.getState(), 'setCallLayout').mockImplementation((l) => {
      store.setState(s => ({ voice: { ...s.voice, callLayout: l } }));
    });

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    const btn = getByTestId('layout-button');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);

    // Assert
    expect(spy).toHaveBeenCalledWith('spotlight');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    spy.mockRestore();
  });

  it('opens spatial audio status when media is available', () => {
    // Arrange
    seedVoiceStore([]);
    store.setState({
      mediaAvailable: true,
      spatialPositions: new Map([
        ['#media', new Map([
          ['alice', { x: -0.5, y: 0, z: 0, t: 1 }],
          ['bob', { x: 0.5, y: 0, z: 0, t: 2 }],
        ])],
      ]),
    });

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    fireEvent.click(getByTestId('spatial-audio-button'));

    // Assert
    expect(screen.getByRole('dialog', { name: 'Spatial audio controls' })).toBeInTheDocument();
    expect(screen.getByText('Spatial audio')).toBeInTheDocument();
    expect(screen.getByText('2 positioned')).toBeInTheDocument();
  });

  it('exposes the spatial pad position to assistive tech and updates it from the keyboard', () => {
    // Arrange — one peer to position; media available so the pad renders.
    seedVoiceStore([makePeer('alice')]);
    store.setState({ mediaAvailable: true });

    // Act — open the popover and reach the pad.
    const { getByTestId } = render(() => <VoiceBar />);
    fireEvent.click(getByTestId('spatial-audio-button'));
    const pad = getByTestId('spatial-audio-pad');

    // Assert — keyboard-operable widget with an exposed value (WCAG 4.1.2).
    expect(pad).toHaveAttribute('tabindex', '0');
    expect(pad).toHaveAttribute('aria-describedby', 'voice-spatial-pad-help');
    expect(pad.getAttribute('aria-label')).toMatch(/^Spatial position for alice: /);

    const readout = getByTestId('spatial-audio-position');
    expect(readout).toHaveAttribute('aria-live', 'polite');
    expect(readout).toHaveTextContent('Centered');

    // Arrow keys move the source and the readout announces the new position.
    fireEvent.keyDown(pad, { key: 'ArrowRight' });
    expect(readout).toHaveTextContent(/right/i);
    expect(pad.getAttribute('aria-label')).toMatch(/right/i);
  });

  it('disables spatial audio controls when media is unavailable', () => {
    // Arrange
    seedVoiceStore([]);

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    const btn = getByTestId('spatial-audio-unavailable-button');

    // Assert
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-label', 'Spatial audio unavailable');
  });

  it('settings button calls openVoiceSettings', () => {
    // Arrange
    seedVoiceStore([]);
    const spy = vi.spyOn(store.getState(), 'openVoiceSettings').mockImplementation(() => {});

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    fireEvent.click(getByTestId('settings-button'));

    // Assert
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('shows the live duration timer with an accessible label', () => {
    // Arrange
    const now = new Date('2026-07-08T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    seedVoiceStore([], [], { callStartedAt: now.getTime() - 65_000 });

    // Act
    const { getByRole } = render(() => <VoiceBar />);

    // Assert
    const timer = getByRole('timer');
    expect(timer).toHaveTextContent('01:05');
    expect(timer).toHaveAttribute('aria-label', 'Call duration: 1m 5s');
  });

  it('shows the participant count without roster data (self + peers)', () => {
    // Arrange — self + 2 peers = 3
    seedVoiceStore([makePeer('alice'), makePeer('bob')]);

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    const count = getByTestId('participant-count');

    // Assert
    expect(count).toHaveAttribute('aria-label', '3 in call');
    expect(count.textContent).toContain('3');
  });

  it('counts the case-insensitive union of self, decoded peers, and cross-node roster members', () => {
    // Arrange — Alice is the same identity as decoded peer alice; bob is
    // roster-only and must still be included.
    seedVoiceStore([makePeer('alice')]);
    store.setState({
      voiceChannelParticipants: new Map([['#media', new Set(['self', 'Alice', 'bob'])]]),
    });

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    const count = getByTestId('participant-count');

    // Assert — self + alice + bob, with no duplicate for Alice/alice.
    expect(count).toHaveAttribute('aria-label', '3 in call');
    expect(count.textContent).toContain('3');
  });

  it('reaction picker sends an emoji via sendCallReaction', () => {
    // Arrange
    seedVoiceStore([]);
    const spy = vi.spyOn(store.getState(), 'sendCallReaction').mockImplementation(() => {});

    // Act — open the popover, then click a reaction
    const { getByTestId } = render(() => <VoiceBar />);
    fireEvent.click(getByTestId('reactions-button'));
    fireEvent.click(getByTestId('reaction-🎉'));

    // Assert
    expect(spy).toHaveBeenCalledWith('🎉');
    spy.mockRestore();
  });
});

// ── Store voice slice ───────────────────────────────────────────────────────

describe('store voice slice — in-call actions', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  it('setCallLayout updates the layout', () => {
    // Act
    store.getState().setCallLayout('spotlight');

    // Assert
    expect(store.getState().voice.callLayout).toBe('spotlight');
  });

  it('pinParticipant pins a nick and switches to spotlight', () => {
    // Act
    store.getState().pinParticipant('alice');

    // Assert
    expect(store.getState().voice.pinnedParticipant).toBe('alice');
    expect(store.getState().voice.callLayout).toBe('spotlight');
  });

  it('pinParticipant toggles off when the same nick is pinned again', () => {
    // Arrange
    store.getState().pinParticipant('alice');

    // Act
    store.getState().pinParticipant('alice');

    // Assert
    expect(store.getState().voice.pinnedParticipant).toBeNull();
  });

  it('toggleCaptions flips captionsEnabled', () => {
    // Arrange
    expect(store.getState().voice.captionsEnabled).toBe(false);

    // Act
    store.getState().toggleCaptions();

    // Assert
    expect(store.getState().voice.captionsEnabled).toBe(true);
  });

  it('toggleRaiseHand flips the self handRaised flag', () => {
    // Act
    store.getState().toggleRaiseHand();

    // Assert
    expect(store.getState().voice.handRaised).toBe(true);

    // Act again
    store.getState().toggleRaiseHand();
    expect(store.getState().voice.handRaised).toBe(false);
  });

  it('setPeerHandRaised tracks per-peer raised hands immutably', () => {
    // Act
    store.getState().setPeerHandRaised('alice', true);

    // Assert
    expect(store.getState().voice.raisedHands.has('alice')).toBe(true);

    // Act — lower
    store.getState().setPeerHandRaised('alice', false);
    expect(store.getState().voice.raisedHands.has('alice')).toBe(false);
  });

  it('openVoiceSettings / closeVoiceSettings toggle the settings flag', () => {
    // Act
    store.getState().openVoiceSettings();
    expect(store.getState().showVoiceSettings).toBe(true);

    store.getState().closeVoiceSettings();
    expect(store.getState().showVoiceSettings).toBe(false);
  });
});

// ── VoiceStage — spotlight layout ─────────────────────────────────────────────

describe('VoiceStage spotlight layout', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the spotlight primary slot when callLayout is spotlight', () => {
    // Arrange
    seedVoiceStore([makePeer('alice'), makePeer('bob')], [], { callLayout: 'spotlight' });

    // Act
    const { getByTestId } = render(() => <VoiceStage />);

    // Assert
    expect(getByTestId('spotlight-primary')).toBeDefined();
    expect(getByTestId('voice-stage')).toHaveAttribute('data-layout', 'spotlight');
  });

  it('promotes the pinned participant into the spotlight', () => {
    // Arrange — pin bob; the primary tile should be bob
    seedVoiceStore(
      [makePeer('alice'), makePeer('bob')],
      [],
      { callLayout: 'spotlight', pinnedParticipant: 'bob' },
    );

    // Act
    const { getByTestId } = render(() => <VoiceStage />);

    // Assert — primary contains the bob tile
    const primary = getByTestId('spotlight-primary');
    expect(primary.querySelector('[data-nick="bob"]')).not.toBeNull();
  });

  it('auto-promotes the active speaker when nobody is pinned', () => {
    // Arrange — alice is speaking
    seedVoiceStore(
      [makePeer('alice', { speaking: true }), makePeer('bob')],
      [],
      { callLayout: 'spotlight' },
    );

    // Act
    const { getByTestId } = render(() => <VoiceStage />);

    // Assert — speaking peer is in the primary slot
    const primary = getByTestId('spotlight-primary');
    expect(primary.querySelector('[data-nick="alice"]')).not.toBeNull();
  });

  it('still renders the grid when callLayout is grid', () => {
    // Arrange
    seedVoiceStore([makePeer('alice')], [], { callLayout: 'grid' });

    // Act
    const { queryByTestId } = render(() => <VoiceStage />);

    // Assert — no spotlight primary
    expect(queryByTestId('spotlight-primary')).toBeNull();
  });
});

// ── ParticipantTile — richer tiles ────────────────────────────────────────────

describe('ParticipantTile enhancements', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the raised-hand badge when handRaised', () => {
    // Act
    const { getByTestId } = render(() => (
      <ParticipantTile nick="alice" peer={makePeer('alice')} stream={null} handRaised channelUser={undefined} />
    ));

    // Assert
    expect(getByTestId('hand-badge')).toBeDefined();
    expect(getByTestId('participant-tile')).toHaveAttribute('data-hand-raised', 'true');
  });

  it('does not show the raised-hand badge by default', () => {
    // Act
    const { queryByTestId } = render(() => (
      <ParticipantTile nick="alice" peer={makePeer('alice')} stream={null} channelUser={undefined} />
    ));

    // Assert
    expect(queryByTestId('hand-badge')).toBeNull();
  });

  it('renders a pin button when onPin is provided and fires it', () => {
    // Arrange
    const onPin = vi.fn();

    // Act
    const { getByTestId } = render(() => (
      <ParticipantTile nick="alice" peer={makePeer('alice')} stream={null} onPin={onPin} channelUser={undefined} />
    ));
    fireEvent.click(getByTestId('pin-button'));

    // Assert
    expect(onPin).toHaveBeenCalledWith('alice');
  });

  it('marks the pin button pressed and the tile pinned when pinned', () => {
    // Act
    const { getByTestId } = render(() => (
      <ParticipantTile nick="alice" peer={makePeer('alice')} stream={null} onPin={() => {}} pinned channelUser={undefined} />
    ));

    // Assert
    expect(getByTestId('pin-button')).toHaveAttribute('aria-pressed', 'true');
    expect(getByTestId('participant-tile').className).toContain('voice-tile--pinned');
  });

  it('renders the connection-quality indicator only when quality is supplied', () => {
    // Act — with quality
    const withQuality = render(() => (
      <ParticipantTile nick="alice" peer={makePeer('alice')} stream={null} quality={2} channelUser={undefined} />
    ));
    expect(withQuality.getByTestId('tile-quality')).toBeDefined();
    cleanup();

    // Act — without quality
    const withoutQuality = render(() => (
      <ParticipantTile nick="bob" peer={makePeer('bob')} stream={null} channelUser={undefined} />
    ));
    expect(withoutQuality.queryByTestId('tile-quality')).toBeNull();
  });

  it('shows the camera-off badge for a peer that declared video but has no stream', () => {
    // Act
    const { getByTitle } = render(() => (
      <ParticipantTile nick="alice" peer={makePeer('alice', { hasVideo: true })} stream={null} channelUser={undefined} />
    ));

    // Assert
    expect(getByTitle('Camera off')).toBeDefined();
  });
});

// ── CallStatusAnnouncer (SC 4.1.3 Status Messages) ──────────────────────────────

/** Replace the in-call peer set without remounting the component. */
function setPeers(nicks: string[]) {
  store.setState((s) => {
    const peers = new Map<string, SuimyakuPeerState>();
    for (const nick of nicks) peers.set(nick, makePeer(nick));
    return { voice: { ...s.voice, peers } };
  });
}

describe('CallStatusAnnouncer', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => cleanup());

  it('exposes a polite, atomic status live region', () => {
    // Arrange
    seedVoiceStore([makePeer('alice')], []);

    // Act
    const { getByTestId } = render(() => <CallStatusAnnouncer />);
    const region = getByTestId('call-status-announcer');

    // Assert — scoped announcement channel, not an assertive alert
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
  });

  it('does NOT announce the existing roster on first in-call render', () => {
    // Arrange — a busy call is joined mid-stream (baseline must stay silent)
    seedVoiceStore([makePeer('alice'), makePeer('bob'), makePeer('carol')], []);

    // Act
    const { getByTestId } = render(() => <CallStatusAnnouncer />);

    // Assert — no roster read-out on mount
    expect(getByTestId('call-status-announcer').textContent).toBe('');
  });

  it('announces only the delta when a participant joins', () => {
    // Arrange
    seedVoiceStore([makePeer('alice')], []);
    const { getByTestId } = render(() => <CallStatusAnnouncer />);

    // Act — bob joins the ongoing call
    setPeers(['alice', 'bob']);

    // Assert — bob is announced, the pre-existing alice is not
    const text = getByTestId('call-status-announcer').textContent ?? '';
    expect(text).toContain('bob');
    expect(text).toContain('joined the call');
    expect(text).not.toContain('alice');
  });

  it('announces a participant leaving', () => {
    // Arrange
    seedVoiceStore([makePeer('alice'), makePeer('bob')], []);
    const { getByTestId } = render(() => <CallStatusAnnouncer />);

    // Act — bob leaves
    setPeers(['alice']);

    // Assert
    const text = getByTestId('call-status-announcer').textContent ?? '';
    expect(text).toContain('bob');
    expect(text).toContain('left the call');
  });

  it('stays silent on unrelated voice-state churn (no roster re-announcement)', () => {
    // Arrange
    seedVoiceStore([makePeer('alice'), makePeer('bob')], []);
    const { getByTestId } = render(() => <CallStatusAnnouncer />);

    // Act — a self-mute flip replaces the voice object but not the roster
    store.setState((s) => ({ voice: { ...s.voice, muted: true } }));

    // Assert — nothing announced; the 24-tile-roster spam trap stays shut
    expect(getByTestId('call-status-announcer').textContent).toBe('');
  });
});

// ── VoiceBar trigger accessible names (SC 4.1.2 Name, Role, Value) ──────────────

describe('VoiceBar popover triggers', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => cleanup());

  it('exposes exactly one named button for the reactions trigger (no nested control)', () => {
    // Arrange
    seedVoiceStore([], [makeChannelUser('self')]);

    // Act
    const { getByRole } = render(() => <VoiceBar />);

    // Assert — getByRole throws on a duplicate/nested button, so this proves the
    // trigger is a single tab stop with a real accessible name.
    expect(getByRole('button', { name: 'Send a reaction' })).toBeInTheDocument();
  });

  it('exposes a single named button for the spatial-audio trigger', () => {
    // Arrange — mediaAvailable so the spatial popover (not the disabled fallback) renders
    seedVoiceStore([], [makeChannelUser('self')], {});
    store.setState((s) => ({ mediaAvailable: true, voice: { ...s.voice } }));

    // Act
    const { getByRole } = render(() => <VoiceBar />);

    // Assert — name comes from the (now non-interactive) labelled child span
    expect(getByRole('button', { name: /Spatial audio controls/ })).toBeInTheDocument();
  });
});
