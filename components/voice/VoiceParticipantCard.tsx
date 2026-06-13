'use client';

import { useEffect, useState } from 'react';
import { useOnyxStore } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';
import SpeakingBars from './SpeakingBars';
import { getMountedSuimyakuMediaEngine } from '@/lib/suimyaku-media/MediaEngine';
import type { NetworkQualityTier } from '@/lib/suimyaku-media/types';

interface VoiceParticipantCardProps {
  nick: string;
  /** Whether this is the local user */
  isYou?: boolean;
  muted?: boolean;
  deafened?: boolean;
}

/**
 * A small hover card shown when hovering a voice participant.
 * Displays avatar, nick, role badges, speaking status, mute state, and connection quality.
 */
export default function VoiceParticipantCard({
  nick,
  isYou,
  muted,
  deafened,
}: VoiceParticipantCardProps) {
  const speakingNicks = useOnyxStore(s => s.speakingNicks);
  const voice         = useOnyxStore(s => s.voice);
  const channels      = useOnyxStore(s => s.channels);

  // Live session network tier (engine-authoritative); falls back to null until
  // the engine reports. The card is only shown for in-call participants, so the
  // session tier is the relevant signal for everyone on the same SFU room.
  const [tier, setTier] = useState<NetworkQualityTier | null>(null);
  useEffect(() => {
    const read = () => {
      const engine = getMountedSuimyakuMediaEngine();
      setTier(engine ? engine.getNetworkStats().tier : null);
    };
    read();
    const id = setInterval(read, 1500);
    return () => clearInterval(id);
  }, []);

  // Speaking: check speakingNicks store (updated by VAD), fall back to peer state
  const speaking = speakingNicks.has(nick.toLowerCase())
    || (!isYou && (voice.peers.get(nick)?.speaking ?? false));

  // Role: look up channel user modes from the active voice channel
  const channelKey = voice.callChannel?.toLowerCase() ?? '';
  const channelObj = channels.get(channelKey);
  const userModes: Set<string> = channelObj?.users.get(nick.toLowerCase())?.modes
    ?? channelObj?.users.get(nick)?.modes
    ?? new Set();

  const isOwner = userModes.has('q');
  const isOp    = userModes.has('o') || userModes.has('a');
  const isVoice = userModes.has('v') || userModes.has('h');

  // Connection quality — prefer the engine's authoritative network tier; fall
  // back to a roomStats audio-bitrate heuristic when the engine hasn't reported.
  let qualityLabel = 'Good';
  let qualityColor = 'var(--status-online, #34d399)';

  if (tier !== null) {
    if (tier === 0)      { qualityLabel = 'Excellent'; qualityColor = 'var(--status-online, #34d399)'; }
    else if (tier === 1) { qualityLabel = 'Good';      qualityColor = 'var(--status-online, #34d399)'; }
    else if (tier === 2) { qualityLabel = 'Fair';      qualityColor = 'var(--warning, #fbbf24)'; }
    else                 { qualityLabel = 'Poor';      qualityColor = 'var(--danger, #f87171)'; }
  } else {
    for (const [, stat] of voice.roomStats) {
      if (!stat) continue;
      if (stat.audio_kbps > 0 && stat.audio_kbps < 8) {
        qualityLabel = 'Poor';
        qualityColor = 'var(--danger, #f87171)';
      } else if (stat.audio_kbps > 0 && stat.audio_kbps < 16) {
        qualityLabel = 'Fair';
        qualityColor = 'var(--warning, #fbbf24)';
      }
    }
  }

  const cleanNick = nick.replace(/^[~@+.]+/, '');

  return (
    <div className="vpc-card">
      <div className="vpc-avatar-row">
        <Avatar nick={nick} size={40} />
        {speaking && (
          <span className="vpc-speaking-ring" aria-hidden />
        )}
      </div>
      <div className="vpc-body">
        <div className="vpc-nick-row">
          <span className="vpc-nick">{cleanNick}</span>
          {isYou && <span className="vpc-you">(You)</span>}
          {/* Role badges */}
          {isOwner && <span className="vpc-badge vpc-badge--owner" title="Owner">♛</span>}
          {!isOwner && isOp && <span className="vpc-badge vpc-badge--op" title="Operator">@</span>}
          {!isOwner && !isOp && isVoice && <span className="vpc-badge vpc-badge--voice" title="Voice">+</span>}
        </div>
        <div className="vpc-divider" />
        <div className="vpc-status-row">
          <SpeakingBars speaking={speaking && !muted && !deafened} size="sm" />
          <span className={`vpc-status-text ${deafened ? 'vpc-status-text--deaf' : muted ? 'vpc-status-text--muted' : speaking ? 'vpc-status-text--speaking' : ''}`}>
            {deafened ? 'Deafened' : muted ? 'Muted' : speaking ? 'Speaking' : 'Listening'}
          </span>
          {muted && !deafened && (
            <span className="vpc-mute-icon" aria-label="Muted" title="Muted">
              <MuteIcon />
            </span>
          )}
          {deafened && (
            <span className="vpc-mute-icon vpc-mute-icon--deafened" aria-label="Deafened" title="Deafened">
              <DeafenIcon />
            </span>
          )}
        </div>
        <div className="vpc-quality">
          <span className="vpc-quality-dot" style={{ background: qualityColor, color: qualityColor }} aria-hidden />
          <span className="vpc-quality-label">{qualityLabel} connection</span>
        </div>
      </div>
      <style>{`
        .vpc-card {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          background: color-mix(in srgb, #050505 86%, var(--accent, #0ea5e9) 8%);
          border-radius: var(--r-sm, 6px) var(--r-xl, 16px) var(--r-md, 8px) var(--r-lg, 14px);
          padding: 12px 14px;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-2, 0 18px 44px rgba(0,0,0,.42));
          min-width: 190px;
          animation: vpc-pop 140ms cubic-bezier(0.16,1,0.3,1) both;
          pointer-events: none;
        }

        @keyframes vpc-pop {
          from { opacity: 0; transform: scale(0.90) translateY(6px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        .vpc-avatar-row {
          position: relative;
          flex-shrink: 0;
        }

        /* Speaking ring: the one permitted luminous voice treatment */
        .vpc-speaking-ring {
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          border: 2.5px solid var(--status-online, #34d399);
          animation: vpc-ring-pulse 900ms ease-in-out infinite;
          pointer-events: none;
        }
        .vpc-speaking-ring::after {
          content: '';
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          border: 1.5px solid rgba(52, 211, 153, 0.25);
          animation: vpc-ring-pulse 900ms ease-in-out infinite;
          animation-delay: 150ms;
        }

        @keyframes vpc-ring-pulse {
          0%   { opacity: 1; transform: scale(0.96); }
          60%  { opacity: 0.7; transform: scale(1.12); }
          100% { opacity: 1; transform: scale(0.96); }
        }

        .vpc-body {
          display: flex;
          flex-direction: column;
          gap: 5px;
          min-width: 0;
          flex: 1;
        }

        .vpc-nick-row {
          display: flex;
          align-items: center;
          gap: 5px;
          flex-wrap: nowrap;
        }

        .vpc-nick {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: 0.01em;
        }

        .vpc-you {
          font-size: 10.5px;
          font-weight: 500;
          color: var(--text-muted);
          letter-spacing: 0;
          flex-shrink: 0;
        }

        /* Role badges */
        .vpc-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 9.5px;
          font-weight: 800;
          border-radius: 4px;
          padding: 1px 5px;
          line-height: 1.3;
          flex-shrink: 0;
        }
        .vpc-badge--owner {
          background: rgba(103,232,249,0.12);
          color: var(--gold, #67e8f9);
          border: 1px solid rgba(103,232,249,0.3);
        }
        .vpc-badge--op {
          background: rgba(14,165,233,0.12);
          color: var(--accent, #0ea5e9);
          border: 1px solid rgba(14,165,233,0.28);
        }
        .vpc-badge--voice {
          background: rgba(52,211,153,0.1);
          color: var(--status-online, #34d399);
          border: 1px solid rgba(52,211,153,0.25);
        }

        /* Divider between nick and status */
        .vpc-divider {
          height: 1px;
          background: var(--border-subtle, rgba(14,165,233,0.08));
          margin: 0 0 1px;
        }

        .vpc-status-row {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .vpc-status-text {
          font-size: 11px;
          color: var(--text-secondary);
          flex: 1;
        }
        .vpc-status-text--speaking {
          color: var(--status-online, #34d399);
          font-weight: 600;
        }
        .vpc-status-text--muted {
          color: var(--danger, #f87171);
        }
        .vpc-status-text--deaf {
          color: var(--text-muted);
        }

        /* Mute / deafen icons */
        .vpc-mute-icon {
          display: inline-flex;
          align-items: center;
          color: var(--danger, #f87171);
          flex-shrink: 0;
        }
        .vpc-mute-icon--deafened {
          color: var(--text-muted);
        }

        .vpc-quality {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .vpc-quality-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .vpc-quality-label {
          font-size: 10px;
          color: var(--text-muted);
          letter-spacing: 0.03em;
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}

function MuteIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M9.5 3a2 2 0 0 0-4 0v2.5M5.5 7.5a2 2 0 0 0 4 0V7" />
      <path d="M3.5 6.5a4 4 0 0 0 6.7 3" />
      <path d="M7.5 10.5v3M2 2l11 11" />
    </svg>
  );
}

function DeafenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 2l11 11M4 8.3A5 5 0 0 1 12.5 7.5v1" />
      <rect x="1.5" y="8.5" width="3" height="4" rx="1.5" />
      <rect x="10.5" y="8.5" width="3" height="4" rx="1.5" />
    </svg>
  );
}
