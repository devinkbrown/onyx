'use client';

import { useState, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import ModalShell from './ModalShell';

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
    <ModalShell
      onClose={closeScheduledMessages}
      title="Schedule a Message"
      kicker="Later"
      titleId="smm-modal-title"
      size="md"
      flushBody
    >
      {/* Form */}
      <div className="smm-form">
        <div className="smm-field">
          <label className="label-caps smm-label" htmlFor="smm-channel">Channel or DM</label>
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
        </div>

        <div className="smm-field">
          <label className="label-caps smm-label" htmlFor="smm-text">Message</label>
          <textarea
            id="smm-text"
            className="smm-textarea"
            value={msgText}
            onChange={e => setMsgText(e.target.value)}
            placeholder="What do you want to send?"
            rows={3}
          />
        </div>

        <div className="smm-field">
          <label className="label-caps smm-label" htmlFor="smm-datetime">Send at</label>
          <input
            id="smm-datetime"
            className="smm-input"
            type="datetime-local"
            value={dateTime}
            min={nowIso}
            onChange={e => setDateTime(e.target.value)}
          />
        </div>

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
      <div className="label-caps smm-list-header">
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

      <style>{`
        .smm-form {
          padding: var(--sp-4, 16px) var(--sp-5, 20px);
          display: flex; flex-direction: column; gap: var(--sp-4, 16px);
          flex-shrink: 0;
        }
        .smm-field {
          display: flex; flex-direction: column; gap: var(--sp-1, 4px);
        }
        .smm-label {
          margin-bottom: 2px;
        }
        .smm-input,
        .smm-textarea {
          width: 100%; box-sizing: border-box;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          padding: 9px 12px;
          font-size: var(--text-sm, 13px);
          color: var(--text-primary);
          outline: none;
          transition: border-color var(--t-control, 150ms), box-shadow var(--t-control, 150ms);
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
          font-size: var(--text-xs, 12px); color: #f87171;
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
          font-size: var(--text-sm, 13px); font-weight: 600;
          cursor: pointer;
          transition: opacity var(--t-control, 150ms), transform var(--t-micro, 90ms);
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
          padding: var(--sp-3, 12px) var(--sp-5, 20px) var(--sp-2, 8px);
          flex-shrink: 0;
        }

        .smm-list {
          flex: 1; overflow-y: auto;
          padding: 0 var(--sp-3, 12px) var(--sp-3, 12px);
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }
        .smm-list::-webkit-scrollbar { width: 4px; }
        .smm-list::-webkit-scrollbar-thumb {
          background: var(--border-normal); border-radius: 2px;
        }

        .smm-empty {
          text-align: center;
          padding: var(--sp-6, 24px) 0;
          font-size: var(--text-sm, 13px);
          color: var(--text-muted, #3d6480);
        }

        .smm-item {
          padding: 10px 12px;
          border-radius: var(--r-md);
          border: 1px solid var(--border-subtle);
          background: var(--elev-tint-1, var(--bg-elevated));
          margin-bottom: 6px;
          transition: border-color var(--t-control, 150ms), background var(--t-control, 150ms);
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
          font-size: var(--text-xs, 12px); font-weight: 700;
          color: var(--accent);
          font-family: var(--font-mono, monospace);
        }
        .smm-item-time {
          font-size: var(--text-2xs, 11px);
          font-weight: 600;
          color: var(--text-muted);
          background: var(--bg-float);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-full);
          padding: 1px 7px;
        }

        .smm-item-body {
          display: flex; align-items: flex-start; gap: var(--sp-2, 8px);
        }
        .smm-item-text {
          flex: 1;
          font-size: var(--text-sm, 13px);
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
          transition: background var(--t-control, 150ms), color var(--t-control, 150ms);
          margin-top: 1px;
        }
        .smm-cancel:hover {
          background: rgba(248, 113, 113, 0.12);
          color: #f87171;
        }
      `}</style>
    </ModalShell>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

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
