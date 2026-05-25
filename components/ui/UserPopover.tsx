'use client';

import { useState, useRef, useEffect } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { IRCMessage } from '@/lib/irc/types';
import { parseActivity } from '@/lib/activity';
import Avatar from './Avatar';
import Button from './Button';

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

export default function UserPopover({ nick, children }: Props) {
  const [open,   setOpen]   = useState(false);
  const [whois,  setWhois]  = useState<WhoisInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

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

  const userActivities   = useOnyxStore(s => s.userActivities);

  const isSelf = nick.toLowerCase() === ourNick.toLowerCase();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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
  const userPronouns = isSelf ? selfPronouns : (richProfile?.pronouns ?? '');

  const storedActivity = userActivities[nick.toLowerCase()];
  const activity = storedActivity ?? parseActivity(userStatus);

  // User's highest mode in current channel
  const channelUser = activeView.kind === 'channel'
    ? channels.get(activeView.channel.toLowerCase())?.users.get(nick.toLowerCase())
    : undefined;

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
    window.dispatchEvent(new CustomEvent('ocean:insert-mention', { detail: { nick } }));
    setOpen(false);
  };

  const viewFullProfile = () => {
    setOpen(false);
    openUserProfile(nick);
  };

  return (
    <span className="upop-wrap" ref={popoverRef}>
      <span onClick={() => setOpen(v => !v)} style={{ cursor: 'pointer' }}>
        {children}
      </span>

      {open && (
        <div className="upop-card animate-scale-in">
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
              <Button size="sm" variant="primary" fullWidth onClick={openDM}>
                Message
              </Button>
            )}
            {!isSelf && (
              <Button size="sm" variant="ghost" fullWidth onClick={mention}>
                @ Mention
              </Button>
            )}
            <Button size="sm" variant="ghost" fullWidth onClick={viewFullProfile}>
              {isSelf ? 'Edit Profile' : 'View Full Profile'}
            </Button>
            {!isSelf && channelUser && (
              <div className="upop-mod-actions">
                <Button size="sm" variant="ghost" onClick={kick}>Kick</Button>
                <Button size="sm" variant="ghost" onClick={ban}>Ban</Button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .upop-wrap { position: relative; display: inline; }

        .upop-card {
          position: absolute;
          z-index: 800;
          bottom: calc(100% + 8px);
          left: 0;
          width: 260px;
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-xl);
          overflow: hidden;
          box-shadow: var(--shadow-xl), 0 0 0 1px var(--accent-border);
        }

        .upop-banner {
          height: 60px;
          background: linear-gradient(135deg, var(--accent-active) 0%, var(--accent) 100%);
        }

        .upop-avatar-wrap {
          position: relative;
          margin: -28px 0 0 16px;
          display: inline-flex;
          align-items: flex-end;
          gap: 8px;
        }

        .upop-self-badge {
          font-size: 11px; font-weight: 600;
          background: var(--accent-subtle);
          color: var(--accent);
          padding: 2px 7px; border-radius: var(--r-full);
          margin-bottom: 4px;
        }

        .upop-identity { padding: 8px 16px 0; }
        .upop-nick { font-size: 17px; font-weight: 700; color: var(--text-primary); }
        .upop-account { font-size: 13px; color: var(--accent); }
        .upop-away { font-size: 12px; color: var(--status-idle); margin-top: 2px; }

        .upop-loading { padding: 8px 16px; font-size: 12px; color: var(--text-muted); }

        .upop-details { padding: 8px 16px; display: flex; flex-direction: column; gap: 6px; }
        .upop-detail-row { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--text-secondary); }
        .upop-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-muted); }
        .upop-host { font-size: 11px; word-break: break-all; }
        .upop-badge-row { display: flex; }
        .upop-oper-badge { font-size: 12px; font-weight: 600; color: var(--gold); background: var(--gold-subtle); padding: 3px 8px; border-radius: var(--r-full); }

        .upop-pronouns { font-size: 11px; color: var(--text-muted); font-style: italic; margin-top: 1px; }
        .upop-status { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }

        .upop-activity {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 6px 16px 0;
          padding: 7px 10px;
          background: rgba(124, 90, 245, 0.06);
          border: 1px solid rgba(124, 90, 245, 0.12);
          border-radius: var(--r-md);
        }
        .upop-activity-emoji { font-size: 16px; flex-shrink: 0; line-height: 1; }
        .upop-activity-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .upop-activity-type {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--accent, #7c5af5);
        }
        .upop-activity-text {
          font-size: 11px;
          color: var(--text-secondary, #8899bb);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .upop-bio { padding: 0 16px 4px; display: flex; flex-direction: column; gap: 4px; }
        .upop-bio-text { font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin: 0; }

        .upop-actions { padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border-subtle); }
        .upop-mod-actions { display: flex; gap: 6px; }
      `}</style>
    </span>
  );
}
