'use client';

import { useOnyxStore } from '@/lib/store';
import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import Tooltip from '@/components/ui/Tooltip';
import SpeakingBars from './SpeakingBars';
import VoiceParticipantCard from './VoiceParticipantCard';
import { OpcodecWasm } from '@/lib/ladon-media/OpcodecWasm';

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

// ── WASM load-failure detector ───────────────────────────────────────────────
function useWasmLoadFailed(): boolean {
  const [failed, setFailed] = useState(() => OpcodecWasm.loadFailed);
  useEffect(() => {
    if (OpcodecWasm.loadFailed) return; // already failed before mount
    const handler = () => setFailed(true);
    window.addEventListener('wasmLoadFailed', handler);
    return () => window.removeEventListener('wasmLoadFailed', handler);
  }, []);
  return failed;
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
  const codecUnavailable = useWasmLoadFailed();

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
        <span className="vb-waveform" aria-hidden="true">
          <span className="vb-waveform-bar" />
          <span className="vb-waveform-bar" />
          <span className="vb-waveform-bar" />
          <span className="vb-waveform-bar" />
        </span>
        <span className="vb-channel-name">{channelLabel}</span>
        <span className="vb-duration">{duration}</span>
        {codecUnavailable && (
          <Tooltip text="Voice codec unavailable (opcodec_wasm.js not found) — audio disabled" side="top">
            <span className="vb-codec-warn" aria-label="Voice codec unavailable" role="img">
              <CodecWarnIcon />
            </span>
          </Tooltip>
        )}
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
          style={{ '--gate-level': muted ? 0 : micLevel } as unknown as CSSProperties}
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
            className={`vb-btn ${deafened ? 'vb-btn--active-deaf' : ''}`}
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

        <Tooltip text="Leave voice channel" side="top">
          <button className="vb-btn vb-btn--leave" onClick={hangUp} aria-label="Leave voice channel">
            <PhoneOffIcon />
            <span aria-hidden="true">Leave</span>
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
              0 0 0 0   rgba(52, 211, 153, 0),
              0 0 0 2.5px var(--status-online, #34d399),
              0 0 8px  rgba(52, 211, 153, 0.5);
          }
          50% {
            box-shadow:
              0 0 0 5px  rgba(52, 211, 153, 0),
              0 0 0 2.5px var(--status-online, #34d399),
              0 0 18px rgba(52, 211, 153, 0.35);
          }
        }

        @keyframes vb-fadein {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @keyframes vb-dot-wave {
          0%, 60%, 100% { transform: scaleY(0.4); opacity: 0.5; }
          30%            { transform: scaleY(1);   opacity: 1; }
        }

        /* ── Container ── */
        .voice-bar {
          display: flex;
          flex-direction: column;
          gap: 0;
          background: linear-gradient(180deg,
            rgba(52, 211, 153, 0.07) 0%,
            rgba(52, 211, 153, 0.03) 100%);
          border-top: 1px solid rgba(52, 211, 153, 0.25);
          flex-shrink: 0;
          animation: vb-fadein 220ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
        }

        /* ── Header ── */
        .vb-header {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 9px 14px 5px;
        }

        /* Animated waveform dots — shown when not speaking; pulses when connected */
        .vb-waveform {
          display: flex;
          align-items: center;
          gap: 2px;
          height: 14px;
          flex-shrink: 0;
        }
        .vb-waveform-bar {
          width: 3px;
          border-radius: 2px;
          background: var(--status-online, #34d399);
          transform-origin: center bottom;
          animation: vb-dot-wave 1.2s ease-in-out infinite;
        }
        .vb-waveform-bar:nth-child(1) { height: 8px; animation-delay: 0s; }
        .vb-waveform-bar:nth-child(2) { height: 12px; animation-delay: 0.15s; }
        .vb-waveform-bar:nth-child(3) { height: 6px; animation-delay: 0.3s; }
        .vb-waveform-bar:nth-child(4) { height: 10px; animation-delay: 0.15s; }

        .vb-channel-name {
          font-size: 11.5px;
          font-weight: 700;
          color: var(--status-online, #34d399);
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          letter-spacing: 0.03em;
          text-transform: uppercase;
        }
        .vb-duration {
          font-size: 11px;
          color: var(--status-online, #34d399);
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
          background: rgba(52, 211, 153, 0.1);
          padding: 2px 7px;
          border-radius: var(--r-full, 9999px);
          border: 1px solid rgba(52, 211, 153, 0.2);
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .vb-codec-warn {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--warning, #fbbf24);
          opacity: 0.85;
          flex-shrink: 0;
          cursor: default;
          padding: 2px;
        }
        .vb-codec-warn:hover { opacity: 1; }

        /* ── Participant grid ── */
        .vb-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          padding: 6px 14px 4px;
        }

        .vb-tile {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          min-width: 0;
        }

        .vb-tile-avatar {
          position: relative;
          width: 46px; height: 46px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 700;
          color: rgba(255,255,255,0.92);
          letter-spacing: 0.02em;
          user-select: none;
          transition: box-shadow 200ms ease, opacity 200ms;
          flex-shrink: 0;
          box-shadow: 0 0 0 2px transparent, 0 2px 8px rgba(0,0,0,0.4);
        }

        .vb-tile-avatar--speaking {
          animation: speaking-pulse 900ms ease-in-out infinite;
        }

        .vb-tile-avatar--muted {
          box-shadow: 0 0 0 2.5px rgba(248, 113, 113, 0.6), 0 2px 8px rgba(0,0,0,0.4);
          opacity: 0.72;
        }

        /* Muted icon overlay badge */
        .vb-tile-avatar--muted::after {
          content: '';
          position: absolute;
          bottom: -1px;
          right: -1px;
          width: 14px;
          height: 14px;
          background: var(--danger, #f87171);
          border-radius: 50%;
          border: 2px solid var(--bg-deep, #06101d);
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10' fill='none' stroke='white' stroke-width='1.5' stroke-linecap='round'%3E%3Cpath d='M2 2l6 6'/%3E%3C/svg%3E");
          background-size: 70%;
          background-position: center;
          background-repeat: no-repeat;
        }

        .vb-tile-avatar--deafened {
          box-shadow: 0 0 0 2px rgba(100,120,140,0.35), 0 2px 8px rgba(0,0,0,0.4);
          opacity: 0.45;
          filter: grayscale(0.5);
        }

        .vb-tile-you-badge {
          position: absolute;
          bottom: -3px; right: -5px;
          background: var(--accent, #0ea5e9);
          color: #fff;
          font-size: 7.5px;
          font-weight: 800;
          padding: 1px 4px;
          border-radius: 5px;
          letter-spacing: 0.05em;
          line-height: 1.5;
          white-space: nowrap;
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        }

        .vb-tile-name {
          font-size: 10px;
          color: var(--text-secondary);
          max-width: 54px;
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
          max-width: 54px;
        }

        .vb-tile-status {
          font-size: 11px;
          line-height: 1;
          min-height: 13px;
        }

        .vb-tile-status--speaking {
          filter: drop-shadow(0 0 4px rgba(52,211,153,0.8));
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
          width: 46px; height: 46px;
          border-radius: 50%;
          background: var(--bg-elevated, rgba(19,33,49,0.9));
          border: 1px dashed var(--border-normal);
          font-size: 12px;
          font-weight: 700;
          color: var(--text-muted);
          cursor: default;
          user-select: none;
          letter-spacing: 0.02em;
        }

        /* ── Mic gate bar ── */
        .vb-gate-wrap {
          padding: 2px 14px 3px;
          display: flex;
          align-items: center;
          height: 14px;
        }
        .vb-gate-bar {
          width: 100%;
          height: 3px;
          border-radius: 2px;
          transition: transform 55ms linear, background 220ms;
          transform-origin: left;
          transform: scaleX(var(--gate-level, 0));
        }
        .vb-gate-bar--active {
          background: linear-gradient(90deg,
            var(--status-online, #34d399) 0%,
            rgba(52, 211, 153, 0.6) 100%);
          box-shadow: 0 0 6px rgba(52, 211, 153, 0.45);
        }
        .vb-gate-bar--muted {
          background: var(--text-muted);
          opacity: 0.22;
          transform: scaleX(1);
          height: 2px;
        }

        /* ── Divider ── */
        .vb-divider {
          height: 1px;
          background: var(--border-subtle);
          margin: 0 14px;
        }

        /* ── Controls ── */
        .vb-controls {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 9px 14px 11px;
        }

        .vb-btn {
          width: 38px; height: 38px;
          border-radius: 50%;
          border: 1px solid transparent;
          background: var(--bg-elevated, rgba(19,33,49,0.8));
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          transition: background 150ms, color 150ms, transform 80ms, border-color 150ms, box-shadow 150ms;
          flex-shrink: 0;
        }
        .vb-btn:hover {
          background: var(--bg-float, rgba(26,44,64,0.9));
          color: var(--text-primary);
          border-color: var(--border-normal);
          box-shadow: var(--shadow-sm);
        }
        .vb-btn:active {
          transform: scale(0.91);
        }

        /* Muted = red mic — prominent danger state */
        .vb-btn--active-danger {
          background: rgba(248, 113, 113, 0.18);
          color: var(--danger, #f87171);
          border-color: rgba(248, 113, 113, 0.45);
          box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.1) inset,
                      0 0 8px rgba(248, 113, 113, 0.12);
        }
        .vb-btn--active-danger:hover {
          background: rgba(248, 113, 113, 0.28);
          border-color: rgba(248, 113, 113, 0.6);
          box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.15) inset,
                      0 0 12px rgba(248, 113, 113, 0.2);
        }

        /* Deafened uses separate grey state */
        .vb-btn--active-deaf {
          background: rgba(100, 120, 140, 0.18);
          color: var(--text-muted);
          border-color: rgba(100, 120, 140, 0.3);
          opacity: 0.8;
        }
        .vb-btn--active-deaf:hover {
          background: rgba(100, 120, 140, 0.28);
          border-color: rgba(100, 120, 140, 0.45);
          opacity: 1;
        }

        .vb-btn--active-blue {
          background: rgba(14, 165, 233, 0.14);
          color: var(--accent, #0ea5e9);
          border-color: rgba(14, 165, 233, 0.32);
        }
        .vb-btn--active-blue:hover {
          background: rgba(14, 165, 233, 0.24);
          border-color: rgba(14, 165, 233, 0.5);
        }

        /* Leave: red, prominent pill — stands out clearly */
        .vb-btn--leave {
          background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
          color: #fff;
          border-color: rgba(220, 38, 38, 0.5);
          box-shadow: 0 2px 10px rgba(220, 38, 38, 0.4),
                      0 1px 0 rgba(255,255,255,0.08) inset;
          border-radius: var(--r-full, 9999px);
          padding: 0 14px;
          width: auto;
          gap: 5px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.03em;
        }
        .vb-btn--leave:hover {
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          box-shadow: 0 3px 14px rgba(220, 38, 38, 0.55),
                      0 1px 0 rgba(255,255,255,0.12) inset;
        }

        /* ── Self-preview pip ── */
        .vb-self-preview {
          position: fixed;
          bottom: 76px;
          right: 16px;
          width: 84px; height: 63px;
          border-radius: var(--r-md, 8px);
          overflow: hidden;
          border: 1.5px solid rgba(124, 90, 245, 0.55);
          box-shadow: 0 4px 20px rgba(0,0,0,0.6), 0 0 0 1px rgba(14,165,233,0.2);
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
          0%, 100% { box-shadow: 0 0 0 2px var(--status-online, #34d399), 0 0 12px rgba(52,211,153,0.3); }
          50%       { box-shadow: 0 0 0 2.5px var(--status-online, #34d399), 0 0 20px rgba(52,211,153,0.12); }
        }

        .voice-video-grid {
          display: grid;
          gap: 5px;
          padding: 5px;
          background: #000;
          border-radius: var(--r-md, 8px);
          margin: 8px;
          border: 1px solid var(--border-subtle);
        }

        /* Single tile — centered, max 2/3 width */
        .voice-video-grid[data-count="1"] {
          grid-template-columns: minmax(0, 2fr);
          justify-content: center;
        }

        .voice-video-tile {
          position: relative;
          border-radius: var(--r-sm, 6px);
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
          border-color: rgba(14,165,233,0.6);
          box-shadow: 0 0 0 1px rgba(14,165,233,0.2) inset;
        }

        /* Speaking: green glow border */
        .voice-video-tile--speaking {
          animation: vb-speaking-glow 950ms ease-in-out infinite;
          border-color: var(--status-online, #34d399);
        }

        /* Screenshare: accent border */
        .voice-video-tile--screenshare {
          border-color: rgba(14,165,233,0.55);
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
          padding: 20px 8px 7px;
          background: linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0) 100%);
          pointer-events: none;
        }

        .voice-video-screen-icon {
          display: flex;
          align-items: center;
          color: var(--accent, #0ea5e9);
          flex-shrink: 0;
          opacity: 0.9;
        }

        .voice-video-label {
          font-size: 12px;
          color: rgba(255,255,255,0.95);
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-shadow: 0 1px 4px rgba(0,0,0,0.95);
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .voice-video-you-tag {
          font-size: 9.5px;
          font-weight: 800;
          background: var(--accent, #0ea5e9);
          color: #fff;
          padding: 1px 5px;
          border-radius: 4px;
          letter-spacing: 0.04em;
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

const CodecWarnIcon = () => (
  <svg width="13" height="13" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7.5 1L1 13h13L7.5 1z" />
    <path d="M7.5 6v3.5" />
    <circle cx="7.5" cy="11" r="0.5" fill="currentColor" stroke="none" />
  </svg>
);
