'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useOnyxStore } from '@/lib/store';
import { SuimyakuMediaEngine, setMountedSuimyakuMediaEngine } from '@/lib/suimyaku-media/MediaEngine';
import type { SuimyakuMediaCallbacks } from '@/lib/suimyaku-media/types';
import type { IRCMessage } from '@/lib/irc/types';

/**
 * useSuimyakuMedia
 *
 * Creates and wires the SUIMYAKU MediaEngine to the Ocean store.
 * Mount once at AppShell level.
 *
 * Orochi media signaling arrives as NOTE MEDIA events:
 *   NOTE MEDIA <#channel> <verb> <nick> [detail...]
 * Local controls are sent with MEDIA <verb> <#channel> ...
 */
export function useSuimyakuMedia() {
  const client          = useOnyxStore(s => s.client);
  const setVoiceState   = useOnyxStore(s => s.setVoiceCallState);
  const addNotification = useOnyxStore(s => s.addNotification);
  const screenshareActive = useOnyxStore(s => s.voice.screenshareActive);
  const deafened        = useOnyxStore(s => s.voice.deafened);
  const outputDeviceId  = useOnyxStore(s => s.voice.outputDeviceId);
  const outputVolume    = useOnyxStore(s => s.voice.outputVolume);
  const activeView      = useOnyxStore(s => s.activeView);

  const engineRef         = useRef<SuimyakuMediaEngine | null>(null);
  const prevShareRef      = useRef<boolean>(false);
  // Cache canvas-captured streams per nick so onPeerState (which fires on
  // every speaking/mute change) reuses the existing MediaStream instead of
  // calling captureStream() each time and leaking a new stream every call.
  const canvasStreamRef   = useRef<Map<string, { canvas: HTMLCanvasElement; stream: MediaStream }>>(new Map());

  const channel = activeView.kind === 'channel' ? activeView.channel : null;

  // ── Boot the engine once ──────────────────────────────────────────────────
  useEffect(() => {
    const callbacks: SuimyakuMediaCallbacks = {
      onCallState(state, nick, ch) {
        setVoiceState({ callState: state, callWith: nick, callChannel: ch });
      },
      onPeerState(peer) {
        const peers = new Map(useOnyxStore.getState().voice.peers);
        peers.set(peer.nick, peer);
        const videoParticipants = new Map(useOnyxStore.getState().voice.videoParticipants);
        const existingVideo = videoParticipants.get(peer.nick);
        const screenStream = engineRef.current?.getScreenStream(peer.nick) ?? null;
        const cache = canvasStreamRef.current;
        let canvasStream: MediaStream | null = null;
        if (!screenStream && peer.canvas && 'captureStream' in peer.canvas) {
          const cached = cache.get(peer.nick);
          if (cached && cached.canvas === peer.canvas) {
            canvasStream = cached.stream;
          } else {
            // Canvas changed (or first sight) — drop the stale stream and
            // capture once, then reuse on subsequent peer-state updates.
            cached?.stream.getTracks().forEach(t => t.stop());
            canvasStream = (peer.canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(60);
            cache.set(peer.nick, { canvas: peer.canvas as HTMLCanvasElement, stream: canvasStream });
          }
        }
        const mediaStream = screenStream ?? canvasStream;
        if (peer.hasVideo && mediaStream && existingVideo !== mediaStream) {
          videoParticipants.set(peer.nick, mediaStream);
        } else if (!peer.hasVideo) {
          videoParticipants.delete(peer.nick);
          const cached = cache.get(peer.nick);
          cached?.stream.getTracks().forEach(t => t.stop());
          cache.delete(peer.nick);
        }
        setVoiceState({ peers, videoParticipants });
      },
      onPeerLeft(nick) {
        const peers = new Map(useOnyxStore.getState().voice.peers);
        peers.delete(nick);
        setVoiceState({ peers });
        // Remove video stream for this peer when they leave
        const videoParticipants = new Map(useOnyxStore.getState().voice.videoParticipants);
        videoParticipants.delete(nick);
        setVoiceState({ videoParticipants });
        const cached = canvasStreamRef.current.get(nick);
        cached?.stream.getTracks().forEach(t => t.stop());
        canvasStreamRef.current.delete(nick);
      },
      onPeerSpeaking(nick, speaking) {
        const peers = new Map(useOnyxStore.getState().voice.peers);
        const p = peers.get(nick);
        if (p) peers.set(nick, { ...p, speaking });
        setVoiceState({ peers });
      },
      onLocalStream(stream) {
        const kind = engineRef.current?.getLocalKind() ?? null;
        setVoiceState({
          localStream: stream,
          cameraStream: kind === 'video' ? stream : null,
          cameraOn: kind === 'video' && !!stream,
          screenshareStream: kind === 'screen' ? stream : null,
          screenshareActive: kind === 'screen' && !!stream,
        });
      },
      onRoomStats(ch, stats) {
        const roomStats = new Map(useOnyxStore.getState().voice.roomStats);
        roomStats.set(ch, stats);
        setVoiceState({ roomStats });
      },
      onError(msg) {
        addNotification({ type: 'error', text: `Voice: ${msg}` });
      },
      onDecodeError() {
        // Decode errors are non-fatal; engine handles recovery internally
      },
      onReaction(nick, emoji) {
        // Float a reaction in the call dock (ReactionsOverlay listens here).
        if (typeof window === 'undefined') return;
        window.dispatchEvent(
          new CustomEvent('ocean:voice-reaction', { detail: { nick, emoji } }),
        );
      },
      onRecordingAlert(nick, started) {
        useOnyxStore.getState().addToast({
          variant: started ? 'warning' : 'info',
          title: started ? 'Recording started' : 'Recording stopped',
          description: started
            ? `${nick} is recording this call`
            : `${nick} stopped recording`,
          duration: 5000,
        });
      },
      onNetworkQuality(tier, suggestedBps) {
        // ConnectionQuality polls the engine directly; this event lets any
        // other surface react to tier changes without polling.
        if (typeof window === 'undefined') return;
        window.dispatchEvent(
          new CustomEvent('ocean:voice-network', { detail: { tier, suggestedBps } }),
        );
      },
      enableVideoCalls: () => true,
      enableVoiceCalls: () => true,
      getMediaSettings: () => {
        const v = useOnyxStore.getState().voice;
        return {
          inputDeviceId: v.inputDeviceId,
          cameraDeviceId: v.cameraDeviceId,
          outputDeviceId: v.outputDeviceId,
          outputVolume: v.outputVolume,
          noiseSuppression: v.noiseSuppression,
          echoCancellation: v.echoCancellation,
        };
      },
      getLocalNick: () => useOnyxStore.getState().ourNick,
    };

    if (!engineRef.current) {
      engineRef.current = new SuimyakuMediaEngine(callbacks, { kind: 'voice' });
      setMountedSuimyakuMediaEngine(engineRef.current);
    }

    engineRef.current.setClient(client);

    if (!client) return;

    const fn = (msg: IRCMessage) => {
      if (msg.command !== 'NOTE' || (msg.params[0] ?? '').toUpperCase() !== 'MEDIA') return;

      const target   = msg.params[1];
      const subtype  = (msg.params[2] ?? '').toUpperCase();
      const fromNick = msg.params[3] ?? '';
      const payload  = msg.params.slice(4).join(' ');

      if (!fromNick || !target || !subtype) return;

      engineRef.current?.handleMediaMessage(fromNick, target, subtype, payload);
    };

    client.extraMessageHandlers.add(fn);

    return () => {
      client.extraMessageHandlers.delete(fn);
      engineRef.current?.setClient(null);
    };
  }, [client, setVoiceState, addNotification]);

  useEffect(() => {
    engineRef.current?.setOutput(outputDeviceId, outputVolume);
  }, [outputDeviceId, outputVolume]);

  useEffect(() => {
    engineRef.current?.setDeafened(deafened);
  }, [deafened]);

  useEffect(() => {
    const startHandler = (event: Event) => {
      const detail = (event as CustomEvent<{
        channel: string;
        mode: 'camera' | 'screen';
        quality?: 'auto' | '1080p60' | '4k60';
      }>).detail;
      if (!detail?.channel) return;
      void engineRef.current?.startBroadcast(
        `%%${detail.channel}`,
        detail.mode,
        detail.quality ?? '4k60',
      );
    };

    const stopHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ channel: string }>).detail;
      if (!detail?.channel) return;
      engineRef.current?.stopBroadcast(`%%${detail.channel}`);
    };

    window.addEventListener('ocean:stream-start', startHandler);
    window.addEventListener('ocean:stream-stop', stopHandler);
    return () => {
      window.removeEventListener('ocean:stream-start', startHandler);
      window.removeEventListener('ocean:stream-stop', stopHandler);
    };
  }, []);

  // ── Announce screenshare start / stop to channel ──────────────────────────
  useEffect(() => {
    if (!client || !channel) return;

    const wasActive = prevShareRef.current;

    if (screenshareActive && !wasActive) {
      client.sendRaw('MEDIA', 'JOIN', channel, 'screen');
    } else if (!screenshareActive && wasActive) {
      client.sendRaw('MEDIA', 'LEAVE', channel);
    }

    prevShareRef.current = screenshareActive;
  }, [screenshareActive, client, channel]);

  // ── Voice join / leave helpers ────────────────────────────────────────────
  const announceJoin = useCallback(() => {
    if (client && channel) {
      client.sendRaw('MEDIA', 'JOIN', channel, 'voice');
    }
  }, [client, channel]);

  const announceLeave = useCallback(() => {
    if (client && channel) {
      client.sendRaw('MEDIA', 'LEAVE', channel);
    }
  }, [client, channel]);

  return { engineRef, announceJoin, announceLeave };
}

// ── SUIMYAKU capability flags ────────────────────────────────────────────────────

export interface SuimyakuFlags {
  enabled: boolean;
  version: number;
  codecs: string[];
  simulcast: boolean;
  e2e: boolean;
  spatial: boolean;
  mixer: boolean;
  max: number;
  raw: string;
}

const EMPTY_FLAGS: SuimyakuFlags = {
  enabled: false, version: 0, codecs: [], simulcast: false,
  e2e: false, spatial: false, mixer: false, max: 0, raw: '',
};

function parseSuimyakuCap(raw: string): SuimyakuFlags {
  const flags: SuimyakuFlags = { ...EMPTY_FLAGS, enabled: !!raw, raw };
  for (const token of raw.split(',').map(t => t.trim()).filter(Boolean)) {
    const eq = token.indexOf('=');
    if (eq === -1) {
      if (token === 'simulcast') flags.simulcast = true;
      else if (token === 'e2e') flags.e2e = true;
      else if (token === 'spatial') flags.spatial = true;
      else if (token === 'mixer') flags.mixer = true;
    } else {
      const k = token.slice(0, eq);
      const v = token.slice(eq + 1);
      if (k === 'v') { const n = parseInt(v, 10); if (isFinite(n)) flags.version = n; }
      else if (k === 'codecs') flags.codecs = v.split('/');
      else if (k === 'max') { const n = parseInt(v, 10); if (isFinite(n)) flags.max = n; }
    }
  }
  return flags;
}

/**
 * useSuimyakuFlags
 *
 * Reads the `orochi/suimyaku-media` CAP value negotiated with the server and
 * returns a structured flags object.  Updates reactively when the client
 * changes (e.g. reconnect).
 */
export function useSuimyakuFlags(): SuimyakuFlags {
  const client = useOnyxStore(s => s.client);
  const [flags, setFlags] = useState<SuimyakuFlags>(EMPTY_FLAGS);

  useEffect(() => {
    if (!client) {
      setFlags(EMPTY_FLAGS);
      return;
    }
    const raw = client.capValues.get('orochi/suimyaku-media') ?? '';
    setFlags(raw ? parseSuimyakuCap(raw) : EMPTY_FLAGS);
  }, [client]);

  return flags;
}
