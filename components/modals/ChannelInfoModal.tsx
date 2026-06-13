'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import type { IRCClient } from '@/lib/irc/client';
import ModalShell from './ModalShell';

type Tab = 'overview' | 'members' | 'pins' | 'stats' | 'settings';

// ── Channel stats computation ─────────────────────────────────────────────────

interface ChannelStats {
  total: number;
  topPosters: Array<[string, number]>;
  byHour: number[];
  peakHour: number;
  todayCount: number;
  todayUsers: number;
}

function computeChannelStats(messages: ChatMessage[]): ChannelStats {
  const msgMessages = messages.filter(m => m.type === 'msg');

  const byUser = new Map<string, number>();
  for (const m of msgMessages) {
    byUser.set(m.from, (byUser.get(m.from) ?? 0) + 1);
  }

  const topPosters = Array.from(byUser.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const byHour = new Array(24).fill(0) as number[];
  for (const m of msgMessages) {
    byHour[m.time.getHours()]++;
  }

  const peakHour = byHour.indexOf(Math.max(...byHour));

  const today = new Date().toDateString();
  const todayMessages = msgMessages.filter(m => m.time.toDateString() === today);
  const todayCount = todayMessages.length;
  const todayUsers = new Set(todayMessages.map(m => m.from)).size;

  return { total: msgMessages.length, topPosters, byHour, peakHour, todayCount, todayUsers };
}

const MODE_LABELS: Record<string, string> = {
  // Standard IRC
  m: '+m Moderated — only voiced users can speak',
  n: '+n No external messages',
  t: '+t Topic locked to operators',
  s: '+s Secret — hidden from /LIST',
  i: '+i Invite-only',
  p: '+p Private — listed but properties restricted',
  k: '+k Key protected (password required)',
  l: '+l User limit',
  q: '+q Quiet mask',
  // Orochi core (chm_builtin.c)
  c: '+c Strip colour and formatting codes',
  C: '+C Block CTCP (ACTION exempt)',
  S: '+S TLS-only — SSL/TLS clients only',
  A: '+A Admin-only — IRC admins only',
  O: '+O Oper-only — IRC operators only',
  // Orochi IRCX (m_ircx_modes.c)
  r: '+r Registered — channel persists when empty',
  a: '+a Auth-only — authenticated users only',
  u: '+u KNOCK notifications enabled',
  h: '+h Hidden — not in /LIST but queryable by name',
  d: '+d Cloneable — creates numbered clones when full',
  E: '+E Clone channel',
  f: '+f No format — disable client message formatting',
  z: '+z Service monitoring channel',
  x: '+x Auditorium — non-ops hidden from each other',
  w: '+w No whisper — disables WHISPER',
  Y: '+Y No comic data',
  // SUIMYAKU media modes
  N: '+N SUIMYAKU voice — group voice transport enabled',
  V: '+V SUIMYAKU media — camera and screen sharing enabled',
  // Other extensions
  T: '+T No notices — blocks NOTICE to channel',
  U: '+U Allow non-TLS clients',
};

export default function ChannelInfoModal() {
  const closeChannelInfo    = useOnyxStore(s => s.closeChannelInfo);
  const channelInfoChannel  = useOnyxStore(s => s.channelInfoChannel);
  const channels            = useOnyxStore(s => s.channels);
  const channelProps        = useOnyxStore(s => s.channelProps);
  const requestChannelProps = useOnyxStore(s => s.requestChannelProps);
  const isIRCX              = useOnyxStore(s => s.isIRCX);
  const partChannel         = useOnyxStore(s => s.partChannel);
  const navigate            = useOnyxStore(s => s.navigate);
  const ourNick             = useOnyxStore(s => s.ourNick);
  const pinnedMessages      = useOnyxStore(s => s.pinnedMessages);
  const openWhois           = useOnyxStore(s => s.openWhois);
  const client              = useOnyxStore(s => s.client);

  const channelName = channelInfoChannel ?? '';
  const key         = channelName.toLowerCase();
  const channel     = channels.get(key);
  const props       = channelProps.get(key) ?? {};

  const [activeTab, setActiveTab]         = useState<Tab>('overview');
  const [memberSearch, setMemberSearch]   = useState('');
  const [editingTopic, setEditingTopic]   = useState(false);
  const [topicDraft, setTopicDraft]       = useState('');
  const topicInputRef                     = useRef<HTMLTextAreaElement>(null);

  // Re-request props each time modal opens
  useEffect(() => {
    if (channelName && isIRCX) requestChannelProps(channelName);
  }, [channelName, isIRCX, requestChannelProps]);

  // Reset tab when channel changes
  useEffect(() => {
    setActiveTab('overview');
    setMemberSearch('');
    setEditingTopic(false);
  }, [channelName]);

  // Focus topic input when editing
  useEffect(() => {
    if (editingTopic && topicInputRef.current) {
      topicInputRef.current.focus();
      topicInputRef.current.setSelectionRange(
        topicInputRef.current.value.length,
        topicInputRef.current.value.length,
      );
    }
  }, [editingTopic]);

  // While editing the topic, Escape cancels the edit instead of closing the
  // dialog (capture phase so it pre-empts ModalShell's Escape handler).
  useEffect(() => {
    if (!editingTopic) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setEditingTopic(false);
      }
    };
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [editingTopic]);

  // ── Derived data ───────────────────────────────────────────────────────
  const displayName  = channelName.replace(/^[#&]/, '');
  const description  = props.DESCRIPTION ?? props.Description ?? '';
  const rules        = props.RULES ?? props.Rules ?? '';
  const category     = props.CATEGORY ?? props.Category ?? '';
  const picture      = props.PICTURE ?? props.Picture ?? '';
  const topic        = channel?.topic ?? '';
  const modeStr      = channel?.modes ?? '';
  const createdAt    = channel?.createdAt ?? null;
  const users        = channel?.users ?? new Map();
  const memberCount  = users.size;
  const pinned       = pinnedMessages.get(key) ?? [];

  const TIME_FMT = new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });

  // Count by role
  let opCount    = 0;
  let voiceCount = 0;
  let onlineCount = 0;
  users.forEach(u => {
    if (u.modes.has('q') || u.modes.has('o')) opCount++;
    else if (u.modes.has('v')) voiceCount++;
    if (!u.away) onlineCount++;
  });

  // Determine our own modes in this channel
  const ourEntry = users.get(ourNick.toLowerCase());
  const isOp     = ourEntry?.modes.has('q') || ourEntry?.modes.has('o') || false;

  // Channel modes
  const activeModes: { modeKey: string; label: string }[] = [];
  const limitMatch = modeStr.match(/l(\d+)/);
  for (const [modeChar, modeLabel] of Object.entries(MODE_LABELS)) {
    if (modeStr.includes(modeChar)) {
      activeModes.push({ modeKey: modeChar, label: modeLabel });
    }
  }
  if (limitMatch) {
    activeModes.push({ modeKey: 'l', label: `+l Limit: ${limitMatch[1]}` });
  }

  // Member list filtered
  const filteredMembers = Array.from(users.values()).filter(u =>
    u.nick.toLowerCase().includes(memberSearch.toLowerCase()),
  ).sort((a, b) => {
    const rank = (modes: Set<string>) =>
      modes.has('q') ? 0 : modes.has('o') ? 1 : modes.has('v') ? 2 : 3;
    return rank(a.modes) - rank(b.modes);
  });

  const commitTopic = useCallback(() => {
    const trimmed = topicDraft.trim();
    if (client) {
      client.sendRaw('TOPIC', channelName, trimmed);
    }
    setEditingTopic(false);
  }, [client, channelName, topicDraft]);

  // Channel stats (computed from message history)
  const messages = useMemo(() => channel?.messages ?? [], [channel?.messages]);
  const stats = useMemo(() => computeChannelStats(messages), [messages]);

  const tabs: Tab[] = ['overview', 'members', 'pins', 'stats'];
  if (isOp) tabs.push('settings');

  return (
    <ModalShell
      onClose={closeChannelInfo}
      variant="sheet"
      size="md"
      showClose={false}
      ariaLabel={`Channel info for ${channelName}`}
      flushBody
      className="ci-panel"
    >
      <div className="ci-layout">

        {/* ── Banner ────────────────────────────────────────────────── */}
        <div
          className="ci-banner"
          style={picture ? { backgroundImage: `url(${picture})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        >
          <div className="ci-banner-overlay" />
          <button className="ci-close" onClick={closeChannelInfo} aria-label="Close">
            <CloseIcon />
          </button>
          <div className="ci-banner-content">
            <div className="ci-sigil">#</div>
            <h2 id="ci-panel-title" className="ci-channel-name">{displayName}</h2>
            <div className="ci-banner-meta">
              {category && <span className="ci-category-badge">{category}</span>}
              {createdAt && (
                <span className="ci-created-date">Created {TIME_FMT.format(createdAt)}</span>
              )}
            </div>
          </div>
        </div>

        {/* ── Stats row ────────────────────────────────────────────── */}
        <div className="ci-stats">
          <div className="ci-stat">
            <span className="ci-stat-value">{memberCount}</span>
            <span className="ci-stat-label">Members</span>
          </div>
          <div className="ci-stat">
            <span className="ci-stat-value" style={{ color: 'var(--status-online)' }}>{onlineCount}</span>
            <span className="ci-stat-label">Online</span>
          </div>
          <div className="ci-stat">
            <span className="ci-stat-value" style={{ color: 'var(--gold)' }}>{opCount}</span>
            <span className="ci-stat-label">Ops</span>
          </div>
          <div className="ci-stat">
            <span className="ci-stat-value" style={{ color: '#22c55e' }}>{voiceCount}</span>
            <span className="ci-stat-label">Voice</span>
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────── */}
        <div className="ci-tabs" role="tablist">
          {tabs.map(t => (
            <button
              key={t}
              role="tab"
              aria-selected={activeTab === t}
              className={`ci-tab ${activeTab === t ? 'ci-tab--active' : ''}`}
              onClick={() => setActiveTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'pins' && pinned.length > 0 && (
                <span className="ci-tab-badge">{pinned.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab panels ───────────────────────────────────────────── */}
        <div className="ci-body">

          {/* OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="ci-tab-panel">
              {/* Topic */}
              <section className="ci-section">
                <div className="ci-section-header">
                  <h3 className="ci-section-title">Topic</h3>
                  {isOp && !editingTopic && (
                    <button
                      className="ci-inline-action"
                      onClick={() => { setTopicDraft(topic); setEditingTopic(true); }}
                    >
                      Edit
                    </button>
                  )}
                </div>
                {editingTopic ? (
                  <div className="ci-topic-edit">
                    <textarea
                      ref={topicInputRef}
                      className="ci-topic-input"
                      value={topicDraft}
                      onChange={e => setTopicDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTopic(); }
                        if (e.key === 'Escape') setEditingTopic(false);
                      }}
                      rows={3}
                      maxLength={490}
                    />
                    <div className="ci-topic-edit-actions">
                      <span className="ci-topic-char-hint">{topicDraft.length}/490</span>
                      <button className="ci-btn ci-btn--ghost" onClick={() => setEditingTopic(false)}>Cancel</button>
                      <button className="ci-btn ci-btn--accent" onClick={commitTopic}>Save</button>
                    </div>
                  </div>
                ) : (
                  <p className="ci-text">{topic || <span className="ci-placeholder">No topic set.</span>}</p>
                )}
              </section>

              {/* Description */}
              {description && (
                <section className="ci-section">
                  <h3 className="ci-section-title">About</h3>
                  <p className="ci-text">{description}</p>
                </section>
              )}

              {/* Rules */}
              {rules && (
                <section className="ci-section">
                  <h3 className="ci-section-title">Rules</h3>
                  <ol className="ci-rules">
                    {rules
                      .split(/\\n|\n/)
                      .map(l => l.trim())
                      .filter(Boolean)
                      .map((rule, i) => (
                        <li key={i} className="ci-rule-item">
                          <span className="ci-rule-num">{i + 1}</span>
                          <span>{rule}</span>
                        </li>
                      ))}
                  </ol>
                </section>
              )}

              {/* Channel modes */}
              {activeModes.length > 0 && (
                <section className="ci-section">
                  <h3 className="ci-section-title">Channel Modes</h3>
                  <div className="ci-modes">
                    {activeModes.map(({ modeKey, label }) => (
                      <span key={modeKey} className="ci-mode-badge">{label}</span>
                    ))}
                  </div>
                </section>
              )}

              {/* Empty state */}
              {!topic && !description && !rules && activeModes.length === 0 && (
                <div className="ci-empty">
                  <span className="ci-empty-icon">📋</span>
                  <p>No additional info for this channel.</p>
                </div>
              )}
            </div>
          )}

          {/* MEMBERS */}
          {activeTab === 'members' && (
            <div className="ci-tab-panel">
              <div className="ci-search-wrap">
                <SearchIcon />
                <input
                  className="ci-search-input"
                  placeholder="Search members…"
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  aria-label="Search members"
                />
                {memberSearch && (
                  <button className="ci-search-clear" onClick={() => setMemberSearch('')} aria-label="Clear search">
                    <CloseIcon />
                  </button>
                )}
              </div>
              <div className="ci-member-list">
                {filteredMembers.length === 0 && (
                  <div className="ci-empty"><p>No members found.</p></div>
                )}
                {filteredMembers.map(u => (
                  <button
                    key={u.nick}
                    className="ci-member-row"
                    onClick={() => { openWhois(u.nick); }}
                    aria-label={`View ${u.nick} profile`}
                  >
                    <div className="ci-member-avatar" aria-hidden>
                      {u.nick.charAt(0).toUpperCase()}
                    </div>
                    <span className="ci-member-nick">{u.nick}</span>
                    <div className="ci-member-badges">
                      {u.away && <span className="ci-badge ci-badge--away">Away</span>}
                      {u.modes.has('q') && <span className="ci-badge ci-badge--owner">Owner</span>}
                      {!u.modes.has('q') && u.modes.has('o') && <span className="ci-badge ci-badge--op">Op</span>}
                      {!u.modes.has('q') && !u.modes.has('o') && u.modes.has('v') && (
                        <span className="ci-badge ci-badge--voice">Voice</span>
                      )}
                      {u.modes.has('B') && <span className="ci-badge ci-badge--bot">Bot</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* PINS */}
          {activeTab === 'pins' && (
            <div className="ci-tab-panel">
              {pinned.length === 0 ? (
                <div className="ci-empty">
                  <span className="ci-empty-icon">📌</span>
                  <p>No pinned messages.</p>
                </div>
              ) : (
                <div className="ci-pin-list">
                  {pinned.map(msg => (
                    <PinnedMessageCard key={msg.id} msg={msg} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STATS */}
          {activeTab === 'stats' && (
            <StatsTab stats={stats} />
          )}

          {/* SETTINGS (op only) */}
          {activeTab === 'settings' && isOp && (
            <SettingsTab
              channelName={channelName}
              modeStr={modeStr}
              client={client}
            />
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────── */}
        <div className="ci-footer">
          <button
            className="ci-leave-btn"
            onClick={() => {
              partChannel(channelName);
              navigate({ kind: 'home' });
              closeChannelInfo();
            }}
          >
            Leave Channel
          </button>
        </div>
      </div>

      <style>{styles}</style>
    </ModalShell>
  );
}

// ── Pinned message card ───────────────────────────────────────────────────────

function PinnedMessageCard({ msg }: { msg: ChatMessage }) {
  const TIME_FMT = new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const preview = msg.text.length > 200 ? msg.text.slice(0, 200) + '…' : msg.text;
  return (
    <div className="ci-pin-card">
      <div className="ci-pin-meta">
        <span className="ci-pin-nick">{msg.from}</span>
        <time className="ci-pin-time">{TIME_FMT.format(msg.time)}</time>
      </div>
      <p className="ci-pin-text">{preview}</p>
    </div>
  );
}

// ── Settings tab ─────────────────────────────────────────────────────────────

interface SettingsTabProps {
  channelName: string;
  modeStr: string;
  client: IRCClient | null;
}

interface ModeToggleProps {
  label: string;
  description: string;
  active: boolean;
  onToggle: () => void;
}

function ModeToggle({ label, description, active, onToggle }: ModeToggleProps) {
  return (
    <div className="ci-mode-toggle">
      <div className="ci-mode-toggle-info">
        <span className="ci-mode-toggle-label">{label}</span>
        <span className="ci-mode-toggle-desc">{description}</span>
      </div>
      <button
        role="switch"
        aria-checked={active}
        className={`ci-toggle ${active ? 'ci-toggle--on' : ''}`}
        onClick={onToggle}
      >
        <span className="ci-toggle-thumb" />
      </button>
    </div>
  );
}

function SettingsTab({ channelName, modeStr, client }: SettingsTabProps) {
  const addToast = useOnyxStore(s => s.addToast);

  const sendMode = (flag: string, on: boolean) => {
    client?.sendRaw('MODE', channelName, `${on ? '+' : '-'}${flag}`);
  };

  const has = (flag: string) => modeStr.includes(flag);

  // +k channel key
  const [keyDraft, setKeyDraft] = useState('');

  const handleSetKey = () => {
    const k = keyDraft.trim();
    if (k) {
      client?.sendRaw('MODE', channelName, '+k', k);
    } else {
      client?.sendRaw('MODE', channelName, '-k', '*');
    }
    setKeyDraft('');
  };

  const handleClearKey = () => {
    client?.sendRaw('MODE', channelName, '-k', '*');
    setKeyDraft('');
  };

  // +l user limit
  const limitMatch = modeStr.match(/l(\d+)/);
  const currentLimit = limitMatch ? parseInt(limitMatch[1], 10) : 0;
  const [limitDraft, setLimitDraft] = useState('');

  const handleSetLimit = () => {
    const n = parseInt(limitDraft, 10);
    if (!isNaN(n) && n > 0) {
      client?.sendRaw('MODE', channelName, '+l', String(n));
    }
    setLimitDraft('');
  };

  const handleClearLimit = () => {
    client?.sendRaw('MODE', channelName, '-l');
    setLimitDraft('');
  };

  // Clone channel
  const handleCloneChannel = () => {
    const cloneName = channelName.replace(/^([#&])/, (_m, sigil: string) => sigil) + '-copy';
    client?.sendRaw('JOIN', cloneName);
    const channels = useOnyxStore.getState().channels;
    const ch = channels.get(channelName.toLowerCase());
    if (ch?.topic) {
      setTimeout(() => {
        client?.sendRaw('TOPIC', cloneName, ch.topic);
      }, 800);
    }
    addToast({ variant: 'success', title: `Channel cloned as ${cloneName}` });
  };

  return (
    <div className="ci-tab-panel">
      <section className="ci-section">
        <h3 className="ci-section-title">Channel Flags</h3>
        <div className="ci-toggle-list">
          <ModeToggle
            label="No External Messages (+n)"
            description="Only channel members can send messages"
            active={has('n')}
            onToggle={() => sendMode('n', !has('n'))}
          />
          <ModeToggle
            label="Topic Protected (+t)"
            description="Only ops can change the topic"
            active={has('t')}
            onToggle={() => sendMode('t', !has('t'))}
          />
          <ModeToggle
            label="Secret (+s)"
            description="Channel hidden from /LIST and /WHOIS"
            active={has('s')}
            onToggle={() => sendMode('s', !has('s'))}
          />
          <ModeToggle
            label="Invite Only (+i)"
            description="Users must be invited to join"
            active={has('i')}
            onToggle={() => sendMode('i', !has('i'))}
          />
          <ModeToggle
            label="Moderated (+m)"
            description="Only ops and voiced users can speak"
            active={has('m')}
            onToggle={() => sendMode('m', !has('m'))}
          />
          <ModeToggle
            label="Registered Only (+r)"
            description="Only identified users can join"
            active={has('r')}
            onToggle={() => sendMode('r', !has('r'))}
          />
        </div>
      </section>

      {/* +k channel key */}
      <section className="ci-section">
        <h3 className="ci-section-title">Channel Key (+k)</h3>
        <p className="ci-mode-toggle-desc" style={{ marginBottom: 8 }}>
          Require a password to join.
          {has('k') && <span style={{ marginLeft: 6, color: 'var(--accent)' }}>Key is set.</span>}
        </p>
        <div className="ci-mode-field-row">
          <input
            type="password"
            className="ci-mode-field-input"
            placeholder="Enter new key…"
            value={keyDraft}
            onChange={e => setKeyDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSetKey(); }}
            autoComplete="off"
          />
          <button className="ci-btn ci-btn--accent" onClick={handleSetKey} disabled={!keyDraft.trim()}>
            Set
          </button>
          {has('k') && (
            <button className="ci-btn ci-btn--ghost" onClick={handleClearKey}>
              Clear
            </button>
          )}
        </div>
      </section>

      {/* +l user limit */}
      <section className="ci-section">
        <h3 className="ci-section-title">User Limit (+l)</h3>
        <p className="ci-mode-toggle-desc" style={{ marginBottom: 8 }}>
          Limit the number of users who can join.
          {currentLimit > 0 && <span style={{ marginLeft: 6, color: 'var(--accent)' }}>Current: {currentLimit}</span>}
        </p>
        <div className="ci-mode-field-row">
          <input
            type="number"
            className="ci-mode-field-input"
            placeholder="e.g. 50"
            min={1}
            max={9999}
            value={limitDraft}
            onChange={e => setLimitDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSetLimit(); }}
          />
          <button className="ci-btn ci-btn--accent" onClick={handleSetLimit} disabled={!limitDraft.trim()}>
            Set
          </button>
          {currentLimit > 0 && (
            <button className="ci-btn ci-btn--ghost" onClick={handleClearLimit}>
              Remove
            </button>
          )}
        </div>
      </section>

      {/* SUIMYAKU Voice/Video Modes */}
      <section className="ci-section">
        <h3 className="ci-section-title">SUIMYAKU Media</h3>
        <div className="ci-toggle-list">
          <ModeToggle
            label="Voice Channel (+N)"
            description="Enable group voice transport via SUIMYAKU"
            active={has('N')}
            onToggle={() => sendMode('N', !has('N'))}
          />
          <ModeToggle
            label="Video Channel (+V)"
            description="Enable camera and screenshare via SUIMYAKU"
            active={has('V')}
            onToggle={() => sendMode('V', !has('V'))}
          />
        </div>
      </section>

      {/* Clone channel */}
      <section className="ci-section">
        <div className="ci-section-header">
          <h3 className="ci-section-title">Clone Channel</h3>
        </div>
        <p className="ci-mode-toggle-desc" style={{ marginBottom: 10 }}>
          Create a copy of this channel with the same topic.
          The new channel will be named <code style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{channelName}-copy</code>.
        </p>
        <button className="ci-btn ci-btn--ghost" onClick={handleCloneChannel} style={{ alignSelf: 'flex-start' }}>
          Clone Channel
        </button>
      </section>

      <style>{`
        .ci-mode-field-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .ci-mode-field-input {
          flex: 1;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-xs);
          color: var(--text-primary);
          font-size: 13px;
          font-family: inherit;
          padding: 6px 10px;
          outline: none;
          transition: border-color var(--t-fast);
        }
        .ci-mode-field-input:focus {
          border-color: var(--accent);
        }
        .ci-mode-field-input::-webkit-inner-spin-button,
        .ci-mode-field-input::-webkit-outer-spin-button {
          opacity: 0.5;
        }
        .ci-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

// ── Stats tab ─────────────────────────────────────────────────────────────────

function StatsTab({ stats }: { stats: ChannelStats }) {
  const currentHour = new Date().getHours();
  const maxHour = Math.max(...stats.byHour, 1);
  const topMax = stats.topPosters[0]?.[1] ?? 1;

  const hourLabel = (h: number) => {
    if (h === 0)  return '12am';
    if (h === 6)  return '6am';
    if (h === 12) return '12pm';
    if (h === 18) return '6pm';
    return '';
  };

  const formatHour = (h: number) => {
    if (h === 0)  return '12 AM';
    if (h === 12) return '12 PM';
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  };

  return (
    <div className="ci-tab-panel">

      {/* Quick stats grid */}
      <section className="ci-section">
        <h3 className="ci-section-title">Overview</h3>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-card-value">{stats.total}</div>
            <div className="stat-card-label">Total messages</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value">{stats.todayCount}</div>
            <div className="stat-card-label">Today</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value">{stats.todayUsers}</div>
            <div className="stat-card-label">Active today</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value">{stats.peakHour >= 0 && stats.total > 0 ? formatHour(stats.peakHour) : '—'}</div>
            <div className="stat-card-label">Peak hour</div>
          </div>
        </div>
      </section>

      {/* Top contributors */}
      <section className="ci-section">
        <h3 className="ci-section-title">Top Contributors</h3>
        {stats.topPosters.length === 0 ? (
          <p className="ci-placeholder" style={{ fontSize: '13px' }}>No messages yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {stats.topPosters.map(([nick, count]) => (
              <div key={nick} className="poster-bar-row">
                <span className="poster-name" title={nick}>{nick}</span>
                <div className="poster-bar-track">
                  <div
                    className="poster-bar-fill"
                    style={{ width: `${Math.round((count / topMax) * 100)}%` }}
                  />
                </div>
                <span className="poster-count">{count}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Activity by hour */}
      <section className="ci-section">
        <h3 className="ci-section-title">Activity by Hour</h3>
        <div className="hourly-chart">
          {stats.byHour.map((count, h) => {
            const height = maxHour > 0 ? Math.max(Math.round((count / maxHour) * 100), count > 0 ? 8 : 0) : 0;
            const isCurrent = h === currentHour;
            const isActive = count > 0;
            return (
              <div
                key={h}
                className={`hourly-bar${isCurrent ? ' current' : isActive ? ' active' : ''}`}
                style={{ height: `${Math.max(height, 2)}%` }}
                title={`${formatHour(h)}: ${count} msg${count !== 1 ? 's' : ''}`}
              />
            );
          })}
        </div>
        <div className="hourly-labels">
          {stats.byHour.map((_, h) => (
            <span key={h} style={{ flex: 1, textAlign: 'center' }}>{hourLabel(h)}</span>
          ))}
        </div>
      </section>

    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M2 2l10 10M12 2L2 12" />
  </svg>
);

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="6" cy="6" r="4" />
    <path d="M9 9l3 3" />
  </svg>
);

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = `
  .ci-layout {
    display: flex; flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  /* Banner */
  .ci-banner {
    position: relative;
    height: 160px;
    background: linear-gradient(135deg,
      var(--bg-void) 0%,
      color-mix(in srgb, var(--accent) 8%, var(--bg-deep)) 50%,
      color-mix(in srgb, var(--gold) 5%, var(--bg-deep)) 100%
    );
    flex-shrink: 0;
  }
  .ci-banner-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(to top, var(--bg-deep) 0%, rgba(0,0,0,0.1) 100%);
  }
  .ci-close {
    position: absolute; top: 12px; right: 12px;
    width: 30px; height: 30px;
    background: rgba(0,0,0,0.5);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: var(--r-full); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-secondary);
    transition: background var(--t-fast), color var(--t-fast);
    z-index: 2;
  }
  .ci-close:hover { background: rgba(0,0,0,0.8); color: var(--text-primary); }

  .ci-banner-content {
    position: absolute; bottom: 16px; left: 20px; right: 20px;
    z-index: 2; display: flex; flex-direction: column; gap: 6px;
  }
  .ci-sigil {
    font-size: 28px; font-weight: 700;
    color: var(--accent); line-height: 1;
    text-shadow: 0 0 20px var(--accent-glow);
  }
  .ci-channel-name {
    font-size: 22px; font-weight: 800; letter-spacing: -0.5px;
    color: var(--text-primary);
    text-shadow: 0 2px 8px rgba(0,0,0,0.5);
    margin: 0;
  }
  .ci-banner-meta {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  .ci-category-badge {
    display: inline-flex; align-items: center;
    padding: 2px 8px; border-radius: var(--r-full);
    background: var(--accent-subtle); border: 1px solid var(--accent-border);
    color: var(--accent); font-size: 11px; font-weight: 600;
    letter-spacing: 0.05em; text-transform: uppercase;
  }
  .ci-created-date {
    font-size: 11px; color: var(--text-muted);
  }

  /* Stats row */
  .ci-stats {
    display: flex; gap: 0;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
    background: var(--bg-elevated);
  }
  .ci-stat {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    padding: 10px 8px;
    border-right: 1px solid var(--border-subtle);
  }
  .ci-stat:last-child { border-right: none; }
  .ci-stat-value {
    font-size: 18px; font-weight: 800; color: var(--text-primary);
    line-height: 1.2; letter-spacing: -0.02em;
  }
  .ci-stat-label {
    font-size: 10px; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.07em; margin-top: 3px;
    font-weight: 600;
  }

  /* Tabs */
  .ci-tabs {
    display: flex; gap: 0;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
    padding: 0 4px;
  }
  .ci-tab {
    padding: 10px 14px;
    background: none; border: none; border-bottom: 2px solid transparent;
    color: var(--text-muted); font-size: 13px; font-weight: 500;
    cursor: pointer; font-family: inherit;
    transition: color var(--t-fast), border-color var(--t-fast);
    display: flex; align-items: center; gap: 5px;
    margin-bottom: -1px;
  }
  .ci-tab:hover { color: var(--text-secondary); }
  .ci-tab--active {
    color: var(--text-primary);
    border-bottom-color: var(--accent);
  }
  .ci-tab-badge {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 16px; height: 16px; padding: 0 4px;
    background: var(--accent-subtle); border: 1px solid var(--accent-border);
    color: var(--accent); font-size: 10px; font-weight: 700;
    border-radius: var(--r-full);
  }

  /* Body */
  .ci-body {
    flex: 1; overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--border-normal) transparent;
  }
  .ci-body::-webkit-scrollbar { width: 5px; }
  .ci-body::-webkit-scrollbar-track { background: transparent; }
  .ci-body::-webkit-scrollbar-thumb { background: var(--border-normal); border-radius: 3px; }

  .ci-tab-panel {
    padding: 20px; display: flex; flex-direction: column; gap: 22px;
  }

  /* Sections */
  .ci-section { display: flex; flex-direction: column; gap: 10px; }
  .ci-section-header {
    display: flex; align-items: center; justify-content: space-between;
  }
  .ci-section-title {
    font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--text-muted);
    margin: 0;
  }
  .ci-inline-action {
    font-size: 12px; font-weight: 600; color: var(--accent);
    background: none; border: none; cursor: pointer;
    padding: 2px 6px; border-radius: var(--r-xs);
    font-family: inherit;
    transition: background var(--t-fast);
  }
  .ci-inline-action:hover { background: var(--accent-subtle); }

  .ci-text {
    font-size: 14px; color: var(--text-secondary);
    line-height: 1.65; margin: 0;
  }
  .ci-placeholder { color: var(--text-muted); font-style: italic; }

  /* Topic edit */
  .ci-topic-edit { display: flex; flex-direction: column; gap: 8px; }
  .ci-topic-input {
    width: 100%; background: var(--bg-elevated);
    border: 1px solid var(--accent-border); border-radius: var(--r-sm);
    color: var(--text-primary); font-size: 14px; line-height: 1.55;
    padding: 8px 10px; resize: none; outline: none;
    font-family: inherit; box-sizing: border-box;
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .ci-topic-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(14,165,233,0.18);
  }
  .ci-topic-edit-actions {
    display: flex; align-items: center; gap: 8px;
  }
  .ci-topic-char-hint {
    font-size: 11px; color: var(--text-muted); flex: 1;
  }

  /* Shared buttons */
  .ci-btn {
    font-size: 13px; font-weight: 600; padding: 5px 14px;
    border-radius: var(--r-xs); border: 1px solid transparent;
    cursor: pointer; font-family: inherit;
    transition: opacity var(--t-fast), background var(--t-fast);
  }
  .ci-btn--ghost {
    background: var(--bg-elevated); border-color: var(--border-normal);
    color: var(--text-secondary);
  }
  .ci-btn--ghost:hover { opacity: 0.85; }
  .ci-btn--accent {
    background: var(--accent); color: #fff;
  }
  .ci-btn--accent:hover { opacity: 0.88; }

  /* Rules */
  .ci-rules {
    display: flex; flex-direction: column; gap: 6px;
    list-style: none; padding: 0; margin: 0;
  }
  .ci-rule-item {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 9px 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    font-size: 13px; color: var(--text-secondary); line-height: 1.5;
  }
  .ci-rule-num {
    flex-shrink: 0; width: 20px; height: 20px;
    background: var(--accent-subtle); border: 1px solid var(--accent-border);
    color: var(--accent); font-size: 11px; font-weight: 700;
    border-radius: var(--r-full);
    display: flex; align-items: center; justify-content: center;
    margin-top: 1px;
  }

  /* Mode badges */
  .ci-modes { display: flex; flex-wrap: wrap; gap: 6px; }
  .ci-mode-badge {
    padding: 3px 10px; border-radius: var(--r-full);
    background: var(--bg-overlay); border: 1px solid var(--border-normal);
    color: var(--text-secondary); font-size: 11px; font-weight: 600;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    letter-spacing: 0.01em;
    transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
  }
  .ci-mode-badge:hover {
    background: var(--accent-subtle);
    border-color: var(--accent-border);
    color: var(--accent);
  }

  /* Search */
  .ci-search-wrap {
    position: relative; display: flex; align-items: center;
    background: var(--bg-elevated);
    border: 1px solid var(--border-normal); border-radius: var(--r-md);
    padding: 0 10px; gap: 8px;
  }
  .ci-search-wrap svg { color: var(--text-muted); flex-shrink: 0; }
  .ci-search-input {
    flex: 1; background: none; border: none; outline: none;
    color: var(--text-primary); font-size: 13px; font-family: inherit;
    padding: 9px 0;
  }
  .ci-search-input::placeholder { color: var(--text-muted); }
  .ci-search-clear {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); display: flex; align-items: center;
    padding: 0; transition: color var(--t-fast);
  }
  .ci-search-clear:hover { color: var(--text-primary); }

  /* Member list */
  .ci-member-list {
    display: flex; flex-direction: column; gap: 2px;
  }
  .ci-member-row {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 8px; border-radius: var(--r-sm);
    background: none; border: none; cursor: pointer;
    width: 100%; text-align: left; font-family: inherit;
    transition: background var(--t-fast);
  }
  .ci-member-row:hover { background: var(--bg-elevated); }
  .ci-member-avatar {
    width: 30px; height: 30px; border-radius: var(--r-full);
    background: var(--bg-overlay); border: 1px solid var(--border-subtle);
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700; color: var(--text-secondary);
    flex-shrink: 0;
  }
  .ci-member-nick {
    font-size: 14px; font-weight: 500; color: var(--text-primary);
    flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .ci-member-badges {
    display: flex; gap: 4px; align-items: center; flex-shrink: 0;
  }

  /* Badges */
  .ci-badge {
    font-size: 10px; font-weight: 700; letter-spacing: 0.04em;
    padding: 1px 6px; border-radius: var(--r-full);
    text-transform: uppercase;
  }
  .ci-badge--owner { background: rgba(232,184,75,0.15); color: var(--gold); border: 1px solid rgba(232,184,75,0.3); }
  .ci-badge--op    { background: rgba(124,90,245,0.15); color: var(--accent); border: 1px solid rgba(124,90,245,0.3); }
  .ci-badge--voice { background: rgba(34,197,94,0.12); color: #22c55e; border: 1px solid rgba(34,197,94,0.25); }
  .ci-badge--bot   { background: rgba(14,165,233,0.1); color: var(--accent); border: 1px solid var(--accent-border); }
  .ci-badge--away  { background: var(--bg-overlay); color: var(--text-muted); border: 1px solid var(--border-subtle); }

  /* Pinned messages */
  .ci-pin-list { display: flex; flex-direction: column; gap: 8px; }
  .ci-pin-card {
    padding: 10px 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--gold);
    border-radius: var(--r-md);
    display: flex; flex-direction: column; gap: 5px;
  }
  .ci-pin-meta {
    display: flex; align-items: center; gap: 8px;
  }
  .ci-pin-nick {
    font-size: 13px; font-weight: 700; color: var(--gold);
  }
  .ci-pin-time {
    font-size: 11px; color: var(--text-muted);
  }
  .ci-pin-text {
    font-size: 13px; color: var(--text-secondary);
    line-height: 1.5; margin: 0;
    white-space: pre-wrap; word-break: break-word;
  }

  /* Settings toggles */
  .ci-toggle-list { display: flex; flex-direction: column; gap: 0; }
  .ci-mode-toggle {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .ci-mode-toggle:last-child { border-bottom: none; }
  .ci-mode-toggle-info {
    flex: 1; display: flex; flex-direction: column; gap: 2px;
  }
  .ci-mode-toggle-label {
    font-size: 13px; font-weight: 600; color: var(--text-primary);
  }
  .ci-mode-toggle-desc {
    font-size: 12px; color: var(--text-muted);
  }
  .ci-toggle {
    position: relative; flex-shrink: 0;
    width: 36px; height: 20px;
    background: var(--bg-overlay); border: 1px solid var(--border-normal);
    border-radius: var(--r-full); cursor: pointer;
    transition: background var(--t-fast), border-color var(--t-fast);
  }
  .ci-toggle--on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .ci-toggle-thumb {
    position: absolute; top: 2px; left: 2px;
    width: 14px; height: 14px;
    background: var(--text-muted); border-radius: var(--r-full);
    transition: transform var(--t-fast), background var(--t-fast);
  }
  .ci-toggle--on .ci-toggle-thumb {
    transform: translateX(16px);
    background: #fff;
  }

  /* Empty state */
  .ci-empty {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    padding: 32px 0; color: var(--text-muted); font-size: 14px;
  }
  .ci-empty-icon { font-size: 32px; }

  /* Stats tab */
  .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .stat-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 10px 14px;
    text-align: center;
  }
  .stat-card-value { font-size: 22px; font-weight: 700; color: var(--text-primary); line-height: 1.2; }
  .stat-card-label { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

  .poster-bar-row { display: flex; align-items: center; gap: 8px; }
  .poster-name {
    font-size: 12px; color: var(--text-secondary);
    width: 80px; flex-shrink: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .poster-bar-track { flex: 1; height: 8px; background: var(--bg-elevated); border-radius: 4px; overflow: hidden; }
  .poster-bar-fill { height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.5s ease; }
  .poster-count { font-size: 11px; color: var(--text-muted); width: 36px; text-align: right; flex-shrink: 0; }

  .hourly-chart {
    display: flex;
    align-items: flex-end;
    gap: 1px;
    height: 40px;
    padding: 4px 0;
  }
  .hourly-bar {
    flex: 1;
    border-radius: 2px 2px 0 0;
    background: var(--bg-elevated);
    transition: background 0.2s;
    min-height: 2px;
    height: 2%;
  }
  .hourly-bar.current { background: var(--accent); }
  .hourly-bar.active { background: var(--border-normal); }
  .hourly-labels {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: var(--text-muted);
    margin-top: 3px;
  }

  /* Footer */
  .ci-footer {
    padding: 14px 20px;
    border-top: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .ci-leave-btn {
    width: 100%; padding: 10px;
    background: none;
    border: 1px solid rgba(239,68,68,0.3);
    border-radius: var(--r-md);
    color: var(--danger, #ef4444); font-size: 14px; font-weight: 500;
    cursor: pointer; font-family: inherit;
    transition: background var(--t-fast), border-color var(--t-fast);
  }
  .ci-leave-btn:hover {
    background: var(--danger-subtle, rgba(239,68,68,0.08));
    border-color: rgba(239,68,68,0.5);
  }
`;
