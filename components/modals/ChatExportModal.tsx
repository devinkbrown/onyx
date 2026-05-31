'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import { useDialogFocus } from './useDialogFocus';

// ── Pure export functions ──────────────────────────────────────────────────────

function exportToText(messages: ChatMessage[], channel: string): string {
  const header = `Chat export for ${channel}\nExported: ${new Date().toLocaleString()}\n${'─'.repeat(50)}\n\n`;
  const lines = messages.map(msg => {
    const time = msg.time.toLocaleString();
    if (msg.type === 'msg') return `[${time}] <${msg.from}> ${msg.text}`;
    if (msg.type === 'action') return `[${time}] * ${msg.from} ${msg.text}`;
    return `[${time}] *** ${msg.text}`;
  });
  return header + lines.join('\n');
}

function exportToMarkdown(messages: ChatMessage[], channel: string): string {
  const header = `# Chat History: ${channel}\n\n**Exported:** ${new Date().toLocaleString()}\n\n---\n\n`;
  let result = header;
  let lastDate = '';

  for (const msg of messages) {
    const dateStr = msg.time.toLocaleDateString();
    if (dateStr !== lastDate) {
      result += `\n### ${dateStr}\n\n`;
      lastDate = dateStr;
    }
    const time = msg.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (msg.type === 'msg') {
      result += `\`${time}\` **${msg.from}**: ${msg.text}\n\n`;
    } else if (msg.type === 'action') {
      result += `\`${time}\` _${msg.from} ${msg.text}_\n\n`;
    } else {
      result += `\`${time}\` _${msg.text}_\n\n`;
    }
  }
  return result;
}

function exportToJSON(messages: ChatMessage[], channel: string): string {
  return JSON.stringify(
    {
      channel,
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages.map(m => ({
        time: m.time.toISOString(),
        from: m.from,
        text: m.text,
        type: m.type,
      })),
    },
    null,
    2,
  );
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Types ──────────────────────────────────────────────────────────────────────

type ExportFormat = 'txt' | 'md' | 'json';

const SYSTEM_TYPES = new Set(['join', 'part', 'quit', 'nick', 'mode', 'kick', 'topic', 'system', 'notice']);

// ── Component ──────────────────────────────────────────────────────────────────

export default function ChatExportModal() {
  const closeExportModal  = useOnyxStore(s => s.closeExportModal);
  const cardRef = useRef<HTMLDivElement>(null);
  useDialogFocus(cardRef);
  const addNotification   = useOnyxStore(s => s.addNotification);
  const activeView        = useOnyxStore(s => s.activeView);
  const channels          = useOnyxStore(s => s.channels);

  const rawMessages = activeView.kind === 'channel'
    ? (channels.get(activeView.channel.toLowerCase())?.messages ?? [])
    : [];
  const channelName = activeView.kind === 'channel' ? activeView.channel : 'export';

  const [format, setFormat]                   = useState<ExportFormat>('txt');
  const [allMessages, setAllMessages]         = useState(true);
  const [fromDate, setFromDate]               = useState('');
  const [toDate, setToDate]                   = useState('');
  const [includeSystem, setIncludeSystem]     = useState(false);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeExportModal();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closeExportModal]);

  const buildFilteredMessages = useCallback((): ChatMessage[] => {
    let msgs = rawMessages;

    if (!includeSystem) {
      msgs = msgs.filter(m => !SYSTEM_TYPES.has(m.type));
    }

    if (!allMessages) {
      const from = fromDate ? new Date(fromDate).getTime() : 0;
      const to   = toDate   ? new Date(toDate + 'T23:59:59').getTime() : Infinity;
      msgs = msgs.filter(m => {
        const t = m.time.getTime();
        return t >= from && t <= to;
      });
    }

    return msgs;
  }, [rawMessages, includeSystem, allMessages, fromDate, toDate]);

  const handleExport = () => {
    const msgs = buildFilteredMessages();
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = channelName.replace(/^[#&]/, '');

    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === 'txt') {
      content  = exportToText(msgs, channelName);
      filename = `ocean-${safeName}-${dateStr}.txt`;
      mimeType = 'text/plain;charset=utf-8';
    } else if (format === 'md') {
      content  = exportToMarkdown(msgs, channelName);
      filename = `ocean-${safeName}-${dateStr}.md`;
      mimeType = 'text/markdown;charset=utf-8';
    } else {
      content  = exportToJSON(msgs, channelName);
      filename = `ocean-${safeName}-${dateStr}.json`;
      mimeType = 'application/json;charset=utf-8';
    }

    downloadFile(content, filename, mimeType);
    addNotification({ type: 'system', text: `Exported ${filteredCount} message${filteredCount !== 1 ? 's' : ''} as ${filename}` });
    closeExportModal();
  };

  const filteredCount = buildFilteredMessages().length;

  return (
    <div className="export-modal" onClick={e => { if (e.target === e.currentTarget) closeExportModal(); }}>
      <div className="export-card" ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="export-modal-title">

        {/* Header */}
        <div className="export-header">
          <h2 id="export-modal-title" className="export-title">
            <span className="export-title-icon">📤</span>
            Export Chat History
          </h2>
          <button className="export-close" onClick={closeExportModal} aria-label="Close export modal">
            <CloseIcon />
          </button>
        </div>

        {/* Channel info */}
        <div className="export-channel-info">
          <span className="export-channel-name">#{channelName.replace(/^[#&]/, '')}</span>
          <span className="export-sep">—</span>
          <span className="export-msg-count">{filteredCount} message{filteredCount !== 1 ? 's' : ''}</span>
        </div>

        {/* Format selection */}
        <div className="export-section">
          <div className="export-section-label">Format</div>
          <div className="export-format-group">
            {([
              { value: 'txt',  icon: '📄', label: 'Plain text',  ext: '.txt'  },
              { value: 'md',   icon: '📝', label: 'Markdown',    ext: '.md'   },
              { value: 'json', icon: '📊', label: 'JSON',        ext: '.json' },
            ] as { value: ExportFormat; icon: string; label: string; ext: string }[]).map(opt => (
              <label
                key={opt.value}
                className={`export-format-option${format === opt.value ? ' selected' : ''}`}
              >
                <input
                  type="radio"
                  name="export-format"
                  value={opt.value}
                  checked={format === opt.value}
                  onChange={() => setFormat(opt.value)}
                />
                <span className="export-format-icon">{opt.icon}</span>
                <span className="export-format-label">{opt.label}</span>
                <span className="export-format-ext">{opt.ext}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Date range */}
        <div className="export-section">
          <div className="export-section-label">Date range</div>
          <label className="export-toggle-row">
            <input
              type="checkbox"
              className="export-checkbox"
              checked={allMessages}
              onChange={e => setAllMessages(e.target.checked)}
            />
            <span className="export-toggle-label">All messages</span>
          </label>
          {!allMessages && (
            <div className="export-date-range">
              <div className="export-date-field">
                <label className="export-date-label" htmlFor="export-from">From</label>
                <input
                  id="export-from"
                  type="date"
                  className="export-date-input"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                />
              </div>
              <div className="export-date-field">
                <label className="export-date-label" htmlFor="export-to">To</label>
                <input
                  id="export-to"
                  type="date"
                  className="export-date-input"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* System messages toggle */}
        <div className="export-section">
          <label className="export-toggle-row">
            <input
              type="checkbox"
              className="export-checkbox"
              checked={includeSystem}
              onChange={e => setIncludeSystem(e.target.checked)}
            />
            <span className="export-toggle-label">Include system messages</span>
            <span className="export-toggle-hint">(joins, parts, modes)</span>
          </label>
        </div>

        {/* Export button */}
        <button className="export-btn" onClick={handleExport} disabled={filteredCount === 0}>
          <DownloadIcon />
          Export {filteredCount > 0 ? `${filteredCount} message${filteredCount !== 1 ? 's' : ''}` : '(no messages)'}
        </button>
      </div>

      <style>{`
        .export-modal {
          position: fixed;
          inset: 0;
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
        }

        .export-card {
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-xl, 16px);
          padding: 24px;
          width: 420px;
          max-width: calc(100vw - 32px);
          box-shadow: var(--shadow-xl, 0 24px 64px rgba(0,0,0,0.64));
          display: flex;
          flex-direction: column;
          gap: 20px;
          animation: export-in 160ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
        }

        @keyframes export-in {
          from { opacity: 0; transform: scale(0.97) translateY(6px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        .export-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .export-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .export-title-icon {
          font-size: 18px;
          line-height: 1;
        }

        .export-close {
          width: 28px;
          height: 28px;
          border-radius: var(--r-sm, 6px);
          border: none;
          background: none;
          cursor: pointer;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background var(--t-fast, 150ms), color var(--t-fast, 150ms);
          flex-shrink: 0;
        }
        .export-close:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }

        .export-channel-info {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          background: var(--bg-elevated, var(--bg-float));
          border-radius: var(--r-md, 8px);
          border: 1px solid var(--border-subtle);
        }

        .export-channel-name {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .export-sep {
          color: var(--text-muted);
          font-size: 12px;
        }

        .export-msg-count {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .export-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .export-section-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        .export-format-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .export-format-option {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-radius: var(--r-md, 8px);
          border: 1px solid var(--border-subtle);
          background: var(--bg-elevated);
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
          user-select: none;
        }
        .export-format-option:hover {
          border-color: var(--border-normal);
          background: var(--bg-float);
        }
        .export-format-option.selected {
          border-color: var(--accent-border, rgba(14,165,233,0.4));
          background: var(--accent-subtle, rgba(14,165,233,0.07));
          box-shadow: 0 0 0 1px var(--accent-border, rgba(14,165,233,0.2)) inset;
        }
        .export-format-option input[type="radio"] {
          display: none;
        }

        .export-format-icon {
          font-size: 16px;
          line-height: 1;
          flex-shrink: 0;
        }

        .export-format-label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          flex: 1;
        }

        .export-format-ext {
          font-size: 11px;
          color: var(--text-muted);
          font-family: var(--font-mono, monospace);
          background: var(--bg-base);
          padding: 1px 5px;
          border-radius: var(--r-xs, 3px);
          border: 1px solid var(--border-subtle);
        }

        .export-toggle-row {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          user-select: none;
        }

        .export-checkbox {
          width: 16px;
          height: 16px;
          accent-color: var(--accent);
          cursor: pointer;
          flex-shrink: 0;
        }

        .export-toggle-label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .export-toggle-hint {
          font-size: 12px;
          color: var(--text-muted);
        }

        .export-date-range {
          display: flex;
          gap: 12px;
          margin-top: 4px;
        }

        .export-date-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
        }

        .export-date-label {
          font-size: 11px;
          color: var(--text-muted);
          font-weight: 600;
          letter-spacing: 0.04em;
          cursor: default;
        }

        .export-date-input {
          background: var(--bg-elevated, var(--bg-float));
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm, 6px);
          color: var(--text-primary);
          font-size: 13px;
          padding: 6px 8px;
          outline: none;
          width: 100%;
          box-sizing: border-box;
          transition: border-color 0.15s;
          color-scheme: dark;
        }
        .export-date-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent-border, rgba(14,165,233,0.3));
        }

        .export-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          padding: 12px 16px;
          background: var(--accent, #0ea5e9);
          color: #fff;
          font-size: 14px;
          font-weight: 700;
          border: none;
          border-radius: var(--r-md, 8px);
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s, box-shadow 0.15s;
          box-shadow: 0 4px 16px var(--accent-glow, rgba(14,165,233,0.35));
          font-family: inherit;
          letter-spacing: 0.01em;
        }
        .export-btn:hover:not(:disabled) {
          opacity: 0.92;
          box-shadow: 0 6px 24px var(--accent-glow, rgba(14,165,233,0.45));
        }
        .export-btn:active:not(:disabled) {
          transform: scale(0.98);
          box-shadow: 0 2px 8px var(--accent-glow, rgba(14,165,233,0.25));
        }
        .export-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          box-shadow: none;
        }
      `}</style>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M2.146 2.146a.5.5 0 0 1 .708 0L7 6.293l4.146-4.147a.5.5 0 0 1 .708.708L7.707 7l4.147 4.146a.5.5 0 0 1-.708.708L7 7.707 2.854 11.854a.5.5 0 0 1-.708-.708L6.293 7 2.146 2.854a.5.5 0 0 1 0-.708z"/>
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
      <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
    </svg>
  );
}
