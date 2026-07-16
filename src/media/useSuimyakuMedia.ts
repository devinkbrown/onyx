// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, onCleanup } from 'solid-js';

import {
  getState,
  MAX_LIVE_MEDIA_CHANNELS,
  MAX_LIVE_MEDIA_PARTICIPANTS,
  setState,
  useStore,
} from '@/lib/store';
import {
  MAX_VAULT_SENDER_LENGTH,
  MAX_VAULT_TARGET_LENGTH,
} from '@/lib/vault/historyVault';
import {
  SuimyakuMediaEngine,
  setMountedSuimyakuMediaEngine,
} from '@/lib/suimyaku-media/MediaEngine';
import type {
  NetworkQualityTier,
  SuimyakuChannelInfo,
  SuimyakuMediaCallbacks,
  SuimyakuPeerState,
} from '@/lib/suimyaku-media/types';

/** Per-peer auto-lower timers for raised hands signalled via the ✋ reaction. */
const _handTimers = new Map<string, number>();

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

function canvasStreamForPeer(peer: SuimyakuPeerState): MediaStream | null {
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
 * Mount the SUIMYAKU media engine once under a Solid owner at app root.
 */
export function mountMedia(): void {
  let engine: SuimyakuMediaEngine | null = null;
  let previousScreenshareActive = false;

  const client = useStore(state => state.client);
  const deafened = useStore(state => state.voice.deafened);
  const outputDeviceId = useStore(state => state.voice.outputDeviceId);
  const outputVolume = useStore(state => state.voice.outputVolume);
  const screenshareActive = useStore(state => state.voice.screenshareActive);
  const activeView = useStore(state => state.activeView);

  const callbacks: SuimyakuMediaCallbacks = {
    onCallState(state, nick, channel) {
      const safeNick = validMediaNick(nick) ? nick : '';
      const safeChannel = validMediaChannel(channel) ? channel : null;
      getState().setVoiceCallState({
        callState: state,
        callWith: safeNick,
        callChannel: safeChannel,
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
      getState().addToast({
        variant: 'error',
        title: 'Media error',
        description: safeMessage,
      });
    },

    onDecodeError() {
      // Decode errors are non-fatal; the engine handles peer reset/recovery.
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
      dispatchWindowEvent('ocean:voice-network', { tier, suggestedBps });
    },

    onReaction(nick, emoji) {
      if (
        !validMediaNick(nick)
        || emoji.length === 0
        || emoji.length > MAX_MEDIA_CALLBACK_REACTION_LENGTH
        || /[\u0000-\u001f\u007f]/u.test(emoji)
        || !caseInsensitiveKey(getState().voice.peers, nick)
      ) return;
      dispatchWindowEvent('ocean:voice-reaction', { nick, emoji });
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

    onChannelInfo(channel: string, info: SuimyakuChannelInfo) {
      dispatchWindowEvent('onyx:voice-channel-info', { channel, info });
    },

    onTsumugiState(nick, epoch, fingerprint) {
      dispatchWindowEvent('onyx:voice-tsumugi', { nick, epoch, fingerprint });
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

  engine = new SuimyakuMediaEngine(callbacks, { kind: 'video' });
  setMountedSuimyakuMediaEngine(engine);

  createEffect(() => {
    engine?.setClient(client());
  });

  createEffect(() => {
    engine?.setDeafened(deafened());
  });

  createEffect(() => {
    engine?.setOutput(outputDeviceId(), outputVolume());
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

    window.addEventListener('ocean:stream-start', startHandler);
    window.addEventListener('ocean:stream-stop', stopHandler);
    onCleanup(() => {
      window.removeEventListener('ocean:stream-start', startHandler);
      window.removeEventListener('ocean:stream-stop', stopHandler);
    });
  }

  onCleanup(() => {
    engine?.destroy();
    clearCachedPeerStreams();
    for (const timer of _handTimers.values()) clearTimeout(timer);
    _handTimers.clear();
    setMountedSuimyakuMediaEngine(null);
    engine = null;
  });
}
