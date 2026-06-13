'use client';

import { useOnyxStore } from '@/lib/store';
import { useState, useEffect, useRef, type CSSProperties } from 'react';
import Tooltip from '@/components/ui/Tooltip';
import SpeakingBars from './SpeakingBars';
import VoiceParticipantCard from './VoiceParticipantCard';
import CaptionsOverlay from './CaptionsOverlay';
import ConnectionQuality from './ConnectionQuality';
import ReactionsOverlay from './ReactionsOverlay';
import { OpcodecWasm } from '@/lib/suimyaku-media/OpcodecWasm';
import { getMountedSuimyakuMediaEngine } from '@/lib/suimyaku-media/MediaEngine';

// ── Quick reactions ────────────────────────────────────────────────────────────
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '👏', '🔥', '👋'] as const;

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
      <div className={tileClass} aria-label={`${cleanNick}${isSelf ? ' (you)' : ''}`} data-testid="voice-video-tile">
      <video ref={videoRef} autoPlay playsInline muted={isSelf} />
      <div className="voice-video-bottom-row glass-2">
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
  const stageChannel     = useOnyxStore(s => s.stageChannel);
  const stageHandRaised  = useOnyxStore(s => s.stageHandRaised);
  const raiseHand        = useOnyxStore(s => s.raiseHand);
  const lowerHand        = useOnyxStore(s => s.lowerHand);

  const { callState, callChannel, peers, muted, deafened, screenshareActive, cameraDeviceId, localStream, videoParticipants, cameraOn, cameraStream } = voice;
  const isInCall = callState === 'in_call';
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);

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

  // ── Close the reaction popover on Escape ──────────────────────────────────
  useEffect(() => {
    if (!reactionsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReactionsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reactionsOpen]);

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
  const toggleCaptions = () => setCaptionsEnabled(v => !v);
  const toggleRaiseHand = () => {
    if (stageHandRaised) lowerHand();
    else raiseHand();
  };
  const sendReaction = (emoji: string) => {
    getMountedSuimyakuMediaEngine()?.sendReaction(emoji);
    // Optimistic local echo so you see your own reaction float immediately.
    window.dispatchEvent(
      new CustomEvent('ocean:voice-reaction', { detail: { nick: ourNick, emoji } }),
    );
    setReactionsOpen(false);
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

  const hasCamera = hasVideoInput || !cameraDeviceId;
  const channelLabel = callChannel ?? 'Voice';

  return (
    <div className="voice-bar elev-2 animate-fade-in" data-testid="voice-bar">

      {/* ── Floating reactions ── */}
      <ReactionsOverlay />

      {/* ── Channel header ── */}
      <div className="vb-header">
        <span className="vb-waveform" aria-hidden="true">
          <span className="vb-waveform-bar" />
          <span className="vb-waveform-bar" />
          <span className="vb-waveform-bar" />
          <span className="vb-waveform-bar" />
        </span>
        <span className="vb-channel-name">{channelLabel}</span>
        <ConnectionQuality />
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

      {captionsEnabled && <CaptionsOverlay />}

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
      <div className="vb-controls elev-3" data-testid="voice-control-dock">
        <Tooltip text={muted ? 'Unmute' : 'Mute'} side="top">
          <button
            className={`vb-btn ${muted ? 'vb-btn--active-danger' : ''}`}
            onClick={toggleMute}
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            aria-pressed={muted}
            data-testid="voice-mute-toggle"
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
              data-testid="voice-camera-toggle"
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
            data-testid="voice-share-toggle"
          >
            <MonitorIcon />
          </button>
        </Tooltip>

        <div className="vb-react-wrap">
          <Tooltip text="React" side="top">
            <button
              className={`vb-btn ${reactionsOpen ? 'vb-btn--active-lux' : ''}`}
              onClick={() => setReactionsOpen(o => !o)}
              aria-label="Send a reaction"
              aria-haspopup="true"
              aria-expanded={reactionsOpen}
              data-testid="voice-react-toggle"
            >
              <ReactIcon />
            </button>
          </Tooltip>
          {reactionsOpen && (
            <>
              <div
                className="vb-react-scrim"
                onClick={() => setReactionsOpen(false)}
                aria-hidden="true"
              />
              <div className="vb-react-pop elev-3" role="menu" aria-label="Quick reactions">
                {QUICK_REACTIONS.map(emoji => (
                  <button
                    key={emoji}
                    className="vb-react-emoji"
                    role="menuitem"
                    onClick={() => sendReaction(emoji)}
                    aria-label={`React with ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <Tooltip text={captionsEnabled ? 'Hide captions' : 'Show captions'} side="top">
          <button
            className={`vb-btn ${captionsEnabled ? 'vb-btn--active-lux' : ''}`}
            onClick={toggleCaptions}
            aria-label={captionsEnabled ? 'Hide captions' : 'Show captions'}
            aria-pressed={captionsEnabled}
            data-testid="voice-captions-toggle"
          >
            <CaptionsIcon />
          </button>
        </Tooltip>

        {stageChannel && (
          <Tooltip text={stageHandRaised ? 'Lower hand' : 'Raise hand'} side="top">
            <button
              className={`vb-btn vb-btn--hand ${stageHandRaised ? 'vb-btn--active-lux' : ''}`}
              onClick={toggleRaiseHand}
              aria-label={stageHandRaised ? 'Lower hand' : 'Raise hand'}
              aria-pressed={stageHandRaised}
              data-testid="voice-raise-hand-toggle"
            >
              <HandIcon />
            </button>
          </Tooltip>
        )}

        <Tooltip text="Leave voice channel" side="top">
          <button className="vb-btn vb-btn--leave" onClick={hangUp} aria-label="Leave voice channel" data-testid="voice-leave-button">
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
          0%, 100% { opacity: 0.48; transform: scale(0.94); }
          50%      { opacity: 0.94; transform: scale(1.14); }
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
          gap: var(--sp-2, 8px);
          padding: var(--sp-2, 8px) var(--sp-3, 12px) var(--sp-3, 12px);
          background: color-mix(in srgb, #050505 92%, var(--accent, #0ea5e9) 8%);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-2, 0 18px 44px rgba(0,0,0,.42));
          flex-shrink: 0;
          animation: vb-fadein 220ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
        }

        /* ── Header ── */
        .vb-header {
          display: flex;
          align-items: center;
          gap: var(--sp-2, 8px);
          padding: 0 var(--sp-1, 4px);
          min-height: 28px;
        }

        /* Animated waveform dots — shown when not speaking; pulses when connected */
        .vb-waveform {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 2px;
          width: 28px;
          height: 22px;
          border-radius: var(--r-sm, 6px) var(--r-lg, 14px) var(--r-xs, 4px) var(--r-md, 8px);
          background: color-mix(in srgb, var(--accent, #0ea5e9) 12%, #050505 88%);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 10px 26px rgba(0,0,0,.32));
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
          font-size: var(--text-xs, 12px);
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
          font-size: var(--text-xs, 11px);
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
          background: color-mix(in srgb, #050505 84%, white 8%);
          padding: 3px var(--sp-2, 8px);
          border-radius: var(--r-lg, 14px) var(--r-xs, 4px) var(--r-lg, 14px) var(--r-sm, 6px);
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
          gap: var(--sp-2, 8px);
          padding: 0 var(--sp-1, 4px);
        }

        .vb-tile {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          min-width: 0;
          min-height: 78px;
          padding: var(--sp-2, 8px) var(--sp-1, 4px);
          border-radius: var(--r-sm, 6px) var(--r-xl, 16px) var(--r-md, 8px) var(--r-lg, 14px);
          background: color-mix(in srgb, #050505 86%, var(--accent, #0ea5e9) 8%);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 10px 26px rgba(0,0,0,.32));
          transition: transform var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
                      opacity var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
                      filter var(--t-fast, 150ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1));
        }
        .vb-tile:hover {
          background: color-mix(in srgb, #050505 78%, var(--accent, #0ea5e9) 12%);
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
          box-shadow: 0 0 0 2px #050505, var(--elev-shadow-1, 0 10px 26px rgba(0,0,0,.32));
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
          box-shadow: 0 0 0 2px var(--status-online, #34d399), var(--elev-shadow-1, 0 10px 26px rgba(0,0,0,.32));
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
          color: var(--status-online, #34d399);
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
          background: var(--status-online, #34d399);
        }
        .vb-gate-bar--muted {
          background: var(--text-muted);
          opacity: 0.22;
          transform: scaleX(1);
        }

        /* ── Divider ── */
        .vb-divider {
          height: 1px;
          background: color-mix(in srgb, white 7%, transparent);
          margin: 0 14px;
        }

        /* ── Controls ── */
        .vb-controls {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--sp-2, 8px);
          width: fit-content;
          max-width: 100%;
          margin: 0 auto;
          padding: var(--sp-2, 8px);
          border-radius: var(--r-2xl, 20px) var(--r-lg, 14px) var(--r-xl, 16px) var(--r-md, 8px);
          background: color-mix(in srgb, #050505 76%, var(--accent, #0ea5e9) 8%);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-3, 0 24px 60px rgba(0,0,0,.52));
        }

        .vb-btn {
          position: relative;
          width: 40px; height: 40px;
          border-radius: var(--r-md, 8px) var(--r-xl, 16px) var(--r-sm, 6px) var(--r-lg, 14px);
          border: 0;
          background: color-mix(in srgb, #050505 80%, white 7%);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 10px 26px rgba(0,0,0,.32));
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
          background: color-mix(in srgb, #050505 70%, white 10%);
          color: var(--text-primary);
          transform: translateY(-1px);
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
          transform: translateY(0) scale(0.98);
        }

        /* Muted = red mic — prominent danger state */
        .vb-btn--active-danger {
          background: color-mix(in srgb, var(--danger, #f87171) 18%, #050505 82%);
          color: var(--danger, #f87171);
        }
        .vb-btn--active-danger::before {
          background: var(--danger-subtle);
          opacity: 1;
          transform: scale(1);
        }
        .vb-btn--active-danger:hover {
          background: color-mix(in srgb, var(--danger, #f87171) 24%, #050505 76%);
        }

        /* Deafened uses separate grey state */
        .vb-btn--active-deaf {
          background: color-mix(in srgb, white 10%, #050505 90%);
          color: var(--text-muted);
          opacity: 0.86;
        }
        .vb-btn--active-deaf::before {
          background: var(--bg-float, #1a2c40);
          opacity: 1;
          transform: scale(1);
        }
        .vb-btn--active-deaf:hover {
          background: color-mix(in srgb, white 14%, #050505 86%);
          opacity: 1;
        }

        .vb-btn--active-blue {
          background: color-mix(in srgb, var(--accent, #0ea5e9) 18%, #050505 82%);
          color: var(--accent, #0ea5e9);
        }
        .vb-btn--active-blue::before {
          opacity: 1;
          transform: scale(1);
        }
        .vb-btn--active-blue:hover {
          background: color-mix(in srgb, var(--accent, #0ea5e9) 24%, #050505 76%);
        }

        .vb-btn--active-lux {
          background: color-mix(in srgb, var(--lux, #d8b96a) 18%, #050505 82%);
          color: var(--lux, #d8b96a);
        }
        .vb-btn--active-lux:hover {
          background: color-mix(in srgb, var(--lux, #d8b96a) 24%, #050505 76%);
        }

        /* ── Reaction launcher ── */
        .vb-react-wrap {
          position: relative;
          display: flex;
          flex-shrink: 0;
        }
        .vb-react-scrim {
          position: fixed;
          inset: 0;
          z-index: 1;
        }
        .vb-react-pop {
          position: absolute;
          bottom: calc(100% + 10px);
          left: 50%;
          transform: translateX(-50%);
          z-index: 2;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 2px;
          padding: var(--sp-2, 8px);
          width: max-content;
          border-radius: var(--r-lg, 14px) var(--r-md, 8px) var(--r-xl, 16px) var(--r-sm, 6px);
          background: color-mix(in srgb, #050505 72%, var(--accent, #0ea5e9) 8%);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-3, 0 24px 60px rgba(0,0,0,.52));
          animation: vb-react-pop-in 160ms var(--ease-spring, cubic-bezier(.34,1.4,.4,1)) both;
        }
        @keyframes vb-react-pop-in {
          from { opacity: 0; transform: translateX(-50%) translateY(6px) scale(0.9); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        .vb-react-emoji {
          width: 34px;
          height: 34px;
          border: 0;
          border-radius: var(--r-sm, 6px) var(--r-md, 8px) var(--r-sm, 6px) var(--r-lg, 10px);
          background: transparent;
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform var(--t-fast, 150ms) var(--ease-spring, cubic-bezier(.34,1.4,.4,1)),
                      background var(--t-fast, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1));
        }
        .vb-react-emoji:hover {
          background: color-mix(in srgb, white 8%, transparent);
          transform: scale(1.22);
        }
        .vb-react-emoji:focus-visible {
          outline: 2px solid var(--accent, #0ea5e9);
          outline-offset: 1px;
        }
        .vb-react-emoji:active { transform: scale(1.05); }

        /* Leave: red, prominent pill — stands out clearly */
        .vb-btn--leave {
          background: color-mix(in srgb, var(--danger, #f87171) 28%, #050505 72%);
          color: var(--text-primary);
          border-radius: var(--r-xl, 16px) var(--r-md, 8px) var(--r-2xl, 20px) var(--r-sm, 6px);
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
          background: color-mix(in srgb, var(--danger, #f87171) 36%, #050505 64%);
        }

        /* ── Self-preview pip ── */
        .vb-self-preview {
          position: fixed;
          bottom: 76px;
          right: 16px;
          width: 84px; height: 63px;
          border-radius: var(--r-md, 8px);
          overflow: hidden;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-2, 0 18px 44px rgba(0,0,0,.42));
          z-index: 200;
          background: #000;
        }
        .vb-self-video {
          width: 100%; height: 100%;
          object-fit: cover;
          transform: scaleX(-1);
        }

        /* ── Video grid ── */
        @keyframes vb-speaking-ring {
          0%, 100% { opacity: 0.52; transform: scale(0.995); }
          50%      { opacity: 1; transform: scale(1.015); }
        }

        .voice-video-grid {
          display: grid;
          gap: var(--sp-2, 8px);
          padding: var(--sp-2, 8px);
          background: #000;
          border-radius: var(--r-sm, 6px) var(--r-2xl, 20px) var(--r-md, 8px) var(--r-xl, 16px);
          margin: 0;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-2, 0 18px 44px rgba(0,0,0,.42));
        }

        /* Single tile — centered, max 2/3 width */
        .voice-video-grid[data-count="1"] {
          grid-template-columns: minmax(0, 2fr);
          justify-content: center;
        }

        .voice-video-tile {
          position: relative;
          border-radius: var(--r-xs, 4px) var(--r-xl, 16px) var(--r-sm, 6px) var(--r-md, 8px);
          overflow: hidden;
          background: #000;
          aspect-ratio: 16/9;
          border: 0;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.055);
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
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent, #0ea5e9) 42%, white 10%);
        }

        /* Speaking: the one permitted luminous ring */
        .voice-video-tile--speaking {
          box-shadow: inset 0 0 0 2px var(--status-online, #34d399), 0 0 18px color-mix(in srgb, var(--status-online, #34d399) 62%, transparent);
        }
        .voice-video-tile--speaking::after {
          content: '';
          position: absolute;
          inset: var(--sp-1, 4px);
          border-radius: inherit;
          border: 1px solid var(--status-online, #34d399);
          pointer-events: none;
          animation: vb-speaking-ring 950ms ease-in-out infinite;
        }

        /* Screenshare: accent border */
        .voice-video-tile--screenshare {
          box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent, #0ea5e9) 54%, white 8%);
        }

        /* Bottom label row */
        .voice-video-bottom-row {
          position: absolute;
          bottom: var(--sp-2, 8px);
          left: var(--sp-2, 8px);
          right: var(--sp-2, 8px);
          display: flex;
          align-items: center;
          gap: 5px;
          width: fit-content;
          max-width: calc(100% - var(--sp-4, 16px));
          padding: var(--sp-1, 4px) var(--sp-2, 8px);
          border-radius: var(--r-sm, 6px) var(--r-lg, 14px) var(--r-xs, 4px) var(--r-md, 8px);
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
          .voice-video-tile--speaking,
          .vb-react-pop {
            animation: none;
          }
          .vb-react-emoji {
            transition: none;
          }
          .vb-react-emoji:hover,
          .vb-react-emoji:active {
            transform: none;
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

const CaptionsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M5 7h2.2M5 10h1.4M9 7h2M8.5 10H11" />
  </svg>
);

const ReactIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6.4" />
    <path d="M5.5 9.4a3 3 0 0 0 5 0" />
    <path d="M5.6 6.2h.01M10.4 6.2h.01" />
  </svg>
);

const HandIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5.4 8.2V3.6a1 1 0 0 1 2 0v3.7" />
    <path d="M7.4 7.1V2.8a1 1 0 0 1 2 0v4.5" />
    <path d="M9.4 7.3V4a1 1 0 0 1 2 0v5.6" />
    <path d="M5.4 8.8 4.2 7.6a1 1 0 0 0-1.5 1.3l2.8 3.5c.7.9 1.8 1.4 3 1.4h.7a3.2 3.2 0 0 0 3.2-3.2V7.2" />
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
