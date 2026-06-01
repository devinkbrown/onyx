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
import { useDialogFocus } from './useDialogFocus';

// ── Types ─────────────────────────────────────────────────────────────────────

type SendAccount = (subcmd: string, ...params: string[]) => void;

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

  const svcNoticeRef   = useRef<HTMLDivElement>(null);
  const panelRef       = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef);

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

  const sendAccount: SendAccount = (subcmd, ...params) => {
    client?.sendRaw('ACCOUNT', subcmd, ...params);
  };

  // ── Send PRIVMSG to a service bot ───────────────────────────────────────
  // formatIRCLine auto-prefixes the trailing param with ':' when needed
  const sendToBot = (bot: string, command: string) => {
    client?.sendRaw('PRIVMSG', bot, command);
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
    >
      <div
        className="svc-panel animate-slide-right"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="svc-panel-title"
      >

        {/* Header */}
        <div className="svc-header">
          <div className="svc-header-left">
            <ShieldIcon />
            <div>
              <h2 id="svc-panel-title" className="svc-title">Account Services</h2>
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
            <AccountTab account={account} ourNick={ourNick} sendAccount={sendAccount} />
          )}
          {servicesTab === 'channel' && (
            <ChannelTab channels={channels} ourNick={ourNick} send={send} />
          )}
          {servicesTab === 'memos' && (
            <MemosTab account={account} sendAccount={sendAccount} />
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

        <div className="svc-reply-section">
          <div className="svc-reply-header">
            <span className="svc-section-label">{isBotTab ? `${activeBot} Replies` : 'Server Replies'}</span>
            {filteredNotices.length > 0 && (
              <button className="svc-clear-btn" onClick={clearServiceNotices}>Clear</button>
            )}
          </div>
          <div className="svc-reply-log" ref={svcNoticeRef}>
            {filteredNotices.length === 0 ? (
              <span className="svc-reply-empty">
                {isBotTab ? `${activeBot} responses appear here` : 'Responses to commands appear here'}
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

      </div>

      <style>{`
        .svc-backdrop {
          position: fixed; inset: 0; z-index: 615;
          display: flex; align-items: stretch; justify-content: flex-end;
          background: linear-gradient(90deg, transparent, var(--bg-void));
        }

        .svc-panel {
          width: 368px; max-width: 95vw;
          background: linear-gradient(180deg, var(--bg-base), var(--bg-deep));
          border-left: 1px solid var(--accent-border);
          display: flex; flex-direction: column;
          overflow: hidden;
          box-shadow: var(--shadow-xl), var(--glow);
        }

        /* Header */
        .svc-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 18px;
          height: 64px;
          background: var(--bg-deep);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          gap: 14px;
        }
        .svc-header-left {
          display: flex; align-items: center; gap: 12px; min-width: 0;
        }
        .svc-title {
          font-size: 15px; font-weight: 800; color: var(--text-primary);
          line-height: 1.15;
        }
        .svc-subtitle {
          font-size: 11px; color: var(--text-secondary);
          margin: 3px 0 0; line-height: 1.15;
        }
        .svc-close {
          width: 30px; height: 30px; flex-shrink: 0;
          background: var(--bg-elevated); border: 1px solid var(--border-subtle); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-secondary); border-radius: var(--r-sm);
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .svc-close:hover {
          background: var(--bg-float);
          border-color: var(--accent-border);
          color: var(--text-primary);
          filter: brightness(1.08);
        }
        .svc-close:active { transform: translateY(1px); }

        /* Tabs */
        .svc-tabs-wrap {
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          background: var(--bg-deep);
          padding: 8px 10px 0;
        }
        .svc-tabs {
          display: flex;
          padding: 0;
          gap: 4px;
        }
        .svc-tabs--bot {
          border-top: 1px solid var(--border-subtle);
          margin-top: 6px;
          padding-top: 6px;
        }
        .svc-tab {
          flex: 1 1 0;
          padding: 8px 7px;
          font-size: 11px; font-weight: 700;
          color: var(--text-muted);
          background: transparent; border: 1px solid transparent; cursor: pointer;
          border-bottom: 2px solid transparent;
          border-radius: var(--r-sm) var(--r-sm) 0 0;
          margin-bottom: -1px;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          white-space: nowrap;
        }
        .svc-tab:hover {
          background: var(--bg-elevated);
          color: var(--text-primary);
          filter: brightness(1.04);
        }
        .svc-tab:active { transform: translateY(1px); }
        .svc-tab--active {
          background: var(--accent-subtle);
          border-color: var(--accent-border);
          border-bottom-color: var(--accent);
          color: var(--accent-hover);
          box-shadow: var(--shadow-sm);
        }
        .svc-tab--active:hover {
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
          background: var(--gold-subtle);
          border-color: var(--accent-border);
          border-bottom-color: var(--gold);
          color: var(--gold);
        }

        /* Body */
        .svc-body {
          flex: 1; overflow-y: auto;
          display: flex; flex-direction: column;
          padding: 18px 16px 20px;
          gap: 20px;
          min-height: 0;
          scrollbar-width: thin;
          scrollbar-color: var(--accent-border) var(--bg-deep);
        }
        .svc-body::-webkit-scrollbar { width: 6px; }
        .svc-body::-webkit-scrollbar-thumb {
          background: var(--accent-border);
          border-radius: var(--r-full);
        }

        /* Section */
        .svc-section {
          display: flex; flex-direction: column; gap: 10px;
          padding: 0 0 2px;
        }
        .svc-section-label {
          font-size: 10px; font-weight: 800;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--text-secondary);
          padding: 0 2px;
        }
        .svc-section > p {
          line-height: 1.45;
          padding: 0 2px;
        }

        /* Status row */
        .svc-status-row {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          font-size: 13px;
          box-shadow: var(--shadow-sm);
        }
        .svc-status-badge {
          min-width: 24px; height: 22px;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 800;
          padding: 0 7px; border-radius: var(--r-full);
          flex-shrink: 0;
        }
        .svc-badge--ok {
          background: var(--gold-subtle);
          color: var(--success);
          border: 1px solid var(--border-normal);
        }
        .svc-badge--none {
          background: var(--danger-subtle);
          color: var(--danger);
          border: 1px solid var(--border-normal);
        }
        .svc-status-text {
          color: var(--text-secondary);
          flex: 1; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
          font-size: 12px;
        }

        /* Form */
        .svc-form-row {
          display: flex; flex-direction: column; gap: 6px;
        }
        .svc-form-label {
          font-size: 10px; font-weight: 600;
          color: var(--text-muted); padding: 0 2px;
          letter-spacing: 0.04em;
          line-height: 1.35;
        }
        .svc-form-inline {
          display: flex; gap: 7px; align-items: center;
        }
        .svc-input {
          flex: 1;
          background: var(--bg-base);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          padding: 8px 10px;
          font-size: 12px;
          color: var(--text-primary);
          font-family: inherit;
          min-width: 0;
        }
        .svc-input:hover { border-color: var(--accent-border); }
        .svc-input:focus {
          outline: none;
          background: var(--bg-elevated);
          border-color: var(--accent-border);
          box-shadow: 0 0 0 2px var(--accent-subtle);
        }
        .svc-input::placeholder { color: var(--text-muted); }

        /* Buttons */
        .svc-btn {
          min-height: 32px;
          padding: 7px 11px;
          font-size: 12px; font-weight: 700;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          color: var(--text-primary);
          cursor: pointer;
          white-space: nowrap;
          box-shadow: var(--shadow-sm);
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .svc-btn:hover {
          background: var(--bg-float);
          border-color: var(--accent-border);
          color: var(--accent-hover);
          filter: brightness(1.05);
        }
        .svc-btn:active {
          transform: translateY(1px);
        }
        .svc-btn--accent {
          background: var(--accent);
          border-color: var(--accent);
          color: var(--bg-void);
        }
        .svc-btn--accent:hover {
          background: var(--accent-hover);
          border-color: var(--accent-hover);
          color: var(--bg-void);
        }
        .svc-btn--gold {
          background: var(--gold-subtle);
          border-color: var(--accent-border);
          color: var(--gold);
        }
        .svc-btn--gold:hover {
          background: var(--bg-float);
          border-color: var(--gold);
          color: var(--gold);
        }
        .svc-btn--sm {
          min-height: 26px;
          padding: 4px 8px;
          font-size: 11px;
        }
        .svc-btn--danger {
          background: var(--danger-subtle);
          border-color: var(--border-normal);
          color: var(--danger);
        }
        .svc-btn--danger:hover {
          background: var(--danger);
          border-color: var(--danger);
          color: var(--bg-void);
        }
        .svc-btn:disabled {
          opacity: 0.4; cursor: not-allowed;
          filter: none;
          transform: none;
        }

        /* Toggle row */
        .svc-toggle-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 9px 10px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          gap: 12px;
          box-shadow: var(--shadow-sm);
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .svc-toggle-row:hover {
          border-color: var(--border-normal);
          filter: brightness(1.04);
        }
        .svc-toggle-info { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
        .svc-toggle-name { font-size: 12px; font-weight: 600; color: var(--text-primary); }
        .svc-toggle-desc { font-size: 10px; color: var(--text-muted); line-height: 1.35; }
        .svc-toggle {
          position: relative; width: 32px; height: 18px; flex-shrink: 0;
          background: var(--bg-overlay);
          border-radius: var(--r-full);
          border: 1px solid var(--border-normal); cursor: pointer;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .svc-toggle::after {
          content: ''; position: absolute;
          top: 1px; left: 1px;
          width: 14px; height: 14px;
          background: var(--text-primary); border-radius: 50%;
          box-shadow: var(--shadow-sm);
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .svc-toggle:hover { filter: brightness(1.08); }
        .svc-toggle--on { background: var(--accent); }
        .svc-toggle--on::after { transform: translateX(14px); }

        /* Channel list */
        .svc-ch-list { display: flex; flex-direction: column; gap: 6px; }
        .svc-ch-row {
          display: flex; align-items: center; gap: 8px;
          padding: 9px 10px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          box-shadow: var(--shadow-sm);
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .svc-ch-row:hover {
          border-color: var(--border-normal);
          filter: brightness(1.04);
        }
        .svc-ch-name {
          font-size: 12px; font-weight: 600; color: var(--text-primary);
          flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .svc-ch-badge {
          font-size: 10px; font-weight: 700;
          padding: 2px 6px; border-radius: var(--r-full);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          color: var(--accent-hover);
          flex-shrink: 0;
        }

        /* Confirm panel */
        .svc-confirm {
          display: flex; flex-direction: column; gap: 10px;
          padding: 12px;
          background: var(--danger-subtle);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          box-shadow: var(--shadow-sm);
        }
        .svc-confirm-msg {
          font-size: 12px; color: var(--text-secondary); line-height: 1.5;
          margin: 0;
        }
        .svc-confirm-actions {
          display: flex; gap: 8px; justify-content: flex-end;
        }

        /* Separator */
        .svc-hr {
          border: none;
          border-top: 1px solid var(--border-subtle);
          margin: 6px 0;
        }

        /* Reply log */
        .svc-reply-section {
          flex-shrink: 0;
          border-top: 1px solid var(--border-normal);
          padding: 12px 14px 14px;
          background: var(--bg-deep);
          box-shadow: var(--shadow-sm);
        }
        .svc-reply-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 8px;
        }
        .svc-clear-btn {
          font-size: 10px; font-weight: 700; color: var(--text-muted);
          background: var(--bg-elevated); border: 1px solid var(--border-subtle); cursor: pointer;
          padding: 3px 7px;
          border-radius: var(--r-xs);
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .svc-clear-btn:hover {
          color: var(--text-secondary);
          border-color: var(--border-normal);
          filter: brightness(1.05);
        }
        .svc-clear-btn:active { transform: translateY(1px); }
        .svc-reply-log {
          max-height: 124px; overflow-y: auto;
          display: flex; flex-direction: column; gap: 3px;
          padding: 6px;
          background: var(--bg-void);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          scrollbar-width: thin;
          scrollbar-color: var(--accent-border) var(--bg-void);
        }
        .svc-reply-log::-webkit-scrollbar { width: 3px; }
        .svc-reply-log::-webkit-scrollbar-thumb {
          background: var(--accent-border);
          border-radius: 2px;
        }
        .svc-reply-empty {
          font-size: 11px; color: var(--text-muted);
          font-style: italic;
        }
        .svc-reply-line {
          display: flex; gap: 6px; align-items: baseline;
          font-size: 11px;
          line-height: 1.4;
          padding: 3px 4px;
          border-radius: var(--r-xs);
        }
        .svc-reply-line:hover {
          background: var(--bg-base);
        }
        .svc-reply-time {
          color: var(--text-muted); flex-shrink: 0;
          font-family: var(--font-mono, monospace);
          opacity: 0.7;
        }
        .svc-reply-source {
          color: var(--gold); flex-shrink: 0;
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
          padding: 9px 10px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          display: flex; flex-direction: column; gap: 3px;
          box-shadow: var(--shadow-sm);
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
          padding: 3px 8px; border-radius: var(--r-full);
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          color: var(--text-secondary);
        }

        /* CHANSET options grid */
        .svc-opt-grid { display: flex; flex-direction: column; gap: 6px; }

        /* Bot tab info note */
        .svc-bot-note {
          font-size: 11px; color: var(--text-secondary);
          padding: 9px 10px;
          background: var(--gold-subtle);
          border: 1px solid var(--accent-border);
          border-radius: var(--r-md);
          line-height: 1.5;
          box-shadow: var(--shadow-sm);
        }
        .svc-bot-note strong { color: var(--gold); font-weight: 700; }

        @media (prefers-reduced-motion: reduce) {
          .svc-close,
          .svc-tab,
          .svc-btn,
          .svc-toggle-row,
          .svc-toggle,
          .svc-toggle::after,
          .svc-ch-row,
          .svc-clear-btn {
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}

// ── Account Tab ───────────────────────────────────────────────────────────────

interface AccountTabProps {
  account: string | null;
  ourNick: string;
  sendAccount: SendAccount;
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

function AccountTab({ account, ourNick, sendAccount }: AccountTabProps) {
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
      if (on) next.add(f);
      else next.delete(f);
      return next;
    });
    sendAccount('SET', f, on ? 'ON' : 'OFF');
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
                onClick={() => sendAccount('INFO')}
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
                      sendAccount('IDENTIFY', identifyAcc, identifyPw);
                    } else {
                      sendAccount('IDENTIFY', identifyPw);
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
                    sendAccount('IDENTIFY', identifyAcc, identifyPw);
                  } else {
                    sendAccount('IDENTIFY', identifyPw);
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
                disabled={!regPw}
                onClick={() => {
                  sendAccount('REGISTER', regPw);
                  if (regEmail) sendAccount('SETEMAIL', regEmail);
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
              onClick={() => { sendAccount('GHOST', ghostNick); setGhostNick(''); }}
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
                  sendAccount('RECOVER', recoverNick, recoverPw);
                } else {
                  sendAccount('RECOVER', recoverNick);
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
                    sendAccount('SETPASS', oldPw, newPw);
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
                  onClick={() => { sendAccount('SETEMAIL', email); setEmail(''); }}
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
                onClick={() => sendAccount('GROUP')}
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
                  onClick={() => { sendAccount('UNGROUP', ungroupNick); setUngroupNick(''); }}
                >Ungroup</button>
              </div>
            </div>
            <button
              className="svc-btn"
              onClick={() => sendAccount('LISTGROUPS')}
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
                  onClick={() => { sendAccount('ACCESS', 'ADD', accessMask); setAccessMask(''); }}
                >Add</button>
              </div>
            </div>
            <div className="svc-form-inline">
              <button className="svc-btn svc-btn--sm" onClick={() => sendAccount('ACCESS', 'LIST')}>
                List Masks ↗
              </button>
              <button
                className="svc-btn svc-btn--sm"
                onClick={() => sendAccount('CERT', 'LIST')}
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
              onClick={() => sendAccount('SENDPASS')}
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
                      sendAccount('DROP', dropPw);
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
      if (on) flagSet.add(opt);
      else flagSet.delete(opt);
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
  sendAccount: SendAccount;
}

function MemosTab({ account, sendAccount }: MemosTabProps) {
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
          onClick={() => sendAccount('MEMO', 'LIST')}
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
                  sendAccount('MEMO', 'SEND', sendTo, sendText);
                  setSendText('');
                }
              }}
            />
            <button
              className="svc-btn svc-btn--accent"
              disabled={!sendTo || !sendText}
              onClick={() => { sendAccount('MEMO', 'SEND', sendTo, sendText); setSendText(''); }}
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
              onClick={() => { sendAccount('MEMO', 'READ', readId); }}
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
              onClick={() => { sendAccount('MEMO', 'DEL', delId); setDelId(''); }}
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
              onClick={() => { sendAccount('MEMO', 'FORWARD', fwdId, fwdTo); setFwdId(''); setFwdTo(''); }}
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
          <p style={{ fontSize: 11, color: 'var(--gold)', margin: 0 }}>
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
