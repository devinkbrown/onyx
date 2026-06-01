'use client';

import { useState, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import { useDialogFocus } from './useDialogFocus';

// ── Relative time helper ───────────────────────────────────────────────────────

function relativeTime(sendAt: number): string {
  const diff = sendAt - Date.now();
  if (diff <= 0) return 'Sending…';
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)   return 'in less than a minute';
  if (mins < 60)  return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  if (days === 1) return `Tomorrow at ${new Date(sendAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return `in ${days} days`;
}

function formatAbsolute(sendAt: number): string {
  return new Date(sendAt).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDateTimeLocalMin(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ScheduledMessagesModal() {
  const activeView             = useOnyxStore(s => s.activeView);
  const scheduledMessages      = useOnyxStore(s => s.scheduledMessages);
  const scheduleMessage        = useOnyxStore(s => s.scheduleMessage);
  const cancelScheduledMessage = useOnyxStore(s => s.cancelScheduledMessage);
  const closeScheduledMessages = useOnyxStore(s => s.closeScheduledMessages);

  const defaultChannel =
    activeView.kind === 'channel' ? activeView.channel :
    activeView.kind === 'dm'      ? activeView.nick :
    '';

  const [channel, setChannel]   = useState(defaultChannel);
  const [msgText, setMsgText]   = useState('');
  const [dateTime, setDateTime] = useState('');
  const [error, setError]       = useState('');
  const channelRef = useRef<HTMLInputElement>(null);
  const panelRef   = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef);

  function handleSchedule() {
    setError('');
    const trimmedChannel = channel.trim();
    const trimmedText    = msgText.trim();
    if (!trimmedChannel) { setError('Channel or nick is required.'); return; }
    if (!trimmedText)    { setError('Message cannot be empty.'); return; }
    if (!dateTime)       { setError('Pick a date and time.'); return; }
    const sendAt = new Date(dateTime).getTime();
    if (isNaN(sendAt))   { setError('Invalid date/time.'); return; }
    if (sendAt <= Date.now()) { setError('Time must be in the future.'); return; }
    scheduleMessage(trimmedChannel, trimmedText, sendAt);
    setMsgText('');
    setDateTime('');
  }

  // min value for datetime-local: now rounded to the next minute
  const nowIso = formatDateTimeLocalMin(new Date(Date.now() + 60_000));

  return (
    <div
      className="smm-backdrop"
      onClick={e => { if (e.target === e.currentTarget) closeScheduledMessages(); }}
    >
      <div className="smm-panel" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="smm-modal-title">
        {/* Header */}
        <div className="smm-header">
          <div className="smm-title-row">
            <ClockIcon />
            <h2 id="smm-modal-title" className="smm-title">Schedule a Message</h2>
          </div>
          <button
            className="smm-close"
            aria-label="Close"
            onClick={closeScheduledMessages}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Form */}
        <div className="smm-form">
          <label className="smm-label" htmlFor="smm-channel">Channel or DM</label>
          <input
            id="smm-channel"
            ref={channelRef}
            className="smm-input"
            type="text"
            value={channel}
            onChange={e => setChannel(e.target.value)}
            placeholder="#channel or nick"
            autoComplete="off"
            spellCheck={false}
          />

          <label className="smm-label" htmlFor="smm-text">Message</label>
          <textarea
            id="smm-text"
            className="smm-textarea"
            value={msgText}
            onChange={e => setMsgText(e.target.value)}
            placeholder="What do you want to send?"
            rows={3}
          />

          <label className="smm-label" htmlFor="smm-datetime">Send at</label>
          <input
            id="smm-datetime"
            className="smm-input"
            type="datetime-local"
            value={dateTime}
            min={nowIso}
            onChange={e => setDateTime(e.target.value)}
          />

          {error && <p className="smm-error" role="alert">{error}</p>}

          <button
            className="smm-btn-schedule"
            onClick={handleSchedule}
            disabled={!channel.trim() || !msgText.trim() || !dateTime}
          >
            Schedule Message
          </button>
        </div>

        {/* Divider */}
        <div className="smm-divider" />

        {/* List */}
        <div className="smm-list-header">
          Pending ({scheduledMessages.length})
        </div>

        <div className="smm-list">
          {scheduledMessages.length === 0 ? (
            <div className="smm-empty">No scheduled messages</div>
          ) : (
            scheduledMessages.map(msg => (
              <div key={msg.id} className="smm-item">
                <div className="smm-item-meta">
                  <span className="smm-item-channel">{msg.channel}</span>
                  <span className="smm-item-time" title={formatAbsolute(msg.sendAt)}>
                    {relativeTime(msg.sendAt)}
                  </span>
                </div>
                <div className="smm-item-body">
                  <span className="smm-item-text">{msg.text}</span>
                  <button
                    className="smm-cancel"
                    aria-label={`Cancel scheduled message: ${msg.text.slice(0, 40)}`}
                    onClick={() => cancelScheduledMessage(msg.id)}
                  >
                    <CancelIcon />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <style>{`
        .smm-backdrop {
          position: fixed; inset: 0;
          background: rgba(3, 8, 16, 0.72);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center;
          z-index: 500;
          animation: smm-fade 160ms ease both;
        }
        @keyframes smm-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        .smm-panel {
          width: min(520px, 92vw);
          max-height: 85dvh;
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-xl);
          display: flex; flex-direction: column;
          overflow: hidden;
          animation: smm-rise 200ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
        }
        @keyframes smm-rise {
          from { opacity: 0; transform: translateY(10px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }

        .smm-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 18px 20px 14px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .smm-title-row {
          display: flex; align-items: center; gap: 10px;
        }
        .smm-title-row svg {
          color: var(--accent, #0ea5e9);
          flex-shrink: 0;
        }
        .smm-title {
          margin: 0;
          font-size: 15px; font-weight: 700;
          color: var(--text-primary, #dff0ff);
          letter-spacing: -0.01em;
        }
        .smm-close {
          width: 30px; height: 30px;
          background: none; border: none; cursor: pointer;
          color: var(--text-muted, #3d6480);
          border-radius: 8px; display: flex; align-items: center; justify-content: center;
          transition: background 140ms, color 140ms;
        }
        .smm-close:hover {
          background: var(--accent-subtle);
          color: var(--text-primary);
        }

        .smm-form {
          padding: 18px 20px;
          display: flex; flex-direction: column; gap: 8px;
          flex-shrink: 0;
        }
        .smm-label {
          font-size: 11px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.07em;
          color: var(--text-muted, #3d6480);
          margin-bottom: 2px;
        }
        .smm-input,
        .smm-textarea {
          width: 100%; box-sizing: border-box;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          padding: 9px 12px;
          font-size: 13px;
          color: var(--text-primary);
          outline: none;
          transition: border-color 140ms, box-shadow 140ms;
          font-family: inherit;
          resize: none;
        }
        .smm-input:focus,
        .smm-textarea:focus {
          border-color: var(--accent-border);
          box-shadow: 0 0 0 2.5px var(--accent-glow);
        }
        .smm-input::placeholder,
        .smm-textarea::placeholder {
          color: var(--text-muted);
        }
        /* datetime-local icon tinting */
        .smm-input[type="datetime-local"]::-webkit-calendar-picker-indicator {
          filter: invert(0.6) sepia(1) saturate(3) hue-rotate(175deg);
          cursor: pointer;
          opacity: 0.7;
        }

        .smm-error {
          font-size: 12px; color: #f87171;
          margin: 0; padding: 6px 10px;
          background: rgba(248, 113, 113, 0.08);
          border-radius: 6px;
          border: 1px solid rgba(248, 113, 113, 0.2);
        }

        .smm-btn-schedule {
          align-self: flex-end;
          padding: 8px 18px;
          background: var(--accent, #0ea5e9);
          color: #fff;
          border: none; border-radius: 8px;
          font-size: 13px; font-weight: 600;
          cursor: pointer;
          transition: opacity 140ms, transform 100ms;
        }
        .smm-btn-schedule:hover { opacity: 0.88; }
        .smm-btn-schedule:active { transform: scale(0.97); }
        .smm-btn-schedule:disabled {
          opacity: 0.38; cursor: not-allowed;
        }

        .smm-divider {
          height: 1px;
          background: var(--border-subtle);
          flex-shrink: 0;
        }

        .smm-list-header {
          padding: 12px 20px 8px;
          font-size: 11px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.07em;
          color: var(--text-muted, #3d6480);
          flex-shrink: 0;
        }

        .smm-list {
          flex: 1; overflow-y: auto;
          padding: 0 12px 12px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }
        .smm-list::-webkit-scrollbar { width: 4px; }
        .smm-list::-webkit-scrollbar-thumb {
          background: var(--border-normal); border-radius: 2px;
        }

        .smm-empty {
          text-align: center;
          padding: 24px 0;
          font-size: 13px;
          color: var(--text-muted, #3d6480);
        }

        .smm-item {
          padding: 10px 12px;
          border-radius: var(--r-md);
          border: 1px solid var(--border-subtle);
          background: var(--bg-elevated);
          margin-bottom: 6px;
          transition: border-color 140ms, background 140ms;
        }
        .smm-item:hover {
          border-color: var(--border-normal);
          background: var(--bg-float);
        }
        .smm-item:last-child { margin-bottom: 0; }

        .smm-item-meta {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 4px;
        }
        .smm-item-channel {
          font-size: 12px; font-weight: 700;
          color: var(--accent);
          font-family: var(--font-mono, monospace);
        }
        .smm-item-time {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          background: var(--bg-float);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-full);
          padding: 1px 7px;
        }

        .smm-item-body {
          display: flex; align-items: flex-start; gap: 8px;
        }
        .smm-item-text {
          flex: 1;
          font-size: 13px;
          color: var(--text-secondary, #7aa8c4);
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          word-break: break-word;
        }
        .smm-cancel {
          flex-shrink: 0;
          width: 24px; height: 24px;
          background: none; border: none;
          cursor: pointer;
          color: var(--text-muted, #3d6480);
          border-radius: 5px;
          display: flex; align-items: center; justify-content: center;
          transition: background 140ms, color 140ms;
          margin-top: 1px;
        }
        .smm-cancel:hover {
          background: rgba(248, 113, 113, 0.12);
          color: #f87171;
        }
      `}</style>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CancelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
