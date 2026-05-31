'use client';

import { useEffect, useRef, useState } from 'react';
import { useOnyxStore } from '@/lib/store';
import { StreamOverlay } from './StreamOverlay';
import { RaidBanner } from './RaidBanner';
import { PollWidget } from './PollWidget';
import { PollCreateModal } from './PollWidget';

interface Props {
  channel: string;
}

export function StreamLayout({ channel }: Props) {
  const streams = useOnyxStore(s => s.streams);
  const ourNick = useOnyxStore(s => s.ourNick);
  const client = useOnyxStore(s => s.client);
  const endStream = useOnyxStore(s => s.endStream);
  const raidChannel = useOnyxStore(s => s.raidChannel);
  const localStream = useOnyxStore(s => s.voice.localStream);
  const videoParticipants = useOnyxStore(s => s.voice.videoParticipants);

  const [showRaidInput, setShowRaidInput] = useState(false);
  const [raidTarget, setRaidTarget] = useState('');
  const [showPollCreate, setShowPollCreate] = useState(false);

  const stream = streams.get(channel.toLowerCase());
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!stream?.live || !client) return;
    const streamRoom = `%%${channel}`;
    client.sendRaw('JOIN', streamRoom);
    return () => {
      client.sendRaw('PART', streamRoom);
    };
  }, [stream?.live, client, channel]);

  const isStreamer = stream?.streamer.toLowerCase() === ourNick.toLowerCase();
  const mediaStream = isStreamer ? localStream : stream ? videoParticipants.get(stream.streamer) ?? null : null;

  useEffect(() => {
    if (!videoRef.current) return;
    if (videoRef.current.srcObject !== mediaStream) {
      videoRef.current.srcObject = mediaStream;
    }
  }, [mediaStream]);

  if (!stream?.live) return null;

  const handleRaid = () => {
    if (!raidTarget.trim()) return;
    raidChannel(channel, raidTarget.trim());
    setShowRaidInput(false);
    setRaidTarget('');
  };

  const handleLeave = () => {
    client?.sendRaw('PART', `%%${channel}`);
  };

  return (
    <>
      <div className="sl-root">
        {/* Black background with LADON media */}
        <div className="sl-video-area">
          {mediaStream ? (
            <video
              ref={videoRef}
              className="sl-video"
              autoPlay
              playsInline
              muted={isStreamer}
            />
          ) : (
            <div className="sl-video-placeholder" aria-hidden="true">
              <VideoPlaceholderIcon />
              <span>Video stream via LADON</span>
            </div>
          )}

          {/* Floating overlays */}
          <StreamOverlay channel={channel} />
          <RaidBanner channel={channel} />

          {/* Poll widget — bottom left */}
          <div className="sl-poll-host">
            <PollWidget channel={channel} />
          </div>

          {/* Control bar — bottom */}
          <div className="sl-control-bar">
            <div className="sl-control-gradient" aria-hidden="true" />
            <div className="sl-controls">
              {isStreamer ? (
                <>
                  {/* Raid button */}
                  <div className="sl-raid-wrap">
                    <button
                      className="sl-ctrl-btn sl-ctrl-btn--ghost"
                      type="button"
                      onClick={() => setShowRaidInput(v => !v)}
                      aria-expanded={showRaidInput}
                      aria-haspopup="true"
                    >
                      <RaidIcon />
                      Raid
                    </button>
                    {showRaidInput && (
                      <div className="sl-raid-input-pop" role="dialog" aria-label="Raid channel">
                        <input
                          className="sl-raid-input"
                          value={raidTarget}
                          onChange={(e) => setRaidTarget(e.target.value)}
                          placeholder="#channel"
                          aria-label="Target channel for raid"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRaid();
                            if (e.key === 'Escape') setShowRaidInput(false);
                          }}
                          autoFocus
                        />
                        <button
                          className="sl-raid-go"
                          type="button"
                          onClick={handleRaid}
                          disabled={!raidTarget.trim()}
                        >
                          Raid
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Poll button */}
                  <button
                    className="sl-ctrl-btn sl-ctrl-btn--ghost"
                    type="button"
                    onClick={() => setShowPollCreate(true)}
                  >
                    <PollIcon />
                    Poll
                  </button>

                  {/* End stream */}
                  <button
                    className="sl-ctrl-btn sl-ctrl-btn--danger"
                    type="button"
                    onClick={() => endStream(channel)}
                  >
                    <StopIcon />
                    End Stream
                  </button>
                </>
              ) : (
                <button
                  className="sl-ctrl-btn sl-ctrl-btn--ghost"
                  type="button"
                  onClick={handleLeave}
                >
                  <LeaveIcon />
                  Leave Stream
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showPollCreate && (
        <PollCreateModal channel={channel} onClose={() => setShowPollCreate(false)} />
      )}

      <style>{`
        .sl-root {
          flex-shrink: 0;
          position: relative;
          background: var(--bg-void);
          border-bottom: 1px solid var(--border-subtle);
        }
        .sl-video-area {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 9;
          max-height: 320px;
          background: #000;
          overflow: hidden;
        }
        .sl-video {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: contain;
          background: #000;
        }
        .sl-video-placeholder {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: rgba(255,255,255,0.18);
          font-size: 13px;
          font-weight: 500;
        }
        .sl-poll-host {
          position: absolute;
          left: 12px;
          bottom: 54px;
          z-index: 15;
          pointer-events: all;
        }
        .sl-control-bar {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 12;
        }
        .sl-control-gradient {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 72px;
          background: linear-gradient(to top, rgba(3,8,16,0.92) 0%, transparent 100%);
          pointer-events: none;
        }
        .sl-controls {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px 12px;
          justify-content: flex-end;
        }
        .sl-ctrl-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 12px;
          border-radius: 7px;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: opacity 150ms, background 150ms;
          border: none;
        }
        .sl-ctrl-btn--ghost {
          background: rgba(255,255,255,0.1);
          color: #fff;
          border: 1px solid rgba(255,255,255,0.12);
        }
        .sl-ctrl-btn--ghost:hover { background: rgba(255,255,255,0.16); }
        .sl-ctrl-btn--danger {
          background: rgba(230,57,70,0.18);
          color: #ff6b7a;
          border: 1px solid rgba(230,57,70,0.3);
        }
        .sl-ctrl-btn--danger:hover { background: rgba(230,57,70,0.28); }
        .sl-raid-wrap { position: relative; }
        .sl-raid-input-pop {
          position: absolute;
          bottom: calc(100% + 8px);
          right: 0;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: 8px;
          padding: 8px;
          display: flex;
          gap: 6px;
          box-shadow: var(--shadow-lg);
          animation: sl-pop 140ms cubic-bezier(0.16,1,0.3,1);
        }
        @keyframes sl-pop {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .sl-raid-input {
          background: var(--bg-overlay);
          border: 1px solid var(--border-normal);
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 13px;
          color: var(--text-primary);
          font-family: inherit;
          outline: none;
          width: 140px;
        }
        .sl-raid-input:focus { border-color: var(--accent); }
        .sl-raid-go {
          background: linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%);
          border: none;
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 700;
          color: #fff;
          cursor: pointer;
          font-family: inherit;
          transition: opacity 150ms;
        }
        .sl-raid-go:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .sl-raid-go:not(:disabled):hover { opacity: 0.88; }
      `}</style>
    </>
  );
}

const VideoPlaceholderIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="23 7 16 12 23 17 23 7"/>
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
  </svg>
);

const RaidIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>
);

const PollIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="20" x2="18" y2="10"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);

const StopIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
  </svg>
);

const LeaveIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);
