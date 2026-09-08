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

import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import type { CadencePeerState } from '@/lib/cadence-media/types';
import * as clipboard from '@/lib/clipboard/writeClipboardText';
import { VoiceStage } from './VoiceStage';
import { ParticipantTile } from './ParticipantTile';
import { VoiceBar, downloadLocalRecording, localRecordingFilename } from './VoiceBar';
import { CallStatusAnnouncer } from './CallStatusAnnouncer';

// ── Helpers ───────────────────────────────────────────────────────────────────

const initialState = store.getInitialState();
const displayMediaDescriptor = Object.getOwnPropertyDescriptor(
  navigator.mediaDevices,
  'getDisplayMedia',
);
const wakeLockDescriptor = Object.getOwnPropertyDescriptor(navigator, 'wakeLock');
const pictureInPictureEnabledDescriptor = Object.getOwnPropertyDescriptor(
  document,
  'pictureInPictureEnabled',
);
const pictureInPictureElementDescriptor = Object.getOwnPropertyDescriptor(
  document,
  'pictureInPictureElement',
);
const exitPictureInPictureDescriptor = Object.getOwnPropertyDescriptor(
  document,
  'exitPictureInPicture',
);
const requestPictureInPictureDescriptor = Object.getOwnPropertyDescriptor(
  HTMLVideoElement.prototype,
  'requestPictureInPicture',
);

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

function makePeer(nick: string, overrides: Partial<CadencePeerState> = {}): CadencePeerState {
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
  peers: CadencePeerState[],
  channelUsers: ChannelUser[] = [],
  extra: Partial<typeof initialState.voice> = {},
) {
  const peersMap = new Map<string, CadencePeerState>();
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
        // Stage only paints participants once the call is "started".
        callStartedAt: Date.now(),
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

function openCallMore(getByTestId: (id: string) => HTMLElement): void {
  fireEvent.click(getByTestId('call-more-button'));
}

const RECORDING_BLOB = new Blob(['saved-audio'], { type: 'audio/webm;codecs=opus' });

async function installVoiceBarRecording(opts: { deferred?: boolean } = {}) {
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

function restorePictureInPicture(): void {
  const restore = (target: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined) => {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  };

  restore(document, 'pictureInPictureEnabled', pictureInPictureEnabledDescriptor);
  restore(document, 'pictureInPictureElement', pictureInPictureElementDescriptor);
  restore(document, 'exitPictureInPicture', exitPictureInPictureDescriptor);
  restore(HTMLVideoElement.prototype, 'requestPictureInPicture', requestPictureInPictureDescriptor);
}

function setPictureInPictureSupport(
  requestImplementation?: (
    video: HTMLVideoElement,
    enter: (video: HTMLVideoElement) => void,
  ) => Promise<unknown>,
) {
  let activeElement: HTMLVideoElement | null = null;
  const enter = (video: HTMLVideoElement) => {
    activeElement = video;
    video.dispatchEvent(new Event('enterpictureinpicture'));
  };
  const request = vi.fn(function (this: HTMLVideoElement) {
    if (requestImplementation) return requestImplementation(this, enter);
    enter(this);
    return Promise.resolve();
  });
  const exit = vi.fn(async () => {
    const previous = activeElement;
    activeElement = null;
    previous?.dispatchEvent(new Event('leavepictureinpicture'));
  });

  Object.defineProperty(document, 'pictureInPictureEnabled', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(document, 'pictureInPictureElement', {
    configurable: true,
    get: () => activeElement,
  });
  Object.defineProperty(document, 'exitPictureInPicture', {
    configurable: true,
    value: exit,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'requestPictureInPicture', {
    configurable: true,
    value: request,
  });

  return { request, exit };
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

  it('does not detach an unchanged peer video stream when speaking status updates', () => {
    const stream = {
      getTracks: () => [],
      getVideoTracks: () => [],
    } as unknown as MediaStream;
    seedVoiceStore(
      [makePeer('alice', { hasVideo: true })],
      [],
      { videoParticipants: new Map([['alice', stream]]) },
    );

    const view = render(() => <VoiceStage />);
    const video = view.getByTestId('tile-video') as HTMLVideoElement;
    let attached = video.srcObject;
    let assignments = 0;
    Object.defineProperty(video, 'srcObject', {
      configurable: true,
      get: () => attached,
      set: value => {
        assignments += 1;
        attached = value;
      },
    });

    store.getState().setSpeakingNick('alice', true);

    expect(view.getByTestId('tile-video')).toBe(video);
    expect(video.srcObject).toBe(stream);
    expect(assignments).toBe(0);
  });

  it('keeps the spotlight subject video mounted while its speaking status flips', () => {
    // Arrange — pin Alice so the spotlight subject cannot change; only her
    // speaking flag moves. A talking participant must not blink her own feed.
    const stream = {
      getTracks: () => [],
      getVideoTracks: () => [],
    } as unknown as MediaStream;
    seedVoiceStore(
      [makePeer('alice', { hasVideo: true })],
      [],
      {
        callLayout: 'spotlight',
        pinnedParticipant: 'alice',
        videoParticipants: new Map([['alice', stream]]),
      },
    );

    const view = render(() => <VoiceStage />);
    const primary = view.getByTestId('spotlight-primary');
    const video = within(primary).getByTestId('tile-video') as HTMLVideoElement;
    let attached = video.srcObject;
    let assignments = 0;
    Object.defineProperty(video, 'srcObject', {
      configurable: true,
      get: () => attached,
      set: value => {
        assignments += 1;
        attached = value;
      },
    });

    // Act — a burst of talk activity: peer speaking, then the flat event-plane
    // set, then silence again.
    store.getState().setVoiceParticipantSpeaking('alice', true);
    store.getState().setSpeakingNick('alice', true);
    store.getState().setSpeakingNick('alice', false);

    // Assert — same element, same stream, never re-assigned.
    const current = within(view.getByTestId('spotlight-primary')).getByTestId('tile-video');
    expect(current).toBe(video);
    expect(video.srcObject).toBe(stream);
    expect(assignments).toBe(0);
  });

  it('updates the spotlight subject tile in place across unrelated voice updates', () => {
    // Arrange
    const stream = {
      getTracks: () => [],
      getVideoTracks: () => [],
    } as unknown as MediaStream;
    seedVoiceStore(
      [makePeer('alice', { hasVideo: true })],
      [],
      {
        callLayout: 'spotlight',
        pinnedParticipant: 'alice',
        videoParticipants: new Map([['alice', stream]]),
      },
    );

    const view = render(() => <VoiceStage />);
    const video = within(view.getByTestId('spotlight-primary')).getByTestId('tile-video');

    // Act — a mute badge change must repaint the badge, not the video element.
    store.getState().setVoiceParticipantMuted('alice', true);

    // Assert — element identity survives; the badge still reflects the update.
    const tile = within(view.getByTestId('spotlight-primary')).getByTestId('participant-tile');
    expect(within(view.getByTestId('spotlight-primary')).getByTestId('tile-video')).toBe(video);
    expect(tile).toHaveAttribute('aria-label', 'alice, muted');
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
    restorePictureInPicture();
  });

  it('keeps video in-page when native Picture-in-Picture is unavailable', () => {
    Object.defineProperty(document, 'pictureInPictureEnabled', {
      configurable: true,
      value: false,
    });
    const stream = {} as MediaStream;

    const { getByTestId, queryByTestId } = render(() => (
      <ParticipantTile nick="alice" peer={makePeer('alice')} stream={stream} channelUser={undefined} />
    ));

    expect(getByTestId('tile-video')).toBeDefined();
    expect(queryByTestId('native-pip-button')).toBeNull();
  });

  it('opens and closes the tile video in native Picture-in-Picture only on click', async () => {
    const { request, exit } = setPictureInPictureSupport();
    const stream = {} as MediaStream;
    const { getByTestId } = render(() => (
      <ParticipantTile nick="alice" peer={makePeer('alice')} stream={stream} channelUser={undefined} />
    ));
    const video = getByTestId('tile-video');
    const button = getByTestId('native-pip-button');

    expect(request).not.toHaveBeenCalled();
    expect(button).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(button);
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request.mock.instances[0]).toBe(video);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAccessibleName('Close alice Picture-in-Picture');

    fireEvent.click(button);
    await waitFor(() => expect(exit).toHaveBeenCalledOnce());
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('treats a denied Picture-in-Picture request as a neutral outcome', async () => {
    const { request } = setPictureInPictureSupport(async () => {
      throw new DOMException('Request cancelled', 'NotAllowedError');
    });
    const { getByTestId, queryByRole } = render(() => (
      <ParticipantTile nick="alice" peer={makePeer('alice')} stream={{} as MediaStream} channelUser={undefined} />
    ));
    const button = getByTestId('native-pip-button');

    fireEvent.click(button);

    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(queryByRole('alert')).toBeNull();
  });

  it('coalesces clicks while a Picture-in-Picture request is pending', async () => {
    let finishRequest: (() => void) | undefined;
    const { request } = setPictureInPictureSupport((video, enter) => new Promise((resolve) => {
      finishRequest = () => {
        enter(video);
        resolve(undefined);
      };
    }));
    const { getByTestId } = render(() => (
      <ParticipantTile nick="alice" peer={makePeer('alice')} stream={{} as MediaStream} channelUser={undefined} />
    ));
    const button = getByTestId('native-pip-button');

    fireEvent.click(button);
    fireEvent.click(button);

    expect(request).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    finishRequest?.();
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
  });

  it('closes native Picture-in-Picture when its tile unmounts', async () => {
    const { exit } = setPictureInPictureSupport();
    const view = render(() => (
      <ParticipantTile nick="alice" peer={makePeer('alice')} stream={{} as MediaStream} channelUser={undefined} />
    ));

    fireEvent.click(view.getByTestId('native-pip-button'));
    await waitFor(() => expect(view.getByTestId('native-pip-button')).toHaveAttribute('aria-pressed', 'true'));
    view.unmount();

    await waitFor(() => expect(exit).toHaveBeenCalledOnce());
  });

  it('closes a Picture-in-Picture request that resolves after unmount', async () => {
    let finishRequest: (() => void) | undefined;
    const { exit } = setPictureInPictureSupport((video, enter) => new Promise((resolve) => {
      finishRequest = () => {
        enter(video);
        resolve(undefined);
      };
    }));
    const view = render(() => (
      <ParticipantTile nick="alice" peer={makePeer('alice')} stream={{} as MediaStream} channelUser={undefined} />
    ));

    fireEvent.click(view.getByTestId('native-pip-button'));
    view.unmount();
    expect(exit).not.toHaveBeenCalled();

    finishRequest?.();
    await waitFor(() => expect(exit).toHaveBeenCalledOnce());
  });

  it('closes a pending Picture-in-Picture request when its stream disappears', async () => {
    let finishRequest: (() => void) | undefined;
    const { exit } = setPictureInPictureSupport((video, enter) => new Promise((resolve) => {
      finishRequest = () => {
        enter(video);
        resolve(undefined);
      };
    }));
    const [stream, setStream] = createSignal<MediaStream | null>({} as MediaStream);
    const view = render(() => (
      <ParticipantTile nick="alice" peer={makePeer('alice')} stream={stream()} channelUser={undefined} />
    ));

    fireEvent.click(view.getByTestId('native-pip-button'));
    setStream(null);
    expect(view.queryByTestId('native-pip-button')).toBeNull();

    finishRequest?.();
    await waitFor(() => expect(exit).toHaveBeenCalledOnce());
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
    vi.useRealTimers();
  });

  it('does not render when callState is idle', () => {
    // Arrange — store is at initialState (callState: 'idle')

    // Act
    const { queryByTestId, getByTestId } = render(() => <VoiceBar />);

    // Assert — bar is hidden
    expect(queryByTestId('voice-bar')).toBeNull();
    expect(getByTestId('voice-bar-owner')).toHaveAttribute('data-voice-bar-active', 'false');
  });

  it('renders the bar when callState is in_call', () => {
    // Arrange
    seedVoiceStore([]);

    // Act
    const { getByTestId } = render(() => <VoiceBar />);

    // Assert
    expect(getByTestId('voice-bar')).toBeDefined();
  });

  it('keeps one recording VoiceBar mounted while the primary surface changes', async () => {
    const g = globalThis as unknown as { MediaRecorder?: unknown };
    const previousRecorder = g.MediaRecorder;
    g.MediaRecorder = class {
      static isTypeSupported() { return true; }
    };

    const startRecording = vi.fn().mockReturnValue({ started: true });
    const stopRecording = vi.fn().mockResolvedValue(
      new Blob(['persistent-audio'], { type: 'audio/webm;codecs=opus' }),
    );
    const { setMountedCadenceMediaEngine } = await import('@/lib/cadence-media/MediaEngine');
    setMountedCadenceMediaEngine({
      startRecording,
      stopRecording,
      getLocalStream: vi.fn().mockReturnValue({ getTracks: () => [] } as unknown as MediaStream),
    } as never);

    try {
      seedVoiceStore([]);
      const [surface, setSurface] = createSignal<'rooms' | 'calls'>('rooms');
      const { getByTestId } = render(() => (
        <>
          <div data-testid="primary-surface">{surface()}</div>
          <VoiceBar />
        </>
      ));
      const bar = getByTestId('voice-bar');
      openCallMore(getByTestId);
      const record = getByTestId('record-button');

      fireEvent.click(record);
      expect(startRecording).toHaveBeenCalledOnce();
      expect(getByTestId('record-status')).toHaveTextContent('Recording local audio');

      setSurface('calls');
      expect(getByTestId('primary-surface')).toHaveTextContent('calls');
      expect(getByTestId('voice-bar')).toBe(bar);
      expect(getByTestId('record-status')).toHaveTextContent('Recording local audio');
      expect(stopRecording).not.toHaveBeenCalled();

      setSurface('rooms');
      expect(getByTestId('voice-bar')).toBe(bar);
      expect(getByTestId('record-button')).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(getByTestId('record-button'));
      await waitFor(() => expect(stopRecording).toHaveBeenCalledOnce());
    } finally {
      setMountedCadenceMediaEngine(null);
      if (previousRecorder === undefined) {
        Reflect.deleteProperty(globalThis, 'MediaRecorder');
      } else {
        g.MediaRecorder = previousRecorder;
      }
    }
  });

  it('shows a hop-protected security chip with shield language, never a padlock', () => {
    // Arrange — in_call without media E2EE (not shipped)
    seedVoiceStore([]);

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    const chip = getByTestId('call-security-chip');

    // Assert — shield hop honesty (Era 1 A5 / research R1 / C7 unify)
    expect(chip).toBeDefined();
    expect(chip.getAttribute('data-security-level')).toBe('hop_protected');
    expect(chip.getAttribute('data-uses-padlock')).toBe('false');
    expect(chip.getAttribute('data-honest-private')).toBe('false');
    expect(chip.getAttribute('data-padlock-tone')).toBe('public');
    expect(chip.getAttribute('aria-label')?.toLowerCase()).toContain('encrypted to this server');
    expect(chip.textContent?.toLowerCase()).toContain('protected connection');
    // No padlock SVG path for hop-only (LockIcon uses a keyed rect body)
    expect(chip.querySelector('svg rect[width="14"]')).toBeNull();
  });

  it('opens the Privacy sheet from the security chip with hop-only honesty', async () => {
    seedVoiceStore([]);
    const { getByTestId } = render(() => <VoiceBar />);

    fireEvent.click(getByTestId('call-security-chip'));

    // Sheet portals to document.body — query via screen, not the render root.
    const sheet = await screen.findByTestId('call-privacy-sheet');
    expect(sheet.getAttribute('data-privacy-level')).toBe('hop_protected');
    expect(screen.getByTestId('call-privacy-server-access').textContent?.toLowerCase()).toContain(
      'operators can access call media',
    );
    expect(screen.getByTestId('call-privacy-epoch').textContent?.toLowerCase()).toContain(
      'end-to-end media encryption',
    );
    expect(screen.getByRole('dialog', { name: /call privacy/i })).toBeTruthy();
  });

  it('surfaces the local media E2EE fingerprint in the Privacy sheet', async () => {
    const { setMountedCadenceMediaEngine } = await import('@/lib/cadence-media/MediaEngine');
    const getLocalMediaE2eeFingerprint = vi.fn().mockResolvedValue('AbC1Def2GhI3');
    setMountedCadenceMediaEngine({ getLocalMediaE2eeFingerprint } as never);

    try {
      seedVoiceStore([]);
      const { getByTestId } = render(() => <VoiceBar />);

      fireEvent.click(getByTestId('call-security-chip'));

      const fingerprint = await screen.findByTestId('call-privacy-local-fingerprint');
      await waitFor(() => {
        expect(fingerprint.textContent).toContain('AbC1Def2GhI3');
      });
      expect(getLocalMediaE2eeFingerprint).toHaveBeenCalled();
      expect(screen.getByText(/compare this code out of band/i)).toBeTruthy();
    } finally {
      setMountedCadenceMediaEngine(null);
    }
  });

  it('shows fingerprint unavailable when the media engine is not mounted', async () => {
    const { setMountedCadenceMediaEngine } = await import('@/lib/cadence-media/MediaEngine');
    setMountedCadenceMediaEngine(null);

    seedVoiceStore([]);
    const { getByTestId } = render(() => <VoiceBar />);

    fireEvent.click(getByTestId('call-security-chip'));

    const fingerprint = await screen.findByTestId('call-privacy-local-fingerprint');
    expect(fingerprint.textContent?.toLowerCase()).toContain('unavailable');
  });

  it('surfaces live local SFU topology from engine stats (not hardcoded)', async () => {
    const { setMountedCadenceMediaEngine } = await import('@/lib/cadence-media/MediaEngine');
    setMountedCadenceMediaEngine({
      getLocalMediaE2eeFingerprint: vi.fn().mockResolvedValue(''),
      getNetworkStats: () => ({
        tier: 0 as const,
        suggestedBps: 0,
        jitterMs: 5,
        lossRate: 0.01,
      }),
    } as never);

    try {
      seedVoiceStore([]);
      const { getByTestId } = render(() => <VoiceBar />);

      // Badge polls on mount (engineReady → local SFU).
      await waitFor(() => {
        expect(getByTestId('sfu-cascade-badge').getAttribute('data-sfu-cascade-mode')).toBe('local');
      });
      expect(getByTestId('sfu-cascade-badge').textContent).toMatch(/local sfu/i);

      fireEvent.click(getByTestId('call-security-chip'));
      const cascade = await screen.findByTestId('call-privacy-sfu-cascade');
      await waitFor(() => {
        expect(cascade.getAttribute('data-sfu-cascade-mode')).toBe('local');
      });
      expect(cascade.textContent?.toLowerCase()).toContain('local sfu');
      expect(cascade.textContent?.toLowerCase()).toContain('this network node');
    } finally {
      setMountedCadenceMediaEngine(null);
    }
  });

  it('surfaces network relay hops from room STATS advertisement', async () => {
    const { setMountedCadenceMediaEngine } = await import('@/lib/cadence-media/MediaEngine');
    setMountedCadenceMediaEngine({
      getLocalMediaE2eeFingerprint: vi.fn().mockResolvedValue(''),
      getNetworkStats: () => ({
        tier: 1 as const,
        suggestedBps: 200_000,
        jitterMs: 20,
        lossRate: 0.02,
      }),
    } as never);

    try {
      const roomStats = new Map([
        ['#media', {
          active_senders: 2,
          total_viewers: 4,
          video_fps: 30,
          audio_kbps: 64,
          remote_forwarders: 2,
        }],
      ]);
      seedVoiceStore([], [], { roomStats });
      const { getByTestId } = render(() => <VoiceBar />);

      // Room STATS alone advertise cascade (no need to wait on engine poll).
      expect(getByTestId('sfu-cascade-badge').getAttribute('data-sfu-cascade-mode')).toBe('cascade');
      expect(getByTestId('sfu-cascade-badge').getAttribute('data-sfu-cascade-hops')).toBe('3');
      expect(getByTestId('sfu-cascade-badge').textContent).toMatch(/3 hops/i);

      fireEvent.click(getByTestId('call-security-chip'));
      const cascade = await screen.findByTestId('call-privacy-sfu-cascade');
      expect(cascade.getAttribute('data-sfu-cascade-mode')).toBe('cascade');
      expect(cascade.textContent?.toLowerCase()).toContain('network relay');
    } finally {
      setMountedCadenceMediaEngine(null);
    }
  });

  it('marks cascade degraded when engine reports high loss', async () => {
    const { setMountedCadenceMediaEngine } = await import('@/lib/cadence-media/MediaEngine');
    setMountedCadenceMediaEngine({
      getLocalMediaE2eeFingerprint: vi.fn().mockResolvedValue(''),
      getNetworkStats: () => ({
        tier: 3 as const,
        suggestedBps: 50_000,
        jitterMs: 120,
        lossRate: 0.22,
      }),
    } as never);

    try {
      seedVoiceStore([]);
      const { getByTestId } = render(() => <VoiceBar />);
      await waitFor(() => {
        expect(getByTestId('sfu-cascade-badge').getAttribute('data-sfu-cascade-mode')).toBe('degraded');
      });

      fireEvent.click(getByTestId('call-security-chip'));
      const cascade = await screen.findByTestId('call-privacy-sfu-cascade');
      await waitFor(() => {
        expect(cascade.getAttribute('data-sfu-cascade-mode')).toBe('degraded');
      });
      expect(cascade.textContent?.toLowerCase()).toContain('degraded');
    } finally {
      setMountedCadenceMediaEngine(null);
    }
  });

  it('offers a turn-off-camera soft prompt after sustained poor CQ with camera on', async () => {
    vi.useFakeTimers();
    const { setMountedCadenceMediaEngine } = await import('@/lib/cadence-media/MediaEngine');
    setMountedCadenceMediaEngine({
      getNetworkStats: () => ({
        tier: 3 as const,
        suggestedBps: 80_000,
        jitterMs: 90,
        lossRate: 0.12,
      }),
    } as never);

    try {
      seedVoiceStore([], [], { cameraOn: true });
      render(() => <VoiceBar />);

      // First sample arms hysteresis — no prompt yet.
      expect(screen.queryByTestId('connection-quality-prompt')).toBeNull();

      // 1 Hz poll + 2500 ms hold → need ≥3 interval ticks after the initial poll.
      await vi.advanceTimersByTimeAsync(3000);

      expect(screen.getByTestId('connection-quality-prompt')).toBeTruthy();
      expect(screen.getByTestId('connection-quality-turn-off-camera')).toBeTruthy();

      const toggleVideo = vi.spyOn(store.getState(), 'toggleVideo').mockResolvedValue(undefined);
      fireEvent.click(screen.getByTestId('connection-quality-turn-off-camera'));
      expect(toggleVideo).toHaveBeenCalledOnce();
      expect(screen.queryByTestId('connection-quality-prompt')).toBeNull();
      toggleVideo.mockRestore();
    } finally {
      setMountedCadenceMediaEngine(null);
      vi.useRealTimers();
    }
  });

  it('toasts once when the bandwidth ladder degrades after a good baseline (R3)', async () => {
    vi.useFakeTimers();
    const { setMountedCadenceMediaEngine } = await import('@/lib/cadence-media/MediaEngine');
    let tier: 0 | 1 | 2 | 3 = 0;
    setMountedCadenceMediaEngine({
      getNetworkStats: () => ({
        tier,
        suggestedBps: tier === 0 ? 500_000 : 100_000,
        jitterMs: 20,
        lossRate: 0.01,
      }),
    } as never);

    try {
      seedVoiceStore([], [], { cameraOn: true });
      const toastCountBefore = store.getState().toasts.length;
      render(() => <VoiceBar />);

      // Establish a good baseline (stable tier 0). 1 Hz poll + 2500 ms hold.
      await vi.advanceTimersByTimeAsync(3000);
      expect(
        store.getState().toasts.filter(t => t.groupKey?.startsWith('bw-ladder-')),
      ).toHaveLength(0);

      // Degrade to fair. The next poll arms the candidate; then hold ≥ hysteresis
      // (another ~3 interval ticks) so the ladder notice can fire once.
      tier = 2;
      await vi.advanceTimersByTimeAsync(4000);

      const ladderToasts = store.getState().toasts.filter(t => t.groupKey === 'bw-ladder-lowering');
      expect(ladderToasts.length).toBeGreaterThanOrEqual(1);
      expect(ladderToasts[0]?.description?.toLowerCase()).toContain('keep audio clear');
      expect(store.getState().toasts.length).toBeGreaterThan(toastCountBefore);

      // Stay fair — no spam.
      const afterFirst = store.getState().toasts.filter(t => t.groupKey === 'bw-ladder-lowering').length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(
        store.getState().toasts.filter(t => t.groupKey === 'bw-ladder-lowering'),
      ).toHaveLength(afterFirst);
    } finally {
      setMountedCadenceMediaEngine(null);
      vi.useRealTimers();
    }
  });

  it('shows connecting security chip while ringing (no padlock)', () => {
    store.setState(
      {
        ...initialState,
        voice: {
          ...initialState.voice,
          callState: 'ringing_out',
          callWith: 'alice',
        },
      },
      true,
    );

    const { getByTestId } = render(() => <VoiceBar />);
    const chip = getByTestId('call-security-chip');

    expect(chip.getAttribute('data-security-level')).toBe('connecting');
    expect(chip.getAttribute('data-uses-padlock')).toBe('false');
    expect(chip.textContent?.toLowerCase()).toContain('connecting');
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
    openCallMore(getByTestId);
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
    openCallMore(getByTestId);
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
    openCallMore(getByTestId);
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
    openCallMore(getByTestId);
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
    openCallMore(getByTestId);
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


  it('starts and stops local-only recording, downloading the blob on stop', async () => {
    const g = globalThis as unknown as { MediaRecorder?: unknown };
    const prevRecorder = g.MediaRecorder;
    // jsdom has no MediaRecorder — the control gates on its presence.
    g.MediaRecorder = class {
      static isTypeSupported() { return true; }
    };

    const startRecording = vi.fn().mockReturnValue({ started: true });
    const stopRecording = vi.fn().mockResolvedValue(
      new Blob(['fake-audio'], { type: 'audio/webm;codecs=opus' }),
    );
    const getLocalStream = vi.fn().mockReturnValue({ getTracks: () => [] } as unknown as MediaStream);
    const { setMountedCadenceMediaEngine } = await import('@/lib/cadence-media/MediaEngine');
    setMountedCadenceMediaEngine({ startRecording, stopRecording, getLocalStream } as never);

    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:onyx-recording');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const activated: Array<{ download: string; href: string }> = [];
    const realCreateElement = document.createElement.bind(document);
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === 'a') {
        const anchor = el as HTMLAnchorElement;
        const click = anchor.click.bind(anchor);
        anchor.click = () => {
          activated.push({ download: anchor.download, href: anchor.href });
          click();
        };
      }
      return el;
    });

    try {
      seedVoiceStore([]);
      const { getByTestId } = render(() => <VoiceBar />);
      openCallMore(getByTestId);
      const btn = getByTestId('record-button');

      expect(btn).toBeEnabled();
      expect(btn).toHaveAttribute('aria-pressed', 'false');
      expect(btn).toHaveAttribute('aria-label', 'Record local audio');

      fireEvent.click(btn);
      expect(startRecording).toHaveBeenCalledOnce();
      expect(btn).toHaveAttribute('aria-pressed', 'true');
      expect(btn).toHaveAttribute('aria-label', 'Stop recording and download');
      expect(getByTestId('record-status')).toHaveTextContent('Recording local audio');

      fireEvent.click(btn);
      await waitFor(() => expect(stopRecording).toHaveBeenCalledOnce());
      await waitFor(() => expect(activated).toHaveLength(1));
      expect(activated[0]!.href).toContain('blob:onyx-recording');
      expect(activated[0]!.download).toMatch(/^onyx-call-.*\.webm$/);
      expect(createObjectURL).toHaveBeenCalledOnce();
      await waitFor(() =>
        expect(getByTestId('record-status')).toHaveTextContent('Recording saved'),
      );
      expect(btn).toHaveAttribute('aria-pressed', 'false');
    } finally {
      setMountedCadenceMediaEngine(null);
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
      createElement.mockRestore();
      if (prevRecorder === undefined) {
        Reflect.deleteProperty(globalThis, 'MediaRecorder');
      } else {
        g.MediaRecorder = prevRecorder;
      }
    }
  });

  it.each([
    ['failed', 'Could not start recording. Try again.'],
    ['finalizing', 'Previous recording is still saving. Try again when it finishes.'],
    ['no-media', 'No local media to record'],
    ['unavailable', 'Recording unavailable'],
    ['already-recording', 'A recording is already running'],
  ] as const)('keeps Record unpressed and releases ownership when start is refused: %s', async (reason, status) => {
    const harness = await installVoiceBarRecording();
    const held = vi.fn();
    try {
      harness.startRecording.mockReturnValue({ started: false, reason });
      seedVoiceStore([]);
      const { getByTestId, unmount } = render(() => <VoiceBar onRecordingOwnerHeld={held} />);
      openCallMore(getByTestId);
      fireEvent.click(getByTestId('record-button'));
      expect(harness.startRecording).toHaveBeenCalledOnce();
      expect(getByTestId('record-button')).toHaveAttribute('aria-pressed', 'false');
      expect(getByTestId('record-button')).toHaveAttribute('aria-label', 'Record local audio');
      expect(getByTestId('record-status')).toHaveTextContent(status);
      expect(held).not.toHaveBeenCalledWith(true);
      unmount();
      expect(harness.stopRecording).not.toHaveBeenCalled();
      expect(harness.createObjectURL).not.toHaveBeenCalled();
    } finally {
      harness.restore();
    }
  });

  it.each(['throw', 'missing-result'] as const)('does not claim recording when start returns %s', async (failure) => {
    const harness = await installVoiceBarRecording();
    try {
      harness.startRecording.mockImplementation(() => {
        if (failure === 'throw') throw new Error('Start failed');
        return undefined; // An old mock/engine without explicit acceptance must fail closed.
      });
      seedVoiceStore([]);
      const { getByTestId, unmount } = render(() => <VoiceBar />);
      openCallMore(getByTestId);
      fireEvent.click(getByTestId('record-button'));
      expect(getByTestId('record-button')).toHaveAttribute('aria-pressed', 'false');
      expect(getByTestId('record-status')).toHaveTextContent('Could not start recording. Try again.');
      unmount();
      expect(harness.stopRecording).not.toHaveBeenCalled();
      expect(harness.createObjectURL).not.toHaveBeenCalled();
    } finally {
      harness.restore();
    }
  });

  it('allows retry after a finalization refusal and holds ownership only after acceptance', async () => {
    const harness = await installVoiceBarRecording();
    const held = vi.fn();
    try {
      harness.startRecording.mockReturnValueOnce({ started: false, reason: 'finalizing' });
      seedVoiceStore([]);
      const { getByTestId } = render(() => <VoiceBar onRecordingOwnerHeld={held} />);
      openCallMore(getByTestId);
      const button = getByTestId('record-button');
      fireEvent.click(button);
      expect(held).not.toHaveBeenCalledWith(true);
      fireEvent.click(button);
      expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(held).toHaveBeenLastCalledWith(true);
      expect(getByTestId('record-status')).toHaveTextContent('Recording local audio');
      fireEvent.click(button);
      await waitFor(() => expect(held).toHaveBeenLastCalledWith(false));
      expect(harness.stopRecording).toHaveBeenCalledOnce();
      expect(harness.createObjectURL).toHaveBeenCalledOnce();
    } finally {
      harness.restore();
    }
  });

  it('saves the recording when Leave ends the call while recording', async () => {
    const harness = await installVoiceBarRecording();
    try {
      seedVoiceStore([]);
      const { getByTestId, queryByTestId } = render(() => <VoiceBar />);
      openCallMore(getByTestId);
      fireEvent.click(getByTestId('record-button'));
      expect(harness.startRecording).toHaveBeenCalledOnce();

      fireEvent.click(getByTestId('leave-button'));
      await waitFor(() => expect(harness.stopRecording).toHaveBeenCalledOnce());
      await waitFor(() => expect(harness.createObjectURL).toHaveBeenCalledOnce());
      expect(queryByTestId('voice-bar')).toBeNull();
      expect(getByTestId('voice-bar-owner')).toHaveAttribute('data-voice-bar-active', 'false');
      expect(harness.startRecording).toHaveBeenCalledOnce();
    } finally {
      harness.restore();
    }
  });

  it('saves a deferred recording blob when Stop races with Leave', async () => {
    const harness = await installVoiceBarRecording({ deferred: true });
    try {
      seedVoiceStore([]);
      const { getByTestId, queryByTestId } = render(() => <VoiceBar />);
      openCallMore(getByTestId);
      fireEvent.click(getByTestId('record-button'));
      fireEvent.click(getByTestId('record-button'));
      expect(harness.stopRecording).toHaveBeenCalledOnce();
      expect(harness.createObjectURL).not.toHaveBeenCalled();

      fireEvent.click(getByTestId('leave-button'));
      expect(harness.stopRecording).toHaveBeenCalledOnce();
      expect(queryByTestId('voice-bar')).toBeNull();
      expect(getByTestId('voice-bar-owner')).toHaveAttribute('data-voice-bar-active', 'false');

      harness.resolveStop();
      await waitFor(() => expect(harness.createObjectURL).toHaveBeenCalledOnce());
      expect(harness.stopRecording).toHaveBeenCalledOnce();
    } finally {
      harness.restore();
    }
  });

  it('saves a deferred recording blob when the owner unmounts during Stop', async () => {
    const harness = await installVoiceBarRecording({ deferred: true });
    try {
      seedVoiceStore([]);
      const { getByTestId, unmount } = render(() => <VoiceBar />);
      openCallMore(getByTestId);
      fireEvent.click(getByTestId('record-button'));
      fireEvent.click(getByTestId('record-button'));
      expect(harness.stopRecording).toHaveBeenCalledOnce();

      unmount();
      expect(harness.stopRecording).toHaveBeenCalledOnce();
      expect(harness.createObjectURL).not.toHaveBeenCalled();

      harness.resolveStop();
      await waitFor(() => expect(harness.createObjectURL).toHaveBeenCalledOnce());
      expect(harness.startRecording).toHaveBeenCalledOnce();
    } finally {
      harness.restore();
    }
  });

  it('stops recording resources on genuine unmount without starting media', async () => {
    const harness = await installVoiceBarRecording({ deferred: true });
    try {
      seedVoiceStore([]);
      const { getByTestId, unmount } = render(() => <VoiceBar />);
      openCallMore(getByTestId);
      fireEvent.click(getByTestId('record-button'));
      expect(harness.startRecording).toHaveBeenCalledOnce();
      expect(harness.stopRecording).not.toHaveBeenCalled();

      unmount();
      await waitFor(() => expect(harness.stopRecording).toHaveBeenCalledOnce());
      expect(harness.startRecording).toHaveBeenCalledOnce();

      harness.resolveStop();
      await waitFor(() => expect(harness.createObjectURL).toHaveBeenCalledOnce());
      expect(harness.stopRecording).toHaveBeenCalledOnce();
    } finally {
      harness.restore();
    }
  });

  it('disables recording when MediaRecorder is unavailable', () => {
    const g = globalThis as unknown as { MediaRecorder?: unknown };
    const prevRecorder = g.MediaRecorder;
    Reflect.deleteProperty(globalThis, 'MediaRecorder');
    try {
      seedVoiceStore([]);
      const { getByTestId } = render(() => <VoiceBar />);
      openCallMore(getByTestId);
      const btn = getByTestId('record-button');
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('aria-label', 'Recording unavailable');
    } finally {
      if (prevRecorder === undefined) {
        Reflect.deleteProperty(globalThis, 'MediaRecorder');
      } else {
        g.MediaRecorder = prevRecorder;
      }
    }
  });

  it('builds a stamped local recording filename from the mime type', () => {
    const date = new Date('2026-07-21T12:34:56.000Z');
    expect(localRecordingFilename('audio/webm;codecs=opus', date)).toBe(
      'onyx-call-2026-07-21T12-34-56.webm',
    );
    expect(localRecordingFilename('audio/ogg', date)).toBe('onyx-call-2026-07-21T12-34-56.ogg');
  });

  it('downloads a local recording blob through an anchor and schedules URL cleanup', async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rec');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const activated: string[] = [];
    const realCreateElement = document.createElement.bind(document);
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === 'a') {
        const anchor = el as HTMLAnchorElement;
        anchor.click = () => { activated.push(anchor.download); };
      }
      return el;
    });
    try {
      downloadLocalRecording(new Blob(['x'], { type: 'audio/webm' }), 'onyx-call-test.webm');
      expect(activated).toEqual(['onyx-call-test.webm']);
      expect(createObjectURL).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:rec');
    } finally {
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
      createElement.mockRestore();
      vi.useRealTimers();
    }
  });

  it('keeps the screenshare control in place while server availability changes', () => {
    // Arrange
    seedVoiceStore([]);
    setDisplayCapture(vi.fn().mockResolvedValue({} as MediaStream));

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    openCallMore(getByTestId);
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

  it('shows people on the call plus sentence-case mute, video, and leave', () => {
    seedVoiceStore([makePeer('alice')]);
    const { getByTestId } = render(() => <VoiceBar />);
    expect(getByTestId('call-people').textContent).toMatch(/You/);
    expect(getByTestId('call-people').textContent).toMatch(/alice/i);
    expect(getByTestId('participant-count')).toHaveTextContent('2 people');
    expect(getByTestId('mute-button')).toHaveTextContent('Mute');
    expect(getByTestId('camera-button')).toHaveTextContent('Video');
    expect(getByTestId('leave-button')).toHaveTextContent('Leave');
    expect(getByTestId('invite-to-call')).toHaveTextContent('Invite');
    expect(getByTestId('mute-button').className).toMatch(/voice-bar__action/);
  });

  it('copies the room invite link instead of inventing a call protocol', async () => {
    seedVoiceStore([]);
    const writeSpy = vi.spyOn(clipboard, 'writeClipboardText').mockResolvedValue(true);
    const { getByTestId } = render(() => <VoiceBar />);
    fireEvent.click(getByTestId('invite-to-call'));
    await waitFor(() => expect(writeSpy).toHaveBeenCalled());
    const copied = String(writeSpy.mock.calls[0]?.[0] ?? '');
    expect(copied).toContain('join=%23media');
    expect(copied).not.toMatch(/call=|cadence|media=/i);
    expect(getByTestId('invite-status')).toHaveTextContent('Invite link copied');
    writeSpy.mockRestore();
  });

  it('raise-hand button calls toggleRaiseHand and reflects pressed state', () => {
    // Arrange
    seedVoiceStore([]);
    const spy = vi.spyOn(store.getState(), 'toggleRaiseHand').mockImplementation(() => {
      store.setState(s => ({ voice: { ...s.voice, handRaised: !s.voice.handRaised } }));
    });

    // Act
    const { getByTestId } = render(() => <VoiceBar />);
    openCallMore(getByTestId);
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
    openCallMore(getByTestId);
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
    openCallMore(getByTestId);
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
    openCallMore(getByTestId);
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
    openCallMore(getByTestId);
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
    openCallMore(getByTestId);
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
    openCallMore(getByTestId);
    fireEvent.click(getByTestId('settings-button'));

    // Assert
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('updates the duration timer without making each tick a live announcement', () => {
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
    expect(timer).not.toHaveAttribute('aria-live', 'polite');
    expect(timer).not.toHaveAttribute('aria-live', 'assertive');

    vi.advanceTimersByTime(1_000);

    expect(timer).toHaveTextContent('01:06');
    expect(timer).toHaveAttribute('aria-label', 'Call duration: 1m 6s');
  });

  it('does not start a call-duration timer while the call is only ringing', () => {
    store.setState(s => ({
      voice: {
        ...s.voice,
        callState: 'ringing_out',
        callWith: 'Mina',
        callStartedAt: null,
      },
    }));

    const { getByTestId, queryByRole } = render(() => <VoiceBar />);

    const bar = getByTestId('voice-bar');
    expect(bar).toBeInTheDocument();
    expect(queryByRole('timer')).toBeNull();
    expect(bar.querySelector('.voice-bar__dot')).toBeNull();
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
    openCallMore(getByTestId);
    fireEvent.click(getByTestId('reactions-button'));
    fireEvent.click(getByTestId('reaction-🎉'));

    // Assert
    expect(spy).toHaveBeenCalledWith('🎉');
    spy.mockRestore();
  });

  it('opens a named reaction dialog, focuses the first item, and roves with every menu navigation key', async () => {
    seedVoiceStore([]);

    const { getByRole, getByTestId } = render(() => <VoiceBar />);
    openCallMore(getByTestId);
    const trigger = getByRole('button', { name: 'Send a reaction' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = getByRole('dialog', { name: 'Send a reaction' });
    const items = within(dialog).getAllByRole('menuitem');
    await waitFor(() => expect(items[0]).toHaveFocus());
    expect(items[0]).toHaveAttribute('tabindex', '0');
    expect(items[1]).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(items[0]!, { key: 'ArrowRight' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1]!, { key: 'ArrowDown' });
    expect(items[2]).toHaveFocus();
    fireEvent.keyDown(items[2]!, { key: 'ArrowLeft' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1]!, { key: 'ArrowUp' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0]!, { key: 'End' });
    expect(items.at(-1)).toHaveFocus();
    fireEvent.keyDown(items.at(-1)!, { key: 'Home' });
    expect(items[0]).toHaveFocus();
  });

  it('activates reactions exactly once with Enter and Space and restores the trigger', async () => {
    seedVoiceStore([]);
    const spy = vi.spyOn(store.getState(), 'sendCallReaction').mockImplementation(() => {});

    const { getByRole, getByTestId } = render(() => <VoiceBar />);
    openCallMore(getByTestId);
    const trigger = getByRole('button', { name: 'Send a reaction' });
    trigger.focus();
    fireEvent.click(trigger);
    const enterItem = getByRole('menuitem', { name: 'React with 👍' });
    await waitFor(() => expect(enterItem).toHaveFocus());

    fireEvent.keyDown(enterItem, { key: 'Enter' });
    fireEvent.keyUp(enterItem, { key: 'Enter' });
    fireEvent.click(enterItem);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith('👍');
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    const spaceItem = getByRole('menuitem', { name: 'React with 👍' });
    await waitFor(() => expect(spaceItem).toHaveFocus());
    fireEvent.keyDown(spaceItem, { key: ' ' });
    fireEvent.keyUp(spaceItem, { key: ' ' });
    fireEvent.click(spaceItem);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith('👍');
    await waitFor(() => expect(trigger).toHaveFocus());

    spy.mockRestore();
  });

  it('closes the reaction picker with Escape and restores focus without sending', async () => {
    seedVoiceStore([]);
    const spy = vi.spyOn(store.getState(), 'sendCallReaction').mockImplementation(() => {});

    const { getByRole, getByTestId, queryByRole } = render(() => <VoiceBar />);
    openCallMore(getByTestId);
    const trigger = getByRole('button', { name: 'Send a reaction' });
    trigger.focus();
    fireEvent.click(trigger);
    const item = getByRole('menuitem', { name: 'React with 👍' });
    await waitFor(() => expect(item).toHaveFocus());

    fireEvent.keyDown(item, { key: 'Escape' });

    await waitFor(() => expect(queryByRole('dialog', { name: 'Send a reaction' })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ── Store voice slice ───────────────────────────────────────────────────────

describe('store voice slice — in-call actions', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  it('joinVoiceChannel honours muteOnJoin after capture succeeds', async () => {
    const audioTrack = { enabled: true, stop: vi.fn() };
    const stream = {
      getAudioTracks: () => [audioTrack],
      getVideoTracks: () => [],
      getTracks: () => [audioTrack],
    } as unknown as MediaStream;

    const setMuted = vi.fn();
    const engine = {
      joinVoice: vi.fn(async () => undefined),
      joinVideo: vi.fn(async () => undefined),
      getLocalStream: vi.fn(() => stream),
      setMuted,
      leaveRoom: vi.fn(),
      sendReaction: vi.fn(),
      getNetworkStats: vi.fn(() => ({ tier: 0, suggestedBps: 0, jitterMs: 0, lossRate: 0 })),
    };

    const { setMountedCadenceMediaEngine } = await import('@/lib/cadence-media/MediaEngine');
    setMountedCadenceMediaEngine(engine as never);

    try {
      store.setState({
        ...initialState,
        client: { sendRaw: vi.fn() } as never,
        ourNick: 'self',
        voice: { ...initialState.voice, muteOnJoin: true, muted: false },
      }, true);

      await store.getState().joinVoiceChannel('#media', false);

      expect(engine.joinVoice).toHaveBeenCalledWith('#media', null);
      expect(audioTrack.enabled).toBe(false);
      expect(store.getState().voice.callState).toBe('in_call');
      expect(store.getState().voice.muted).toBe(true);
      expect(setMuted).toHaveBeenCalledWith(true);
    } finally {
      setMountedCadenceMediaEngine(null);
    }
  });

  it('joinVoiceChannel leaves muted false when muteOnJoin is off', async () => {
    const audioTrack = { enabled: true, stop: vi.fn() };
    const stream = {
      getAudioTracks: () => [audioTrack],
      getVideoTracks: () => [],
      getTracks: () => [audioTrack],
    } as unknown as MediaStream;

    const setMuted = vi.fn();
    const engine = {
      joinVoice: vi.fn(async () => undefined),
      joinVideo: vi.fn(async () => undefined),
      getLocalStream: vi.fn(() => stream),
      setMuted,
      leaveRoom: vi.fn(),
      sendReaction: vi.fn(),
      getNetworkStats: vi.fn(() => ({ tier: 0, suggestedBps: 0, jitterMs: 0, lossRate: 0 })),
    };

    const { setMountedCadenceMediaEngine } = await import('@/lib/cadence-media/MediaEngine');
    setMountedCadenceMediaEngine(engine as never);

    try {
      store.setState({
        ...initialState,
        client: { sendRaw: vi.fn() } as never,
        ourNick: 'self',
        voice: { ...initialState.voice, muteOnJoin: false, muted: true },
      }, true);

      await store.getState().joinVoiceChannel('#media', false);

      expect(store.getState().voice.muted).toBe(false);
      expect(audioTrack.enabled).toBe(true);
      expect(setMuted).toHaveBeenCalledWith(false);
    } finally {
      setMountedCadenceMediaEngine(null);
    }
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
    const peers = new Map<string, CadencePeerState>();
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
    const { getByRole, getByTestId } = render(() => <VoiceBar />);
    openCallMore(getByTestId);

    // Assert — getByRole throws on a duplicate/nested button, so this proves the
    // trigger is a single tab stop with a real accessible name.
    expect(getByRole('button', { name: 'Send a reaction' })).toBeInTheDocument();
  });

  it('exposes a single named button for the spatial-audio trigger', () => {
    // Arrange — mediaAvailable so the spatial popover (not the disabled fallback) renders
    seedVoiceStore([], [makeChannelUser('self')], {});
    store.setState((s) => ({ mediaAvailable: true, voice: { ...s.voice } }));

    // Act
    const { getByRole, getByTestId } = render(() => <VoiceBar />);
    openCallMore(getByTestId);

    // Assert — name comes from the (now non-interactive) labelled child span
    expect(getByRole('button', { name: /Spatial audio controls/ })).toBeInTheDocument();
  });
});
