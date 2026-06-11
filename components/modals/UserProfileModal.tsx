'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useOnyxStore } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';
import { useDialogFocus } from './useDialogFocus';
import ProfileMetadataEditor, { type ProfileMetadataDraft } from '@/components/ui/ProfileMetadataEditor';
import RoleBadge, { highestRoleMode } from '@/components/ui/RoleBadge';

// ── Nick color helpers ────────────────────────────────────────────────────────

function nickHue(nick: string): number {
  let hash = 0;
  for (const c of nick) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return Math.abs(hash) % 360;
}

function bannerTint(nick: string, bannerColor?: string): string {
  if (bannerColor) {
    return bannerColor;
  }
  const hue = nickHue(nick);
  return `hsl(${hue}, 44%, 34%)`;
}

// ── Linkify helper ────────────────────────────────────────────────────────────

function linkifyText(text: string): React.ReactNode[] {
  const URL_RE = /https?:\/\/[^\s<>"]+/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    parts.push(
      <a
        key={match.index}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer"
        className="upm-link"
      >
        {match[0]}
      </a>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function BioText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {linkifyText(line)}
        </span>
      ))}
    </>
  );
}

// ── Time formatters ────────────────────────────────────────────────────────────

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatIdle(secs: number | undefined): string {
  if (secs === undefined || secs === 0) return '';
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d`;
}

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_DOT_COLORS: Record<string, string> = {
  online: 'var(--status-online)',
  idle: 'var(--status-idle)',
  dnd: 'var(--status-dnd)',
  offline: 'var(--status-offline)',
};

// ── Mode badge ────────────────────────────────────────────────────────────────

interface ModeBadgeProps {
  modes: Set<string>;
}

function ModeBadge({ modes }: ModeBadgeProps) {
  const modeToPrefix = useOnyxStore(s => s.isupportModeToPrefix);
  const mode = highestRoleMode(modes, modeToPrefix);
  return mode ? <RoleBadge mode={mode} /> : null;
}

// ── Local note textarea ───────────────────────────────────────────────────────

function NoteEditor({ nick }: { nick: string }) {
  const storageKey = `ocean-note-${nick.toLowerCase()}`;
  const [note, setNote] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(storageKey) ?? '';
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [note, autoResize]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNote(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      localStorage.setItem(storageKey, val);
    }, 500);
  };

  return (
    <textarea
      ref={textareaRef}
      className="upm-note-textarea"
      value={note}
      onChange={handleChange}
      placeholder="Click to add a note about this user"
      rows={3}
      aria-label="Private note about this user"
    />
  );
}

// ── Block confirmation ────────────────────────────────────────────────────────

function useBlockedNicks() {
  const STORAGE_KEY = 'ocean-blocked';

  const isBlocked = (nick: string): boolean => {
    if (typeof window === 'undefined') return false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const list: string[] = JSON.parse(raw);
      return list.includes(nick.toLowerCase());
    } catch {
      return false;
    }
  };

  const block = (nick: string): void => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list: string[] = raw ? JSON.parse(raw) : [];
      const key = nick.toLowerCase();
      if (!list.includes(key)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...list, key]));
      }
    } catch {
      // ignore
    }
  };

  const unblock = (nick: string): void => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list: string[] = raw ? JSON.parse(raw) : [];
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(list.filter(n => n !== nick.toLowerCase()))
      );
    } catch {
      // ignore
    }
  };

  return { isBlocked, block, unblock };
}

// ── Tab types ─────────────────────────────────────────────────────────────────

type ProfileTab = 'about' | 'mutual' | 'notes';

// ── Edit panel ────────────────────────────────────────────────────────────────

interface EditPanelProps {
  nick: string;
  onClose: () => void;
}

function EditPanel({ nick, onClose }: EditPanelProps) {
  const selfBio         = useOnyxStore(s => s.selfBio);
  const selfPronouns    = useOnyxStore(s => s.selfPronouns);
  const selfDisplayName = useOnyxStore(s => s.selfDisplayName);
  const invisibleMode   = useOnyxStore(s => s.invisibleMode);
  const setSelfBio         = useOnyxStore(s => s.setSelfBio);
  const setSelfPronouns    = useOnyxStore(s => s.setSelfPronouns);
  const setSelfDisplayName = useOnyxStore(s => s.setSelfDisplayName);
  const setInvisibleMode   = useOnyxStore(s => s.setInvisibleMode);
  const setUserProfile     = useOnyxStore(s => s.setUserProfile);
  const getUserProfile     = useOnyxStore(s => s.getUserProfile);

  const existing = getUserProfile(nick);
  const accentColor = existing?.bannerColor ?? bannerTint(nick);

  const handleSave = (draft: ProfileMetadataDraft) => {
    setSelfBio(draft.bio);
    setSelfPronouns(draft.pronouns);
    setSelfDisplayName(draft.displayName);
    // Sync into userProfiles so view mode shows fresh data immediately
    setUserProfile(nick, {
      ...(existing ?? { nick }),
      bio: draft.bio,
      pronouns: draft.pronouns,
      bannerColor: draft.accentColor,
    });
    onClose();
  };

  return (
    <div className="upm-layout">
      {/* Left column — live preview */}
      <div className="upm-left">
        <div className="upm-banner" style={{ '--upm-accent': accentColor } as CSSProperties & Record<string, string>} aria-hidden />

        <div className="upm-avatar-wrap">
          <div className="upm-avatar-border">
            <Avatar nick={nick} size={64} />
          </div>
        </div>

        <div className="upm-identity">
          <h2 className="upm-nick">
            {selfDisplayName || nick}
            <span className="upm-mode-badge upm-mode-self">You</span>
          </h2>
          {selfPronouns && (
            <p className="upm-pronouns">{selfPronouns}</p>
          )}
          {selfBio && (
            <p className="upm-preview-bio">{selfBio}</p>
          )}
        </div>
      </div>

      {/* Right column — edit fields */}
      <div className="upm-right">
        <div className="upm-edit-scroll">
          <ProfileMetadataEditor
            nick={nick}
            initialDisplayName={selfDisplayName}
            initialPronouns={selfPronouns}
            initialBio={selfBio}
            initialAccentColor={accentColor}
            onSave={handleSave}
            onCancel={onClose}
          />

          <div className="upm-edit-field">
            <div className="upm-invisible-row">
              <div>
                <div className="upm-edit-label">Invisible Mode</div>
                <div className="upm-invisible-desc">Hide your presence from other users (IRC mode +i)</div>
              </div>
              <button
                className={`upm-toggle${invisibleMode ? ' upm-toggle-on' : ''}`}
                role="switch"
                aria-checked={invisibleMode}
                onClick={() => setInvisibleMode(!invisibleMode)}
                aria-label="Toggle invisible mode"
              >
                <span className="upm-toggle-thumb" />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function UserProfileModal() {
  const nick             = useOnyxStore(s => s.userProfileNick) ?? '';
  const ourNick          = useOnyxStore(s => s.ourNick);
  const channels         = useOnyxStore(s => s.channels);
  const client           = useOnyxStore(s => s.client);
  const userProps        = useOnyxStore(s => s.userProps);
  const requestUserProps = useOnyxStore(s => s.requestUserProps);
  const isIRCX           = useOnyxStore(s => s.isIRCX);
  const activeView       = useOnyxStore(s => s.activeView);
  const navigate         = useOnyxStore(s => s.navigate);
  const closeUserProfile = useOnyxStore(s => s.closeUserProfile);
  const ignoredUsers     = useOnyxStore(s => s.ignoredUsers);
  const ignoreUser       = useOnyxStore(s => s.ignoreUser);
  const unignoreUser     = useOnyxStore(s => s.unignoreUser);
  const getUserProfile   = useOnyxStore(s => s.getUserProfile);
  const setUserProfile   = useOnyxStore(s => s.setUserProfile);
  const selfDisplayName  = useOnyxStore(s => s.selfDisplayName);
  const selfBio          = useOnyxStore(s => s.selfBio);
  const selfPronouns     = useOnyxStore(s => s.selfPronouns);
  const selfBannerUrl    = useOnyxStore(s => s.selfBannerUrl);
  const watchList        = useOnyxStore(s => s.watchList);
  const addToWatchList   = useOnyxStore(s => s.addToWatchList);

  const [tab, setTab] = useState<ProfileTab>('about');
  const [blockConfirm, setBlockConfirm] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cardRef    = useRef<HTMLDivElement>(null);
  const { isBlocked, block, unblock } = useBlockedNicks();
  useDialogFocus(cardRef);

  const isSelf = nick.toLowerCase() === ourNick.toLowerCase();
  const isIgnored = ignoredUsers.has(nick.toLowerCase());
  const richProfile = getUserProfile(nick);

  // When modal opens for self, default to edit mode
  useEffect(() => {
    if (isSelf) {
      setEditMode(true);
    } else {
      setEditMode(false);
    }
  }, [nick, isSelf]);

  // Check initial block state
  useEffect(() => {
    setBlocked(isBlocked(nick));
  }, [nick]);

  // Request IRCX props
  useEffect(() => {
    if (isIRCX && nick) requestUserProps(nick);
  }, [nick, isIRCX]);

  // WHOIS — populate richProfile via store setUserProfile
  useEffect(() => {
    if (!client || !nick) return;
    const handler = client.extraMessageHandlers;

    const fn = (msg: { command: string; params: string[] }) => {
      const { command, params } = msg;
      if (command === '301') {
        setUserProfile(nick, { away: true, awayMessage: params[2] });
      } else if (command === '318') {
        handler.delete(fn);
      }
    };

    handler.add(fn);
    client.sendRaw('WHOIS', nick, nick);

    return () => {
      handler.delete(fn);
    };
  }, [nick, client]);

  // Close on overlay click
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) closeUserProfile();
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeUserProfile();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closeUserProfile]);

  // IRCX props
  const nickProps    = userProps.get(nick.toLowerCase()) ?? {};
  const userBio      = isSelf ? selfBio : (richProfile?.bio ?? nickProps.BIO ?? nickProps.Bio ?? '');
  const userStatus   = nickProps.STATUS ?? nickProps.Status ?? '';
  const userPicture  = nickProps.PICTURE ?? nickProps.Picture ?? '';
  const userActivity = nickProps.ACTIVITY ?? nickProps.Activity ?? '';
  const userPronouns = isSelf ? selfPronouns : (richProfile?.pronouns ?? '');
  const userBannerUrl = isSelf ? selfBannerUrl : (richProfile?.bannerUrl ?? '');

  // Current channel membership for mode badge
  const channelUser = activeView.kind === 'channel'
    ? channels.get(activeView.channel.toLowerCase())?.users.get(nick.toLowerCase())
    : undefined;

  // Mutual channels: channels where both this nick and we appear
  const mutualChannels = Array.from(channels.values())
    .filter(ch => ch.users.has(nick.toLowerCase()) && ch.users.has(ourNick.toLowerCase()));

  // Presence status derived from WHOIS away
  const isAway = richProfile?.away ?? false;
  const presenceStatus = isAway ? 'idle' : 'online';

  // Watch list
  const isOnWatchList = watchList.some(w => w.nick.toLowerCase() === nick.toLowerCase());

  const handleMessage = () => {
    navigate({ kind: 'dm', nick });
    closeUserProfile();
  };

  const handleAddFriend = () => {
    if (!isOnWatchList) addToWatchList(nick);
    closeUserProfile();
  };

  const handleNavigateChannel = (channelName: string) => {
    navigate({ kind: 'channel', channel: channelName });
    closeUserProfile();
  };

  const handleBlock = () => {
    if (!blockConfirm) {
      setBlockConfirm(true);
      return;
    }
    if (blocked) {
      unblock(nick);
      setBlocked(false);
    } else {
      block(nick);
      setBlocked(true);
    }
    setBlockConfirm(false);
    closeUserProfile();
  };

  const bannerStyle = userBannerUrl
    ? { backgroundImage: `url(${userBannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center top' }
  : userPicture
    ? { backgroundImage: `url(${userPicture})`, backgroundSize: 'cover', backgroundPosition: 'center top' }
    : { '--upm-accent': bannerTint(nick, richProfile?.bannerColor) } as CSSProperties & Record<string, string>;

  const displayName = isSelf && selfDisplayName ? selfDisplayName : nick;
  const isSelfEdited = isSelf && selfDisplayName && selfDisplayName !== nick;

  return (
    <div
      className="upm-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
    >
      <div
        className="upm-card animate-scale-in"
        ref={cardRef}
        role="dialog"
        aria-modal
        aria-label={`${nick}'s profile`}
      >

        {/* Close button */}
        <button className="upm-close" onClick={closeUserProfile} aria-label="Close profile">
          <CloseIcon />
        </button>

        {/* ── Edit mode (own profile) ── */}
        {isSelf && editMode ? (
          <EditPanel nick={nick} onClose={() => {
            setEditMode(false);
            closeUserProfile();
          }} />
        ) : (
          /* ── View mode ── */
          <div className="upm-layout">

            {/* Left column */}
            <div className="upm-left">

              {/* Banner */}
              <div className="upm-banner" style={bannerStyle} aria-hidden />

              {/* Avatar overlapping banner */}
              <div className="upm-avatar-wrap">
                <div className="upm-avatar-border">
                  <Avatar nick={nick} size={64} status={presenceStatus} />
                </div>
              </div>

              {/* Identity */}
              <div className="upm-identity">
                <h2 className="upm-nick">
                  {displayName}
                  {isSelfEdited && <span className="upm-edited-tag">edited</span>}
                </h2>
                {richProfile?.account && (
                  <p className="upm-account">@{richProfile.account}</p>
                )}

                {/* Pronouns chip */}
                {userPronouns && (
                  <p className="upm-pronouns">{userPronouns}</p>
                )}

                {/* Badges row */}
                <div className="upm-badges">
                  <span
                    className="upm-presence-dot"
                    style={{ background: STATUS_DOT_COLORS[presenceStatus] }}
                    title={isAway ? `Away${richProfile?.awayMessage ? `: ${richProfile.awayMessage}` : ''}` : 'Online'}
                    aria-label={isAway ? 'Away' : 'Online'}
                  />
                  {richProfile?.ircOperator && <span title="IRC Operator">⭐</span>}
                  {richProfile?.bot && <span title="Bot">🤖</span>}
                  {channelUser && <ModeBadge modes={channelUser.modes} />}
                  {isSelf && <span className="upm-mode-badge upm-mode-self">You</span>}
                </div>

                {/* Custom status */}
                {userStatus && (
                  <p className="upm-custom-status">
                    <span className="upm-status-bullet" aria-hidden>●</span>
                    {userStatus}
                  </p>
                )}

                {/* Activity */}
                {userActivity && (
                  <div className="upm-activity-card">
                    <div className="upm-activity-label">ACTIVITY</div>
                    <div className="upm-activity-text">{userActivity}</div>
                  </div>
                )}

                {/* Edit profile button for own profile */}
                {isSelf && (
                  <button
                    className="upm-btn upm-btn-secondary upm-edit-profile-btn"
                    onClick={() => setEditMode(true)}
                  >
                    <EditIcon />
                    Edit Profile
                  </button>
                )}
              </div>

            </div>

            {/* Right column */}
            <div className="upm-right">

              {/* Tab bar */}
              <div className="upm-tabs" role="tablist">
                <button
                  className={`upm-tab${tab === 'about' ? ' active' : ''}`}
                  role="tab"
                  aria-selected={tab === 'about'}
                  onClick={() => setTab('about')}
                >
                  About Me
                </button>
                <button
                  className={`upm-tab${tab === 'mutual' ? ' active' : ''}`}
                  role="tab"
                  aria-selected={tab === 'mutual'}
                  onClick={() => setTab('mutual')}
                >
                  Mutual Channels
                  {mutualChannels.length > 0 && (
                    <span className="upm-tab-count">{mutualChannels.length}</span>
                  )}
                </button>
                <button
                  className={`upm-tab${tab === 'notes' ? ' active' : ''}`}
                  role="tab"
                  aria-selected={tab === 'notes'}
                  onClick={() => setTab('notes')}
                >
                  Notes
                </button>
              </div>

              {/* Tab content */}
              <div className="upm-tab-content" role="tabpanel">

                {/* About Me */}
                {tab === 'about' && (
                  <>
                    {(userBio || richProfile?.realname) && (
                      <div className="upm-section">
                        <h3 className="upm-section-label">Bio</h3>
                        <p className="upm-bio-text">
                          <BioText text={userBio || richProfile?.realname || ''} />
                        </p>
                      </div>
                    )}

                    {richProfile?.signonTime ? (
                      <div className="upm-section">
                        <h3 className="upm-section-label">Member Since</h3>
                        <p className="upm-info-value">{formatTimestamp(richProfile.signonTime)}</p>
                      </div>
                    ) : null}

                    {richProfile?.server && (
                      <div className="upm-section">
                        <h3 className="upm-section-label">IRC Server</h3>
                        <p className="upm-info-value">{richProfile.server}</p>
                        {richProfile.serverInfo && (
                          <p className="upm-info-sub">{richProfile.serverInfo}</p>
                        )}
                      </div>
                    )}

                    {richProfile?.idleSeconds !== undefined && richProfile.idleSeconds > 0 && (
                      <div className="upm-section">
                        <h3 className="upm-section-label">Idle</h3>
                        <p className="upm-info-value">{formatIdle(richProfile.idleSeconds)}</p>
                      </div>
                    )}

                    {isAway && richProfile?.awayMessage && (
                      <div className="upm-section">
                        <h3 className="upm-section-label">Away Message</h3>
                        <p className="upm-bio-text">{richProfile.awayMessage}</p>
                      </div>
                    )}

                    {!userBio && !richProfile?.realname && !richProfile?.signonTime && !richProfile?.server && (
                      <p className="upm-empty-state">No profile info available.</p>
                    )}
                  </>
                )}

                {/* Mutual Channels */}
                {tab === 'mutual' && (
                  <>
                    {mutualChannels.length === 0 ? (
                      <p className="upm-empty-state">No mutual channels.</p>
                    ) : (
                      mutualChannels.map(ch => (
                        <button
                          key={ch.name}
                          className="upm-mutual-channel"
                          onClick={() => handleNavigateChannel(ch.name)}
                        >
                          <span className="upm-mutual-hash"><HashIcon /></span>
                          <span className="upm-mutual-name">{ch.name.replace(/^[#&]/, '')}</span>
                          <span className="upm-mutual-count">{ch.users.size} members</span>
                        </button>
                      ))
                    )}
                  </>
                )}

                {/* Notes */}
                {tab === 'notes' && (
                  <div className="upm-section">
                    <h3 className="upm-section-label">Note — only you can see this</h3>
                    <NoteEditor nick={nick} />
                  </div>
                )}

              </div>

              {/* Action bar */}
              {!isSelf && (
                <div className="upm-actions">
                  <button className="upm-btn upm-btn-primary" onClick={handleMessage}>
                    <MessageIcon />
                    Send Message
                  </button>
                  {!isOnWatchList && (
                    <button className="upm-btn upm-btn-secondary" onClick={handleAddFriend}>
                      Add Friend
                    </button>
                  )}
                  <button
                    className={`upm-btn ${isIgnored ? 'upm-btn-danger' : 'upm-btn-ghost'}`}
                    onClick={() => {
                      if (isIgnored) {
                        unignoreUser(nick);
                      } else {
                        ignoreUser(nick);
                      }
                      closeUserProfile();
                    }}
                  >
                    {isIgnored ? '🔔 Unignore' : '🔇 Ignore'}
                  </button>
                  {blockConfirm ? (
                    <button className="upm-btn upm-btn-danger" onClick={handleBlock}>
                      Confirm {blocked ? 'Unblock' : 'Block'}
                    </button>
                  ) : (
                    <button className="upm-btn upm-btn-ghost" onClick={handleBlock}>
                      {blocked ? 'Unblock' : 'Block'}
                    </button>
                  )}
                </div>
              )}

            </div>
          </div>
        )}
      </div>

      <style>{`
        /* ── Overlay ── */
        .upm-overlay {
          position: fixed;
          inset: 0;
          z-index: 900;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--scrim, color-mix(in srgb, var(--bg-void) 86%, transparent));
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          padding: 20px;
        }

        /* ── Card ── */
        .upm-card {
          position: relative;
          width: 100%;
          max-width: 720px;
          background: var(--elev-tint-3, var(--bg-elevated));
          border: 0;
          border-radius: var(--r-xl, 16px) var(--r-sm, 6px) var(--r-lg, 14px) var(--r-md, 10px);
          overflow: hidden;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-3, 0 28px 80px rgba(0,0,0,.48));
          max-height: 90dvh;
          isolation: isolate;
        }

        .upm-card::before {
          content: '';
          position: absolute;
          inset: 0 0 auto;
          height: 1px;
          background: color-mix(in srgb, var(--upm-accent, var(--accent)) 34%, transparent);
          pointer-events: none;
          z-index: 1;
        }

        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        .animate-scale-in { animation: scale-in var(--t-overlay-in, 320ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both; }

        /* ── Close button ── */
        .upm-close {
          position: absolute;
          top: 14px;
          right: 14px;
          z-index: 10;
          width: 30px;
          height: 30px;
          border-radius: var(--r-full);
          border: 0;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
          background: color-mix(in srgb, var(--bg-void) 62%, transparent);
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .upm-close:hover {
          background: var(--bg-float);
          color: var(--text-primary);
          transform: scale(1.04);
        }

        /* ── Two-column layout ── */
        .upm-layout {
          display: flex;
          min-height: 480px;
        }

        /* ── Left column ── */
        .upm-left {
          width: 280px;
          flex-shrink: 0;
          box-shadow: inset -1px 0 0 var(--border-subtle);
          display: flex;
          flex-direction: column;
          position: relative;
          background: var(--elev-tint-1, var(--bg-deep));
        }

        .upm-banner {
          height: 132px;
          position: relative;
          flex-shrink: 0;
          background: color-mix(in srgb, var(--upm-accent, var(--accent)) 42%, var(--bg-deep) 58%);
        }

        .upm-banner::after {
          content: '';
          position: absolute;
          inset: 0;
          background: color-mix(in srgb, var(--bg-void) 18%, transparent);
          pointer-events: none;
        }

        .upm-banner-edit-btn {
          position: absolute;
          top: 52px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 11px;
          font-weight: 600;
          padding: 3px 10px;
          border-radius: var(--r-full);
          border: 1px solid var(--border-normal);
          background: color-mix(in srgb, var(--bg-void) 62%, transparent);
          color: var(--text-secondary);
          cursor: pointer;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          z-index: 2;
          white-space: nowrap;
        }
        .upm-banner-edit-btn:hover {
          background: var(--bg-float);
          color: var(--text-primary);
          border-color: var(--accent-border);
          transform: translateX(-50%) translateY(-1px);
        }

        .upm-banner-field {
          padding: 0 16px 8px;
          margin-top: 4px;
        }

        .upm-avatar-wrap {
          position: relative;
          padding: 0 20px;
          margin-top: -40px;
          flex-shrink: 0;
          z-index: 2;
        }

        .upm-avatar-border {
          display: inline-flex;
          border-radius: var(--r-full);
          padding: 3px;
          background: color-mix(in srgb, var(--upm-accent, var(--accent)) 36%, var(--elev-tint-2, var(--bg-float)) 64%);
          border: 0;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 8px 18px rgba(0,0,0,.24));
          line-height: 0;
        }

        .upm-identity {
          padding: 12px 20px 20px;
          flex: 1;
        }

        .upm-nick {
          font-size: 24px;
          font-weight: 800;
          color: var(--text-normal, var(--text-primary));
          margin: 0 0 4px;
          letter-spacing: 0;
          line-height: 1.08;
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .upm-edited-tag {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-muted);
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-full);
          padding: 2px 7px;
          text-transform: uppercase;
          letter-spacing: 0;
        }

        .upm-account {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0 0 8px;
          font-weight: 500;
        }

        .upm-pronouns {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          font-size: 12px;
          color: var(--gold);
          margin: 0 0 8px;
          font-weight: 700;
          border: 0;
          background: color-mix(in srgb, var(--elev-tint-1, var(--bg-elevated)) 86%, var(--lux, #d8b96a) 14%);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
          border-radius: var(--r-full);
          padding: 3px 8px;
        }

        .upm-preview-bio {
          font-size: 12px;
          color: var(--text-muted);
          margin: 4px 0 0;
          line-height: 1.5;
          word-break: break-word;
          white-space: pre-wrap;
          max-height: 80px;
          overflow: hidden;
        }

        .upm-badges {
          display: flex;
          gap: 7px;
          margin-top: 12px;
          align-items: center;
          flex-wrap: wrap;
        }

        .upm-presence-dot {
          width: 10px;
          height: 10px;
          border-radius: var(--r-full);
          flex-shrink: 0;
          display: inline-block;
          box-shadow: 0 0 0 3px var(--bg-deep), 0 0 0 5px color-mix(in srgb, currentColor 28%, transparent);
        }

        /* ── Mode badges ── */
        .upm-mode-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 4px 9px;
          border-radius: var(--r-full);
          letter-spacing: 0;
          text-transform: uppercase;
          line-height: 1;
        }
        .upm-mode-owner { background: var(--gold-subtle); color: var(--gold); border: 1px solid color-mix(in srgb, var(--gold) 34%, transparent); }
        .upm-mode-op    { background: var(--accent-subtle); color: var(--accent-hover); border: 1px solid var(--accent-border); }
        .upm-mode-voice { background: color-mix(in srgb, var(--success) 14%, transparent); color: var(--success); border: 1px solid color-mix(in srgb, var(--success) 28%, transparent); }
        .upm-mode-oper  { background: var(--gold-subtle); color: var(--gold); border: 1px solid color-mix(in srgb, var(--gold) 34%, transparent); }
        .upm-mode-self  { background: var(--bg-base); color: var(--text-secondary); border: 1px solid var(--border-normal); }

        .upm-custom-status {
          font-size: 13px;
          color: var(--text-secondary, var(--text-muted));
          margin: 14px 0 0;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 10px;
          border: 0;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
          border-radius: var(--r-md);
          background: color-mix(in srgb, var(--bg-base) 72%, transparent);
        }

        .upm-status-bullet {
          color: var(--accent);
          font-size: 8px;
          line-height: 1;
        }

        .upm-activity-card {
          margin-top: 14px;
          background: var(--elev-tint-1, var(--bg-base));
          border: 0;
          border-radius: var(--r-md);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
          padding: 10px 12px;
        }

        .upm-activity-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 4px;
        }

        .upm-activity-text {
          font-size: 13px;
          color: var(--text-secondary, var(--text-primary));
          word-break: break-word;
        }

        .upm-edit-profile-btn {
          margin-top: 18px;
          width: 100%;
          justify-content: center;
          font-size: 12px;
          padding: 9px 12px;
          gap: 5px;
        }

        /* ── Right column ── */
        .upm-right {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        /* ── Tabs ── */
        .upm-tabs {
          display: flex;
          box-shadow: inset 0 -1px 0 var(--border-subtle);
          padding: 0 18px;
          flex-shrink: 0;
          background: color-mix(in srgb, var(--bg-deep) 42%, transparent);
        }

        .upm-tab {
          padding: 14px 12px 12px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          color: var(--text-muted);
          border: none;
          background: none;
          font-family: inherit;
          border-bottom: 2px solid transparent;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: opacity var(--t-fast) var(--ease-out);
        }

        .upm-tab.active {
          color: var(--text-normal, var(--text-primary));
          border-bottom-color: var(--accent);
        }

        .upm-tab:hover:not(.active) {
          color: var(--text-secondary, var(--text-muted));
        }

        .upm-tab-count {
          font-size: 11px;
          font-weight: 700;
          background: var(--accent-subtle);
          color: var(--accent-hover);
          border: 0;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
          padding: 1px 6px;
          border-radius: var(--r-full);
          min-width: 18px;
          text-align: center;
        }

        /* ── Tab content ── */
        .upm-tab-content {
          flex: 1;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: var(--border-subtle) transparent;
          padding-bottom: 10px;
        }

        .upm-section {
          padding: 18px 18px 0;
        }

        .upm-section-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0;
          color: var(--text-muted);
          margin: 0 0 8px;
          display: flex; align-items: center; gap: 8px;
        }
        .upm-section-label::after {
          content: ''; flex: 1; height: 1px; background: color-mix(in srgb, var(--text-muted) 24%, transparent);
        }

        /* ── About Me ── */
        .upm-bio-text {
          font-size: 14px;
          line-height: 1.68;
          color: var(--text-secondary, var(--text-primary));
          margin: 0 0 4px;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .upm-info-value {
          font-size: 15px;
          color: var(--text-primary);
          margin: 0 0 2px;
          font-weight: 700;
        }

        .upm-info-sub {
          font-size: 12px;
          color: var(--text-muted);
          margin: 0;
        }

        .upm-empty-state {
          font-size: 13px;
          color: var(--text-muted);
          padding: 30px 18px;
          text-align: center;
          font-style: italic;
        }

        /* ── Mutual Channels ── */
        .upm-mutual-channel {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 18px;
          width: 100%;
          background: transparent;
          border: none;
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out);
        }
        .upm-mutual-channel:hover {
          background: var(--elev-tint-1, var(--bg-base));
          transform: translateX(2px);
        }

        .upm-mutual-hash {
          color: var(--accent-hover);
          flex-shrink: 0;
        }

        .upm-mutual-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-normal, var(--text-primary));
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .upm-mutual-count {
          font-size: 12px;
          color: var(--text-muted);
          flex-shrink: 0;
        }

        /* ── Notes ── */
        .upm-note-textarea {
          width: 100%;
          min-height: 80px;
          border: 0;
          border-radius: var(--r-md);
          background: var(--elev-tint-1, var(--bg-deep));
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), inset 0 0 0 1px var(--border-subtle);
          color: var(--text-secondary, var(--text-primary));
          font-size: 14px;
          font-family: inherit;
          line-height: 1.6;
          resize: vertical;
          outline: none;
          padding: 10px 12px;
          box-sizing: border-box;
          transition: none;
        }
        .upm-note-textarea::placeholder {
          color: var(--text-muted);
          font-style: italic;
        }
        .upm-note-textarea:focus {
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), inset 0 0 0 1px var(--accent-border);
          color: var(--text-normal, var(--text-primary));
        }

        /* ── Actions ── */
        .upm-actions {
          display: flex;
          gap: 8px;
          padding: 14px 18px 16px;
          box-shadow: inset 0 1px 0 var(--border-subtle);
          flex-shrink: 0;
          flex-wrap: wrap;
          background: color-mix(in srgb, var(--bg-deep) 60%, transparent);
        }

        .upm-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 16px;
          border-radius: var(--r-sm, 6px) var(--r-md, 10px) var(--r-sm, 6px) var(--r-lg, 14px);
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          border: 0;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          white-space: nowrap;
        }

        .upm-btn:hover {
          transform: translateY(-1px);
        }

        .upm-btn:active {
          transform: translateY(0);
        }

        .upm-btn-primary {
          background: color-mix(in srgb, var(--accent) 82%, #05070a);
          color: var(--text-primary);
        }
        .upm-btn-primary:hover { filter: brightness(1.05); }

        .upm-btn-secondary {
          background: var(--elev-tint-1, var(--bg-base));
          color: var(--text-primary);
        }
        .upm-btn-secondary:hover { background: var(--bg-overlay); }

        .upm-btn-ghost {
          background: transparent;
          color: var(--text-muted);
        }
        .upm-btn-ghost:hover { color: var(--text-secondary); background: var(--bg-elevated); }

        .upm-btn-danger {
          background: var(--danger-subtle);
          color: var(--danger);
        }
        .upm-btn-danger:hover { background: color-mix(in srgb, var(--danger) 18%, transparent); }

        /* ── Link ── */
        .upm-link {
          color: var(--accent);
          text-decoration: none;
        }
        .upm-link:hover { text-decoration: underline; }

        /* ── Edit mode ── */
        .upm-edit-header {
          padding: 18px 18px 0;
          box-shadow: inset 0 -1px 0 var(--border-subtle);
          padding-bottom: 14px;
          flex-shrink: 0;
          background: color-mix(in srgb, var(--bg-deep) 42%, transparent);
        }

        .upm-edit-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-normal, var(--text-primary));
          margin: 0;
          text-transform: uppercase;
          letter-spacing: 0;
        }

        .upm-edit-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 6px 0 10px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-subtle) transparent;
        }

        .upm-edit-field {
          padding: 14px 18px 0;
        }

        .upm-edit-label {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0;
          color: var(--text-muted);
          margin-bottom: 6px;
        }

        .upm-char-count {
          font-size: 11px;
          color: var(--text-muted);
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
        }

        .upm-edit-input {
          width: 100%;
          height: 36px;
          padding: 0 12px;
          border: 0;
          border-radius: var(--r-md);
          background: var(--elev-tint-1, var(--bg-deep));
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), inset 0 0 0 1px var(--border-normal);
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          outline: none;
          box-sizing: border-box;
          transition: none;
        }
        .upm-edit-input:focus {
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), inset 0 0 0 1px var(--accent-border), 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
        }
        .upm-edit-input::placeholder { color: var(--text-muted); }

        .upm-edit-textarea {
          width: 100%;
          padding: 8px 12px;
          border: 0;
          border-radius: var(--r-md);
          background: var(--elev-tint-1, var(--bg-deep));
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), inset 0 0 0 1px var(--border-normal);
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          line-height: 1.6;
          resize: vertical;
          outline: none;
          box-sizing: border-box;
          min-height: 80px;
          transition: none;
        }
        .upm-edit-textarea:focus {
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), inset 0 0 0 1px var(--accent-border), 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
        }
        .upm-edit-textarea::placeholder { color: var(--text-muted); }

        /* ── Invisible mode toggle ── */
        .upm-invisible-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 4px 0 12px;
        }

        .upm-invisible-desc {
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 2px;
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
        }

        .upm-toggle {
          position: relative;
          width: 44px;
          height: 24px;
          border-radius: var(--r-full);
          border: none;
          background: var(--bg-overlay);
          cursor: pointer;
          flex-shrink: 0;
          transition: opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          padding: 0;
        }

        .upm-toggle-on {
          background: var(--accent);
        }

        .upm-toggle-thumb {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 18px;
          height: 18px;
          border-radius: var(--r-full);
          background: #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.35);
          transition: transform var(--t-normal) var(--ease-spring);
          pointer-events: none;
        }

        .upm-toggle-on .upm-toggle-thumb {
          transform: translateX(20px);
        }

        /* ── Responsive: stack columns on narrow screens ── */
        @media (max-width: 560px) {
          .upm-layout { flex-direction: column; }
          .upm-left {
            width: 100%;
            border-right: none;
            border-bottom: 1px solid var(--border-subtle);
          }
        }
      `}</style>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M1 1l12 12M13 1L1 13" />
    </svg>
  );
}

function HashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M2 4.5h9M2 8.5h9M5 1.5l-1.5 10M9.5 1.5L8 11.5" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 2H1.5C1.22 2 1 2.22 1 2.5v6c0 .28.22.5.5.5H4l2.5 3L9 9h3.5c.28 0 .5-.22.5-.5v-6c0-.28-.22-.5-.5-.5z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 1.5l2.5 2.5-7 7L1 12l.5-3.5 7-7z" />
    </svg>
  );
}
