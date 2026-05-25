'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';

function formatTs(d: Date): string {
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function classifyLine(line: string): 'ping' | 'error' | 'mode' | 'privmsg' | 'normal' {
  const upper = line.toUpperCase();
  if (upper.startsWith('PING') || upper.startsWith('PONG') ||
      upper.includes(' PING ') || upper.includes(' PONG ')) return 'ping';
  const numericMatch = line.match(/^\S+ (\d{3})/);
  if (numericMatch) {
    const n = parseInt(numericMatch[1], 10);
    if (n >= 400 && n < 600) return 'error';
  }
  if (upper.includes(' MODE ') || upper.startsWith('MODE ')) return 'mode';
  if (upper.includes(' PRIVMSG ') || upper.includes(' NOTICE ') ||
      upper.startsWith('PRIVMSG ') || upper.startsWith('NOTICE ')) return 'privmsg';
  return 'normal';
}

export default function RawLogPanel() {
  const rawLog         = useOnyxStore(s => s.rawLog);
  const clearRawLog    = useOnyxStore(s => s.clearRawLog);
  const toggleRawLog   = useOnyxStore(s => s.toggleRawLog);
  const client         = useOnyxStore(s => s.client);

  const [filter,      setFilter]      = useState('');
  const [paused,      setPaused]      = useState(false);
  const [minimized,   setMinimized]   = useState(false);
  const [rawSend,     setRawSend]     = useState('');
  const [autoScroll,  setAutoScroll]  = useState(true);
  const [copied,      setCopied]      = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  const autoScrollRef = useRef(autoScroll);
  pausedRef.current = paused;
  autoScrollRef.current = autoScroll;

  // Auto-scroll to bottom when new entries arrive (unless paused, minimized, or locked)
  useEffect(() => {
    if (pausedRef.current || minimized || !autoScrollRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rawLog, minimized]);

  const filteredEntries = filter
    ? rawLog.filter(e => e.line.toLowerCase().includes(filter.toLowerCase()))
    : rawLog;

  const sendRaw = useCallback(() => {
    const trimmed = rawSend.trim();
    if (!trimmed || !client) return;
    const parts = trimmed.split(' ');
    client.sendRaw(parts[0].toUpperCase(), ...parts.slice(1));
    setRawSend('');
  }, [rawSend, client]);

  const handleCopy = useCallback(() => {
    const text = filteredEntries
      .map(e => `${formatTs(e.ts)} ${e.dir === 'out' ? '→' : '←'} ${e.line}`)
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [filteredEntries]);

  return (
    <div className={`rawlog-panel ${minimized ? 'rawlog-panel--minimized' : ''}`}>
      {/* Header */}
      <div className="rawlog-header">
        <span className="rawlog-title">Raw IRC Log</span>

        <div className="rawlog-header-actions">
          <input
            className="rawlog-filter"
            placeholder="Filter…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <button
            className={`rawlog-btn ${autoScroll ? '' : 'rawlog-btn--active'}`}
            onClick={() => setAutoScroll(a => !a)}
            title={autoScroll ? 'Lock scroll (disable auto-scroll)' : 'Unlock scroll (enable auto-scroll)'}
          >
            {autoScroll ? '🔓' : '🔒'}
          </button>
          <button
            className="rawlog-btn"
            onClick={handleCopy}
            title="Copy filtered log to clipboard"
          >
            {copied ? '✓' : '📋'}
          </button>
          <button
            className={`rawlog-btn ${paused ? 'rawlog-btn--active' : ''}`}
            onClick={() => setPaused(p => !p)}
            title={paused ? 'Resume' : 'Pause'}
          >
            {paused ? '▶' : '⏸'}
          </button>
          <button
            className="rawlog-btn"
            onClick={clearRawLog}
            title="Clear log"
          >
            ✕ Clear
          </button>
          <button
            className="rawlog-btn"
            onClick={() => setMinimized(m => !m)}
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? '▲' : '▼'}
          </button>
          <button
            className="rawlog-btn rawlog-btn--close"
            onClick={toggleRawLog}
            title="Close"
          >
            ×
          </button>
        </div>
      </div>

      {/* Log body */}
      {!minimized && (
        <>
          <div className="rawlog-body" ref={scrollRef}>
            {filteredEntries.length === 0 && (
              <div className="rawlog-empty">No entries yet. Enable raw log capture and connect to a server.</div>
            )}
            {filteredEntries.map((entry, i) => {
              const kind = classifyLine(entry.line);
              const dirClass = entry.dir === 'out' ? 'rawlog-entry--sent' : 'rawlog-entry--recv';
              return (
                <div
                  key={i}
                  className={`rawlog-entry rawlog-entry--${kind} ${dirClass}`}
                  title={entry.line}
                >
                  <span className="rawlog-ts">{formatTs(entry.ts)}</span>
                  <span className={`rawlog-dir rawlog-dir--${entry.dir}`}>
                    {entry.dir === 'out' ? '→' : '←'}
                  </span>
                  <span className="rawlog-line">{entry.line}</span>
                </div>
              );
            })}
          </div>

          {/* Raw send bar */}
          <div className="rawlog-send-bar">
            <input
              className="rawlog-send-input"
              placeholder="Send raw IRC line (e.g. PING server)…"
              value={rawSend}
              onChange={e => setRawSend(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendRaw(); }}
              disabled={!client}
            />
            <button
              className="rawlog-btn rawlog-btn--send"
              onClick={sendRaw}
              disabled={!rawSend.trim() || !client}
            >
              Send
            </button>
          </div>
        </>
      )}

      <style>{`
        .rawlog-panel {
          position: fixed;
          bottom: 0; left: 0; right: 0;
          height: 240px;
          background: var(--bg-void);
          border-top: 1px solid var(--border-normal);
          display: flex;
          flex-direction: column;
          z-index: 400;
          font-family: var(--font-mono, 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace);
          font-size: 12px;
        }
        .rawlog-panel--minimized {
          height: auto;
        }

        /* Header */
        .rawlog-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 8px;
          border-bottom: 1px solid var(--border-subtle);
          background: var(--bg-deep);
          flex-shrink: 0;
          height: 32px;
        }
        .rawlog-title {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .rawlog-header-actions {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-left: auto;
        }
        .rawlog-filter {
          height: 22px;
          padding: 0 8px;
          border-radius: var(--r-sm);
          border: 1px solid var(--border-subtle);
          background: var(--bg-elevated);
          color: var(--text-primary);
          font-size: 11px;
          font-family: inherit;
          width: 140px;
        }
        .rawlog-filter:focus { outline: none; border-color: var(--accent-border); }
        .rawlog-filter::placeholder { color: var(--text-muted); }

        /* Buttons */
        .rawlog-btn {
          height: 22px;
          padding: 0 6px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm);
          background: var(--bg-elevated);
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 11px;
          font-family: inherit;
          white-space: nowrap;
          transition: background 100ms, color 100ms;
        }
        .rawlog-btn:hover { background: var(--bg-overlay); color: var(--text-primary); }
        .rawlog-btn--active { background: var(--accent-subtle); color: var(--accent); border-color: var(--accent-border); }
        .rawlog-btn--close { color: var(--text-muted); font-size: 14px; line-height: 1; }
        .rawlog-btn--close:hover { color: var(--danger); }
        .rawlog-btn--send { background: var(--accent-subtle); color: var(--accent); border-color: var(--accent-border); }
        .rawlog-btn--send:disabled { opacity: 0.4; cursor: default; }

        /* Body */
        .rawlog-body {
          flex: 1;
          overflow-y: auto;
          overflow-x: auto;
          padding: 4px 0;
        }
        .rawlog-empty {
          padding: 16px;
          color: var(--text-muted);
          font-family: inherit;
          font-size: 12px;
        }

        /* Entries */
        .rawlog-entry {
          display: flex;
          align-items: baseline;
          gap: 6px;
          padding: 1px 8px;
          white-space: nowrap;
        }
        .rawlog-entry:hover { background: rgba(255,255,255,0.03); }

        /* Direction-based color coding */
        .rawlog-entry--sent .rawlog-line {
          color: #5db87a;
        }
        .rawlog-entry--recv .rawlog-line {
          color: #5b9bd5;
        }

        /* Classification overrides (higher specificity) */
        .rawlog-entry--ping { opacity: 0.4; }
        .rawlog-entry--error .rawlog-line { color: var(--danger) !important; }
        .rawlog-entry--mode .rawlog-line { color: var(--warning) !important; }
        .rawlog-entry--privmsg.rawlog-entry--recv .rawlog-line { color: #7bb8f0; font-weight: 500; }
        .rawlog-entry--privmsg.rawlog-entry--sent .rawlog-line { color: #72d48e; font-weight: 500; }

        .rawlog-ts {
          color: var(--text-muted);
          flex-shrink: 0;
          user-select: none;
          font-size: 11px;
        }
        .rawlog-dir {
          flex-shrink: 0;
          font-weight: 700;
          user-select: none;
          width: 12px;
          text-align: center;
        }
        .rawlog-dir--in  { color: #5b9bd5; }
        .rawlog-dir--out { color: #5db87a; }
        .rawlog-line {
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: inherit;
        }

        /* Send bar */
        .rawlog-send-bar {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-top: 1px solid var(--border-subtle);
          background: var(--bg-deep);
          flex-shrink: 0;
        }
        .rawlog-send-input {
          flex: 1;
          height: 22px;
          padding: 0 8px;
          border-radius: var(--r-sm);
          border: 1px solid var(--border-subtle);
          background: var(--bg-elevated);
          color: var(--text-primary);
          font-size: 11px;
          font-family: inherit;
        }
        .rawlog-send-input:focus { outline: none; border-color: var(--accent-border); }
        .rawlog-send-input:disabled { opacity: 0.5; }
        .rawlog-send-input::placeholder { color: var(--text-muted); }
      `}</style>
    </div>
  );
}
