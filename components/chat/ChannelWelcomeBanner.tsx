'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  channel: string;
  topic: string;
  memberCount: number;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 8000;

export default function ChannelWelcomeBanner({ channel, topic, memberCount, onDismiss }: Props) {
  const [progress, setProgress] = useState(100);
  const [visible, setVisible] = useState(true);
  const onDismissRef = useRef(onDismiss);
  const dismissedRef = useRef(false);
  const channelKey = channel.toLowerCase();

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setVisible(false);
    onDismissRef.current();
  }, []);

  useEffect(() => {
    dismissedRef.current = false;
    setProgress(100);
    setVisible(true);

    const startTime = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100);
      setProgress(pct);
      if (pct <= 0) {
        clearInterval(id);
        dismiss();
      }
    }, 50);
    return () => clearInterval(id);
  }, [channelKey, dismiss]);

  if (!visible) return null;

  return (
    <div className="cwb-root" role="status" aria-live="polite">
      <div className="cwb-body">
        <div className="cwb-left-accent" aria-hidden="true" />
        <div className="cwb-content">
          <div className="cwb-channel-row">
            <span className="cwb-sigil">#</span>
            <span className="cwb-channel-name">{channel.replace(/^[#&]/, '')}</span>
            {memberCount > 0 && (
              <span className="cwb-member-pill">{memberCount} members</span>
            )}
          </div>
          {topic ? (
            <p className="cwb-topic">{topic}</p>
          ) : (
            <p className="cwb-topic cwb-topic--empty">No topic set.</p>
          )}
        </div>
        <button
          className="cwb-dismiss"
          onClick={dismiss}
          aria-label="Dismiss welcome banner"
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
            <path d="M2 2l8 8M10 2l-8 8"/>
          </svg>
        </button>
      </div>
      <div className="cwb-progress-track" aria-hidden="true">
        <div className="cwb-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <style>{`
        .cwb-root {
          position: relative;
          flex-shrink: 0;
          overflow: hidden;
          animation: cwb-slide-in 240ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
        }
        @keyframes cwb-slide-in {
          from { opacity: 0; transform: translateY(-10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .cwb-body {
          display: flex;
          align-items: flex-start;
          gap: 0;
          background: linear-gradient(135deg,
            rgba(14,165,233,0.08) 0%,
            var(--bg-elevated, #132131) 60%);
          border-bottom: 1px solid var(--border-subtle);
          padding: 12px 16px 14px;
          position: relative;
        }
        .cwb-left-accent {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          background: linear-gradient(180deg, var(--accent, #0ea5e9) 0%, var(--gold, #e8b84b) 100%);
          border-radius: 0 2px 2px 0;
          box-shadow: 0 0 8px rgba(14,165,233,0.35);
        }
        .cwb-content {
          flex: 1;
          min-width: 0;
          padding-left: 14px;
        }
        .cwb-channel-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 5px;
        }
        .cwb-sigil {
          font-size: 18px;
          font-weight: 800;
          color: var(--accent, #0ea5e9);
          line-height: 1;
          opacity: 0.8;
        }
        .cwb-channel-name {
          font-size: 16px;
          font-weight: 800;
          color: var(--text-primary);
          line-height: 1;
          letter-spacing: -0.3px;
        }
        .cwb-member-pill {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          background: var(--bg-float, var(--bg-base));
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-full, 9999px);
          padding: 2px 8px;
          line-height: 1.5;
          flex-shrink: 0;
        }
        .cwb-begin-text {
          font-size: 12px;
          color: var(--text-muted);
          margin: 0 0 4px;
          font-style: italic;
        }
        .cwb-topic {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0;
          line-height: 1.55;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 64px;
          overflow: hidden;
        }
        .cwb-topic--empty {
          color: var(--text-muted);
          font-style: italic;
        }
        .cwb-dismiss {
          flex-shrink: 0;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          font-size: 13px;
          line-height: 1;
          padding: 3px 5px;
          border-radius: var(--r-xs);
          transition: color var(--t-fast), background var(--t-fast);
          align-self: flex-start;
          margin-top: 2px;
        }
        .cwb-dismiss:hover {
          color: var(--text-primary);
          background: var(--ch-hover-bg, rgba(14,165,233,0.07));
        }
        .cwb-progress-track {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--border-subtle);
        }
        .cwb-progress-fill {
          height: 100%;
          background: var(--accent, #0ea5e9);
          opacity: 0.55;
          transition: width 50ms linear;
        }
      `}</style>
    </div>
  );
}
