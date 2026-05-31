'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useOnyxStore } from '@/lib/store';
import { LadonMediaEngine } from '@/lib/ladon-media/MediaEngine';
import type { LadonMediaCallbacks } from '@/lib/ladon-media/types';
import type { IRCMessage } from '@/lib/irc/types';

/**
 * useLadonMedia
 *
 * Creates and wires the LADON MediaEngine to the Ocean store.
 * Mount once at AppShell level.
 *
 * LADON messages arrive as the 'MEDIA' or 'LADONMEDIA' IRC command
 * (the server advertises which one via ISUPPORT LADONMEDIA=<cmd>).
 * Each message: MEDIA <target> <subtype> [<payload>]
 *
 * Screenshare signaling uses CTCP-style LADON_MEDIA messages:
 *   START: PRIVMSG #channel :\x01LADON_MEDIA SCREENSHARE_START\x01
 *   STOP:  PRIVMSG #channel :\x01LADON_MEDIA SCREENSHARE_STOP\x01
 *
 * Voice join/leave:
 *   JOIN:  PRIVMSG #channel :\x01LADON_MEDIA JOIN\x01
 *   LEAVE: PRIVMSG #channel :\x01LADON_MEDIA LEAVE\x01
 */
export function useLadonMedia() {
  const client          = useOnyxStore(s => s.client);
  const setVoiceState   = useOnyxStore(s => s.setVoiceCallState);
  const addNotification = useOnyxStore(s => s.addNotification);
  const screenshareActive = useOnyxStore(s => s.voice.screenshareActive);
  const activeView      = useOnyxStore(s => s.activeView);

  const engineRef         = useRef<LadonMediaEngine | null>(null);
  const prevShareRef      = useRef<boolean>(false);
  // Cache canvas-captured streams per nick so onPeerState (which fires on
  // every speaking/mute change) reuses the existing MediaStream instead of
  // calling captureStream() each time and leaking a new stream every call.
  const canvasStreamRef   = useRef<Map<string, { canvas: HTMLCanvasElement; stream: MediaStream }>>(new Map());

  const channel = activeView.kind === 'channel' ? activeView.channel : null;

  // ── Boot the engine once ──────────────────────────────────────────────────
  useEffect(() => {
    const callbacks: LadonMediaCallbacks = {
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
        setVoiceState({ localStream: stream });
      },
      onRoomStats(ch, stats) {
        const roomStats = new Map(useOnyxStore.getState().voice.roomStats);
        roomStats.set(ch, stats);
        setVoiceState({ roomStats });
      },
      onError(msg) {
        addNotification({ type: 'error', text: `Voice: ${msg}` });
      },
      onDecodeError(_peer, _type, _err) {
        // Decode errors are non-fatal; engine handles recovery internally
      },
      enableVideoCalls: () => true,
      enableVoiceCalls: () => true,
    };

    if (!engineRef.current) {
      engineRef.current = new LadonMediaEngine(callbacks, { kind: 'voice' });
    }

    engineRef.current.setClient(client);

    if (!client) return;

    const mediaCmd = (client.isupport.LADONMEDIA || 'MEDIA').toUpperCase();

    const fn = (msg: IRCMessage) => {
      const cmd = msg.command;
      if (cmd !== mediaCmd && cmd !== 'MEDIA' && cmd !== 'LADONMEDIA') return;

      const target   = msg.params[0];
      const subtype  = msg.params[1];
      const payload  = msg.params[2] ?? '';
      const fromNick = msg.nick ?? '';

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
      client.sendRaw('PRIVMSG', channel, '\x01LADON_MEDIA SCREENSHARE_START\x01');
    } else if (!screenshareActive && wasActive) {
      client.sendRaw('PRIVMSG', channel, '\x01LADON_MEDIA SCREENSHARE_STOP\x01');
    }

    prevShareRef.current = screenshareActive;
  }, [screenshareActive, client, channel]);

  // ── Voice join / leave helpers ────────────────────────────────────────────
  const announceJoin = useCallback(() => {
    if (client && channel) {
      client.sendRaw('PRIVMSG', channel, '\x01LADON_MEDIA JOIN\x01');
    }
  }, [client, channel]);

  const announceLeave = useCallback(() => {
    if (client && channel) {
      client.sendRaw('PRIVMSG', channel, '\x01LADON_MEDIA LEAVE\x01');
    }
  }, [client, channel]);

  return { engineRef, announceJoin, announceLeave };
}

// ── LADON capability flags ────────────────────────────────────────────────────

export interface LadonFlags {
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

const EMPTY_FLAGS: LadonFlags = {
  enabled: false, version: 0, codecs: [], simulcast: false,
  e2e: false, spatial: false, mixer: false, max: 0, raw: '',
};

function parseLadonCap(raw: string): LadonFlags {
  const flags: LadonFlags = { ...EMPTY_FLAGS, enabled: !!raw, raw };
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
 * useLadonFlags
 *
 * Reads the `ophion/ladon-media` CAP value negotiated with the server and
 * returns a structured flags object.  Updates reactively when the client
 * changes (e.g. reconnect).
 */
export function useLadonFlags(): LadonFlags {
  const client = useOnyxStore(s => s.client);
  const [flags, setFlags] = useState<LadonFlags>(EMPTY_FLAGS);

  useEffect(() => {
    if (!client) {
      setFlags(EMPTY_FLAGS);
      return;
    }
    const raw = client.capValues.get('ophion/ladon-media') ?? '';
    setFlags(raw ? parseLadonCap(raw) : EMPTY_FLAGS);
  }, [client]);

  return flags;
}
