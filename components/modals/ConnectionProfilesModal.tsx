'use client';

import { useState, useEffect } from 'react';
import { useOnyxStore } from '@/lib/store';
import { saveCredentials } from '@/lib/credentials';
import ModalShell from './ModalShell';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  nick: string;
  password?: string;
  channels: string[];
  tls: boolean;
  createdAt: string;
}

// ── Persistence helpers ────────────────────────────────────────────────────────

const PROFILES_KEY = 'ocean-connection-profiles';

function getDefaultProfiles(): ConnectionProfile[] {
  return [{
    id: 'default',
    name: 'Ocean (Default)',
    host: typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_IRC_HOST ?? window.location.hostname)
      : 'localhost',
    port: 6697,
    nick: '',
    channels: [],
    tls: true,
    createdAt: new Date().toISOString(),
  }];
}

function loadProfiles(): ConnectionProfile[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    return raw ? (JSON.parse(raw) as ConnectionProfile[]) : getDefaultProfiles();
  } catch {
    return getDefaultProfiles();
  }
}

function saveProfiles(profiles: ConnectionProfile[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {}
}

function generateId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── Empty profile factory ──────────────────────────────────────────────────────

function newProfile(): ConnectionProfile {
  return {
    id: generateId(),
    name: 'New Profile',
    host: '',
    port: 6697,
    nick: '',
    password: '',
    channels: [],
    tls: true,
    createdAt: new Date().toISOString(),
  };
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ConnectionProfilesModal() {
  const closeConnectionProfiles = useOnyxStore(s => s.closeConnectionProfiles);
  const connect                 = useOnyxStore(s => s.connect);
  const connectionStatus        = useOnyxStore(s => s.connectionStatus);
  const ourNick                 = useOnyxStore(s => s.ourNick);

  const [profiles, setProfiles] = useState<ConnectionProfile[]>(() => loadProfiles());
  const [activeId, setActiveId] = useState<string>(() => {
    const loaded = loadProfiles();
    return loaded[0]?.id ?? 'default';
  });
  const [draft, setDraft] = useState<ConnectionProfile | null>(null);

  // Sync draft whenever active profile changes
  useEffect(() => {
    const found = profiles.find(p => p.id === activeId);
    setDraft(found ? { ...found } : null);
  }, [activeId, profiles]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleSelectProfile(id: string) {
    setActiveId(id);
  }

  function handleNewProfile() {
    const p = newProfile();
    const next = [...profiles, p];
    setProfiles(next);
    saveProfiles(next);
    setActiveId(p.id);
  }

  function handleDeleteProfile(id: string) {
    const next = profiles.filter(p => p.id !== id);
    if (next.length === 0) {
      const fallback = getDefaultProfiles();
      setProfiles(fallback);
      saveProfiles(fallback);
      setActiveId(fallback[0].id);
    } else {
      setProfiles(next);
      saveProfiles(next);
      if (activeId === id) setActiveId(next[0].id);
    }
  }

  function handleSave() {
    if (!draft) return;
    const next = profiles.map(p => p.id === draft.id ? { ...draft } : p);
    setProfiles(next);
    saveProfiles(next);
  }

  function handleConnect() {
    if (!draft) return;
    // Save draft first
    const saved = profiles.map(p => p.id === draft.id ? { ...draft } : p);
    setProfiles(saved);
    saveProfiles(saved);

    // Build WS URL from profile
    const scheme = draft.tls ? 'wss' : 'ws';
    const wsUrl = `${scheme}://${draft.host}:${draft.port}`;
    const nick = draft.nick || ourNick || 'OceanUser';

    if (draft.password) {
      saveCredentials({
        nick,
        server: wsUrl,
        password: draft.password,
      });
    }

    // Connect (re-uses existing connect action which handles disconnect + reconnect)
    connect({
      url: wsUrl,
      nick,
      password: draft.password || undefined,
    });

    // Auto-join channels stored in profile once connected
    if (draft.channels.length > 0) {
      const joinChannels = draft.channels;
      const unsub = useOnyxStore.subscribe(
        s => s.connectionStatus,
        status => {
          if (status === 'connected') {
            joinChannels.forEach(ch => {
              useOnyxStore.getState().joinChannel(ch);
            });
            unsub();
          }
        },
      );
    }

    closeConnectionProfiles();
  }

  function patchDraft(partial: Partial<ConnectionProfile>) {
    setDraft(prev => prev ? { ...prev, ...partial } : prev);
  }

  function handleChannelsText(text: string) {
    const channels = text
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    patchDraft({ channels });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ModalShell
      onClose={closeConnectionProfiles}
      title="Connection Profiles"
      kicker="Network"
      titleId="conn-modal-title"
      size="md"
      flushBody
      footer={
        <>
          <button className="conn-btn-secondary" onClick={closeConnectionProfiles}>
            Cancel
          </button>
          <button className="conn-btn-secondary" onClick={handleSave}>
            Save
          </button>
          <button
            className="conn-btn-primary"
            onClick={handleConnect}
            disabled={!draft?.host || !draft?.nick}
            style={{ opacity: (!draft?.host || !draft?.nick) ? 0.5 : 1 }}
          >
            {connectionStatus === 'connected' ? 'Reconnect' : 'Connect'}
          </button>
        </>
      }
    >
      <div className="conn-body">

        {/* Sidebar: profile list */}
        <div className="conn-sidebar">
          {profiles.map(p => (
            <div
              key={p.id}
              className={`conn-profile-item ${p.id === activeId ? 'active' : ''}`}
              onClick={() => handleSelectProfile(p.id)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && handleSelectProfile(p.id)}
              aria-pressed={p.id === activeId}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name || 'Unnamed'}
              </span>
              {profiles.length > 1 && (
                <button
                  className="conn-profile-del"
                  onClick={e => { e.stopPropagation(); handleDeleteProfile(p.id); }}
                  aria-label={`Delete profile ${p.name}`}
                  title="Delete"
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          <button className="conn-new-btn" onClick={handleNewProfile}>
            <span>＋</span> New Profile
          </button>
        </div>

        {/* Editor */}
        {draft && (
          <div className="conn-editor">

            <div className="conn-field">
              <label className="label-caps conn-label" htmlFor="cp-name">Profile Name</label>
              <input
                id="cp-name"
                className="conn-input"
                value={draft.name}
                onChange={e => patchDraft({ name: e.target.value })}
                placeholder="My IRC Server"
              />
            </div>

            <div className="conn-field">
              <label className="label-caps conn-label" htmlFor="cp-host">Server Host</label>
              <input
                id="cp-host"
                className="conn-input"
                value={draft.host}
                onChange={e => patchDraft({ host: e.target.value })}
                placeholder="irc.server.net"
              />
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <div className="conn-field" style={{ flex: '1 0 80px' }}>
                <label className="label-caps conn-label" htmlFor="cp-port">Port</label>
                <input
                  id="cp-port"
                  className="conn-input"
                  type="number"
                  min={1}
                  max={65535}
                  value={draft.port}
                  onChange={e => patchDraft({ port: parseInt(e.target.value, 10) || 6697 })}
                />
              </div>

              <div className="conn-field" style={{ flex: '1', justifyContent: 'flex-end', paddingTop: '4px' }}>
                <label className="label-caps conn-label">TLS</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '4px' }}>
                  <button
                    role="switch"
                    aria-checked={draft.tls}
                    className={`conn-toggle ${draft.tls ? 'conn-toggle--on' : ''}`}
                    onClick={() => patchDraft({ tls: !draft.tls })}
                  >
                    <span className="conn-toggle-thumb" />
                  </button>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {draft.tls ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>
            </div>

            <div className="conn-field">
              <label className="label-caps conn-label" htmlFor="cp-nick">Nickname</label>
              <input
                id="cp-nick"
                className="conn-input"
                value={draft.nick}
                onChange={e => patchDraft({ nick: e.target.value })}
                placeholder="YourNick"
              />
            </div>

            <div className="conn-field">
              <label className="label-caps conn-label" htmlFor="cp-pass">
                Password <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: '11px', color: 'var(--text-muted)' }}>(optional)</span>
              </label>
              <input
                id="cp-pass"
                className="conn-input"
                type="password"
                value={draft.password ?? ''}
                onChange={e => patchDraft({ password: e.target.value })}
                placeholder="NickServ password"
                autoComplete="new-password"
              />
            </div>

            <div className="conn-field">
              <label className="label-caps conn-label" htmlFor="cp-channels">
                Auto-join Channels <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: '11px', color: 'var(--text-muted)' }}>(one per line)</span>
              </label>
              <textarea
                id="cp-channels"
                className="conn-input"
                rows={3}
                value={draft.channels.join('\n')}
                onChange={e => handleChannelsText(e.target.value)}
                placeholder={'#general\n#help'}
                style={{ resize: 'vertical', minHeight: '72px' }}
              />
            </div>

          </div>
        )}

      </div>

      <style>{`
        .conn-body { display: flex; flex: 1; overflow: hidden; min-height: 380px; }
        .conn-sidebar { width: 188px; border-right: 1px solid var(--border-subtle); padding: 10px 8px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; flex-shrink: 0; }
        .conn-profile-item { position: relative; padding: 9px 10px 9px 14px; border-radius: var(--r-sm); cursor: pointer; display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: var(--text-sm, 13px); font-weight: 500; border: 1px solid transparent; transition: background var(--t-control, 150ms), color var(--t-control, 150ms), border-color var(--t-control, 150ms); }
        .conn-profile-item:hover { background: var(--elev-tint-1, var(--bg-elevated)); color: var(--text-primary); }
        .conn-profile-item.active { background: var(--elev-tint-2, var(--accent-subtle)); color: var(--text-primary); border-color: var(--border-subtle); font-weight: 600; }
        .conn-profile-item.active::before { content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 3px; height: 14px; border-radius: 2px; background: var(--lux, var(--accent)); }
        .conn-profile-del { margin-left: auto; width: 20px; height: 20px; border-radius: 50%; border: none; background: none; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 11px; transition: background var(--t-control, 150ms), color var(--t-control, 150ms); flex-shrink: 0; }
        .conn-profile-del:hover { background: var(--danger-subtle); color: var(--danger); }
        .conn-editor { flex: 1; padding: var(--sp-4, 16px) var(--sp-5, 20px); overflow-y: auto; display: flex; flex-direction: column; gap: var(--sp-4, 16px); }
        .conn-field { display: flex; flex-direction: column; gap: 5px; }
        .conn-input { background: var(--bg-elevated); border: 1px solid var(--border-normal); border-radius: var(--r-sm); padding: 8px 12px; color: var(--text-primary); font-size: var(--text-sm, 13px); font-family: inherit; outline: none; transition: border-color var(--t-control, 150ms), background var(--t-control, 150ms); }
        .conn-input:focus { border-color: var(--accent-border); background: var(--bg-float); }
        .conn-input::placeholder { color: var(--text-muted); }
        .conn-btn-primary { padding: 8px 20px; border-radius: var(--r-sm); border: none; background: var(--accent); color: white; cursor: pointer; font-size: var(--text-sm, 13px); font-weight: 600; font-family: inherit; transition: background var(--t-control, 150ms), opacity var(--t-control, 150ms); }
        .conn-btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
        .conn-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
        .conn-btn-secondary { padding: 8px 16px; border-radius: var(--r-sm); border: 1px solid var(--border-normal); background: none; color: var(--text-secondary); cursor: pointer; font-size: var(--text-sm, 13px); font-family: inherit; transition: background var(--t-control, 150ms), color var(--t-control, 150ms); }
        .conn-btn-secondary:hover { background: var(--bg-overlay); color: var(--text-primary); }
        .conn-new-btn { padding: 8px 10px; border-radius: var(--r-sm); border: 1px dashed var(--border-normal); background: none; color: var(--text-muted); cursor: pointer; font-size: var(--text-xs, 12px); font-family: inherit; display: flex; align-items: center; gap: 6px; margin-top: auto; transition: border-color var(--t-control, 150ms), color var(--t-control, 150ms), background var(--t-control, 150ms); }
        .conn-new-btn:hover { border-color: var(--accent-border); color: var(--accent); background: var(--accent-subtle); }
        .conn-toggle { position: relative; width: 36px; height: 20px; border-radius: 10px; border: none; background: var(--border-normal); cursor: pointer; transition: background var(--t-control, 150ms); padding: 0; flex-shrink: 0; }
        .conn-toggle--on { background: var(--accent); }
        .conn-toggle-thumb { position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: white; transition: transform var(--t-control, 150ms); display: block; }
        .conn-toggle--on .conn-toggle-thumb { transform: translateX(16px); }
      `}</style>
    </ModalShell>
  );
}
