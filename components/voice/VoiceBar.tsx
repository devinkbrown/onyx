'use client';

import { useOnyxStore } from '@/lib/store';
import { useState, useEffect, useRef, type CSSProperties } from 'react';
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
  const ourNick         = useOnyxStore(s => s.ourNick);
  const setSpeakingNick = useOnyxStore(s => s.setSpeakingNick);
  const toggleMuteAction = useOnyxStore(s => s.toggleMute);
  const toggleDeafenAction = useOnyxStore(s => s.toggleDeafen);
  const toggleCameraAction = useOnyxStore(s => s.toggleCamera);
  const leaveVoiceChannel = useOnyxStore(s => s.leaveVoiceChannel);

  const { callState, callChannel, peers, muted, deafened, screenshareActive, cameraDeviceId, localStream, videoParticipants, cameraOn, cameraStream } = voice;
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

  // ── Camera ─────────────────────────────────────────────────────────────────
  const [hasVideoInput, setHasVideoInput] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Show video grid when we have remote video participants or local camera is on
  const showVideoGrid = videoParticipants.size > 0 || cameraOn || screenshareActive;

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices()
      .then(devices => setHasVideoInput(devices.some(d => d.kind === 'videoinput')))
      .catch(() => setHasVideoInput(true));
  }, []);

  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  // ── Controls ───────────────────────────────────────────────────────────────
  const toggleMute       = () => toggleMuteAction();
  const toggleDeafen     = () => toggleDeafenAction();
  const toggleScreenshare = () => {
    const v = useOnyxStore.getState().voice;
    if (screenshareActive) v.stopScreenshare();
    else void v.startScreenshare();
  };
  const toggleCamera = () => void toggleCameraAction();
  const hangUp = () => leaveVoiceChannel();

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

  const hasCamera = hasVideoInput || !cameraDeviceId;
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
          0%, 100% { opacity: 0.38; transform: scale(0.94); filter: drop-shadow(0 0 3px var(--status-online, #34d399)); }
          50%      { opacity: 0.9;  transform: scale(1.14); filter: drop-shadow(0 0 7px var(--status-online, #34d399)); }
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
            var(--bg-base, #0c1828) 0%,
            var(--bg-deep, #06101d) 100%);
          border-top: 1px solid var(--accent-border);
          box-shadow: var(--shadow-md);
          flex-shrink: 0;
          animation: vb-fadein 220ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
        }

        /* ── Header ── */
        .vb-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px 7px;
          background: linear-gradient(180deg, var(--bg-deep, #06101d), transparent);
          border-bottom: 1px solid var(--border-subtle);
        }

        /* Animated waveform dots — shown when not speaking; pulses when connected */
        .vb-waveform {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 2px;
          width: 28px;
          height: 22px;
          border-radius: var(--r-sm, 6px);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          box-shadow: var(--shadow-sm);
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
          min-width: 0;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-primary);
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          letter-spacing: 0;
          text-transform: uppercase;
        }
        .vb-duration {
          font-size: 11px;
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
          background: var(--bg-elevated, #132131);
          padding: 3px 8px;
          border-radius: var(--r-full, 9999px);
          border: 1px solid var(--border-normal);
          font-weight: 600;
          letter-spacing: 0;
        }
        .vb-codec-warn {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--warning, #fbbf24);
          opacity: 0.85;
          flex-shrink: 0;
          cursor: default;
          padding: 3px;
          border-radius: var(--r-xs, 3px);
          background: var(--bg-elevated, #132131);
          border: 1px solid var(--border-subtle);
        }
        .vb-codec-warn:hover { opacity: 1; }

        /* ── Participant grid ── */
        .vb-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 7px;
          padding: 8px 14px 6px;
        }

        .vb-tile {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          min-width: 0;
          min-height: 78px;
          padding: 7px 5px 6px;
          border-radius: var(--r-md, 8px);
          background: var(--bg-elevated, #132131);
          border: 1px solid var(--border-subtle);
          box-shadow: var(--shadow-sm);
          transition: transform var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
                      opacity var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
                      filter var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1));
        }
        .vb-tile:hover {
          background: var(--bg-float, #1a2c40);
          border-color: var(--border-normal);
          transform: translateY(-1px);
        }

        .vb-tile-avatar {
          position: relative;
          width: 44px; height: 44px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 700;
          color: rgba(255,255,255,0.92);
          letter-spacing: 0;
          user-select: none;
          transition: transform var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
                      opacity var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
                      filter var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1));
          flex-shrink: 0;
          box-shadow: 0 0 0 2px var(--bg-deep, #06101d), var(--shadow-sm);
          isolation: isolate;
        }
        .vb-tile-avatar::before {
          content: '';
          position: absolute;
          inset: -5px;
          border: 1px solid var(--status-online, #34d399);
          border-radius: 50%;
          opacity: 0;
          transform: scale(0.94);
          pointer-events: none;
          z-index: -1;
        }

        .vb-tile-avatar--speaking {
          box-shadow: 0 0 0 2px var(--status-online, #34d399), var(--shadow-sm);
          filter: drop-shadow(0 0 4px var(--status-online, #34d399));
        }
        .vb-tile-avatar--speaking::before {
          animation: speaking-pulse 900ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) infinite;
        }

        .vb-tile-avatar--muted {
          box-shadow: 0 0 0 2px var(--danger, #f87171), var(--shadow-sm);
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
          box-shadow: 0 0 0 2px var(--text-muted), var(--shadow-sm);
          opacity: 0.5;
          filter: grayscale(0.45);
        }

        .vb-tile-you-badge {
          position: absolute;
          bottom: -3px; right: -5px;
          background: var(--accent, #0ea5e9);
          color: var(--text-primary);
          font-size: 7.5px;
          font-weight: 800;
          padding: 1px 4px;
          border-radius: 5px;
          letter-spacing: 0;
          line-height: 1.5;
          white-space: nowrap;
          box-shadow: var(--shadow-sm);
        }

        .vb-tile-name {
          font-size: 10px;
          color: var(--text-secondary);
          max-width: 100%;
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
          gap: 4px;
          width: 100%;
          min-width: 0;
          max-width: 64px;
        }

        .vb-tile-status {
          position: absolute;
          top: 5px;
          right: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 17px;
          height: 17px;
          border-radius: var(--r-full, 9999px);
          background: var(--bg-float, #1a2c40);
          border: 1px solid var(--border-subtle);
          font-size: 10px;
          line-height: 1;
          box-shadow: var(--shadow-sm);
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
          justify-self: center;
          align-self: stretch;
          width: 100%;
          min-height: 78px;
          border-radius: var(--r-md, 8px);
          background: var(--bg-elevated, rgba(19,33,49,0.9));
          border: 1px dashed var(--border-normal);
          font-size: 12px;
          font-weight: 700;
          color: var(--text-muted);
          cursor: default;
          user-select: none;
          letter-spacing: 0;
          box-shadow: var(--shadow-sm);
        }

        /* ── Mic gate bar ── */
        .vb-gate-wrap {
          position: relative;
          padding: 4px 14px 5px;
          display: flex;
          align-items: center;
          height: 17px;
        }
        .vb-gate-wrap::before {
          content: '';
          position: absolute;
          left: 14px;
          right: 14px;
          height: 3px;
          border-radius: var(--r-full, 9999px);
          background: var(--bg-elevated, #132131);
          border: 1px solid var(--border-subtle);
        }
        .vb-gate-bar {
          position: relative;
          z-index: 1;
          width: 100%;
          height: 3px;
          border-radius: var(--r-full, 9999px);
          transition: transform 55ms linear, opacity var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1));
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
        }

        /* ── Divider ── */
        .vb-divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--border-normal), transparent);
          margin: 0 14px;
        }

        /* ── Controls ── */
        .vb-controls {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 10px 14px 12px;
        }

        .vb-btn {
          position: relative;
          width: 40px; height: 40px;
          border-radius: 50%;
          border: 1px solid var(--border-subtle);
          background: var(--bg-elevated, rgba(19,33,49,0.8));
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          box-shadow: var(--shadow-sm);
          overflow: hidden;
          transition: transform var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
                      opacity var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
                      filter var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1));
          flex-shrink: 0;
        }
        .vb-btn::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: var(--accent-subtle);
          opacity: 0;
          transform: scale(0.92);
          pointer-events: none;
          transition: opacity var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
                      transform var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1));
        }
        .vb-btn svg,
        .vb-btn span {
          position: relative;
          z-index: 1;
          flex-shrink: 0;
        }
        .vb-btn:hover {
          background: var(--bg-float, rgba(26,44,64,0.9));
          color: var(--text-primary);
          border-color: var(--border-normal);
          filter: brightness(1.08);
        }
        .vb-btn:hover::before {
          opacity: 1;
          transform: scale(1);
        }
        .vb-btn:focus-visible {
          outline: 2px solid var(--accent, #0ea5e9);
          outline-offset: 2px;
        }
        .vb-btn:active {
          transform: scale(0.94);
        }

        /* Muted = red mic — prominent danger state */
        .vb-btn--active-danger {
          background: var(--danger-subtle);
          color: var(--danger, #f87171);
          border-color: var(--danger, #f87171);
          box-shadow: var(--shadow-sm);
        }
        .vb-btn--active-danger::before {
          background: var(--danger-subtle);
          opacity: 1;
          transform: scale(1);
        }
        .vb-btn--active-danger:hover {
          background: var(--danger-subtle);
          border-color: var(--danger-hover, #ef4444);
        }

        /* Deafened uses separate grey state */
        .vb-btn--active-deaf {
          background: var(--bg-overlay, #213550);
          color: var(--text-muted);
          border-color: var(--border-normal);
          opacity: 0.86;
        }
        .vb-btn--active-deaf::before {
          background: var(--bg-float, #1a2c40);
          opacity: 1;
          transform: scale(1);
        }
        .vb-btn--active-deaf:hover {
          background: var(--bg-overlay, #213550);
          border-color: var(--accent-border);
          opacity: 1;
        }

        .vb-btn--active-blue {
          background: var(--accent-subtle);
          color: var(--accent, #0ea5e9);
          border-color: var(--accent-border);
        }
        .vb-btn--active-blue::before {
          opacity: 1;
          transform: scale(1);
        }
        .vb-btn--active-blue:hover {
          background: var(--accent-subtle);
          border-color: var(--accent-hover, #38bdf8);
        }

        /* Leave: red, prominent pill — stands out clearly */
        .vb-btn--leave {
          background: linear-gradient(135deg, var(--danger-hover, #ef4444) 0%, var(--danger, #f87171) 100%);
          color: var(--text-primary);
          border-color: var(--danger, #f87171);
          box-shadow: var(--shadow-md);
          border-radius: var(--r-full, 9999px);
          padding: 0 14px;
          width: auto;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0;
        }
        .vb-btn--leave::before {
          background: var(--danger-subtle);
        }
        .vb-btn--leave:hover {
          background: linear-gradient(135deg, var(--danger, #f87171) 0%, var(--danger-hover, #ef4444) 100%);
          filter: brightness(1.05);
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
          0%, 100% { filter: drop-shadow(0 0 3px var(--status-online, #34d399)); }
          50%      { filter: drop-shadow(0 0 8px var(--status-online, #34d399)); }
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
          transition: filter var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
                      opacity var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
                      transform var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1));
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

        @media (prefers-reduced-motion: reduce) {
          .voice-bar,
          .vb-waveform-bar,
          .vb-tile-avatar--speaking::before,
          .voice-video-tile--speaking {
            animation: none;
          }
          .voice-bar,
          .vb-tile,
          .vb-tile-avatar,
          .vb-gate-bar,
          .vb-btn,
          .vb-btn::before,
          .voice-video-tile {
            transition: none;
          }
          .voice-bar,
          .vb-tile:hover,
          .vb-btn:active {
            transform: none;
          }
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
