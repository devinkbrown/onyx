'use client';

import { useState, useMemo, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import IrcText from '@/components/chat/IrcText';
import { useDialogFocus } from './useDialogFocus';

// Detect lines that look like ASCII art
function isArtLine(line: string): boolean {
  const artChars = line.match(/[│─┌┐└┘╔╗╚╝═║╠╣╦╩╬*#|+\\/-]{3,}/);
  return (artChars?.length ?? 0) > 0;
}

// Strip IRC color/formatting codes for plain-text copy
function stripIrc(text: string): string {
  // Strip color codes: \x03[0-9]{1,2}(,[0-9]{1,2})?
  // Strip bold (\x02), italic (\x1d), underline (\x1f), reverse (\x16), reset (\x0f)
  return text
    .replace(/\x03[0-9]{1,2}(?:,[0-9]{1,2})?/g, '')
    .replace(/[\x02\x1d\x1f\x16\x0f]/g, '');
}

export default function MotdModal() {
  const motd        = useOnyxStore(s => s.motd);
  const closeMotd   = useOnyxStore(s => s.closeMotd);
  const networkName = useOnyxStore(s => s.networkName);
  const serverUrl   = useOnyxStore(s => s.server?.url ?? 'unknown');

  const [dontShow, setDontShow] = useState(false);
  const [search,   setSearch]   = useState('');
  const [copied,   setCopied]   = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef);

  const lines = useMemo(() => (motd ?? '').split('\n'), [motd]);

  const filteredLines = useMemo(() => {
    if (!search.trim()) return lines;
    const q = search.toLowerCase();
    return lines.filter(l => l.toLowerCase().includes(q));
  }, [lines, search]);

  const handleDismiss = () => {
    if (dontShow) {
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem(`ocean-hide-motd-${serverUrl}`, '1');
        }
      } catch {
        // Storage unavailable — silently degrade
      }
    }
    closeMotd();
  };

  const handleCopy = () => {
    const plain = lines.map(stripIrc).join('\n');
    navigator.clipboard.writeText(plain).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  if (!motd) return null;

  return (
    <div className="motd-backdrop">
      <div className="motd-panel" ref={panelRef} role="dialog" aria-modal aria-labelledby="motd-title">
        <div className="motd-header">
          <h2 className="motd-title" id="motd-title">
            Welcome to {networkName}
          </h2>
          <button
            className="motd-copy-btn"
            onClick={handleCopy}
            title="Copy MOTD as plain text"
            aria-label="Copy MOTD as plain text"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>

        <div className="motd-search-wrap">
          <input
            type="search"
            className="motd-search"
            placeholder="Search MOTD…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search MOTD content"
          />
          {search && filteredLines.length !== lines.length && (
            <span className="motd-search-count" aria-live="polite">
              {filteredLines.length} of {lines.length} lines
            </span>
          )}
        </div>

        <div className="motd-body">
          <div className="motd-lines">
            {filteredLines.map((line, i) => (
              <div
                key={i}
                className={`motd-line${isArtLine(line) ? ' motd-line--art' : ''}`}
              >
                <IrcText text={line || '​'} />
              </div>
            ))}
          </div>
        </div>

        <div className="motd-footer">
          <label className="motd-no-show">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={e => setDontShow(e.target.checked)}
            />
            <span>Don&apos;t show again</span>
          </label>
          <button className="motd-dismiss" onClick={handleDismiss}>
            Dismiss
          </button>
        </div>
      </div>

      <style>{`
        .motd-backdrop {
          position: fixed;
          inset: 0;
          z-index: 600;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .motd-panel {
          width: 100%;
          max-width: 600px;
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-lg);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: motd-in 180ms var(--ease-out) both;
          max-height: calc(100vh - 48px);
        }

        @keyframes motd-in {
          from { opacity: 0; transform: translateY(-8px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        .motd-header {
          padding: 20px 24px 14px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 12px;
          border-bottom: 1px solid var(--border-subtle);
        }

        .motd-title {
          font-size: 17px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
          flex: 1;
          letter-spacing: -0.01em;
        }

        .motd-copy-btn {
          padding: 5px 12px;
          border-radius: var(--r-sm);
          border: 1px solid var(--border-normal);
          background: var(--bg-elevated);
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          transition: all var(--t-fast);
          flex-shrink: 0;
        }
        .motd-copy-btn:hover {
          border-color: var(--accent-border);
          color: var(--accent);
        }

        .motd-search-wrap {
          padding: 10px 24px 8px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .motd-search {
          flex: 1;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md, 6px);
          padding: 6px 10px;
          font-size: 12px;
          color: var(--text-primary);
          outline: none;
          font-family: inherit;
          transition: border-color 0.15s;
        }
        .motd-search::placeholder { color: var(--text-muted); }
        .motd-search:focus { border-color: var(--accent-border); }

        .motd-search-count {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
          flex-shrink: 0;
        }

        .motd-body {
          flex: 1;
          overflow: hidden;
          padding: 0 24px 4px;
        }

        .motd-lines {
          font-size: 13px;
          line-height: 1.65;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 14px 16px;
          max-height: 420px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: var(--accent-border, rgba(14,165,233,0.28)) transparent;
        }
        .motd-lines::-webkit-scrollbar { width: 4px; }
        .motd-lines::-webkit-scrollbar-track { background: transparent; }
        .motd-lines::-webkit-scrollbar-thumb {
          background: var(--accent-border, rgba(14,165,233,0.28));
          border-radius: 2px;
        }
        .motd-lines::-webkit-scrollbar-thumb:hover {
          background: var(--accent, #0ea5e9);
        }

        .motd-line {
          color: var(--text-secondary);
          white-space: pre-wrap;
          word-break: break-word;
          min-height: 1.65em;
        }

        .motd-line--art {
          font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace);
          font-size: 11.5px;
          line-height: 1.4;
          white-space: pre;
          color: var(--text-primary);
        }

        .motd-footer {
          padding: 12px 24px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-shrink: 0;
          border-top: 1px solid var(--border-subtle);
        }

        .motd-no-show {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-size: 13px;
          color: var(--text-muted);
          user-select: none;
        }

        .motd-no-show input[type="checkbox"] {
          accent-color: var(--accent);
          width: 14px;
          height: 14px;
          cursor: pointer;
        }

        .motd-no-show:hover {
          color: var(--text-secondary);
        }

        .motd-dismiss {
          font-size: 14px;
          font-weight: 600;
          padding: 7px 20px;
          border-radius: var(--r-sm);
          border: none;
          background: var(--accent);
          color: #fff;
          cursor: pointer;
          transition: opacity var(--t-fast);
          flex-shrink: 0;
          font-family: inherit;
        }

        .motd-dismiss:hover {
          opacity: 0.88;
        }
      `}</style>
    </div>
  );
}
