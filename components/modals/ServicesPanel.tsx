'use client';

/**
 * ServicesPanel — built-in account & channel management
 *
 * Tabs 1-4 (Account / Channels / Memos / VHost) use native IRC commands
 * directly to the server (no bot intermediary).
 *
 * Tabs 5-8 (NickServ / ChanServ / HostServ / MemoServ) use PRIVMSG to
 * service bots for servers that run them.
 * Replies are captured via serviceNotices in the store.
 *
 *   Native: IDENTIFY, REGISTER, SETPASS, SETEMAIL, SET, DROP,
 *           GROUP, UNGROUP, LISTGROUPS, ACCESS, CERT, SENDPASS,
 *           REGISTER #chan, CHANSET #chan option value, ACCESS #chan,
 *           MEMO SEND|LIST|READ|DEL|FORWARD,
 *           VHOST REQUEST|TAKE|OFF, VHOFFERLIST
 *
 *   Bot:    PRIVMSG NickServ :INFO|GHOST|RELEASE
 *           PRIVMSG ChanServ :INFO|SET
 *           PRIVMSG HostServ :REQUEST
 *           PRIVMSG MemoServ :SEND|LIST|READ|DEL
 */

import { useState, useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReplyLine {
  id: string;
  text: string;
  ts: Date;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ServicesPanel() {
  const closeServices    = useOnyxStore(s => s.closeServices);
  const servicesTab      = useOnyxStore(s => s.servicesTab);
  const openServices     = useOnyxStore(s => s.openServices);
  const client           = useOnyxStore(s => s.client);
  const server           = useOnyxStore(s => s.server);
  const channels         = useOnyxStore(s => s.channels);
  const ourNick          = useOnyxStore(s => s.ourNick);
  const serviceNotices   = useOnyxStore(s => s.serviceNotices);
  const clearServiceNotices = useOnyxStore(s => s.clearServiceNotices);

  const account = server?.account ?? null;

  // ── Capture server reply NOTICEs (native commands) ───────────────────────
  const [replies, setReplies] = useState<ReplyLine[]>([]);
  const replyBodyRef   = useRef<HTMLDivElement>(null);
  const svcNoticeRef   = useRef<HTMLDivElement>(null);
  const seenIds        = useRef<Set<string>>(new Set());

  // Subscribe to ALL dms changes — server replies arrive as NOTICEs
  useEffect(() => {
    const unsub = useOnyxStore.subscribe(
      s => s.dms,
      (dms) => {
        dms.forEach((conv) => {
          const last = conv.messages[conv.messages.length - 1];
          if (!last || seenIds.current.has(last.id)) return;
          if (!conv.nick?.startsWith('#') && !conv.nick?.startsWith('&')) {
            seenIds.current.add(last.id);
            setReplies(prev => {
              const next = [...prev, { id: last.id, text: last.text, ts: last.time as Date }];
              return next.slice(-20);
            });
          }
        });
      },
    );
    return unsub;
  }, []);

  // Auto-scroll reply log
  useEffect(() => {
    if (replyBodyRef.current) {
      replyBodyRef.current.scrollTop = replyBodyRef.current.scrollHeight;
    }
  }, [replies]);

  // Auto-scroll service notices log
  useEffect(() => {
    if (svcNoticeRef.current) {
      svcNoticeRef.current.scrollTop = svcNoticeRef.current.scrollHeight;
    }
  }, [serviceNotices]);

  // Escape closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeServices();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closeServices]);

  // ── Send raw IRC command directly to server ─────────────────────────────
  const send = (command: string, ...params: string[]) => {
    client?.sendRaw(command, ...params);
  };

  // ── Send PRIVMSG to a service bot ───────────────────────────────────────
  // formatIRCLine auto-prefixes the trailing param with ':' when needed
  const sendToBot = (bot: string, command: string) => {
    client?.sendRaw('PRIVMSG', bot, command);
  };

  // ── Clear reply log ────────────────────────────────────────────────────
  const clearReplies = () => {
    setReplies([]);
    seenIds.current.clear();
  };

  const isBotTab = servicesTab === 'nickserv' || servicesTab === 'chanserv'
    || servicesTab === 'hostserv' || servicesTab === 'memoserv';

  // Filter service notices to those relevant to the active bot tab
  const tabBotMap: Record<string, string> = {
    nickserv: 'NickServ',
    chanserv: 'ChanServ',
    hostserv: 'HostServ',
    memoserv: 'MemoServ',
  };
  const activeBot = tabBotMap[servicesTab];
  const filteredNotices = activeBot
    ? serviceNotices.filter(n => n.source.toLowerCase() === activeBot.toLowerCase())
    : serviceNotices;

  type TabId = typeof servicesTab;

  const tabs: { id: TabId; label: string }[] = [
    { id: 'account',  label: 'Account' },
    { id: 'channel',  label: 'Channels' },
    { id: 'memos',    label: 'Memos' },
    { id: 'vhost',    label: 'VHost' },
    { id: 'nickserv', label: 'NickServ' },
    { id: 'chanserv', label: 'ChanServ' },
    { id: 'hostserv', label: 'HostServ' },
    { id: 'memoserv', label: 'MemoServ' },
  ];

  return (
    <div
      className="svc-backdrop"
      onClick={e => { if (e.target === e.currentTarget) closeServices(); }}
      aria-modal="true"
      role="dialog"
      aria-label="Account Services"
    >
      <div className="svc-panel animate-slide-right">

        {/* Header */}
        <div className="svc-header">
          <div className="svc-header-left">
            <ShieldIcon />
            <div>
              <h2 className="svc-title">Account Services</h2>
              <p className="svc-subtitle">
                {isBotTab ? 'Service bot commands via PRIVMSG' : 'Native server commands'}
              </p>
            </div>
          </div>
          <button
            className="svc-close"
            onClick={closeServices}
            aria-label="Close services panel"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Tab bar — two rows */}
        <div className="svc-tabs-wrap" role="tablist">
          <div className="svc-tabs svc-tabs--row">
            {tabs.slice(0, 4).map(t => (
              <button
                key={t.id}
                className={`svc-tab ${servicesTab === t.id ? 'svc-tab--active' : ''}`}
                role="tab"
                aria-selected={servicesTab === t.id}
                onClick={() => openServices(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="svc-tabs svc-tabs--row svc-tabs--bot">
            {tabs.slice(4).map(t => (
              <button
                key={t.id}
                className={`svc-tab svc-tab--bot ${servicesTab === t.id ? 'svc-tab--active' : ''}`}
                role="tab"
                aria-selected={servicesTab === t.id}
                onClick={() => openServices(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="svc-body">
          {servicesTab === 'account' && (
            <AccountTab account={account} ourNick={ourNick} send={send} />
          )}
          {servicesTab === 'channel' && (
            <ChannelTab channels={channels} ourNick={ourNick} send={send} />
          )}
          {servicesTab === 'memos' && (
            <MemosTab account={account} send={send} />
          )}
          {servicesTab === 'vhost' && (
            <VHostTab send={send} />
          )}
          {servicesTab === 'nickserv' && (
            <NickServTab ourNick={ourNick} sendToBot={sendToBot} />
          )}
          {servicesTab === 'chanserv' && (
            <ChanServTab channels={channels} sendToBot={sendToBot} />
          )}
          {servicesTab === 'hostserv' && (
            <HostServTab sendToBot={sendToBot} />
          )}
          {servicesTab === 'memoserv' && (
            <MemoServTab sendToBot={sendToBot} />
          )}
        </div>

        {/* Footer reply log — native tabs use dms, bot tabs use serviceNotices */}
        {!isBotTab ? (
          <div className="svc-reply-section">
            <div className="svc-reply-header">
              <span className="svc-section-label">Server Replies</span>
              {replies.length > 0 && (
                <button className="svc-clear-btn" onClick={clearReplies}>Clear</button>
              )}
            </div>
            <div className="svc-reply-log" ref={replyBodyRef}>
              {replies.length === 0 ? (
                <span className="svc-reply-empty">
                  Responses to commands appear here
                </span>
              ) : (
                replies.map(r => (
                  <div key={r.id} className="svc-reply-line">
                    <span className="svc-reply-time">
                      {r.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="svc-reply-text">{r.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="svc-reply-section">
            <div className="svc-reply-header">
              <span className="svc-section-label">{activeBot} Replies</span>
              {filteredNotices.length > 0 && (
                <button className="svc-clear-btn" onClick={clearServiceNotices}>Clear</button>
              )}
            </div>
            <div className="svc-reply-log" ref={svcNoticeRef}>
              {filteredNotices.length === 0 ? (
                <span className="svc-reply-empty">
                  {activeBot} responses appear here
                </span>
              ) : (
                filteredNotices.map((n, i) => (
                  <div key={i} className="svc-reply-line">
                    <span className="svc-reply-time">
                      {n.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="svc-reply-source">{n.source}</span>
                    <span className="svc-reply-text">{n.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

      </div>

      <style>{`
        .svc-backdrop {
          position: fixed; inset: 0; z-index: 615;
          display: flex; align-items: stretch; justify-content: flex-end;
        }

        .svc-panel {
          width: 340px; max-width: 95vw;
          background: var(--bg-deep);
          border-left: 1px solid var(--border-normal);
          display: flex; flex-direction: column;
          overflow: hidden;
          box-shadow: -8px 0 40px rgba(0, 0, 0, 0.45);
        }

        /* Header */
        .svc-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 16px;
          height: 56px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          gap: 12px;
        }
        .svc-header-left {
          display: flex; align-items: center; gap: 10px; min-width: 0;
        }
        .svc-title {
          font-size: 14px; font-weight: 700; color: var(--text-primary);
          line-height: 1.2;
        }
        .svc-subtitle {
          font-size: 10px; color: var(--text-muted);
          margin: 0; line-height: 1;
        }
        .svc-close {
          width: 28px; height: 28px; flex-shrink: 0;
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); border-radius: var(--r-xs);
          transition: background var(--t-fast), color var(--t-fast);
        }
        .svc-close:hover { background: var(--ch-hover-bg); color: var(--text-primary); }

        /* Tabs */
        .svc-tabs-wrap {
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .svc-tabs {
          display: flex;
          padding: 0 12px;
          gap: 2px;
        }
        .svc-tabs--bot {
          border-top: 1px solid var(--border-subtle);
          padding-top: 2px;
        }
        .svc-tab {
          padding: 7px 9px;
          font-size: 11px; font-weight: 600;
          color: var(--text-muted);
          background: none; border: none; cursor: pointer;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          transition: color var(--t-fast), border-color var(--t-fast);
          white-space: nowrap;
        }
        .svc-tab:hover { color: var(--text-primary); }
        .svc-tab--active {
          color: var(--accent);
          border-bottom-color: var(--accent);
        }
        .svc-tab--bot {
          font-size: 10px;
          color: var(--text-muted);
          opacity: 0.8;
        }
        .svc-tab--bot:hover { opacity: 1; }
        .svc-tab--bot.svc-tab--active {
          opacity: 1;
          color: var(--gold, #e8b84b);
          border-bottom-color: var(--gold, #e8b84b);
        }

        /* Body */
        .svc-body {
          flex: 1; overflow-y: auto;
          display: flex; flex-direction: column;
          padding: 14px 14px;
          gap: 18px;
          min-height: 0;
        }

        /* Section */
        .svc-section {
          display: flex; flex-direction: column; gap: 8px;
        }
        .svc-section-label {
          font-size: 10px; font-weight: 700;
          letter-spacing: 0.07em; text-transform: uppercase;
          color: var(--text-muted);
          padding: 0 2px;
        }

        /* Status row */
        .svc-status-row {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          font-size: 13px;
        }
        .svc-status-badge {
          font-size: 10px; font-weight: 700;
          padding: 2px 6px; border-radius: var(--r-full);
          flex-shrink: 0;
        }
        .svc-badge--ok {
          background: oklch(30% 0.1 150 / 0.25);
          color: oklch(65% 0.18 150);
          border: 1px solid oklch(65% 0.18 150 / 0.4);
        }
        .svc-badge--none {
          background: oklch(30% 0.15 15 / 0.2);
          color: oklch(65% 0.2 15);
          border: 1px solid oklch(65% 0.2 15 / 0.4);
        }
        .svc-status-text {
          color: var(--text-secondary);
          flex: 1; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
          font-size: 12px;
        }

        /* Form */
        .svc-form-row {
          display: flex; flex-direction: column; gap: 4px;
        }
        .svc-form-label {
          font-size: 10px; font-weight: 600;
          color: var(--text-muted); padding: 0 2px;
          letter-spacing: 0.04em;
        }
        .svc-form-inline {
          display: flex; gap: 6px; align-items: center;
        }
        .svc-input {
          flex: 1;
          background: var(--bg-base);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          padding: 6px 9px;
          font-size: 12px;
          color: var(--text-primary);
          font-family: inherit;
          min-width: 0;
          transition: border-color var(--t-fast), box-shadow var(--t-fast);
        }
        .svc-input:focus {
          outline: none;
          border-color: var(--accent-border, oklch(65% 0.24 255 / 0.5));
          box-shadow: 0 0 0 2px var(--accent-subtle, oklch(65% 0.24 255 / 0.1));
        }
        .svc-input::placeholder { color: var(--text-muted); }

        /* Buttons */
        .svc-btn {
          padding: 5px 10px;
          font-size: 12px; font-weight: 600;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          color: var(--text-primary);
          cursor: pointer;
          white-space: nowrap;
          transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
        }
        .svc-btn:hover {
          background: var(--accent-subtle, oklch(65% 0.24 255 / 0.15));
          border-color: var(--accent-border, oklch(65% 0.24 255 / 0.5));
          color: var(--accent);
        }
        .svc-btn--accent {
          background: var(--accent);
          border-color: var(--accent);
          color: #fff;
        }
        .svc-btn--accent:hover {
          opacity: 0.88;
        }
        .svc-btn--gold {
          background: oklch(40% 0.12 70 / 0.3);
          border-color: oklch(70% 0.18 70 / 0.6);
          color: var(--gold, #e8b84b);
        }
        .svc-btn--gold:hover {
          background: oklch(70% 0.18 70 / 0.2);
          border-color: var(--gold, #e8b84b);
        }
        .svc-btn--sm {
          padding: 3px 8px;
          font-size: 11px;
        }
        .svc-btn--danger {
          background: oklch(30% 0.15 15 / 0.2);
          border-color: oklch(65% 0.25 15 / 0.5);
          color: oklch(70% 0.2 15);
        }
        .svc-btn--danger:hover {
          background: oklch(65% 0.25 15);
          border-color: oklch(65% 0.25 15);
          color: #fff;
        }
        .svc-btn:disabled {
          opacity: 0.4; cursor: not-allowed;
        }

        /* Toggle row */
        .svc-toggle-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 7px 10px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          gap: 12px;
        }
        .svc-toggle-info { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
        .svc-toggle-name { font-size: 12px; font-weight: 600; color: var(--text-primary); }
        .svc-toggle-desc { font-size: 10px; color: var(--text-muted); }
        .svc-toggle {
          position: relative; width: 32px; height: 18px; flex-shrink: 0;
          background: var(--border-normal);
          border-radius: var(--r-full);
          border: none; cursor: pointer;
          transition: background var(--t-fast);
        }
        .svc-toggle::after {
          content: ''; position: absolute;
          top: 2px; left: 2px;
          width: 14px; height: 14px;
          background: #fff; border-radius: 50%;
          transition: transform var(--t-fast);
        }
        .svc-toggle--on { background: var(--accent); }
        .svc-toggle--on::after { transform: translateX(14px); }

        /* Channel list */
        .svc-ch-list { display: flex; flex-direction: column; gap: 4px; }
        .svc-ch-row {
          display: flex; align-items: center; gap: 8px;
          padding: 7px 10px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          transition: border-color var(--t-fast);
        }
        .svc-ch-row:hover { border-color: var(--border-normal); }
        .svc-ch-name {
          font-size: 12px; font-weight: 600; color: var(--text-primary);
          flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .svc-ch-badge {
          font-size: 10px; font-weight: 700;
          padding: 1px 5px; border-radius: var(--r-full);
          background: var(--accent-subtle, oklch(65% 0.24 255 / 0.15));
          border: 1px solid var(--accent-border, oklch(65% 0.24 255 / 0.4));
          color: var(--accent);
          flex-shrink: 0;
        }

        /* Confirm panel */
        .svc-confirm {
          display: flex; flex-direction: column; gap: 8px;
          padding: 12px;
          background: oklch(30% 0.15 15 / 0.15);
          border: 1px solid oklch(65% 0.25 15 / 0.4);
          border-radius: var(--r-md);
        }
        .svc-confirm-msg {
          font-size: 12px; color: var(--text-secondary); line-height: 1.5;
        }
        .svc-confirm-actions {
          display: flex; gap: 6px; justify-content: flex-end;
        }

        /* Separator */
        .svc-hr {
          border: none;
          border-top: 1px solid var(--border-subtle);
          margin: 4px 0;
        }

        /* Reply log */
        .svc-reply-section {
          flex-shrink: 0;
          border-top: 1px solid var(--border-subtle);
          padding: 10px 14px;
          background: var(--bg-base);
        }
        .svc-reply-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 6px;
        }
        .svc-clear-btn {
          font-size: 10px; color: var(--text-muted);
          background: none; border: none; cursor: pointer;
          padding: 0 2px;
          transition: color var(--t-fast);
        }
        .svc-clear-btn:hover { color: var(--text-secondary); }
        .svc-reply-log {
          max-height: 110px; overflow-y: auto;
          display: flex; flex-direction: column; gap: 2px;
        }
        .svc-reply-empty {
          font-size: 11px; color: var(--text-muted);
          font-style: italic;
        }
        .svc-reply-line {
          display: flex; gap: 6px; align-items: baseline;
          font-size: 11px;
          line-height: 1.4;
        }
        .svc-reply-time {
          color: var(--text-muted); flex-shrink: 0;
          font-family: var(--font-mono, monospace);
        }
        .svc-reply-source {
          color: var(--gold, #e8b84b); flex-shrink: 0;
          font-family: var(--font-mono, monospace);
          font-weight: 700; font-size: 10px;
        }
        .svc-reply-text {
          color: var(--text-secondary);
          word-break: break-word;
          font-family: var(--font-mono, monospace);
        }

        /* Memo items */
        .svc-memo-list { display: flex; flex-direction: column; gap: 6px; }
        .svc-memo-item {
          padding: 8px 10px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          display: flex; flex-direction: column; gap: 3px;
        }
        .svc-memo-header {
          display: flex; align-items: center; justify-content: space-between; gap: 6px;
        }
        .svc-memo-from { font-size: 11px; font-weight: 700; color: var(--accent); }
        .svc-memo-id { font-size: 10px; color: var(--text-muted); font-family: monospace; }
        .svc-memo-text { font-size: 12px; color: var(--text-secondary); line-height: 1.4; }
        .svc-memo-actions { display: flex; gap: 4px; margin-top: 2px; }

        /* Nick group list */
        .svc-nick-list { display: flex; flex-wrap: wrap; gap: 4px; }
        .svc-nick-chip {
          font-size: 11px; font-weight: 600;
          padding: 2px 8px; border-radius: var(--r-full);
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          color: var(--text-secondary);
        }

        /* CHANSET options grid */
        .svc-opt-grid { display: flex; flex-direction: column; gap: 6px; }

        /* Bot tab info note */
        .svc-bot-note {
          font-size: 11px; color: var(--text-muted);
          padding: 6px 10px;
          background: oklch(40% 0.12 70 / 0.08);
          border: 1px solid oklch(70% 0.18 70 / 0.2);
          border-radius: var(--r-md);
          line-height: 1.5;
        }
        .svc-bot-note strong { color: var(--gold, #e8b84b); font-weight: 700; }
      `}</style>
    </div>
  );
}

// ── Account Tab ───────────────────────────────────────────────────────────────

interface AccountTabProps {
  account: string | null;
  ourNick: string;
  send: (cmd: string, ...params: string[]) => void;
}

type AccountFlag =
  | 'HIDE EMAIL'
  | 'PROTECT'
  | 'SECURE'
  | 'PRIVATE'
  | 'MEMONOTIFY'
  | 'NOMEMO'
  | 'NOOP'
  | 'ENFORCE'
  | 'SASLONLY';

interface FlagDef { flag: AccountFlag; label: string; desc: string }

const ACCOUNT_FLAGS: FlagDef[] = [
  { flag: 'HIDE EMAIL',  label: 'Hide Email',    desc: 'Hide email from INFO output' },
  { flag: 'PROTECT',     label: 'Protect',        desc: 'Ghost/kill on nick collision' },
  { flag: 'SECURE',      label: 'Secure',         desc: 'Require access-list match to identify' },
  { flag: 'PRIVATE',     label: 'Private',        desc: 'Hide account from searches' },
  { flag: 'MEMONOTIFY',  label: 'Memo Notify',    desc: 'Notify on new memo' },
  { flag: 'NOMEMO',      label: 'No Memo',        desc: 'Reject incoming memos' },
  { flag: 'NOOP',        label: 'No Auto-Op',     desc: 'Never auto-op on channel join' },
  { flag: 'ENFORCE',     label: 'Enforce',        desc: 'Rename nick after delay if unidentified' },
  { flag: 'SASLONLY',    label: 'SASL Only',      desc: 'IDENTIFY rejected; SASL PLAIN only' },
];

function AccountTab({ account, ourNick, send }: AccountTabProps) {
  const [identifyPw, setIdentifyPw]     = useState('');
  const [identifyAcc, setIdentifyAcc]   = useState('');
  const [regEmail, setRegEmail]         = useState('');
  const [regPw, setRegPw]               = useState('');
  const [oldPw, setOldPw]               = useState('');
  const [newPw, setNewPw]               = useState('');
  const [email, setEmail]               = useState('');
  const [ghostNick, setGhostNick]       = useState('');
  const [recoverNick, setRecoverNick]   = useState('');
  const [recoverPw, setRecoverPw]       = useState('');
  const [ungroupNick, setUngroupNick]   = useState('');
  const [accessMask, setAccessMask]     = useState('');
  const [flags, setFlags]               = useState<Set<AccountFlag>>(new Set());
  const [showDrop, setShowDrop]         = useState(false);
  const [dropPw, setDropPw]             = useState('');

  const loggedIn = !!account;

  const toggleFlag = (f: AccountFlag, on: boolean) => {
    setFlags(prev => {
      const next = new Set(prev);
      on ? next.add(f) : next.delete(f);
      return next;
    });
    send('SET', f, on ? 'ON' : 'OFF');
  };

  return (
    <>
      {/* Status */}
      <div className="svc-section">
        <div className="svc-section-label">Account Status</div>
        <div className="svc-status-row">
          {loggedIn ? (
            <>
              <span className="svc-status-badge svc-badge--ok">✓</span>
              <span className="svc-status-text">
                Identified as <strong>{account}</strong>
              </span>
              <button
                className="svc-btn svc-btn--sm"
                onClick={() => send('ACCOUNTINFO')}
              >Info</button>
            </>
          ) : (
            <>
              <span className="svc-status-badge svc-badge--none">✗</span>
              <span className="svc-status-text">Not identified ({ourNick})</span>
            </>
          )}
        </div>
      </div>

      {/* Identify (when not logged in) */}
      {!loggedIn && (
        <div className="svc-section">
          <div className="svc-section-label">Identify</div>
          <div className="svc-form-row">
            <label className="svc-form-label">Account (optional, defaults to current nick)</label>
            <input
              className="svc-input"
              placeholder={ourNick}
              value={identifyAcc}
              onChange={e => setIdentifyAcc(e.target.value)}
            />
          </div>
          <div className="svc-form-row">
            <label className="svc-form-label">Password</label>
            <div className="svc-form-inline">
              <input
                className="svc-input"
                type="password"
                placeholder="Your password"
                value={identifyPw}
                onChange={e => setIdentifyPw(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && identifyPw) {
                    if (identifyAcc) {
                      send('IDENTIFY', identifyAcc, identifyPw);
                    } else {
                      send('IDENTIFY', identifyPw);
                    }
                    setIdentifyPw('');
                  }
                }}
              />
              <button
                className="svc-btn svc-btn--accent"
                disabled={!identifyPw}
                onClick={() => {
                  if (identifyAcc) {
                    send('IDENTIFY', identifyAcc, identifyPw);
                  } else {
                    send('IDENTIFY', identifyPw);
                  }
                  setIdentifyPw('');
                }}
              >Identify</button>
            </div>
          </div>
        </div>
      )}

      {/* Register (when not logged in) */}
      {!loggedIn && (
        <div className="svc-section">
          <div className="svc-section-label">Register Nick</div>
          <div className="svc-form-row">
            <label className="svc-form-label">Email</label>
            <input
              className="svc-input"
              type="email"
              placeholder="your@email.com"
              value={regEmail}
              onChange={e => setRegEmail(e.target.value)}
            />
          </div>
          <div className="svc-form-row">
            <label className="svc-form-label">Password</label>
            <div className="svc-form-inline">
              <input
                className="svc-input"
                type="password"
                placeholder="Choose a password"
                value={regPw}
                onChange={e => setRegPw(e.target.value)}
              />
              <button
                className="svc-btn svc-btn--accent"
                disabled={!regPw || !regEmail}
                onClick={() => {
                  send('REGISTER', regEmail, regPw);
                  setRegPw(''); setRegEmail('');
                }}
              >Register</button>
            </div>
          </div>
        </div>
      )}

      {/* Ghost / Recover (always visible) */}
      <div className="svc-section">
        <div className="svc-section-label">Nick Recovery</div>
        <div className="svc-form-row">
          <label className="svc-form-label">Ghost — disconnect a session using your nick</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="Nick to ghost"
              value={ghostNick}
              onChange={e => setGhostNick(e.target.value)}
            />
            <button
              className="svc-btn"
              disabled={!ghostNick}
              onClick={() => { send('GHOST', ghostNick); setGhostNick(''); }}
            >Ghost</button>
          </div>
        </div>
        <div className="svc-form-row">
          <label className="svc-form-label">Recover — reclaim nick (requires password if not identified)</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="Nick"
              value={recoverNick}
              onChange={e => setRecoverNick(e.target.value)}
            />
            <input
              className="svc-input"
              type="password"
              placeholder="Password"
              style={{ maxWidth: 100 }}
              value={recoverPw}
              onChange={e => setRecoverPw(e.target.value)}
            />
            <button
              className="svc-btn"
              disabled={!recoverNick}
              onClick={() => {
                if (recoverPw) {
                  send('RECOVER', recoverNick, recoverPw);
                } else {
                  send('RECOVER', recoverNick);
                }
                setRecoverNick(''); setRecoverPw('');
              }}
            >Recover</button>
          </div>
        </div>
      </div>

      {/* Manage (only when logged in) */}
      {loggedIn && (
        <>
          {/* Change password */}
          <div className="svc-section">
            <div className="svc-section-label">Change Password</div>
            <div className="svc-form-row">
              <label className="svc-form-label">Old password</label>
              <input
                className="svc-input"
                type="password"
                placeholder="Current password"
                value={oldPw}
                onChange={e => setOldPw(e.target.value)}
              />
            </div>
            <div className="svc-form-row">
              <label className="svc-form-label">New password</label>
              <div className="svc-form-inline">
                <input
                  className="svc-input"
                  type="password"
                  placeholder="New password"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                />
                <button
                  className="svc-btn"
                  disabled={!oldPw || !newPw}
                  onClick={() => {
                    send('SETPASS', oldPw, newPw);
                    setOldPw(''); setNewPw('');
                  }}
                >Change</button>
              </div>
            </div>
          </div>

          {/* Change email */}
          <div className="svc-section">
            <div className="svc-section-label">Change Email</div>
            <div className="svc-form-row">
              <div className="svc-form-inline">
                <input
                  className="svc-input"
                  type="email"
                  placeholder="New email address"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
                <button
                  className="svc-btn"
                  disabled={!email}
                  onClick={() => { send('SETEMAIL', email); setEmail(''); }}
                >Update</button>
              </div>
            </div>
          </div>

          {/* Nick grouping */}
          <div className="svc-section">
            <div className="svc-section-label">Nick Groups</div>
            <div className="svc-form-row">
              <label className="svc-form-label">
                GROUP — attach current nick <strong>{ourNick}</strong> to your account
              </label>
              <button
                className="svc-btn"
                onClick={() => send('GROUP')}
                style={{ alignSelf: 'flex-start' }}
              >Group Current Nick</button>
            </div>
            <div className="svc-form-row">
              <label className="svc-form-label">UNGROUP — detach a nick from your account</label>
              <div className="svc-form-inline">
                <input
                  className="svc-input"
                  placeholder="Nick to ungroup"
                  value={ungroupNick}
                  onChange={e => setUngroupNick(e.target.value)}
                />
                <button
                  className="svc-btn"
                  disabled={!ungroupNick}
                  onClick={() => { send('UNGROUP', ungroupNick); setUngroupNick(''); }}
                >Ungroup</button>
              </div>
            </div>
            <button
              className="svc-btn"
              onClick={() => send('LISTGROUPS')}
              style={{ alignSelf: 'flex-start' }}
            >List Grouped Nicks ↗</button>
          </div>

          {/* Access masks */}
          <div className="svc-section">
            <div className="svc-section-label">Host Access Masks</div>
            <div className="svc-form-row">
              <label className="svc-form-label">
                Auto-identify from matching user@host masks
              </label>
              <div className="svc-form-inline">
                <input
                  className="svc-input"
                  placeholder="user@host or *@*.isp.net"
                  value={accessMask}
                  onChange={e => setAccessMask(e.target.value)}
                />
                <button
                  className="svc-btn"
                  disabled={!accessMask}
                  onClick={() => { send('ACCESS', 'ADD', accessMask); setAccessMask(''); }}
                >Add</button>
              </div>
            </div>
            <div className="svc-form-inline">
              <button className="svc-btn svc-btn--sm" onClick={() => send('ACCESS', 'LIST')}>
                List Masks ↗
              </button>
              <button
                className="svc-btn svc-btn--sm"
                onClick={() => send('CERT', 'LIST')}
                title="TLS certificate fingerprints"
              >
                List Certs ↗
              </button>
            </div>
          </div>

          {/* Account flags */}
          <div className="svc-section">
            <div className="svc-section-label">Account Settings</div>
            <div className="svc-opt-grid">
              {ACCOUNT_FLAGS.map(({ flag, label, desc }) => (
                <div key={flag} className="svc-toggle-row">
                  <div className="svc-toggle-info">
                    <span className="svc-toggle-name">{label}</span>
                    <span className="svc-toggle-desc">{desc}</span>
                  </div>
                  <button
                    className={`svc-toggle ${flags.has(flag) ? 'svc-toggle--on' : ''}`}
                    aria-pressed={flags.has(flag)}
                    aria-label={`Toggle ${label}`}
                    onClick={() => toggleFlag(flag, !flags.has(flag))}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Password reset */}
          <div className="svc-section">
            <div className="svc-section-label">Password Reset</div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
              Send a reset token to your registered email address.
            </p>
            <button
              className="svc-btn"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => send('SENDPASS')}
            >Email Reset Token</button>
          </div>

          {/* Danger zone */}
          <div className="svc-section">
            <div className="svc-section-label">Danger Zone</div>
            {!showDrop ? (
              <button
                className="svc-btn svc-btn--danger"
                onClick={() => setShowDrop(true)}
              >Drop Account…</button>
            ) : (
              <div className="svc-confirm">
                <p className="svc-confirm-msg">
                  This permanently removes your account registration.
                  All grouped nicks and channel founder rights will be lost.
                </p>
                <div className="svc-form-row">
                  <label className="svc-form-label">Confirm password</label>
                  <input
                    className="svc-input"
                    type="password"
                    placeholder="Your password"
                    value={dropPw}
                    onChange={e => setDropPw(e.target.value)}
                  />
                </div>
                <div className="svc-confirm-actions">
                  <button
                    className="svc-btn"
                    onClick={() => { setShowDrop(false); setDropPw(''); }}
                  >Cancel</button>
                  <button
                    className="svc-btn svc-btn--danger"
                    disabled={!dropPw}
                    onClick={() => {
                      send('DROP', dropPw);
                      setShowDrop(false); setDropPw('');
                    }}
                  >Drop Account</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

// ── Channel Tab ───────────────────────────────────────────────────────────────

interface ChannelTabProps {
  channels: Map<string, { name: string; users: Map<string, { nick: string; modes: Set<string>; away?: boolean }> }>;
  ourNick: string;
  send: (cmd: string, ...params: string[]) => void;
}

type ChansetOption =
  | 'KEEPTOPIC'
  | 'GUARD'
  | 'PRIVATE'
  | 'RESTRICTED'
  | 'VERBOSE'
  | 'NOEXPIRE';

interface ChansetDef { opt: ChansetOption; label: string; desc: string }

const CHANSET_OPTS: ChansetDef[] = [
  { opt: 'KEEPTOPIC',   label: 'Keep Topic',   desc: 'Restore topic when channel empties' },
  { opt: 'GUARD',       label: 'Guard',         desc: 'Keep channel protected while empty' },
  { opt: 'PRIVATE',     label: 'Private',       desc: 'Hide from channel listings' },
  { opt: 'RESTRICTED',  label: 'Restricted',    desc: 'Only allow access-listed users to join' },
  { opt: 'VERBOSE',     label: 'Verbose',       desc: 'Announce bans and kicks to all users' },
];

function ChannelTab({ channels, ourNick, send }: ChannelTabProps) {
  const [selectedChan, setSelectedChan] = useState('');
  const [regChan, setRegChan]           = useState('');
  const [accessChan, setAccessChan]     = useState('');
  const [accessMask, setAccessMask]     = useState('');
  const [accessLevel, setAccessLevel]   = useState<'OP'|'VOICE'|'OWNER'>('OP');
  const [chansetFlags, setChansetFlags] = useState<Map<string, Set<ChansetOption>>>(new Map());
  const [urlChan, setUrlChan]           = useState('');
  const [url, setUrl]                   = useState('');

  const managedChannels = Array.from(channels.values()).filter(ch => {
    const u = ch.users.get(ourNick.toLowerCase());
    if (!u) return false;
    return u.modes.has('o') || u.modes.has('q') || u.modes.has('a');
  });

  const allChannels = Array.from(channels.values()).map(ch => ch.name);

  const getFlags = (chan: string): Set<ChansetOption> =>
    chansetFlags.get(chan) ?? new Set();

  const toggleChanFlag = (chan: string, opt: ChansetOption, on: boolean) => {
    setChansetFlags(prev => {
      const next = new Map(prev);
      const flagSet = new Set(next.get(chan) ?? []);
      on ? flagSet.add(opt) : flagSet.delete(opt);
      next.set(chan, flagSet);
      return next;
    });
    send('CHANSET', chan, opt, on ? 'ON' : 'OFF');
  };

  const resolveChannel = (s: string) => s.startsWith('#') || s.startsWith('&') ? s : `#${s}`;

  return (
    <>
      {managedChannels.length > 0 && (
        <div className="svc-section">
          <div className="svc-section-label">Your Channels</div>
          <div className="svc-ch-list">
            {managedChannels.map(ch => {
              const u = ch.users.get(ourNick.toLowerCase())!;
              const level = u.modes.has('q') ? 'OWNER' : u.modes.has('a') ? 'PROTECTED' : 'OP';
              return (
                <div key={ch.name} className="svc-ch-row">
                  <span className="svc-ch-name">{ch.name}</span>
                  <span className="svc-ch-badge">{level}</span>
                  <button
                    className="svc-btn svc-btn--sm"
                    onClick={() => send('ACCOUNTINFO', ch.name)}
                  >Info</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="svc-section">
        <div className="svc-section-label">Register Channel</div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
          You must be a channel operator and identified to register.
        </p>
        <div className="svc-form-row">
          <label className="svc-form-label">Channel name</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="#channel"
              value={regChan}
              onChange={e => setRegChan(e.target.value)}
              list="svc-chan-suggestions"
            />
            <datalist id="svc-chan-suggestions">
              {allChannels.map(c => <option key={c} value={c} />)}
            </datalist>
            <button
              className="svc-btn svc-btn--accent"
              disabled={!regChan}
              onClick={() => {
                send('REGISTER', resolveChannel(regChan));
                setRegChan('');
              }}
            >Register</button>
          </div>
        </div>
      </div>

      <div className="svc-section">
        <div className="svc-section-label">Channel Settings (CHANSET)</div>
        <div className="svc-form-row">
          <label className="svc-form-label">Channel</label>
          <select
            className="svc-input"
            value={selectedChan}
            onChange={e => setSelectedChan(e.target.value)}
          >
            <option value="">Select a channel…</option>
            {allChannels.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {selectedChan && (
          <div className="svc-opt-grid">
            {CHANSET_OPTS.map(({ opt, label, desc }) => {
              const on = getFlags(selectedChan).has(opt);
              return (
                <div key={opt} className="svc-toggle-row">
                  <div className="svc-toggle-info">
                    <span className="svc-toggle-name">{label}</span>
                    <span className="svc-toggle-desc">{desc}</span>
                  </div>
                  <button
                    className={`svc-toggle ${on ? 'svc-toggle--on' : ''}`}
                    aria-pressed={on}
                    aria-label={`Toggle ${label} for ${selectedChan}`}
                    onClick={() => toggleChanFlag(selectedChan, opt, !on)}
                  />
                </div>
              );
            })}
            <div className="svc-form-row" style={{ marginTop: 4 }}>
              <label className="svc-form-label">Channel URL</label>
              <div className="svc-form-inline">
                <input
                  className="svc-input"
                  placeholder="https://…"
                  value={urlChan === selectedChan ? url : ''}
                  onChange={e => { setUrl(e.target.value); setUrlChan(selectedChan); }}
                />
                <button
                  className="svc-btn"
                  disabled={!url || urlChan !== selectedChan}
                  onClick={() => { send('CHANSET', selectedChan, 'URL', url); setUrl(''); }}
                >Set</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="svc-section">
        <div className="svc-section-label">Channel Access (IRCX ACCESS)</div>
        <div className="svc-form-row">
          <label className="svc-form-label">Channel</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="#channel"
              value={accessChan}
              onChange={e => setAccessChan(e.target.value)}
              list="svc-chan-access-list"
            />
            <datalist id="svc-chan-access-list">
              {allChannels.map(c => <option key={c} value={c} />)}
            </datalist>
            <button
              className="svc-btn svc-btn--sm"
              disabled={!accessChan}
              onClick={() => send('ACCESS', resolveChannel(accessChan), 'LIST')}
            >List ↗</button>
          </div>
        </div>
        {accessChan && (
          <div className="svc-form-row">
            <label className="svc-form-label">Add access entry</label>
            <div className="svc-form-inline">
              <input
                className="svc-input"
                placeholder="account or *!user@host"
                value={accessMask}
                onChange={e => setAccessMask(e.target.value)}
              />
              <select
                className="svc-input"
                style={{ maxWidth: 80 }}
                value={accessLevel}
                onChange={e => setAccessLevel(e.target.value as typeof accessLevel)}
              >
                <option value="VOICE">+v</option>
                <option value="OP">+o</option>
                <option value="OWNER">+q</option>
              </select>
              <button
                className="svc-btn"
                disabled={!accessMask}
                onClick={() => {
                  send('ACCESS', resolveChannel(accessChan), 'ADD', accessMask, accessLevel);
                  setAccessMask('');
                }}
              >Add</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Memos Tab ─────────────────────────────────────────────────────────────────

interface MemosTabProps {
  account: string | null;
  send: (cmd: string, ...params: string[]) => void;
}

function MemosTab({ account, send }: MemosTabProps) {
  const [sendTo, setSendTo]     = useState('');
  const [sendText, setSendText] = useState('');
  const [readId, setReadId]     = useState('');
  const [delId, setDelId]       = useState('');
  const [fwdId, setFwdId]       = useState('');
  const [fwdTo, setFwdTo]       = useState('');

  if (!account) {
    return (
      <div className="svc-section">
        <div className="svc-status-row">
          <span className="svc-status-badge svc-badge--none">✗</span>
          <span className="svc-status-text">You must be identified to use memos.</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="svc-section">
        <div className="svc-section-label">Inbox</div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
          Memo list appears in server replies below.
        </p>
        <button
          className="svc-btn"
          onClick={() => send('MEMO', 'LIST')}
          style={{ alignSelf: 'flex-start' }}
        >Fetch Memo List ↗</button>
      </div>

      <div className="svc-section">
        <div className="svc-section-label">Send Memo</div>
        <div className="svc-form-row">
          <label className="svc-form-label">To (account name)</label>
          <input
            className="svc-input"
            placeholder="account"
            value={sendTo}
            onChange={e => setSendTo(e.target.value)}
          />
        </div>
        <div className="svc-form-row">
          <label className="svc-form-label">Message</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="Your memo text"
              value={sendText}
              onChange={e => setSendText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && sendTo && sendText) {
                  send('MEMO', 'SEND', sendTo, sendText);
                  setSendText('');
                }
              }}
            />
            <button
              className="svc-btn svc-btn--accent"
              disabled={!sendTo || !sendText}
              onClick={() => { send('MEMO', 'SEND', sendTo, sendText); setSendText(''); }}
            >Send</button>
          </div>
        </div>
      </div>

      <div className="svc-section">
        <div className="svc-section-label">Manage</div>
        <div className="svc-form-row">
          <label className="svc-form-label">Read memo by ID</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="Memo ID"
              value={readId}
              onChange={e => setReadId(e.target.value)}
            />
            <button
              className="svc-btn"
              disabled={!readId}
              onClick={() => { send('MEMO', 'READ', readId); }}
            >Read ↗</button>
          </div>
        </div>
        <div className="svc-form-row">
          <label className="svc-form-label">Delete memo by ID (or ALL)</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="ID or ALL"
              value={delId}
              onChange={e => setDelId(e.target.value)}
            />
            <button
              className="svc-btn svc-btn--danger"
              disabled={!delId}
              onClick={() => { send('MEMO', 'DEL', delId); setDelId(''); }}
            >Delete</button>
          </div>
        </div>
        <hr className="svc-hr" />
        <div className="svc-form-row">
          <label className="svc-form-label">Forward memo to account</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="Memo ID"
              style={{ maxWidth: 80 }}
              value={fwdId}
              onChange={e => setFwdId(e.target.value)}
            />
            <input
              className="svc-input"
              placeholder="Account"
              value={fwdTo}
              onChange={e => setFwdTo(e.target.value)}
            />
            <button
              className="svc-btn"
              disabled={!fwdId || !fwdTo}
              onClick={() => { send('MEMO', 'FORWARD', fwdId, fwdTo); setFwdId(''); setFwdTo(''); }}
            >Fwd</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── VHost Tab ─────────────────────────────────────────────────────────────────

interface VHostTabProps {
  send: (cmd: string, ...params: string[]) => void;
}

function VHostTab({ send }: VHostTabProps) {
  const [reqVhost, setReqVhost]   = useState('');
  const [takeVhost, setTakeVhost] = useState('');

  return (
    <>
      <div className="svc-section">
        <div className="svc-section-label">Offered VHosts</div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
          Operators can offer vhosts for users to take.
          Results appear in server replies below.
        </p>
        <button
          className="svc-btn"
          onClick={() => send('VHOFFERLIST')}
          style={{ alignSelf: 'flex-start' }}
        >View Offered VHosts ↗</button>
      </div>

      <div className="svc-section">
        <div className="svc-section-label">Take an Offered VHost</div>
        <div className="svc-form-row">
          <label className="svc-form-label">VHost (from VHOFFERLIST)</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="user.example.com"
              value={takeVhost}
              onChange={e => setTakeVhost(e.target.value)}
            />
            <button
              className="svc-btn svc-btn--accent"
              disabled={!takeVhost}
              onClick={() => { send('VHOST', 'TAKE', takeVhost); setTakeVhost(''); }}
            >Take</button>
          </div>
        </div>
      </div>

      <div className="svc-section">
        <div className="svc-section-label">Request Custom VHost</div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
          Sends a vhost request to online operators for approval.
        </p>
        <div className="svc-form-row">
          <label className="svc-form-label">Requested hostname</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="my.custom.host"
              value={reqVhost}
              onChange={e => setReqVhost(e.target.value)}
            />
            <button
              className="svc-btn"
              disabled={!reqVhost}
              onClick={() => { send('VHOST', 'REQUEST', reqVhost); setReqVhost(''); }}
            >Request</button>
          </div>
        </div>
      </div>

      <div className="svc-section">
        <div className="svc-section-label">Remove VHost</div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
          Restore your original host and remove the active vhost.
        </p>
        <button
          className="svc-btn svc-btn--danger"
          onClick={() => send('VHOST', 'OFF')}
          style={{ alignSelf: 'flex-start' }}
        >Remove VHost</button>
      </div>
    </>
  );
}

// ── NickServ Tab (bot PRIVMSG) ────────────────────────────────────────────────

interface NickServTabProps {
  ourNick: string;
  sendToBot: (bot: string, command: string) => void;
}

function NickServTab({ ourNick, sendToBot }: NickServTabProps) {
  const [infoNick, setInfoNick]       = useState('');
  const [ghostNick, setGhostNick]     = useState('');
  const [ghostPw, setGhostPw]         = useState('');
  const [releaseNick, setReleaseNick] = useState('');

  return (
    <>
      <div className="svc-bot-note">
        Commands sent via <strong>PRIVMSG NickServ</strong>.
        Replies appear in the log below.
      </div>

      {/* INFO */}
      <div className="svc-section">
        <div className="svc-section-label">Nick Info</div>
        <div className="svc-form-row">
          <label className="svc-form-label">
            Look up registration info for any nick (account creation date, last seen, vhost…)
          </label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder={ourNick}
              value={infoNick}
              onChange={e => setInfoNick(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  sendToBot('NickServ', `INFO ${infoNick || ourNick}`);
                }
              }}
            />
            <button
              className="svc-btn svc-btn--gold"
              onClick={() => sendToBot('NickServ', `INFO ${infoNick || ourNick}`)}
            >INFO ↗</button>
          </div>
        </div>
      </div>

      {/* GHOST */}
      <div className="svc-section">
        <div className="svc-section-label">Ghost</div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
          Kill a stale session that is using your nick.
        </p>
        <div className="svc-form-row">
          <label className="svc-form-label">Nick to ghost</label>
          <input
            className="svc-input"
            placeholder="nick"
            value={ghostNick}
            onChange={e => setGhostNick(e.target.value)}
          />
        </div>
        <div className="svc-form-row">
          <label className="svc-form-label">Password (required)</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              type="password"
              placeholder="Your password"
              value={ghostPw}
              onChange={e => setGhostPw(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && ghostNick && ghostPw) {
                  sendToBot('NickServ', `GHOST ${ghostNick} ${ghostPw}`);
                  setGhostNick(''); setGhostPw('');
                }
              }}
            />
            <button
              className="svc-btn svc-btn--danger"
              disabled={!ghostNick || !ghostPw}
              onClick={() => {
                sendToBot('NickServ', `GHOST ${ghostNick} ${ghostPw}`);
                setGhostNick(''); setGhostPw('');
              }}
            >GHOST</button>
          </div>
        </div>
      </div>

      {/* RELEASE */}
      <div className="svc-section">
        <div className="svc-section-label">Release</div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
          Release a nick being held by enforcement so you can reclaim it.
        </p>
        <div className="svc-form-row">
          <label className="svc-form-label">Nick to release</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="nick"
              value={releaseNick}
              onChange={e => setReleaseNick(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && releaseNick) {
                  sendToBot('NickServ', `RELEASE ${releaseNick}`);
                  setReleaseNick('');
                }
              }}
            />
            <button
              className="svc-btn"
              disabled={!releaseNick}
              onClick={() => {
                sendToBot('NickServ', `RELEASE ${releaseNick}`);
                setReleaseNick('');
              }}
            >RELEASE</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── ChanServ Tab (bot PRIVMSG) ────────────────────────────────────────────────

interface ChanServTabProps {
  channels: Map<string, { name: string; users: Map<string, unknown> }>;
  sendToBot: (bot: string, command: string) => void;
}

type ChanServFlag = 'GUARD' | 'KEEPTOPIC' | 'PRIVATE';

interface ChanServFlagDef { flag: ChanServFlag; label: string; desc: string }

const CHANSERV_FLAGS: ChanServFlagDef[] = [
  { flag: 'GUARD',      label: 'Guard',      desc: 'Keep channel alive while empty' },
  { flag: 'KEEPTOPIC',  label: 'Keep Topic', desc: 'Restore topic when channel refills' },
  { flag: 'PRIVATE',    label: 'Private',    desc: 'Hide channel from INFO and searches' },
];

function ChanServTab({ channels, sendToBot }: ChanServTabProps) {
  const [infoChan, setInfoChan]     = useState('');
  const [setChan, setSetChan]       = useState('');
  const [flagState, setFlagState]   = useState<Map<ChanServFlag, boolean>>(new Map());

  const allChannels = Array.from(channels.values()).map(ch => ch.name);

  const toggleFlag = (flag: ChanServFlag, on: boolean) => {
    setFlagState(prev => {
      const next = new Map(prev);
      next.set(flag, on);
      return next;
    });
    if (setChan) {
      sendToBot('ChanServ', `SET ${setChan} ${flag} ${on ? 'ON' : 'OFF'}`);
    }
  };

  return (
    <>
      <div className="svc-bot-note">
        Commands sent via <strong>PRIVMSG ChanServ</strong>.
        Replies appear in the log below.
      </div>

      {/* INFO */}
      <div className="svc-section">
        <div className="svc-section-label">Channel Info</div>
        <div className="svc-form-row">
          <label className="svc-form-label">
            Look up channel registration details (founder, flags, topic lock, etc.)
          </label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="#channel"
              value={infoChan}
              onChange={e => setInfoChan(e.target.value)}
              list="svc-cs-info-list"
              onKeyDown={e => {
                if (e.key === 'Enter' && infoChan) {
                  sendToBot('ChanServ', `INFO ${infoChan}`);
                }
              }}
            />
            <datalist id="svc-cs-info-list">
              {allChannels.map(c => <option key={c} value={c} />)}
            </datalist>
            <button
              className="svc-btn svc-btn--gold"
              disabled={!infoChan}
              onClick={() => sendToBot('ChanServ', `INFO ${infoChan}`)}
            >INFO ↗</button>
          </div>
        </div>
      </div>

      {/* SET */}
      <div className="svc-section">
        <div className="svc-section-label">Channel Settings (SET)</div>
        <div className="svc-form-row">
          <label className="svc-form-label">Channel</label>
          <select
            className="svc-input"
            value={setChan}
            onChange={e => { setSetChan(e.target.value); setFlagState(new Map()); }}
          >
            <option value="">Select a channel…</option>
            {allChannels.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {setChan && (
          <div className="svc-opt-grid">
            {CHANSERV_FLAGS.map(({ flag, label, desc }) => {
              const on = flagState.get(flag) ?? false;
              return (
                <div key={flag} className="svc-toggle-row">
                  <div className="svc-toggle-info">
                    <span className="svc-toggle-name">{label}</span>
                    <span className="svc-toggle-desc">{desc}</span>
                  </div>
                  <button
                    className={`svc-toggle ${on ? 'svc-toggle--on' : ''}`}
                    aria-pressed={on}
                    aria-label={`Toggle ChanServ ${label} for ${setChan}`}
                    onClick={() => toggleFlag(flag, !on)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ── HostServ Tab (bot PRIVMSG) ────────────────────────────────────────────────

interface HostServTabProps {
  sendToBot: (bot: string, command: string) => void;
}

function HostServTab({ sendToBot }: HostServTabProps) {
  const [reqVhost, setReqVhost] = useState('');
  const [status, setStatus]     = useState<'idle' | 'sent'>('idle');

  const handleRequest = () => {
    if (!reqVhost) return;
    sendToBot('HostServ', `REQUEST ${reqVhost}`);
    setStatus('sent');
  };

  const handleOff = () => {
    sendToBot('HostServ', 'OFF');
  };

  const handleList = () => {
    sendToBot('HostServ', 'LIST');
  };

  return (
    <>
      <div className="svc-bot-note">
        Commands sent via <strong>PRIVMSG HostServ</strong>.
        Replies appear in the log below.
      </div>

      <div className="svc-section">
        <div className="svc-section-label">Request VHost</div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
          Submit a vhost request to IRC operators. They will approve or deny via HostServ.
        </p>
        <div className="svc-form-row">
          <label className="svc-form-label">Desired hostname</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="my.custom.vhost"
              value={reqVhost}
              onChange={e => { setReqVhost(e.target.value); setStatus('idle'); }}
              onKeyDown={e => { if (e.key === 'Enter') handleRequest(); }}
            />
            <button
              className="svc-btn svc-btn--gold"
              disabled={!reqVhost}
              onClick={handleRequest}
            >REQUEST</button>
          </div>
        </div>
        {status === 'sent' && (
          <p style={{ fontSize: 11, color: 'var(--gold, #e8b84b)', margin: 0 }}>
            Request sent. Check the reply log for confirmation.
          </p>
        )}
      </div>

      <div className="svc-section">
        <div className="svc-section-label">Manage VHost</div>
        <div className="svc-form-inline">
          <button className="svc-btn svc-btn--sm" onClick={handleList}>
            View Active VHost ↗
          </button>
          <button className="svc-btn svc-btn--sm svc-btn--danger" onClick={handleOff}>
            Remove VHost
          </button>
        </div>
      </div>
    </>
  );
}

// ── MemoServ Tab (bot PRIVMSG) ────────────────────────────────────────────────

interface MemoServTabProps {
  sendToBot: (bot: string, command: string) => void;
}

function MemoServTab({ sendToBot }: MemoServTabProps) {
  const [sendTo, setSendTo]     = useState('');
  const [sendText, setSendText] = useState('');
  const [readNum, setReadNum]   = useState('');
  const [delNum, setDelNum]     = useState('');

  return (
    <>
      <div className="svc-bot-note">
        Commands sent via <strong>PRIVMSG MemoServ</strong>.
        Replies appear in the log below.
      </div>

      {/* List */}
      <div className="svc-section">
        <div className="svc-section-label">Inbox</div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
          Fetch your memo list. Unread memos shown in replies.
        </p>
        <button
          className="svc-btn"
          onClick={() => sendToBot('MemoServ', 'LIST')}
          style={{ alignSelf: 'flex-start' }}
        >LIST ↗</button>
      </div>

      {/* Read */}
      <div className="svc-section">
        <div className="svc-section-label">Read Memo</div>
        <div className="svc-form-row">
          <label className="svc-form-label">Memo number (or NEW for first unread)</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="1  or  NEW"
              value={readNum}
              onChange={e => setReadNum(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && readNum) {
                  sendToBot('MemoServ', `READ ${readNum}`);
                }
              }}
            />
            <button
              className="svc-btn svc-btn--gold"
              disabled={!readNum}
              onClick={() => sendToBot('MemoServ', `READ ${readNum}`)}
            >READ ↗</button>
          </div>
        </div>
      </div>

      {/* Send */}
      <div className="svc-section">
        <div className="svc-section-label">Send Memo</div>
        <div className="svc-form-row">
          <label className="svc-form-label">Recipient (nick or account)</label>
          <input
            className="svc-input"
            placeholder="nick"
            value={sendTo}
            onChange={e => setSendTo(e.target.value)}
          />
        </div>
        <div className="svc-form-row">
          <label className="svc-form-label">Message</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="Your message"
              value={sendText}
              onChange={e => setSendText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && sendTo && sendText) {
                  sendToBot('MemoServ', `SEND ${sendTo} ${sendText}`);
                  setSendText('');
                }
              }}
            />
            <button
              className="svc-btn svc-btn--accent"
              disabled={!sendTo || !sendText}
              onClick={() => {
                sendToBot('MemoServ', `SEND ${sendTo} ${sendText}`);
                setSendText('');
              }}
            >SEND</button>
          </div>
        </div>
      </div>

      {/* Delete */}
      <div className="svc-section">
        <div className="svc-section-label">Delete Memo</div>
        <div className="svc-form-row">
          <label className="svc-form-label">Memo number (or ALL)</label>
          <div className="svc-form-inline">
            <input
              className="svc-input"
              placeholder="1  or  ALL"
              value={delNum}
              onChange={e => setDelNum(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && delNum) {
                  sendToBot('MemoServ', `DEL ${delNum}`);
                  setDelNum('');
                }
              }}
            />
            <button
              className="svc-btn svc-btn--danger"
              disabled={!delNum}
              onClick={() => {
                sendToBot('MemoServ', `DEL ${delNum}`);
                setDelNum('');
              }}
            >DEL</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const ShieldIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"
    style={{ color: 'var(--accent)', flexShrink: 0 }}>
    <path d="M8 1L2 3.5V8c0 3.3 2.5 6.1 6 7 3.5-.9 6-3.7 6-7V3.5L8 1zm-.5 9.8L4.6 7.9l1-.9L7.5 9l3.4-3.4 1 .9-4.4 4.3z"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M2 2l10 10M12 2L2 12" />
  </svg>
);
