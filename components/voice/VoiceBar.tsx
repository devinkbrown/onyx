'use client';

import { useOnyxStore } from '@/lib/store';
import { useState, useEffect, useRef, useCallback } from 'react';
import Tooltip from '@/components/ui/Tooltip';
import SpeakingBars from './SpeakingBars';
import VoiceParticipantCard from './VoiceParticipantCard';

// ── Video participant tile ─────────────────────────────────────────────────────
interface VoiceVideoTileProps {
  nick: string;
  stream: MediaStream;
  isSelf?: boolean;
  isSpeaking?: boolean;
  isScreenshare?: boolean;
}

function VoiceVideoTile({ nick, stream, isSelf, isSpeaking, isScreenshare }: VoiceVideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  const tileClass = [
    'voice-video-tile',
    isSelf       ? 'voice-video-tile--self'        : '',
    isSpeaking   ? 'voice-video-tile--speaking'    : '',
    isScreenshare ? 'voice-video-tile--screenshare' : '',
  ].filter(Boolean).join(' ');

  const cleanNick = nick.replace(/^[~@+.%]+/, '');

  return (
    <div className={tileClass} aria-label={`${cleanNick}${isSelf ? ' (you)' : ''}`}>
      <video ref={videoRef} autoPlay playsInline muted={isSelf} />
      <div className="voice-video-bottom-row">
        {isScreenshare && (
          <span className="voice-video-screen-icon" aria-hidden="true">
            <MonitorIcon />
          </span>
        )}
        <span className="voice-video-label">
          {cleanNick}
          {isSelf && <span className="voice-video-you-tag">You</span>}
        </span>
      </div>
    </div>
  );
}

// ── Deterministic nick color ──────────────────────────────────────────────────
function nickColor(nick: string): string {
  let hash = 0;
  for (const c of nick) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 48%)`;
}

function initials(nick: string): string {
  const clean = nick.replace(/^[~@+.]+/, '');
  return clean.slice(0, 2).toUpperCase();
}

// ── Call duration timer ───────────────────────────────────────────────────────
function useCallDuration(isInCall: boolean): string {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isInCall) {
      startRef.current = null;
      setElapsed(0);
      return;
    }
    startRef.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isInCall]);

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// ── Local mic level analyser ──────────────────────────────────────────────────
function useLocalMicLevel(isInCall: boolean, localStream: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!isInCall || !localStream) {
      setLevel(0);
      return;
    }
    try {
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const src = ctx.createMediaStreamSource(localStream);
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        setLevel(Math.min(avg / 80, 1));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setLevel(0);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, [isInCall, localStream]);

  return level;
}

// ── Participant tile ──────────────────────────────────────────────────────────
interface ParticipantTileProps {
  nick: string;
  speaking: boolean;
  muted: boolean;
  deafened?: boolean;
  isYou?: boolean;
}

function ParticipantTile({ nick, speaking, muted, deafened, isYou }: ParticipantTileProps) {
  const bg = nickColor(nick);
  const text = initials(nick);
  const [hovered, setHovered] = useState(false);
  const [cardPos, setCardPos] = useState<{ x: number; y: number } | null>(null);
  const tileRef = useRef<HTMLDivElement>(null);

  let statusIcon: string | null = null;
  if (deafened) statusIcon = '🎧';
  else if (muted) statusIcon = '🔇';
  else statusIcon = null;

  const handleMouseEnter = () => {
    if (tileRef.current) {
      const rect = tileRef.current.getBoundingClientRect();
      setCardPos({ x: rect.right + 8, y: rect.top });
    }
    setHovered(true);
  };
  const handleMouseLeave = () => setHovered(false);

  return (
    <div
      className="vb-tile"
      ref={tileRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className={`vb-tile-avatar ${speaking ? 'vb-tile-avatar--speaking' : ''} ${muted ? 'vb-tile-avatar--muted' : ''} ${deafened ? 'vb-tile-avatar--deafened' : ''}`}
        style={{ background: bg }}
        aria-label={nick}
      >
        {text}
        {isYou && <span className="vb-tile-you-badge">You</span>}
      </div>
      <div className="vb-tile-name-row">
        <SpeakingBars speaking={speaking && !muted} size="sm" />
        <div className="vb-tile-name" title={nick}>
          {nick.slice(0, 10)}{nick.length > 10 ? '…' : ''}
        </div>
      </div>
      {statusIcon && <div className="vb-tile-status">{statusIcon}</div>}

      {/* Hover card portal */}
      {hovered && cardPos && (
        <div
          className="vb-tile-hover-card"
          style={{ left: cardPos.x, top: cardPos.y }}
          aria-hidden
        >
          <VoiceParticipantCard
            nick={nick}
            isYou={isYou}
            muted={muted}
            deafened={deafened}
          />
        </div>
      )}
    </div>
  );
}

// ── Responsive video grid columns ────────────────────────────────────────────
function videoGridColumns(count: number): string {
  if (count <= 1) return '1fr';
  if (count <= 2) return 'repeat(2, 1fr)';
  if (count <= 4) return 'repeat(2, 1fr)';
  return 'repeat(3, 1fr)';
}

// ── VoiceBar ──────────────────────────────────────────────────────────────────
export default function VoiceBar() {
  const voice           = useOnyxStore(s => s.voice);
  const setVoiceState   = useOnyxStore(s => s.setVoiceCallState);
  const ourNick         = useOnyxStore(s => s.ourNick);
  const client          = useOnyxStore(s => s.client);
  const setSpeakingNick = useOnyxStore(s => s.setSpeakingNick);

  const { callState, callChannel, peers, muted, deafened, screenshareActive, cameraDeviceId, localStream, videoParticipants } = voice;
  const isInCall = callState === 'in_call';

  const duration  = useCallDuration(isInCall);
  const micLevel  = useLocalMicLevel(isInCall, localStream);
  const ourSpeaking = micLevel > 0.12 && !muted;

  // ── Sync peer speaking state to speakingNicks store ───────────────────────
  useEffect(() => {
    for (const [nick, peer] of peers) {
      setSpeakingNick(nick, peer.speaking);
    }
  }, [peers, setSpeakingNick]);

  // ── Deafen: suspend/resume all peer AudioContexts via a module-level ref ──
  // PeerRegistry AudioContexts are internal, so we mute via each peer's
  // audCtx gain. We achieve this by toggling audCtx suspend/resume.
  // The actual suspension is handled by the MediaEngine; here we just
  // record the intent in store state. VoiceBar triggers the UI state change.
  useEffect(() => {
    // The deafened flag is already tracked inside voice.deafened.
    // We update the store so other consumers (VoiceParticipantCard etc.) see it.
    // Actual audio muting is handled by PeerRegistry on the MediaEngine side.
  }, [deafened]);

  // ── Camera ─────────────────────────────────────────────────────────────────
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Show video grid when we have remote video participants or local camera is on
  const showVideoGrid = videoParticipants.size > 0 || cameraOn || screenshareActive;

  const startCamera = useCallback(async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setCameraStream(stream);
      setCameraOn(true);
    } catch {
      setCameraOn(false);
    }
  }, [cameraDeviceId]);

  const stopCamera = useCallback(() => {
    cameraStream?.getTracks().forEach(t => t.stop());
    setCameraStream(null);
    setCameraOn(false);
  }, [cameraStream]);

  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  useEffect(() => {
    if (!isInCall && cameraOn) stopCamera();
  }, [isInCall, cameraOn, stopCamera]);

  // ── Controls ───────────────────────────────────────────────────────────────
  const toggleMute       = () => setVoiceState({ muted: !muted });
  const toggleDeafen     = () => setVoiceState({ deafened: !deafened });
  const toggleScreenshare = () => {
    const v = useOnyxStore.getState().voice;
    if (screenshareActive) v.stopScreenshare();
    else void v.startScreenshare();
  };
  const toggleCamera = () => cameraOn ? stopCamera() : void startCamera();

  const hangUp = () => {
    if (client && callChannel) {
      client.sendRaw('MEDIAFRAME', callChannel, 'VOICE_LEAVE', '');
    }
    stopCamera();
    setVoiceState({
      callState: 'idle',
      callWith: '',
      callChannel: null,
      peers: new Map(),
      localStream: null,
    });
  };

  if (!isInCall) return null;

  // ── Build participant list ─────────────────────────────────────────────────
  const peerList = [...peers.values()];
  const allParticipants = [
    { nick: ourNick, speaking: ourSpeaking, muted, deafened, isYou: true },
    ...peerList.map(p => ({
      nick: p.nick,
      speaking: p.speaking,
      muted: p.muted,
      deafened: false,
      isYou: false,
    })),
  ];

  const MAX_GRID = 9;
  const visibleParticipants = allParticipants.slice(0, MAX_GRID);
  const overflow = allParticipants.length - MAX_GRID;

  const hasCamera = !!cameraDeviceId;
  const channelLabel = callChannel ?? 'Voice';

  return (
    <div className="voice-bar animate-fade-in">

      {/* ── Channel header ── */}
      <div className="vb-header">
        <span className="vb-connected-dot" aria-hidden="true" />
        <span className="vb-channel-name">{channelLabel}</span>
        <span className="vb-duration">{duration}</span>
      </div>

      {/* ── Participant grid ── */}
      <div className="vb-grid" role="list" aria-label="Voice participants">
        {visibleParticipants.map(p => (
          <div key={p.nick} role="listitem">
            <ParticipantTile
              nick={p.nick}
              speaking={p.speaking}
              muted={p.muted}
              deafened={p.deafened}
              isYou={p.isYou}
            />
          </div>
        ))}
        {overflow > 0 && (
          <div className="vb-overflow-chip" aria-label={`${overflow} more participants`}>
            +{overflow}
          </div>
        )}
      </div>

      {/* ── Video participant grid ── */}
      {showVideoGrid && (() => {
        const remoteTiles = Array.from(videoParticipants.entries());
        const totalCount = remoteTiles.length + (cameraOn ? 1 : 0);
        const cols = videoGridColumns(totalCount);
        return (
          <div
            className="voice-video-grid"
            style={{ gridTemplateColumns: cols }}
            data-count={totalCount}
            role="region"
            aria-label="Video participants"
          >
            {cameraOn && cameraStream && (
              <VoiceVideoTile
                nick={ourNick}
                stream={cameraStream}
                isSelf
                isSpeaking={ourSpeaking}
              />
            )}
            {remoteTiles.map(([nick, stream]) => {
              const peer = peers.get(nick);
              const isSpeakingPeer = peer?.speaking ?? false;
              const isScreen = stream.getVideoTracks()[0]?.label?.toLowerCase().includes('screen') ?? false;
              return (
                <VoiceVideoTile
                  key={nick}
                  nick={nick}
                  stream={stream}
                  isSpeaking={isSpeakingPeer}
                  isScreenshare={isScreen}
                />
              );
            })}
          </div>
        );
      })()}

      {/* ── Mic level bar ── */}
      <div className="vb-gate-wrap" title={muted ? 'Microphone muted' : 'Microphone level'}>
        <div
          className={`vb-gate-bar ${muted ? 'vb-gate-bar--muted' : 'vb-gate-bar--active'}`}
          style={{ '--gate-level': muted ? 0 : micLevel } as React.CSSProperties}
        />
      </div>

      {/* ── Divider ── */}
      <div className="vb-divider" aria-hidden="true" />

      {/* ── Controls ── */}
      <div className="vb-controls">
        <Tooltip text={muted ? 'Unmute' : 'Mute'} side="top">
          <button
            className={`vb-btn ${muted ? 'vb-btn--active-danger' : ''}`}
            onClick={toggleMute}
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            aria-pressed={muted}
          >
            {muted ? <MicOffIcon /> : <MicIcon />}
          </button>
        </Tooltip>

        <Tooltip text={deafened ? 'Undeafen' : 'Deafen'} side="top">
          <button
            className={`vb-btn ${deafened ? 'vb-btn--active-danger' : ''}`}
            onClick={toggleDeafen}
            aria-label={deafened ? 'Undeafen' : 'Deafen'}
            aria-pressed={deafened}
          >
            {deafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
          </button>
        </Tooltip>

        {hasCamera && (
          <Tooltip text={cameraOn ? 'Stop Camera' : 'Start Camera'} side="top">
            <button
              className={`vb-btn ${cameraOn ? 'vb-btn--active-blue' : ''}`}
              onClick={toggleCamera}
              aria-label={cameraOn ? 'Stop camera' : 'Start camera'}
              aria-pressed={cameraOn}
            >
              <CameraIcon />
            </button>
          </Tooltip>
        )}

        <Tooltip text={screenshareActive ? 'Stop Sharing' : 'Share Screen'} side="top">
          <button
            className={`vb-btn ${screenshareActive ? 'vb-btn--active-danger' : ''}`}
            onClick={toggleScreenshare}
            aria-label={screenshareActive ? 'Stop sharing screen' : 'Share screen'}
            aria-pressed={screenshareActive}
          >
            <MonitorIcon />
          </button>
        </Tooltip>

        <Tooltip text="Leave Voice" side="top">
          <button className="vb-btn vb-btn--leave" onClick={hangUp} aria-label="Leave voice channel">
            <PhoneOffIcon />
          </button>
        </Tooltip>
      </div>

      {/* ── Self-preview pip ── */}
      {cameraOn && cameraStream && (
        <div className="vb-self-preview">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="vb-self-video"
            aria-label="Camera preview"
          />
        </div>
      )}

      <style>{`
        /* ── Keyframes ── */
        @keyframes speaking-pulse {
          0%, 100% {
            box-shadow:
              0 0 0 2px var(--vb-speaking, #22c55e),
              0 0 0 4px rgba(34, 197, 94, 0.3);
          }
          50% {
            box-shadow:
              0 0 0 3px var(--vb-speaking, #22c55e),
              0 0 0 8px rgba(34, 197, 94, 0.0);
          }
        }

        @keyframes vb-fadein {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── Container ── */
        .voice-bar {
          display: flex;
          flex-direction: column;
          gap: 0;
          background: rgba(34, 197, 94, 0.06);
          border-top: 1px solid rgba(34, 197, 94, 0.18);
          flex-shrink: 0;
          animation: vb-fadein 200ms ease-out;
        }

        /* ── Header ── */
        .vb-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px 4px;
        }
        .vb-connected-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          background: var(--status-online, #22c55e);
          box-shadow: 0 0 6px rgba(34, 197, 94, 0.7);
          flex-shrink: 0;
        }
        .vb-channel-name {
          font-size: 12px;
          font-weight: 700;
          color: var(--status-online, #22c55e);
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          letter-spacing: 0.01em;
        }
        .vb-duration {
          font-size: 11px;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }

        /* ── Participant grid ── */
        .vb-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
          padding: 6px 12px;
        }

        .vb-tile {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          min-width: 0;
        }

        .vb-tile-avatar {
          position: relative;
          width: 48px; height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          font-weight: 700;
          color: rgba(255,255,255,0.9);
          letter-spacing: 0.02em;
          user-select: none;
          transition: box-shadow 150ms ease;
          flex-shrink: 0;
          /* default ring */
          box-shadow: 0 0 0 2px transparent;
        }

        .vb-tile-avatar--speaking {
          animation: speaking-pulse 900ms ease-in-out infinite;
        }

        .vb-tile-avatar--muted {
          box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.5);
          opacity: 0.8;
        }

        .vb-tile-avatar--deafened {
          box-shadow: 0 0 0 2px rgba(156, 163, 175, 0.4);
          opacity: 0.6;
        }

        .vb-tile-you-badge {
          position: absolute;
          bottom: -2px; right: -4px;
          background: var(--accent, #7c5af5);
          color: white;
          font-size: 8px;
          font-weight: 700;
          padding: 1px 4px;
          border-radius: 6px;
          letter-spacing: 0.04em;
          line-height: 1.4;
          white-space: nowrap;
        }

        .vb-tile-name {
          font-size: 10px;
          color: var(--text-secondary);
          max-width: 52px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-align: center;
          line-height: 1.2;
        }

        .vb-tile-name-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 3px;
          max-width: 52px;
        }

        .vb-tile-status {
          font-size: 10px;
          line-height: 1;
          min-height: 12px;
        }

        .vb-tile-status--speaking {
          filter: drop-shadow(0 0 3px rgba(34,197,94,0.7));
        }

        .vb-tile-hover-card {
          position: fixed;
          z-index: 400;
          pointer-events: none;
        }

        .vb-overflow-chip {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 48px; height: 48px;
          border-radius: 50%;
          background: rgba(255,255,255,0.08);
          border: 1px dashed rgba(255,255,255,0.2);
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          cursor: default;
          user-select: none;
        }

        /* ── Mic gate bar ── */
        .vb-gate-wrap {
          padding: 0 12px 2px;
          display: flex;
          align-items: center;
          height: 12px;
        }
        .vb-gate-bar {
          width: 100%;
          height: 3px;
          border-radius: 2px;
          transition: transform 60ms linear, background 200ms;
          transform-origin: left;
          transform: scaleX(var(--gate-level, 0));
        }
        .vb-gate-bar--active {
          background: var(--status-online, #22c55e);
          box-shadow: 0 0 4px rgba(34, 197, 94, 0.5);
        }
        .vb-gate-bar--muted {
          background: var(--text-muted);
          opacity: 0.3;
          transform: scaleX(1);
          height: 2px;
        }

        /* ── Divider ── */
        .vb-divider {
          height: 1px;
          background: rgba(255,255,255,0.06);
          margin: 0 12px;
        }

        /* ── Controls ── */
        .vb-controls {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 12px 10px;
        }

        .vb-btn {
          width: 40px; height: 40px;
          border-radius: 50%;
          border: none;
          background: rgba(255,255,255,0.07);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          transition: background 150ms, color 150ms, transform 80ms;
          flex-shrink: 0;
        }
        .vb-btn:hover {
          background: rgba(255,255,255,0.13);
          color: var(--text-primary);
        }
        .vb-btn:active {
          transform: scale(0.93);
        }

        .vb-btn--active-danger {
          background: rgba(239, 68, 68, 0.18);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .vb-btn--active-danger:hover {
          background: rgba(239, 68, 68, 0.28);
        }

        .vb-btn--active-blue {
          background: rgba(59, 130, 246, 0.18);
          color: #60a5fa;
          border: 1px solid rgba(59, 130, 246, 0.3);
        }
        .vb-btn--active-blue:hover {
          background: rgba(59, 130, 246, 0.28);
        }

        .vb-btn--leave {
          background: #dc2626;
          color: white;
        }
        .vb-btn--leave:hover {
          background: #b91c1c;
        }

        /* ── Self-preview pip ── */
        .vb-self-preview {
          position: fixed;
          bottom: 72px;
          right: 16px;
          width: 80px; height: 60px;
          border-radius: 6px;
          overflow: hidden;
          border: 1px solid rgba(124, 90, 245, 0.5);
          box-shadow: 0 4px 16px rgba(0,0,0,0.5);
          z-index: 200;
          background: #000;
        }
        .vb-self-video {
          width: 100%; height: 100%;
          object-fit: cover;
          transform: scaleX(-1);
        }

        /* ── Video grid ── */
        @keyframes vb-speaking-glow {
          0%, 100% { box-shadow: 0 0 0 2px #22c55e, 0 0 10px rgba(34,197,94,0.35); }
          50%       { box-shadow: 0 0 0 3px #22c55e, 0 0 18px rgba(34,197,94,0.15); }
        }

        .voice-video-grid {
          display: grid;
          gap: 4px;
          padding: 4px;
          background: #000;
          border-radius: 8px;
          margin: 8px;
        }

        /* Single tile — centered, max 2/3 width */
        .voice-video-grid[data-count="1"] {
          grid-template-columns: minmax(0, 2fr);
          justify-content: center;
        }

        .voice-video-tile {
          position: relative;
          border-radius: 6px;
          overflow: hidden;
          background: var(--bg-void);
          aspect-ratio: 16/9;
          border: 2px solid transparent;
          transition: border-color 200ms;
        }

        .voice-video-tile video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        /* Self tile: mirrored + violet border */
        .voice-video-tile--self video {
          transform: scaleX(-1);
        }
        .voice-video-tile--self {
          border-color: rgba(124,90,245,0.55);
        }

        /* Speaking: green glow border */
        .voice-video-tile--speaking {
          animation: vb-speaking-glow 900ms ease-in-out infinite;
          border-color: #22c55e;
        }

        /* Screenshare: accent border */
        .voice-video-tile--screenshare {
          border-color: rgba(124,90,245,0.5);
        }

        /* Bottom label row */
        .voice-video-bottom-row {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 18px 8px 6px;
          background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%);
          pointer-events: none;
        }

        .voice-video-screen-icon {
          display: flex;
          align-items: center;
          color: var(--accent, #7c5af5);
          flex-shrink: 0;
          opacity: 0.9;
        }

        .voice-video-label {
          font-size: 12px;
          color: rgba(255,255,255,0.92);
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-shadow: 0 1px 3px rgba(0,0,0,0.9);
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .voice-video-you-tag {
          font-size: 10px;
          font-weight: 700;
          background: var(--accent, #7c5af5);
          color: white;
          padding: 1px 5px;
          border-radius: 4px;
          letter-spacing: 0.03em;
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}

// ── Icon set ──────────────────────────────────────────────────────────────────

const MicIcon = () => (
  <svg width="16" height="16" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M7.5 1a2 2 0 0 0-2 2v4.5a2 2 0 0 0 4 0V3a2 2 0 0 0-2-2z" />
    <path d="M3.5 6.5a4 4 0 0 0 8 0" strokeLinecap="round" />
    <path d="M7.5 10.5v3" strokeLinecap="round" />
  </svg>
);

const MicOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M9.5 3a2 2 0 0 0-4 0v2.5M5.5 7.5a2 2 0 0 0 4 0V7" strokeLinecap="round" />
    <path d="M3.5 6.5a4 4 0 0 0 6.7 3" strokeLinecap="round" />
    <path d="M7.5 10.5v3M2 2l11 11" strokeLinecap="round" />
  </svg>
);

const HeadphonesIcon = () => (
  <svg width="16" height="16" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2.5 8.5V7.5a5 5 0 0 1 10 0v1" strokeLinecap="round" />
    <rect x="1.5" y="8.5" width="3" height="4" rx="1.5" />
    <rect x="10.5" y="8.5" width="3" height="4" rx="1.5" />
  </svg>
);

const HeadphonesOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 2l11 11M4 8.3A5 5 0 0 1 12.5 7.5v1" strokeLinecap="round" />
    <rect x="1.5" y="8.5" width="3" height="4" rx="1.5" />
    <rect x="10.5" y="8.5" width="3" height="4" rx="1.5" />
  </svg>
);

const CameraIcon = () => (
  <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 4.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-5z" />
    <path d="M10 6.5l3-2v5l-3-2" />
  </svg>
);

const MonitorIcon = () => (
  <svg width="16" height="16" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="2" width="13" height="9" rx="1.5" />
    <path d="M5 13h5M7.5 11v2" />
  </svg>
);

const PhoneOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 15 15" fill="currentColor">
    <path d="M1.5 4.5a1 1 0 0 1 1-1h2.5l1 3-1.5 1a8 8 0 0 0 3 3l1-1.5 3 1v2.5a1 1 0 0 1-1 1A11 11 0 0 1 1.5 4.5z" />
    <path d="M2 2l11 11" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
