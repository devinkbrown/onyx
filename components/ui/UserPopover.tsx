'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { IRCMessage } from '@/lib/irc/types';
import { parseActivity } from '@/lib/activity';
import Avatar from './Avatar';
import RoleBadge, { highestRoleMode } from './RoleBadge';

interface Props {
  nick: string;
  children: React.ReactNode;
}

interface WhoisInfo {
  nick: string;
  realname?: string;
  host?: string;
  channels?: string[];
  account?: string;
  away?: string;
  server?: string;
  oper?: boolean;
}

type PopoverPlacement = 'above-left' | 'above-right' | 'below-left' | 'below-right';

function fallbackAccent(nick: string): string {
  let hash = 0;
  for (const c of nick) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return `hsl(${Math.abs(hash) % 360}, 44%, 34%)`;
}

export default function UserPopover({ nick, children }: Props) {
  const [open,      setOpen]      = useState(false);
  const [whois,     setWhois]     = useState<WhoisInfo | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [placement, setPlacement] = useState<PopoverPlacement>('above-left');
  const popoverRef  = useRef<HTMLDivElement>(null);
  const triggerRef  = useRef<HTMLSpanElement>(null);

  const client           = useOnyxStore(s => s.client);
  const ourNick          = useOnyxStore(s => s.ourNick);
  const navigate         = useOnyxStore(s => s.navigate);
  const channels         = useOnyxStore(s => s.channels);
  const activeView       = useOnyxStore(s => s.activeView);
  const userProps        = useOnyxStore(s => s.userProps);
  const requestUserProps  = useOnyxStore(s => s.requestUserProps);
  const isIRCX           = useOnyxStore(s => s.isIRCX);
  const openUserProfile  = useOnyxStore(s => s.openUserProfile);
  const getUserProfile   = useOnyxStore(s => s.getUserProfile);
  const selfPronouns     = useOnyxStore(s => s.selfPronouns);
  const modeToPrefix     = useOnyxStore(s => s.isupportModeToPrefix);

  const userActivities   = useOnyxStore(s => s.userActivities);

  const isSelf = nick.toLowerCase() === ourNick.toLowerCase();

  // Compute placement to avoid going off-screen
  const computePlacement = useCallback((): PopoverPlacement => {
    if (!triggerRef.current) return 'above-left';
    const rect = triggerRef.current.getBoundingClientRect();
    const cardW = 284;
    const cardH = 380; // estimated max height
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const above = rect.top > cardH + 8;
    const below = vh - rect.bottom > cardH + 8;
    const right = vw - rect.left > cardW;
    const preferAbove = above || (!below && above);
    const side = right ? 'right' : 'left';
    const vert = preferAbove ? 'above' : 'below';
    return `${vert}-${side}` as PopoverPlacement;
  }, []);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [open]);

  // Request PROP on open (IRCX)
  useEffect(() => {
    if (!open || !isIRCX) return;
    requestUserProps(nick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nick, isIRCX]);

  // WHOIS on open
  useEffect(() => {
    if (!open || !client || loading || whois?.nick === nick) return;
    setLoading(true);

    // Subscribe to WHOIS responses
    const timeout = setTimeout(() => setLoading(false), 5000);
    const whoisData: Partial<WhoisInfo> = { nick };

    const handler = client.extraMessageHandlers;
    const fn = (msg: IRCMessage) => {
      const cmd = msg.command;
      const p   = msg.params;
      if (cmd === '311') { // RPL_WHOISUSER
        whoisData.realname = p[5];
        whoisData.host = `${p[2]}@${p[3]}`;
      } else if (cmd === '319') { // RPL_WHOISCHANNELS
        whoisData.channels = p[2]?.split(' ').filter(Boolean);
      } else if (cmd === '330') { // RPL_WHOISACCOUNT
        whoisData.account = p[2];
      } else if (cmd === '301') { // RPL_AWAY
        whoisData.away = p[2];
      } else if (cmd === '313') { // RPL_WHOISOPERATOR
        whoisData.oper = true;
      } else if (cmd === '318') { // RPL_ENDOFWHOIS
        clearTimeout(timeout);
        setWhois(whoisData as WhoisInfo);
        setLoading(false);
        handler.delete(fn);
      }
    };

    handler.add(fn);
    client.sendRaw('WHOIS', nick);

    return () => {
      clearTimeout(timeout);
      handler.delete(fn);
    };
  // loading and whois?.nick are intentionally excluded to prevent infinite re-runs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nick, client]);

  const nickProps = userProps.get(nick.toLowerCase()) ?? {};
  const userBio    = nickProps.BIO ?? nickProps.Bio ?? '';
  const userStatus = nickProps.STATUS ?? nickProps.Status ?? '';
  const userPicture = nickProps.PICTURE ?? nickProps.Picture ?? '';
  const richProfile = getUserProfile(nick);
  const profileAccent = nickProps.ACCENT ?? nickProps.Accent ?? nickProps.BANNERCOLOR ?? richProfile?.bannerColor ?? fallbackAccent(nick);
  const userPronouns = isSelf ? selfPronouns : (richProfile?.pronouns ?? '');

  const storedActivity = userActivities[nick.toLowerCase()];
  const activity = storedActivity ?? parseActivity(userStatus);

  // User's highest mode in current channel
  const channelUser = activeView.kind === 'channel'
    ? channels.get(activeView.channel.toLowerCase())?.users.get(nick.toLowerCase())
    : undefined;
  const roleMode = highestRoleMode(channelUser?.modes, modeToPrefix);

  const kick = () => {
    if (client && activeView.kind === 'channel') {
      client.sendRaw('KICK', activeView.channel, nick, 'Kicked by operator');
    }
    setOpen(false);
  };

  const ban = () => {
    if (client && activeView.kind === 'channel') {
      client.sendRaw('MODE', activeView.channel, '+b', `${nick}!*@*`);
    }
    setOpen(false);
  };

  const openDM = () => {
    navigate({ kind: 'dm', nick });
    setOpen(false);
  };

  const mention = () => {
    // OCEAN-INTEGRATION: composer listens for this UI event and inserts the mention text.
    window.dispatchEvent(new CustomEvent('ocean:insert-mention', { detail: { nick } }));
    setOpen(false);
  };

  const viewFullProfile = () => {
    setOpen(false);
    openUserProfile(nick);
  };

  const handleOpen = useCallback(() => {
    setPlacement(computePlacement());
    setOpen(v => !v);
  }, [computePlacement]);

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleOpen();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <span className="upop-wrap" ref={popoverRef}>
      <span
        ref={triggerRef}
        onClick={handleOpen}
        onKeyDown={handleTriggerKeyDown}
        className="upop-trigger"
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {children}
      </span>

      {open && (
        <div
          className={`upop-card upop-card--${placement} animate-scale-in elev-3`}
          style={{ '--upop-accent': profileAccent } as CSSProperties & Record<string, string>}
          data-testid="user-popover"
        >
          {/* Banner */}
          <div
            className="upop-banner"
            style={userPicture ? {
              backgroundImage: `url(${userPicture})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center top',
            } : undefined}
          />

          {/* Avatar */}
          <div className="upop-avatar-wrap">
            <Avatar nick={nick} size={56} />
            {isSelf && <span className="upop-self-badge">You</span>}
          </div>

          {/* Identity */}
          <div className="upop-identity">
            <div className="upop-nick">{nick}</div>
            {whois?.account && <div className="upop-account">@{whois.account}</div>}
            {userPronouns && <div className="upop-pronouns">{userPronouns}</div>}
            {roleMode && <div className="upop-role"><RoleBadge mode={roleMode} /></div>}
            {userStatus && <div className="upop-status">💬 {userStatus}</div>}
            {whois?.away && <div className="upop-away">Away: {whois.away}</div>}
          </div>

          {/* Rich presence / activity */}
          {activity && (
            <div className="upop-activity" aria-label={`Activity: ${activity.typeLabel}`}>
              <span className="upop-activity-emoji" aria-hidden>{activity.emoji}</span>
              <div className="upop-activity-body">
                <span className="upop-activity-type">{activity.typeLabel}</span>
                <span className="upop-activity-text">{activity.text}</span>
              </div>
            </div>
          )}

          {/* Details */}
          {loading && <div className="upop-loading">Loading…</div>}

          {whois && (
            <div className="upop-details">
              {whois.realname && (
                <div className="upop-detail-row">
                  <span className="upop-label">Real name</span>
                  <span>{whois.realname}</span>
                </div>
              )}
              {whois.host && (
                <div className="upop-detail-row">
                  <span className="upop-label">Host</span>
                  <code className="upop-host">{whois.host}</code>
                </div>
              )}
              {whois.oper && (
                <div className="upop-badge-row">
                  <span className="upop-oper-badge">⚡ IRC Operator</span>
                </div>
              )}
            </div>
          )}

          {/* IRCX bio */}
          {userBio && (
            <div className="upop-bio">
              <div className="upop-label">Bio</div>
              <p className="upop-bio-text">{userBio}</p>
            </div>
          )}

          {/* Actions */}
          <div className="upop-actions">
            {!isSelf && (
              <button className="upop-action-btn upop-action-btn--primary" onClick={openDM}>
                Message
              </button>
            )}
            {!isSelf && (
              <button className="upop-action-btn upop-action-btn--ghost" onClick={mention}>
                @ Mention
              </button>
            )}
            <button className="upop-action-btn upop-action-btn--ghost" onClick={viewFullProfile}>
              {isSelf ? 'Edit Profile' : 'View Full Profile'}
            </button>
            {!isSelf && channelUser && (
              <div className="upop-mod-actions">
                <button className="upop-action-btn upop-action-btn--ghost" onClick={kick}>Kick</button>
                <button className="upop-action-btn upop-action-btn--ghost" onClick={ban}>Ban</button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .upop-wrap { position: relative; display: inline; }
        .upop-trigger {
          cursor: pointer;
          border-radius: var(--r-xs, 4px);
          outline: none;
        }
        .upop-trigger:focus-visible {
          box-shadow: 0 0 0 2px var(--accent-border);
        }

        /* ── Card ── */
        .upop-card {
          position: absolute;
          z-index: var(--z-popover, 100);
          width: 284px;
          background: var(--elev-tint-3, var(--bg-float, #1a2c40));
          backdrop-filter: blur(16px) saturate(1.3);
          -webkit-backdrop-filter: blur(16px) saturate(1.3);
          border: 0;
          border-radius: var(--r-xl, 16px) var(--r-sm, 6px) var(--r-lg, 14px) var(--r-md, 10px);
          overflow: hidden;
        }

        /* ── Placement variants ── */
        .upop-card--above-left  { bottom: calc(100% + 8px); left: 0; transform-origin: bottom left; }
        .upop-card--above-right { bottom: calc(100% + 8px); right: 0; transform-origin: bottom right; }
        .upop-card--below-left  { top: calc(100% + 8px); left: 0; transform-origin: top left; }
        .upop-card--below-right { top: calc(100% + 8px); right: 0; transform-origin: top right; }

        /* ── Scale-from-origin animation ── */
        @keyframes upop-scale-in {
          from { opacity: 0; transform: translateY(4px) scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        .animate-scale-in {
          animation: upop-scale-in var(--t-overlay-in, 320ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
        }

        /* ── Banner ── */
        .upop-banner {
          height: 64px;
          background: color-mix(in srgb, var(--upop-accent) 42%, var(--bg-deep) 58%);
          flex-shrink: 0;
          position: relative;
        }
        .upop-banner::after {
          content: '';
          position: absolute;
          inset: 0;
          background: color-mix(in srgb, var(--bg-void) 16%, transparent);
        }

        /* ── Avatar ── */
        .upop-avatar-wrap {
          position: relative;
          margin: -28px 0 0 14px;
          display: inline-flex;
          align-items: flex-end;
          gap: 8px;
        }

        /* Override Avatar for popover — 56px with ring */
        .upop-avatar-wrap > span {
          width: 56px !important;
          height: 56px !important;
        }
        .upop-avatar-wrap > span > span:first-child {
          width: 56px !important;
          height: 56px !important;
          font-size: 24px !important;
          outline: 3px solid var(--bg-float, #1a2c40);
          outline-offset: 1px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.6);
        }

        .upop-self-badge {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0;
          background: var(--elev-tint-1, rgba(14,165,233,0.12));
          color: var(--text-secondary);
          border: 0;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
          padding: 2px 8px;
          border-radius: var(--r-full, 9999px);
          margin-bottom: 6px;
        }

        /* ── Identity ── */
        .upop-identity { padding: 8px 14px 2px; }
        .upop-nick {
          font-size: var(--text-lg, 16px);
          font-family: var(--font-display), Georgia, serif;
          font-weight: 700;
          color: var(--text-primary, #dff0ff);
          line-height: 1.2;
          letter-spacing: 0;
        }
        .upop-account {
          font-size: 12px;
          color: var(--text-muted, #3d6480);
          margin-top: 2px;
          font-weight: 500;
        }
        .upop-away {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: var(--status-idle, #f0b232);
          margin-top: 4px;
          padding: 2px 8px;
          background: rgba(240,178,50,0.08);
          border: 0;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
          border-radius: var(--r-full, 9999px);
        }
        .upop-away::before { content: '◉'; font-size: 8px; }
        .upop-role {
          display: flex;
          margin-top: 6px;
        }

        /* ── Loading ── */
        .upop-loading {
          padding: 8px 14px;
          font-size: 12px;
          color: var(--text-muted, #3d6480);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .upop-loading::before {
          content: '';
          width: 10px; height: 10px;
          border-radius: 50%;
          border: 1.5px solid var(--accent-border);
          border-top-color: var(--accent);
          animation: upop-spin 600ms linear infinite;
        }
        @keyframes upop-spin {
          to { transform: rotate(360deg); }
        }

        /* ── Details ── */
        .upop-details {
          padding: 6px 14px 8px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .upop-detail-row {
          display: flex;
          flex-direction: column;
          gap: 1px;
          font-size: 12px;
          color: var(--text-secondary, #7aa8c4);
        }
        .upop-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0;
          color: var(--text-muted, #3d6480);
        }
        .upop-host {
          font-size: 10.5px;
          word-break: break-all;
          font-family: var(--font-mono, monospace);
          color: var(--text-secondary, #7aa8c4);
        }
        .upop-badge-row { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
        .upop-oper-badge {
          font-size: 11px;
          font-weight: 700;
          color: var(--lux, #d8b96a);
          background: color-mix(in srgb, var(--elev-tint-1, var(--bg-elevated)) 86%, var(--lux, #d8b96a) 14%);
          border: 0;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
          padding: 2px 8px;
          border-radius: var(--r-full, 9999px);
        }

        .upop-pronouns {
          font-size: 11px;
          color: var(--text-muted, #3d6480);
          font-style: italic;
          margin-top: 1px;
        }
        .upop-status {
          font-size: 12px;
          color: var(--text-secondary, #7aa8c4);
          margin-top: 3px;
          font-style: italic;
          line-height: 1.45;
        }

        /* ── Activity ── */
        .upop-activity {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 6px 12px 0;
          padding: 7px 10px;
          background: var(--elev-tint-1, rgba(14,165,233,0.06));
          border: 0;
          border-radius: var(--r-md, 10px) var(--r-sm, 6px) var(--r-lg, 14px) var(--r-sm, 6px);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
        }
        .upop-activity-emoji { font-size: 16px; flex-shrink: 0; line-height: 1; }
        .upop-activity-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .upop-activity-type {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0;
          text-transform: uppercase;
          color: var(--accent, #0ea5e9);
        }
        .upop-activity-text {
          font-size: 11px;
          color: var(--text-secondary, #7aa8c4);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* ── Bio ── */
        .upop-bio {
          padding: 0 14px 6px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .upop-bio-text {
          font-size: 12.5px;
          color: var(--text-secondary, #7aa8c4);
          line-height: 1.55;
          margin: 0;
          font-style: italic;
        }

        /* ── Actions ── */
        .upop-actions {
          padding: 10px 12px 12px;
          display: flex;
          flex-direction: column;
          gap: 5px;
          margin-top: 6px;
          background: color-mix(in srgb, var(--bg-deep) 62%, transparent);
        }

        .upop-action-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          width: 100%;
          padding: 8px 12px;
          border-radius: var(--r-sm, 6px) var(--r-md, 10px) var(--r-sm, 6px) var(--r-lg, 14px);
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: background var(--t-control, 150ms) var(--ease-out, ease), color var(--t-control, 150ms) var(--ease-out, ease), transform var(--t-micro, 90ms) var(--ease-out, ease);
          border: 0;
        }
        .upop-action-btn:active { transform: scale(0.97); }

        .upop-action-btn--primary {
          background: color-mix(in srgb, var(--accent, #0ea5e9) 82%, #05070a);
          color: #fff;
          border-color: transparent;
        }
        .upop-action-btn--primary:hover {
          background: color-mix(in oklch, var(--accent) 85%, white);
        }

        .upop-action-btn--ghost {
          background: var(--elev-tint-1, transparent);
          color: var(--text-secondary, #7aa8c4);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
        }
        .upop-action-btn--ghost:hover {
          background: var(--elev-tint-2, #213550);
          color: var(--text-primary, #dff0ff);
        }

        .upop-mod-actions {
          display: flex;
          gap: 5px;
          margin-top: 2px;
          padding-top: 6px;
          box-shadow: inset 0 1px 0 var(--border-subtle, rgba(14,165,233,0.06));
        }
        .upop-mod-actions .upop-action-btn--ghost {
          font-size: 12px;
          padding: 6px 10px;
          color: var(--text-muted, #3d6480);
        }
        .upop-mod-actions .upop-action-btn--ghost:hover {
          color: #f87171;
          border-color: rgba(248,113,113,0.3);
          background: rgba(248,113,113,0.06);
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-scale-in,
          .upop-loading::before {
            animation: none;
          }
          .upop-action-btn {
            transition: none;
          }
          .upop-action-btn:active {
            transform: none;
          }
        }
      `}</style>
    </span>
  );
}
