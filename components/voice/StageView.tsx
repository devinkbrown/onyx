'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ChannelUser } from '@/lib/irc/types';
import ChatArea from '@/components/chat/ChatArea';

// ── Helpers ───────────────────────────────────────────────────────────────────

function nickColor(nick: string): string {
  let hash = 0;
  for (const c of nick) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 48%)`;
}

function initials(nick: string): string {
  const clean = nick.replace(/^[~@+.%]+/, '');
  return clean.slice(0, 2).toUpperCase();
}

/** Returns true for users who are considered speakers: voice (+v), halfop (+h), op (+o), admin (+a), owner (+q) */
function isSpeaker(user: ChannelUser): boolean {
  return (
    user.modes.has('v') ||
    user.modes.has('h') ||
    user.modes.has('o') ||
    user.modes.has('a') ||
    user.modes.has('q')
  );
}

// ── SpeakerBubble ─────────────────────────────────────────────────────────────

interface SpeakerBubbleProps {
  user: ChannelUser;
  isHost: boolean;
  isCohost: boolean;
  onMoveToAudience: (nick: string) => void;
  onMakeCohost: (nick: string) => void;
}

function SpeakerBubble({ user, isHost, isCohost, onMoveToAudience, onMakeCohost }: SpeakerBubbleProps) {
  const color = nickColor(user.nick);
  const text  = initials(user.nick);
  const displayNick = user.nick.replace(/^[~@+.%]+/, '');

  return (
    <div className="sv-speaker">
      <div className="sv-avatar-ring">
        <div className="sv-avatar" style={{ background: color }}>
          {text}
        </div>
      </div>
      <div className="sv-speaker-footer">
        <span className="sv-speaker-nick">{displayNick}</span>
        {isCohost && (
          <span className="stage-cohost-badge" title="Co-host">Co-host</span>
        )}
        {isHost && (
          <>
            {!isCohost && (
              <button
                className="sv-cohost-btn"
                onClick={() => onMakeCohost(user.nick)}
                title={`Make ${displayNick} co-host`}
                aria-label={`Make ${displayNick} co-host`}
              >
                ★
              </button>
            )}
            <button
              className="sv-move-audience-btn"
              onClick={() => onMoveToAudience(user.nick)}
              title={`Move ${displayNick} to audience`}
              aria-label={`Move ${displayNick} to audience`}
            >
              ↓
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── RaisedHandRow ─────────────────────────────────────────────────────────────

interface RaisedHandRowProps {
  nick: string;
  isHost: boolean;
  onInvite: (nick: string) => void;
  onDeny: (nick: string) => void;
}

function RaisedHandRow({ nick, isHost, onInvite, onDeny }: RaisedHandRowProps) {
  return (
    <div className="sv-hand-row">
      <span className="sv-hand-nick">
        <span className="sv-hand-icon stage-hand-raised" aria-hidden>🙋</span>
        {nick}
      </span>
      {isHost && (
        <div className="sv-hand-actions">
          <button className="sv-hand-btn sv-hand-btn--grant" onClick={() => onInvite(nick)}>
            Invite to speak
          </button>
          <button className="sv-hand-btn sv-hand-btn--deny" onClick={() => onDeny(nick)}>
            Deny
          </button>
        </div>
      )}
    </div>
  );
}

// ── SpeakInviteCard ───────────────────────────────────────────────────────────

interface SpeakInviteCardProps {
  inviterNick: string;
  onAccept: () => void;
  onDecline: () => void;
}

function SpeakInviteCard({ inviterNick, onAccept, onDecline }: SpeakInviteCardProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      onDecline();
    }, 30_000);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [onDecline]);

  return (
    <div className="stage-speak-invite" role="alertdialog" aria-label="Speak invitation">
      <span className="sv-invite-icon" aria-hidden>🎤</span>
      <span className="sv-invite-text">
        <strong>{inviterNick}</strong> invited you to speak
      </span>
      <button className="sv-invite-btn sv-invite-btn--accept" onClick={onAccept}>
        Accept
      </button>
      <button className="sv-invite-btn sv-invite-btn--decline" onClick={onDecline}>
        Decline
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StageView() {
  const stageChannel      = useOnyxStore(s => s.stageChannel);
  const stageRaisedHands  = useOnyxStore(s => s.stageRaisedHands);
  const isStageHost       = useOnyxStore(s => s.isStageHost);
  const isStageSpeaker    = useOnyxStore(s => s.isStageSpeaker);
  const stageHandRaised   = useOnyxStore(s => s.stageHandRaised);
  const pendingSpeakInvite = useOnyxStore(s => s.pendingSpeakInvite);
  const channels          = useOnyxStore(s => s.channels);
  const raiseHand         = useOnyxStore(s => s.raiseHand);
  const lowerHand         = useOnyxStore(s => s.lowerHand);
  const inviteToSpeak     = useOnyxStore(s => s.inviteToSpeak);
  const moveToAudience    = useOnyxStore(s => s.moveToAudience);
  const acceptSpeakInvite = useOnyxStore(s => s.acceptSpeakInvite);
  const declineSpeakInvite = useOnyxStore(s => s.declineSpeakInvite);
  const grantSpeaker      = useOnyxStore(s => s.grantSpeaker);
  const endStage          = useOnyxStore(s => s.endStage);
  const leaveStage        = useOnyxStore(s => s.leaveStage);

  const [muted, setMuted]                   = useState(false);
  const [chatCollapsed, setChatCollapsed]   = useState(false);
  const [cohosts, setCohosts]               = useState<Set<string>>(new Set());

  const channel  = stageChannel ? channels.get(stageChannel.toLowerCase()) : null;
  const speakers = channel ? [...channel.users.values()].filter(isSpeaker) : [];
  const audience = channel ? [...channel.users.values()].filter(u => !isSpeaker(u)) : [];

  const handleRaiseHand = useCallback(() => {
    if (stageHandRaised) {
      lowerHand();
    } else {
      raiseHand();
    }
  }, [stageHandRaised, raiseHand, lowerHand]);

  const handleDeny = useCallback((nick: string) => {
    const removeRaisedHand = useOnyxStore.getState().removeRaisedHand;
    removeRaisedHand(nick);
  }, []);

  const handleInvite = useCallback((nick: string) => {
    inviteToSpeak(nick);
  }, [inviteToSpeak]);

  const handleGrant = useCallback((nick: string) => {
    grantSpeaker(nick);
    const removeRaisedHand = useOnyxStore.getState().removeRaisedHand;
    removeRaisedHand(nick);
  }, [grantSpeaker]);

  const handleMakeCohost = useCallback((nick: string) => {
    if (!stageChannel) return;
    // Grant voice (+v) = co-host in stage context
    useOnyxStore.getState().client?.sendRaw('MODE', stageChannel, '+v', nick);
    setCohosts(prev => new Set([...prev, nick]));
  }, [stageChannel]);

  const handleMuteToggle = useCallback(() => {
    const next = !muted;
    setMuted(next);
    useOnyxStore.getState().setVoiceCallState({ muted: next });
  }, [muted]);

  if (!stageChannel) return null;

  const displayName = stageChannel.replace(/^[#&]/, '');
  const listenerCount = audience.length;

  return (
    <div className="sv-overlay" role="dialog" aria-modal aria-label={`Stage: ${displayName}`}>

      {/* ── Sidebar chat (collapsible) ── */}
      <aside className={`sv-chat-sidebar ${chatCollapsed ? 'sv-chat-sidebar--collapsed' : ''}`}>
        <button
          className="sv-chat-toggle"
          onClick={() => setChatCollapsed(c => !c)}
          aria-label={chatCollapsed ? 'Expand chat' : 'Collapse chat'}
        >
          {chatCollapsed ? '»' : '«'}
        </button>
        {!chatCollapsed && (
          <div className="sv-chat-inner">
            <ChatArea />
          </div>
        )}
      </aside>

      {/* ── Main stage area ── */}
      <main className="sv-main">

        {/* Header */}
        <header className="sv-header">
          <div className="sv-header-left">
            <span className="sv-mic-icon" aria-hidden>🎙️</span>
            <span className="sv-channel-name">{displayName}</span>
          </div>
          <div className="sv-header-right">
            <span className="sv-live-badge">
              <span className="sv-live-dot" aria-hidden />
              LIVE
            </span>
            <span className="sv-counts" aria-label={`${speakers.length} speakers, ${listenerCount} in audience`}>
              {speakers.length} {speakers.length === 1 ? 'speaker' : 'speakers'} · {listenerCount} in audience
            </span>
          </div>
        </header>

        {/* Speakers grid */}
        <section className="sv-speakers-section" aria-label="Speakers">
          <h2 className="sv-section-label">Speakers</h2>
          {speakers.length === 0 ? (
            <p className="sv-empty-speakers">No speakers yet</p>
          ) : (
            <div className="sv-speakers-grid">
              {speakers.map(user => (
                <SpeakerBubble
                  key={user.nick}
                  user={user}
                  isHost={isStageHost}
                  isCohost={cohosts.has(user.nick)}
                  onMoveToAudience={moveToAudience}
                  onMakeCohost={handleMakeCohost}
                />
              ))}
            </div>
          )}
        </section>

        {/* Raised hands — visible to everyone but controls shown to host */}
        {stageRaisedHands.length > 0 && (
          <section className="sv-hands-section" aria-label="Raised hands">
            <h2 className="sv-section-label">
              <span className="stage-hand-raised" style={{ display: 'inline-block', marginRight: 6 }} aria-hidden>🙋</span>
              Raised Hands
            </h2>
            <div className="sv-hands-list">
              {stageRaisedHands.map(nick => (
                <RaisedHandRow
                  key={nick}
                  nick={nick}
                  isHost={isStageHost}
                  onInvite={handleInvite}
                  onDeny={handleDeny}
                />
              ))}
            </div>
          </section>
        )}

        {/* Old grant-based raised hands panel — kept for hosts who use grantSpeaker directly */}
        {isStageHost && stageRaisedHands.length === 0 && audience.length > 0 && (
          <section className="sv-audience-section" aria-label="Audience">
            <h2 className="sv-section-label">Audience ({audience.length})</h2>
            <div className="sv-audience-list">
              {audience.map(u => (
                <div key={u.nick} className="sv-audience-row">
                  <span className="sv-audience-nick">{u.nick.replace(/^[~@+.%]+/, '')}</span>
                  <button
                    className="sv-hand-btn sv-hand-btn--grant"
                    onClick={() => handleGrant(u.nick)}
                  >
                    Invite to speak
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Bottom action bar */}
        <footer className="sv-footer">
          {isStageHost ? (
            <>
              <span className="sv-host-label">You are the host</span>
              <button className="sv-btn sv-btn--danger" onClick={endStage}>
                End Stage
              </button>
            </>
          ) : isStageSpeaker ? (
            <>
              <button
                className={`sv-btn ${muted ? 'sv-btn--muted' : 'sv-btn--secondary'}`}
                onClick={handleMuteToggle}
                aria-pressed={muted}
              >
                {muted ? '🔇 Unmute' : '🎤 Mute'}
              </button>
              <button className="sv-btn sv-btn--danger" onClick={leaveStage}>
                Leave Stage
              </button>
            </>
          ) : (
            <>
              <button
                className={`stage-hand-btn${stageHandRaised ? ' stage-hand-btn--active' : ''}`}
                onClick={handleRaiseHand}
                aria-pressed={stageHandRaised}
              >
                {stageHandRaised ? '✋ Lower Hand' : '🙋 Raise Hand'}
              </button>
              <button className="sv-btn sv-btn--ghost" onClick={leaveStage}>
                Leave
              </button>
            </>
          )}
        </footer>

        {/* Speak invite notification */}
        {pendingSpeakInvite !== null && (
          <SpeakInviteCard
            inviterNick={pendingSpeakInvite}
            onAccept={acceptSpeakInvite}
            onDecline={declineSpeakInvite}
          />
        )}
      </main>

      <style>{`
        /* ── Overlay ── */
        .sv-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: flex;
          background: var(--bg-void, #030810);
          overflow: hidden;
        }

        /* ── Sidebar chat ── */
        .sv-chat-sidebar {
          width: 320px;
          flex-shrink: 0;
          display: flex;
          flex-direction: row;
          border-right: 1px solid rgba(14, 165, 233, 0.12);
          background: var(--bg-deep, #06101d);
          transition: width 200ms cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
          overflow: hidden;
        }
        .sv-chat-sidebar--collapsed {
          width: 36px;
        }

        .sv-chat-toggle {
          position: absolute;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          z-index: 2;
          width: 24px;
          height: 48px;
          background: rgba(14, 165, 233, 0.08);
          border: 1px solid rgba(14, 165, 233, 0.18);
          border-right: none;
          border-radius: 6px 0 0 6px;
          color: var(--accent, #0ea5e9);
          font-size: 14px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background var(--t-fast, 150ms);
        }
        .sv-chat-toggle:hover {
          background: rgba(14, 165, 233, 0.16);
        }

        .sv-chat-inner {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        /* ── Main ── */
        .sv-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 32px 40px 24px;
          overflow-y: auto;
          min-width: 0;
          gap: 32px;
          position: relative;
        }

        /* ── Header ── */
        .sv-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .sv-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .sv-mic-icon {
          font-size: 28px;
          line-height: 1;
        }

        .sv-channel-name {
          font-size: 24px;
          font-weight: 800;
          color: var(--text-primary, #dff0ff);
          letter-spacing: -0.5px;
        }

        .sv-header-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .sv-live-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 20px;
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid rgba(239, 68, 68, 0.4);
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.1em;
          color: #f87171;
          text-transform: uppercase;
        }

        .sv-live-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #ef4444;
          animation: sv-pulse 1.4s ease-in-out infinite;
        }

        @keyframes sv-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.45; transform: scale(0.72); }
        }

        .sv-counts {
          font-size: 14px;
          color: var(--text-secondary, #7aa8c4);
          font-weight: 500;
        }

        /* ── Section labels ── */
        .sv-section-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--text-muted, #3d6480);
          margin: 0 0 16px;
          display: flex;
          align-items: center;
        }

        /* ── Speakers grid ── */
        .sv-speakers-section {
          flex: 1;
        }

        .sv-empty-speakers {
          font-size: 14px;
          color: var(--text-muted, #3d6480);
          font-style: italic;
          margin: 0;
        }

        .sv-speakers-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 24px 32px;
        }

        .sv-speaker {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }

        .sv-avatar-ring {
          padding: 3px;
          border-radius: 50%;
          background: conic-gradient(#22c55e, #16a34a, #22c55e);
          animation: sv-ring-spin 2.5s linear infinite;
        }

        @keyframes sv-ring-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        .sv-avatar {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          font-weight: 800;
          color: #fff;
          border: 3px solid var(--bg-void, #030810);
          letter-spacing: 0.5px;
          user-select: none;
        }

        .sv-speaker-footer {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .sv-speaker-nick {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary, #dff0ff);
          max-width: 90px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sv-move-audience-btn {
          background: rgba(100, 116, 139, 0.15);
          border: 1px solid rgba(100, 116, 139, 0.3);
          color: #94a3b8;
          border-radius: 4px;
          width: 20px;
          height: 20px;
          padding: 0;
          font-size: 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: background 150ms, color 150ms;
          line-height: 1;
        }
        .sv-move-audience-btn:hover {
          background: rgba(239, 68, 68, 0.15);
          border-color: rgba(239, 68, 68, 0.35);
          color: #f87171;
        }

        .sv-cohost-btn {
          background: rgba(232, 184, 75, 0.12);
          border: 1px solid rgba(232, 184, 75, 0.35);
          color: #e8b84b;
          border-radius: 4px;
          width: 20px;
          height: 20px;
          padding: 0;
          font-size: 11px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: background 150ms, color 150ms;
          line-height: 1;
        }
        .sv-cohost-btn:hover {
          background: rgba(232, 184, 75, 0.25);
          border-color: rgba(232, 184, 75, 0.6);
          color: #f5cc6a;
        }

        .stage-cohost-badge {
          font-size: 10px;
          padding: 1px 5px;
          border-radius: 4px;
          background: var(--accent, #7c5af5);
          color: white;
          font-weight: 600;
          margin-left: 4px;
          white-space: nowrap;
        }

        /* ── Raised hands ── */
        .sv-hands-section {
          background: rgba(14, 165, 233, 0.05);
          border: 1px solid rgba(14, 165, 233, 0.12);
          border-radius: 12px;
          padding: 16px 20px;
        }

        .sv-hands-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .sv-hand-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 8px 10px;
          border-radius: 8px;
          background: rgba(6, 16, 29, 0.6);
        }

        .sv-hand-nick {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary, #dff0ff);
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sv-hand-icon {
          font-size: 16px;
          flex-shrink: 0;
        }

        .sv-hand-actions {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }

        .sv-hand-btn {
          padding: 5px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 700;
          border: none;
          cursor: pointer;
          transition: opacity var(--t-fast, 150ms);
        }
        .sv-hand-btn:hover { opacity: 0.82; }

        .sv-hand-btn--grant {
          background: rgba(34, 197, 94, 0.18);
          border: 1px solid rgba(34, 197, 94, 0.4);
          color: #4ade80;
        }

        .sv-hand-btn--deny {
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #f87171;
        }

        /* ── Audience section ── */
        .sv-audience-section {
          background: rgba(14, 165, 233, 0.03);
          border: 1px solid rgba(14, 165, 233, 0.08);
          border-radius: 12px;
          padding: 16px 20px;
        }

        .sv-audience-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .sv-audience-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 6px 10px;
          border-radius: 6px;
          background: rgba(6, 16, 29, 0.4);
        }

        .sv-audience-nick {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary, #7aa8c4);
        }

        /* ── Footer ── */
        .sv-footer {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 0 0;
          border-top: 1px solid rgba(14, 165, 233, 0.1);
          flex-shrink: 0;
        }

        .sv-host-label {
          flex: 1;
          font-size: 13px;
          color: var(--text-secondary, #7aa8c4);
          font-style: italic;
        }

        /* ── Buttons ── */
        .sv-btn {
          padding: 9px 20px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 700;
          border: none;
          cursor: pointer;
          font-family: inherit;
          transition: opacity var(--t-fast, 150ms), transform var(--t-fast, 150ms);
          white-space: nowrap;
        }
        .sv-btn:hover { opacity: 0.85; transform: translateY(-1px); }
        .sv-btn:active { transform: translateY(0); }

        .sv-btn--secondary {
          background: rgba(14, 165, 233, 0.15);
          border: 1px solid rgba(14, 165, 233, 0.35);
          color: var(--accent, #0ea5e9);
        }

        .sv-btn--active {
          background: rgba(14, 165, 233, 0.28);
          border: 1px solid rgba(14, 165, 233, 0.6);
          color: #38bdf8;
          box-shadow: 0 0 12px rgba(14, 165, 233, 0.25);
        }

        .sv-btn--muted {
          background: rgba(100, 116, 139, 0.15);
          border: 1px solid rgba(100, 116, 139, 0.35);
          color: #94a3b8;
        }

        .sv-btn--ghost {
          background: transparent;
          border: 1px solid rgba(61, 100, 128, 0.4);
          color: var(--text-secondary, #7aa8c4);
        }
        .sv-btn--ghost:hover {
          border-color: rgba(61, 100, 128, 0.7);
          color: var(--text-primary, #dff0ff);
        }

        .sv-btn--danger {
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid rgba(239, 68, 68, 0.4);
          color: #f87171;
        }

        /* ── Raise hand button ── */
        @keyframes hand-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(0.95); }
        }
        .stage-hand-raised {
          animation: hand-pulse 1.5s ease-in-out infinite;
          display: inline-block;
        }
        .stage-hand-btn {
          background: rgba(124, 90, 245, 0.15);
          border: 1px solid var(--accent, #7c5af5);
          color: var(--accent, #7c5af5);
          border-radius: 20px;
          padding: 8px 16px;
          cursor: pointer;
          font-weight: 600;
          font-size: 14px;
          font-family: inherit;
          transition: background 150ms;
          white-space: nowrap;
        }
        .stage-hand-btn:hover {
          background: rgba(124, 90, 245, 0.25);
        }
        .stage-hand-btn--active {
          background: rgba(245, 158, 11, 0.15);
          border-color: #f59e0b;
          color: #f59e0b;
        }
        .stage-hand-btn--active:hover {
          background: rgba(245, 158, 11, 0.25);
        }

        /* ── Speak invite card ── */
        .stage-speak-invite {
          position: absolute;
          bottom: 80px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--bg-overlay, #0e1a2b);
          border: 1px solid var(--border, rgba(14, 165, 233, 0.18));
          border-radius: 12px;
          padding: 16px 20px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
          z-index: 10;
          white-space: nowrap;
        }

        .sv-invite-icon {
          font-size: 22px;
          flex-shrink: 0;
        }

        .sv-invite-text {
          font-size: 14px;
          color: var(--text-primary, #dff0ff);
          flex: 1;
          min-width: 0;
        }

        .sv-invite-btn {
          padding: 7px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          border: none;
          transition: opacity 150ms;
          flex-shrink: 0;
        }
        .sv-invite-btn:hover { opacity: 0.85; }

        .sv-invite-btn--accept {
          background: rgba(124, 90, 245, 0.25);
          border: 1px solid var(--accent, #7c5af5);
          color: var(--accent, #7c5af5);
        }

        .sv-invite-btn--decline {
          background: transparent;
          border: 1px solid rgba(61, 100, 128, 0.4);
          color: var(--text-secondary, #7aa8c4);
        }

        /* ── Responsive ── */
        @media (max-width: 768px) {
          .sv-chat-sidebar { display: none; }
          .sv-main { padding: 20px 16px 16px; gap: 24px; }
          .sv-channel-name { font-size: 18px; }
          .sv-speakers-grid { gap: 16px 20px; }
          .sv-avatar { width: 64px; height: 64px; font-size: 18px; }
          .stage-speak-invite {
            width: calc(100% - 32px);
            flex-wrap: wrap;
            bottom: 90px;
            white-space: normal;
          }
        }
      `}</style>
    </div>
  );
}
