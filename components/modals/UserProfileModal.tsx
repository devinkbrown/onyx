'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';
import { useDialogFocus } from './useDialogFocus';

// ── Nick color helpers ────────────────────────────────────────────────────────

function nickHue(nick: string): number {
  let hash = 0;
  for (const c of nick) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return Math.abs(hash) % 360;
}

function bannerGradient(nick: string, bannerColor?: string): string {
  if (bannerColor) {
    return `linear-gradient(135deg, ${bannerColor} 0%, color-mix(in srgb, ${bannerColor} 60%, #000) 100%)`;
  }
  const hue = nickHue(nick);
  return `linear-gradient(135deg, hsl(${hue}, 55%, 25%) 0%, hsl(${(hue + 40) % 360}, 45%, 15%) 100%)`;
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
  if (modes.has('q')) return <span className="upm-mode-badge upm-mode-owner">Owner</span>;
  if (modes.has('o')) return <span className="upm-mode-badge upm-mode-op">Op</span>;
  if (modes.has('v')) return <span className="upm-mode-badge upm-mode-voice">Voice</span>;
  return null;
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
  const selfBannerUrl   = useOnyxStore(s => s.selfBannerUrl);
  const selfDisplayName = useOnyxStore(s => s.selfDisplayName);
  const invisibleMode   = useOnyxStore(s => s.invisibleMode);
  const setSelfBio         = useOnyxStore(s => s.setSelfBio);
  const setSelfPronouns    = useOnyxStore(s => s.setSelfPronouns);
  const setSelfBannerUrl   = useOnyxStore(s => s.setSelfBannerUrl);
  const setSelfDisplayName = useOnyxStore(s => s.setSelfDisplayName);
  const setInvisibleMode   = useOnyxStore(s => s.setInvisibleMode);
  const setUserProfile     = useOnyxStore(s => s.setUserProfile);
  const getUserProfile     = useOnyxStore(s => s.getUserProfile);

  const [draftBio, setDraftBio]         = useState(selfBio);
  const [draftPronouns, setDraftPronouns] = useState(selfPronouns);
  const [draftBannerUrl, setDraftBannerUrl] = useState(selfBannerUrl);
  const [draftDisplayName, setDraftDisplayName] = useState(selfDisplayName);
  const [showBannerInput, setShowBannerInput] = useState(false);

  // Live preview banner style
  const previewBannerStyle = draftBannerUrl
    ? { backgroundImage: `url(${draftBannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center top' }
    : { background: bannerGradient(nick) };

  const handleSave = () => {
    setSelfBio(draftBio);
    setSelfPronouns(draftPronouns);
    setSelfBannerUrl(draftBannerUrl);
    setSelfDisplayName(draftDisplayName);
    // Sync into userProfiles so view mode shows fresh data immediately
    const existing = getUserProfile(nick) ?? { nick };
    setUserProfile(nick, {
      ...existing,
      bio: draftBio,
      pronouns: draftPronouns,
      bannerUrl: draftBannerUrl,
    });
    onClose();
  };

  return (
    <div className="upm-layout">
      {/* Left column — live preview */}
      <div className="upm-left">
        <div className="upm-banner" style={previewBannerStyle} aria-hidden />
        <button
          className="upm-banner-edit-btn"
          onClick={() => setShowBannerInput(v => !v)}
          aria-label="Edit banner image"
        >
          Edit Banner
        </button>
        {showBannerInput && (
          <div className="upm-edit-field upm-banner-field">
            <label className="upm-edit-label" htmlFor="upm-banner-url">Banner URL</label>
            <input
              id="upm-banner-url"
              className="upm-edit-input"
              type="url"
              value={draftBannerUrl}
              onChange={e => setDraftBannerUrl(e.target.value)}
              placeholder="https://example.com/banner.jpg"
            />
          </div>
        )}

        <div className="upm-avatar-wrap">
          <div className="upm-avatar-border">
            <Avatar nick={nick} size={64} />
          </div>
        </div>

        <div className="upm-identity">
          <h2 className="upm-nick">
            {draftDisplayName || nick}
            <span className="upm-mode-badge upm-mode-self">You</span>
          </h2>
          {draftPronouns && (
            <p className="upm-pronouns">{draftPronouns}</p>
          )}
          {draftBio && (
            <p className="upm-preview-bio">{draftBio}</p>
          )}
        </div>
      </div>

      {/* Right column — edit fields */}
      <div className="upm-right">
        <div className="upm-edit-header">
          <h3 className="upm-edit-title">Edit Profile</h3>
        </div>

        <div className="upm-edit-scroll">
          <div className="upm-edit-field">
            <label className="upm-edit-label" htmlFor="upm-display-name">Display Name</label>
            <input
              id="upm-display-name"
              className="upm-edit-input"
              type="text"
              value={draftDisplayName}
              onChange={e => setDraftDisplayName(e.target.value)}
              placeholder={nick}
              maxLength={32}
            />
          </div>

          <div className="upm-edit-field">
            <label className="upm-edit-label" htmlFor="upm-pronouns">Pronouns</label>
            <input
              id="upm-pronouns"
              className="upm-edit-input"
              type="text"
              value={draftPronouns}
              onChange={e => setDraftPronouns(e.target.value)}
              placeholder="e.g. they/them"
              maxLength={32}
            />
          </div>

          <div className="upm-edit-field">
            <label className="upm-edit-label" htmlFor="upm-bio">
              About Me
              <span className="upm-char-count">{draftBio.length}/190</span>
            </label>
            <textarea
              id="upm-bio"
              className="upm-edit-textarea"
              value={draftBio}
              onChange={e => setDraftBio(e.target.value.slice(0, 190))}
              placeholder="Tell others a bit about yourself"
              rows={4}
              maxLength={190}
            />
          </div>

          <div className="upm-edit-field">
            <label className="upm-edit-label" htmlFor="upm-banner-url-main">Banner Image URL</label>
            <input
              id="upm-banner-url-main"
              className="upm-edit-input"
              type="url"
              value={draftBannerUrl}
              onChange={e => setDraftBannerUrl(e.target.value)}
              placeholder="https://example.com/banner.jpg"
            />
          </div>

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

        <div className="upm-actions">
          <button className="upm-btn upm-btn-primary" onClick={handleSave}>
            Save Changes
          </button>
          <button className="upm-btn upm-btn-ghost" onClick={onClose}>
            Cancel
          </button>
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
    : { background: bannerGradient(nick, richProfile?.bannerColor) };

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
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          padding: 16px;
        }

        /* ── Card ── */
        .upm-card {
          position: relative;
          width: 100%;
          max-width: 720px;
          background: var(--bg-2, var(--bg-elevated));
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.65), 0 4px 16px rgba(0, 0, 0, 0.4);
          max-height: 90dvh;
        }

        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        .animate-scale-in { animation: scale-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both; }

        /* ── Close button ── */
        .upm-close {
          position: absolute;
          top: 12px;
          right: 12px;
          z-index: 10;
          width: 28px;
          height: 28px;
          border-radius: var(--r-full);
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(0, 0, 0, 0.5);
          color: rgba(255, 255, 255, 0.75);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
        }
        .upm-close:hover {
          background: rgba(0, 0, 0, 0.75);
          color: #fff;
          border-color: rgba(255,255,255,0.25);
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
          border-right: 1px solid var(--border-subtle);
          display: flex;
          flex-direction: column;
          position: relative;
        }

        .upm-banner {
          height: 120px;
          position: relative;
          flex-shrink: 0;
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
          background: rgba(0,0,0,0.55);
          color: rgba(255,255,255,0.85);
          cursor: pointer;
          transition: background 150ms ease;
          z-index: 2;
          white-space: nowrap;
        }
        .upm-banner-edit-btn:hover { background: rgba(0,0,0,0.75); color: #fff; }

        .upm-banner-field {
          padding: 0 16px 8px;
          margin-top: 4px;
        }

        .upm-avatar-wrap {
          position: relative;
          padding: 0 16px;
          margin-top: -36px;
          flex-shrink: 0;
        }

        .upm-avatar-border {
          display: inline-flex;
          border-radius: var(--r-full);
          border: 4px solid var(--accent);
          box-shadow: 0 0 0 3px var(--bg-2, var(--bg-elevated));
          line-height: 0;
        }

        .upm-identity {
          padding: 8px 16px 16px;
          flex: 1;
        }

        .upm-nick {
          font-size: 20px;
          font-weight: 700;
          color: var(--text-normal, var(--text-primary));
          margin: 0 0 2px;
          letter-spacing: -0.01em;
          line-height: 1.2;
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .upm-edited-tag {
          font-size: 11px;
          font-weight: 500;
          color: var(--text-muted);
          background: var(--bg-elevated);
          border-radius: var(--r-full);
          padding: 2px 7px;
        }

        .upm-account {
          font-size: 13px;
          color: var(--text-muted);
          margin: 0 0 4px;
          font-weight: 500;
        }

        .upm-pronouns {
          font-size: 12px;
          color: var(--text-muted);
          margin: 0 0 6px;
          font-weight: 500;
          font-style: italic;
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
          gap: 6px;
          margin-top: 8px;
          align-items: center;
          flex-wrap: wrap;
        }

        .upm-presence-dot {
          width: 10px;
          height: 10px;
          border-radius: var(--r-full);
          flex-shrink: 0;
          display: inline-block;
        }

        /* ── Mode badges ── */
        .upm-mode-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 3px 9px;
          border-radius: var(--r-full);
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .upm-mode-owner { background: rgba(232, 184, 75, 0.15); color: var(--gold); border: 1px solid rgba(232,184,75,0.25); }
        .upm-mode-op    { background: rgba(14, 165, 233, 0.15); color: var(--accent); border: 1px solid rgba(14,165,233,0.25); }
        .upm-mode-voice { background: rgba(52, 211, 153, 0.15); color: var(--status-online); border: 1px solid rgba(52,211,153,0.25); }
        .upm-mode-oper  { background: rgba(250, 200, 50, 0.15); color: #f0c040; border: 1px solid rgba(250,200,50,0.25); }
        .upm-mode-self  { background: var(--bg-elevated); color: var(--text-muted); border: 1px solid var(--border-subtle); }

        .upm-custom-status {
          font-size: 13px;
          color: var(--text-secondary, var(--text-muted));
          margin: 10px 0 0;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .upm-status-bullet {
          color: var(--accent);
          font-size: 8px;
          line-height: 1;
        }

        .upm-activity-card {
          margin-top: 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 8px 12px;
        }

        .upm-activity-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.06em;
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
          margin-top: 14px;
          width: 100%;
          justify-content: center;
          font-size: 12px;
          padding: 7px 12px;
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
          border-bottom: 1px solid var(--border-subtle);
          padding: 0 16px;
          flex-shrink: 0;
        }

        .upm-tab {
          padding: 12px 12px 10px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          color: var(--text-muted);
          border: none;
          background: none;
          font-family: inherit;
          border-bottom: 2px solid transparent;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: color 150ms ease, border-color 150ms ease;
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
          background: var(--bg-elevated);
          color: var(--text-muted);
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
        }

        .upm-section {
          padding: 16px 16px 0;
        }

        .upm-section-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--text-muted);
          margin: 0 0 6px;
          display: flex; align-items: center; gap: 8px;
        }
        .upm-section-label::after {
          content: ''; flex: 1; height: 1px; background: var(--border-subtle);
        }

        /* ── About Me ── */
        .upm-bio-text {
          font-size: 14px;
          line-height: 1.6;
          color: var(--text-secondary, var(--text-muted));
          margin: 0 0 4px;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .upm-info-value {
          font-size: 14px;
          color: var(--text-secondary, var(--text-primary));
          margin: 0 0 2px;
          font-weight: 500;
        }

        .upm-info-sub {
          font-size: 12px;
          color: var(--text-muted);
          margin: 0;
        }

        .upm-empty-state {
          font-size: 13px;
          color: var(--text-muted);
          padding: 24px 16px;
          text-align: center;
          font-style: italic;
        }

        /* ── Mutual Channels ── */
        .upm-mutual-channel {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          width: 100%;
          background: none;
          border: none;
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          transition: background 150ms ease;
        }
        .upm-mutual-channel:hover { background: var(--bg-overlay, rgba(255,255,255,0.04)); }

        .upm-mutual-hash {
          color: var(--text-muted);
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
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          background: var(--bg-elevated);
          color: var(--text-secondary, var(--text-primary));
          font-size: 14px;
          font-family: inherit;
          line-height: 1.6;
          resize: vertical;
          outline: none;
          padding: 8px 12px;
          box-sizing: border-box;
          transition: border-color 150ms ease;
        }
        .upm-note-textarea::placeholder {
          color: var(--text-muted);
          font-style: italic;
        }
        .upm-note-textarea:focus {
          border-color: var(--accent);
          color: var(--text-normal, var(--text-primary));
        }

        /* ── Actions ── */
        .upm-actions {
          display: flex;
          gap: 8px;
          padding: 12px 16px;
          border-top: 1px solid var(--border-subtle);
          flex-shrink: 0;
          flex-wrap: wrap;
        }

        .upm-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: var(--r-md);
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          border: 1px solid transparent;
          transition: background 150ms ease, color 150ms ease, border-color 150ms ease, opacity 150ms ease;
          white-space: nowrap;
        }

        .upm-btn-primary {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
        }
        .upm-btn-primary:hover { opacity: 0.88; }

        .upm-btn-secondary {
          background: var(--bg-elevated);
          color: var(--text-primary);
          border-color: var(--border-normal);
        }
        .upm-btn-secondary:hover { background: var(--bg-overlay); }

        .upm-btn-ghost {
          background: transparent;
          color: var(--text-muted);
          border-color: var(--border-subtle);
        }
        .upm-btn-ghost:hover { color: var(--text-secondary); background: var(--bg-elevated); }

        .upm-btn-danger {
          background: rgba(220, 38, 38, 0.15);
          color: #ef4444;
          border-color: rgba(220, 38, 38, 0.35);
        }
        .upm-btn-danger:hover { background: rgba(220, 38, 38, 0.25); }

        /* ── Link ── */
        .upm-link {
          color: var(--accent);
          text-decoration: none;
        }
        .upm-link:hover { text-decoration: underline; }

        /* ── Edit mode ── */
        .upm-edit-header {
          padding: 16px 16px 0;
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: 12px;
          flex-shrink: 0;
        }

        .upm-edit-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-normal, var(--text-primary));
          margin: 0;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .upm-edit-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 4px 0;
          scrollbar-width: thin;
          scrollbar-color: var(--border-subtle) transparent;
        }

        .upm-edit-field {
          padding: 12px 16px 0;
        }

        .upm-edit-label {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
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
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          background: var(--bg-deep);
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          outline: none;
          box-sizing: border-box;
          transition: border-color 150ms ease, box-shadow 150ms ease;
        }
        .upm-edit-input:focus {
          border-color: var(--accent-border);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
        }
        .upm-edit-input::placeholder { color: var(--text-muted); }

        .upm-edit-textarea {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          background: var(--bg-deep);
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          line-height: 1.6;
          resize: vertical;
          outline: none;
          box-sizing: border-box;
          min-height: 80px;
          transition: border-color 150ms ease, box-shadow 150ms ease;
        }
        .upm-edit-textarea:focus {
          border-color: var(--accent-border);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
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
          transition: background 200ms ease;
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
          transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
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
