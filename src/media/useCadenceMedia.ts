// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, onCleanup } from 'solid-js';

import {
  getState,
  MAX_LIVE_MEDIA_CHANNELS,
  MAX_LIVE_MEDIA_PARTICIPANTS,
  selectDeviceMemoryOwner,
  setState,
  useStore,
} from '@/lib/store';
import { peerKeyStatus, pinPeerTrustBinding } from '@/lib/e2ee/keyPinning';
import {
  MAX_VAULT_SENDER_LENGTH,
  MAX_VAULT_TARGET_LENGTH,
} from '@/lib/vault/historyVault';
import {
  CadenceMediaEngine,
  setMountedCadenceMediaEngine,
} from '@/lib/cadence-media/MediaEngine';
import type {
  NetworkQualityTier,
  CadenceChannelInfo,
  CadenceMediaCallbacks,
  CadencePeerState,
} from '@/lib/cadence-media/types';
import {
  classifyCodecFailure,
  codecFailureToastCopy,
  decodeFailureKey,
  isCodecFailureMessage,
  shouldAnnounceDecodeError,
  type CodecFailureMediaKind,
} from '@/lib/cadence-media/codecFailure';
import { isTypingTarget } from '@/lib/keyboard/shortcutsRegistry';
import { keyboardEventIsClaimed } from '@/primitives/focusTrap';

/** Per-peer auto-lower timers for raised hands signalled via the ✋ reaction. */
const _handTimers = new Map<string, number>();

/** Decode-failure toast keys already announced this call (R5 rate-limit). */
const _decodeFailureAnnounced = new Set<string>();

type CanvasStreamCacheEntry = {
  canvas: HTMLCanvasElement;
  stream: MediaStream;
};

type StreamStartDetail = {
  channel: string;
  mode: 'camera' | 'screen';
  quality?: 'auto' | '1080p60' | '4k60';
};

const canvasStreamCache = new Map<string, CanvasStreamCacheEntry>();

const MAX_MEDIA_CALLBACK_TEXT_LENGTH = 4 * 1024;
const MAX_MEDIA_CALLBACK_REACTION_LENGTH = 64;

function validMediaNick(nick: string): boolean {
  return nick.length > 0
    && nick.length <= MAX_VAULT_SENDER_LENGTH
    && !nick.startsWith(':')
    && !nick.includes(',')
    && !/[\u0000-\u0020\u007f]/u.test(nick);
}

function validMediaChannel(channel: string | null): channel is string {
  return Boolean(
    channel
    && channel.length <= MAX_VAULT_TARGET_LENGTH
    && '#&'.includes(channel[0] ?? '')
    && !channel.includes(',')
    && !/[\u0000-\u0020\u007f]/u.test(channel),
  );
}

function caseInsensitiveKey<T>(source: ReadonlyMap<string, T>, value: string): string | null {
  const key = value.toLowerCase();
  for (const candidate of source.keys()) {
    if (candidate.toLowerCase() === key) return candidate;
  }
  return null;
}

function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach(track => track.stop());
}

function clearCachedPeerStream(nick: string): void {
  const cached = canvasStreamCache.get(nick);
  stopStream(cached?.stream);
  canvasStreamCache.delete(nick);
}

function clearCachedPeerStreams(): void {
  for (const cached of canvasStreamCache.values()) stopStream(cached.stream);
  canvasStreamCache.clear();
}

function canvasStreamForPeer(peer: CadencePeerState): MediaStream | null {
  const canvas = peer.canvas;
  if (!canvas || !('captureStream' in canvas)) return null;

  const cached = canvasStreamCache.get(peer.nick);
  if (cached?.canvas === canvas) return cached.stream;

  stopStream(cached?.stream);
  const stream = (canvas as HTMLCanvasElement & {
    captureStream(fps?: number): MediaStream;
  }).captureStream(60);
  canvasStreamCache.set(peer.nick, { canvas, stream });
  return stream;
}

function removeNickFromVoicePresence(nick: string): void {
  if (!validMediaNick(nick)) return;
  const lowerNick = nick.toLowerCase();
  setState(state => {
    let changed = false;
    const voiceChannelParticipants = new Map(state.voiceChannelParticipants);

    for (const [channel, participants] of voiceChannelParticipants) {
      const next = new Set(participants);
      for (const participant of participants) {
        if (participant.toLowerCase() === lowerNick) next.delete(participant);
      }
      if (next.size !== participants.size) {
        changed = true;
        if (next.size === 0) voiceChannelParticipants.delete(channel);
        else voiceChannelParticipants.set(channel, next);
      }
    }

    return changed ? { voiceChannelParticipants } : {};
  });
}

function setVoicePresence(nick: string, channel: string | null, available: boolean): void {
  if (!validMediaNick(nick) || !validMediaChannel(channel)) return;

  const channelKey = channel.toLowerCase();
  const lowerNick = nick.toLowerCase();
  setState(state => {
    const voiceChannelParticipants = new Map(state.voiceChannelParticipants);
    if (
      available
      && !voiceChannelParticipants.has(channelKey)
      && voiceChannelParticipants.size >= MAX_LIVE_MEDIA_CHANNELS
    ) return {};
    const participants = new Set(voiceChannelParticipants.get(channelKey) ?? []);

    for (const participant of participants) {
      if (participant.toLowerCase() === lowerNick) participants.delete(participant);
    }
    if (available) {
      if (participants.size >= MAX_LIVE_MEDIA_PARTICIPANTS) return {};
      participants.add(nick);
    }

    if (participants.size === 0) voiceChannelParticipants.delete(channelKey);
    else voiceChannelParticipants.set(channelKey, participants);
    return { voiceChannelParticipants, mediaAvailable: true };
  });
}

function dispatchWindowEvent(name: string, detail: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Match a KeyboardEvent against the VoiceSettings-captured push-to-talk key.
 * Capture stores `event.key` (with space normalised to `'Space'`).
 */
function eventMatchesPttKey(event: KeyboardEvent, boundKey: string): boolean {
  if (boundKey === 'Space') return event.key === ' ' || event.key === 'Space';
  return event.key === boundKey;
}

/**
 * Mount the CADENCE media engine once under a Solid owner at app root.
 */
export function mountMedia(): void {
  let engine: CadenceMediaEngine | null = null;
  let previousScreenshareActive = false;

  const client = useStore(state => state.client);
  const deafened = useStore(state => state.voice.deafened);
  const outputDeviceId = useStore(state => state.voice.outputDeviceId);
  const outputVolume = useStore(state => state.voice.outputVolume);
  const pushToTalk = useStore(state => state.voice.pushToTalk);
  const pushToTalkKey = useStore(state => state.voice.pushToTalkKey);
  const screenshareActive = useStore(state => state.voice.screenshareActive);
  const activeView = useStore(state => state.activeView);

  const callbacks: CadenceMediaCallbacks = {
    onCallState(state, nick, channel) {
      const safeNick = validMediaNick(nick) ? nick : '';
      const safeChannel = validMediaChannel(channel) ? channel : null;
      // Fresh call → re-arm R5 decode toasts for new peers/sessions.
      if (state === 'idle') {
        _decodeFailureAnnounced.clear();
        // Full UI teardown. Engine setIdle used to only clear callState/channel,
        // leaving callStartedAt/localStream half-set so the stage flickered or
        // re-opened empty then vanished again.
        getState().setVoiceCallState({
          callState: 'idle',
          callWith: '',
          callChannel: null,
          callStartedAt: null,
          localStream: null,
          cameraOn: false,
          cameraStream: null,
          screenshareActive: false,
          screenshareStream: null,
          peers: new Map(),
          videoParticipants: new Map(),
          pinnedParticipant: null,
          handRaised: false,
          raisedHands: new Set<string>(),
          stageSize: 'compact',
        });
        return;
      }
      // Never wipe an established callChannel with null — setCallState('in_call',
      // '', room) is fine, but a partial callback with an unvalidated channel
      // must not make viewingCall() false and unmount the stage mid-call.
      const prevChannel = getState().voice.callChannel;
      getState().setVoiceCallState({
        callState: state,
        callWith: safeNick,
        callChannel: safeChannel ?? prevChannel,
      });
    },

    onPeerState(peer) {
      if (!validMediaNick(peer.nick) || !validMediaChannel(peer.channel)) return;
      const state = getState();
      const peers = new Map(state.voice.peers);
      const existingPeerKey = caseInsensitiveKey(peers, peer.nick);
      if (!existingPeerKey && peers.size >= MAX_LIVE_MEDIA_PARTICIPANTS) return;
      if (existingPeerKey && existingPeerKey !== peer.nick) {
        peers.delete(existingPeerKey);
        clearCachedPeerStream(existingPeerKey);
      }
      peers.set(peer.nick, peer);

      const videoParticipants = new Map(state.voice.videoParticipants);
      const existingVideoKey = caseInsensitiveKey(videoParticipants, peer.nick);
      const existingVideo = existingVideoKey ? videoParticipants.get(existingVideoKey) : undefined;
      if (existingVideoKey && existingVideoKey !== peer.nick) videoParticipants.delete(existingVideoKey);
      const screenStream = engine?.getScreenStream(peer.nick) ?? null;
      const canvasStream = screenStream ? null : canvasStreamForPeer(peer);
      const mediaStream = screenStream ?? canvasStream;

      if (peer.hasVideo && mediaStream && existingVideo !== mediaStream) {
        videoParticipants.set(peer.nick, mediaStream);
      } else if (!peer.hasVideo) {
        videoParticipants.delete(peer.nick);
        clearCachedPeerStream(peer.nick);
      }

      state.setVoiceCallState({ peers, videoParticipants });
      setVoicePresence(peer.nick, peer.channel, true);
      state.setSpeakingNick(peer.nick, peer.speaking);
    },

    onPeerLeft(nick) {
      if (!validMediaNick(nick)) return;
      const state = getState();
      const peers = new Map(state.voice.peers);
      const peerKey = caseInsensitiveKey(peers, nick);
      if (peerKey) peers.delete(peerKey);

      const videoParticipants = new Map(state.voice.videoParticipants);
      const videoKey = caseInsensitiveKey(videoParticipants, nick);
      if (videoKey) videoParticipants.delete(videoKey);

      clearCachedPeerStream(peerKey ?? nick);
      // Allow a future rejoin of the same nick to re-announce codec failure.
      for (const key of [..._decodeFailureAnnounced]) {
        if (key.startsWith(`${nick.toLowerCase()}:`)) _decodeFailureAnnounced.delete(key);
      }
      state.setVoiceCallState({ peers, videoParticipants });
      state.setSpeakingNick(nick, false);
      removeNickFromVoicePresence(nick);
    },

    onPeerSpeaking(nick, speaking) {
      if (!validMediaNick(nick)) return;
      const state = getState();
      const peers = new Map(state.voice.peers);
      const peerKey = caseInsensitiveKey(peers, nick);
      const peer = peerKey ? peers.get(peerKey) : undefined;
      if (peer && peerKey) peers.set(peerKey, { ...peer, speaking });
      state.setVoiceCallState({ peers });
      state.setSpeakingNick(nick, speaking);
    },

    onLocalStream(stream) {
      const kind = engine?.getLocalKind() ?? null;
      getState().setVoiceCallState({
        localStream: stream,
        cameraStream: kind === 'video' ? stream : null,
        cameraOn: kind === 'video' && !!stream,
        screenshareStream: kind === 'screen' ? stream : null,
        screenshareActive: kind === 'screen' && !!stream,
      });
    },

    onRoomStats(channel, stats) {
      if (!validMediaChannel(channel)) return;
      const state = getState();
      const roomStats = new Map(state.voice.roomStats);
      if (!roomStats.has(channel) && roomStats.size >= MAX_LIVE_MEDIA_CHANNELS) return;
      roomStats.set(channel, stats);
      state.setVoiceCallState({ roomStats });
    },

    onError(message) {
      const safeMessage = message.slice(0, MAX_MEDIA_CALLBACK_TEXT_LENGTH);
      // Both surfaces: the inbox keeps a record, the toast makes the failure
      // visible AT THE MOMENT it happens (a silent camera/permission failure
      // reads as "clicking Join video does nothing").
      getState().addNotification({ type: 'error', text: `Voice: ${safeMessage}` });
      // Research R5 — codec init/ladder exhaust gets a dedicated fail-closed toast
      // (never a generic "Media error" that users miss as black video).
      if (isCodecFailureMessage(safeMessage)) {
        const kind = classifyCodecFailure(safeMessage);
        const copy = codecFailureToastCopy(kind, { rawMessage: safeMessage });
        getState().addToast({
          variant: 'error',
          title: copy.title,
          description: copy.description,
          duration: 7000,
          groupKey: `codec-fail-${kind}`,
        });
        return;
      }
      getState().addToast({
        variant: 'error',
        title: 'Media error',
        description: safeMessage,
      });
    },

    onDecodeError(peer, type, err) {
      // Decode errors are non-fatal for the call, but R5 requires a fail-closed
      // toast so a peer codec mismatch never presents as silent black video.
      if (!validMediaNick(peer)) return;
      const mediaKind: CodecFailureMediaKind =
        type === 'screen' ? 'screen' : type === 'voice' ? 'voice' : 'video';
      // Audio decode glitches are common under packet loss — only toast video/
      // screenshare so we don't spam on transient voice frames.
      if (mediaKind === 'voice') return;
      const key = decodeFailureKey(peer, mediaKind);
      if (!shouldAnnounceDecodeError(_decodeFailureAnnounced, key)) return;
      _decodeFailureAnnounced.add(key);
      const raw = err instanceof Error ? err.message : String(err ?? '');
      const kind = classifyCodecFailure(raw || 'decode failed');
      const copy = codecFailureToastCopy(
        kind === 'unknown' ? 'decode' : kind,
        { peer, mediaKind, rawMessage: raw },
      );
      getState().addToast({
        variant: 'error',
        title: copy.title,
        description: copy.description,
        duration: 6000,
        groupKey: `codec-decode-${key}`,
      });
    },

    onAudioLevel(nick, level) {
      if (!validMediaNick(nick) || !Number.isFinite(level)) return;
      dispatchWindowEvent('onyx:voice-audio-level', { nick, level });
    },

    onPresence(nick, available) {
      if (!validMediaNick(nick)) return;
      dispatchWindowEvent('onyx:voice-presence', { nick, available });
      if (!available) {
        removeNickFromVoicePresence(nick);
      }
    },

    onNetworkQuality(tier: NetworkQualityTier, suggestedBps: number) {
      dispatchWindowEvent('onyx:voice-network', { tier, suggestedBps });
    },

    onReaction(nick, emoji) {
      if (
        !validMediaNick(nick)
        || emoji.length === 0
        || emoji.length > MAX_MEDIA_CALLBACK_REACTION_LENGTH
        || /[\u0000-\u001f\u007f]/u.test(emoji)
        || !caseInsensitiveKey(getState().voice.peers, nick)
      ) return;
      dispatchWindowEvent('onyx:voice-reaction', { nick, emoji });
      // A ✋ reaction is the raise-hand signal (toggleRaiseHand emits it on raise;
      // there is no explicit lower signal), so surface the peer's raised hand and
      // auto-clear it after a window so a stale hand doesn't linger forever.
      if (emoji === '✋') {
        getState().setPeerHandRaised(nick, true);
        const prev = _handTimers.get(nick);
        if (prev) clearTimeout(prev);
        _handTimers.set(
          nick,
          setTimeout(() => {
            getState().setPeerHandRaised(nick, false);
            _handTimers.delete(nick);
          }, 15000) as unknown as number,
        );
      }
    },

    onRecordingAlert(nick, started) {
      if (!validMediaNick(nick)) return;
      getState().addToast({
        variant: started ? 'warning' : 'info',
        title: started ? 'Recording started' : 'Recording stopped',
        description: started
          ? `${nick} is recording this call`
          : `${nick} stopped recording`,
        duration: 5000,
      });
    },

    onRoomNearFull() {
      getState().addToast({
        variant: 'warning',
        title: 'Room near capacity',
        description: 'This voice room is almost full.',
        duration: 5000,
      });
    },

    onRecordConsent(nick) {
      if (!validMediaNick(nick)) return;
      getState().addToast({
        variant: 'warning',
        title: 'Recording request',
        description: `${nick} requested recording consent.`,
        duration: 5000,
      });
    },

    onChannelInfo(channel: string, info: CadenceChannelInfo) {
      dispatchWindowEvent('onyx:voice-channel-info', { channel, info });
    },

    onMooringState(nick, epoch, fingerprint) {
      dispatchWindowEvent('onyx:voice-mooring', { nick, epoch, fingerprint });
    },

    onMediaE2eeState(active, degraded, epoch) {
      getState().setVoiceCallState({
        mediaE2eeActive: active,
        mediaE2eeDegraded: degraded,
        mediaE2eeEpoch: epoch,
      });
      dispatchWindowEvent('onyx:voice-e2ee', { active, degraded, epoch });
    },

    async verifyPeerMediaKey(nick, publicKeyB64url, _attachmentId, trustBinding) {
      if (!validMediaNick(nick)) return false;
      const state = getState();
      const owner = selectDeviceMemoryOwner(state);
      if (!owner) return false;
      // Trust follows the enrolled durable signing identity, not the random
      // per-connection attachment route. Reconnects retain continuity while
      // separately enrolled devices keep independent trust buckets.
      const trustSubject = `${nick.toLowerCase()}#media-device#${trustBinding}`;
      const verdict = await peerKeyStatus(trustSubject, trustBinding, owner);
      if (verdict === 'changed') {
        await state._flagPeerKeyChange(nick, publicKeyB64url);
        return false;
      }
      if (verdict === 'unreadable') return false;
      if (verdict === 'first-use') {
        return pinPeerTrustBinding(trustSubject, trustBinding, owner);
      }
      return true;
    },

    enableVideoCalls: () => true,
    enableVoiceCalls: () => true,

    getMediaSettings() {
      const voice = getState().voice;
      return {
        inputDeviceId: voice.inputDeviceId,
        cameraDeviceId: voice.cameraDeviceId,
        outputDeviceId: voice.outputDeviceId,
        outputVolume: voice.outputVolume,
        noiseSuppression: voice.noiseSuppression,
        echoCancellation: voice.echoCancellation,
      };
    },

    getLocalNick: () => getState().ourNick,
  };

  engine = new CadenceMediaEngine(callbacks, { kind: 'video' });
  setMountedCadenceMediaEngine(engine);

  createEffect(() => {
    engine?.setClient(client());
  });

  createEffect(() => {
    engine?.setDeafened(deafened());
  });

  createEffect(() => {
    engine?.setOutput(outputDeviceId(), outputVolume());
  });

  // Push-to-talk: mirror the store flag into the engine on every setting change
  // (and on initial mount / re-join). When enabled the engine mutes local audio
  // until pttPress; when disabled it restores open-mic.
  createEffect(() => {
    engine?.setPushToTalk(pushToTalk());
  });

  // Window keydown/keyup for the bound PTT key. Rebinds when the flag or key
  // changes; onCleanup removes listeners and releases a held press so a setting
  // flip mid-hold never leaves the mic stuck open.
  createEffect(() => {
    const enabled = pushToTalk();
    const boundKey = pushToTalkKey();
    if (!enabled || !boundKey || typeof window === 'undefined') return;

    let held = false;

    const release = () => {
      if (!held) return;
      held = false;
      engine?.pttRelease();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // IME / already-claimed keys, auto-repeat, and typing targets never arm PTT.
      if (keyboardEventIsClaimed(event) || event.repeat || held) return;
      if (!eventMatchesPttKey(event, boundKey)) return;
      if (isTypingTarget(event.target)) return;
      // Modifier chords (Ctrl+V paste, etc.) are not a PTT hold.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      held = true;
      // Space would otherwise scroll the page while held as PTT.
      event.preventDefault();
      engine?.pttPress();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!held || !eventMatchesPttKey(event, boundKey)) return;
      release();
    };

    const onBlur = () => {
      release();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      release();
    });
  });

  createEffect(() => {
    const active = screenshareActive();
    const view = activeView();
    const channel = view.kind === 'channel'
      ? view.channel
      : getState().voice.callChannel;
    const wasActive = previousScreenshareActive;
    previousScreenshareActive = active;

    if (!channel || active === wasActive) return;

    if (active) {
      if (!engine?.getLocalStream()) void engine?.startScreenShare(channel);
    } else if (engine?.getLocalKind() === 'screen') {
      engine.stopBroadcast(channel);
    }
  });

  if (typeof window !== 'undefined') {
    const startHandler = (event: Event) => {
      const detail = (event as CustomEvent<StreamStartDetail>).detail;
      if (!detail?.channel) return;
      void engine?.startBroadcast(
        detail.channel,
        detail.mode,
        detail.quality ?? '4k60',
      );
    };

    const stopHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ channel: string }>).detail;
      if (!detail?.channel) return;
      engine?.stopBroadcast(detail.channel);
    };

    window.addEventListener('onyx:stream-start', startHandler);
    window.addEventListener('onyx:stream-stop', stopHandler);
    onCleanup(() => {
      window.removeEventListener('onyx:stream-start', startHandler);
      window.removeEventListener('onyx:stream-stop', stopHandler);
    });
  }

  onCleanup(() => {
    engine?.destroy();
    clearCachedPeerStreams();
    for (const timer of _handTimers.values()) clearTimeout(timer);
    _handTimers.clear();
    setMountedCadenceMediaEngine(null);
    engine = null;
  });
}
