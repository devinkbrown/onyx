'use client';

import { useState, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import ModalShell from './ModalShell';

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

  const filteredCount = buildFilteredMessages().length;

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

  return (
    <ModalShell
      onClose={closeExportModal}
      title="Export Chat History"
      kicker="Archive"
      titleId="export-modal-title"
      size="sm"
      closeLabel="Close export modal"
      footer={
        <button className="export-btn" onClick={handleExport} disabled={filteredCount === 0}>
          <DownloadIcon />
          Export {filteredCount > 0 ? `${filteredCount} message${filteredCount !== 1 ? 's' : ''}` : '(no messages)'}
        </button>
      }
    >
      <div className="export-content">
        {/* Channel info */}
        <div className="export-channel-info">
          <span className="export-channel-name">#{channelName.replace(/^[#&]/, '')}</span>
          <span className="export-sep">—</span>
          <span className="export-msg-count">{filteredCount} message{filteredCount !== 1 ? 's' : ''}</span>
        </div>

        {/* Format selection */}
        <div className="export-section">
          <div className="label-caps export-section-label">Format</div>
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
          <div className="label-caps export-section-label">Date range</div>
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
      </div>

      <style>{`
        .export-content {
          display: flex;
          flex-direction: column;
          gap: var(--sp-4, 16px);
        }

        .export-channel-info {
          display: flex;
          align-items: center;
          gap: var(--sp-2, 8px);
          padding: 10px 12px;
          background: var(--elev-tint-1, var(--bg-elevated, var(--bg-float)));
          border-radius: var(--r-md, 8px);
          border: 1px solid var(--border-subtle);
        }

        .export-channel-name {
          font-size: var(--text-sm, 13px);
          font-weight: 700;
          color: var(--text-primary);
        }

        .export-sep {
          color: var(--text-muted);
          font-size: var(--text-xs, 12px);
        }

        .export-msg-count {
          font-size: var(--text-xs, 12px);
          color: var(--text-secondary);
        }

        .export-section {
          display: flex;
          flex-direction: column;
          gap: var(--sp-2, 8px);
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
          transition: border-color var(--t-control, 150ms), background var(--t-control, 150ms), box-shadow var(--t-control, 150ms);
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
          font-size: var(--text-sm, 13px);
          font-weight: 600;
          color: var(--text-primary);
          flex: 1;
        }

        .export-format-ext {
          font-size: var(--text-2xs, 11px);
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
          font-size: var(--text-sm, 13px);
          font-weight: 600;
          color: var(--text-primary);
        }

        .export-toggle-hint {
          font-size: var(--text-xs, 12px);
          color: var(--text-muted);
        }

        .export-date-range {
          display: flex;
          gap: var(--sp-3, 12px);
          margin-top: var(--sp-1, 4px);
        }

        .export-date-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
        }

        .export-date-label {
          font-size: var(--text-2xs, 11px);
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
          font-size: var(--text-sm, 13px);
          padding: 6px 8px;
          outline: none;
          width: 100%;
          box-sizing: border-box;
          transition: border-color var(--t-control, 150ms);
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
          gap: var(--sp-2, 8px);
          width: 100%;
          padding: 12px 16px;
          background: var(--accent, #0ea5e9);
          color: #fff;
          font-size: var(--text-base, 14px);
          font-weight: 700;
          border: none;
          border-radius: var(--r-md, 8px);
          cursor: pointer;
          transition: opacity var(--t-control, 150ms), transform var(--t-micro, 90ms);
          font-family: inherit;
          letter-spacing: 0.01em;
        }
        .export-btn:hover:not(:disabled) {
          opacity: 0.92;
        }
        .export-btn:active:not(:disabled) {
          transform: scale(0.98);
        }
        .export-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>
    </ModalShell>
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
