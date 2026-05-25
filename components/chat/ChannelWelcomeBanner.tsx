'use client';

import { useEffect, useState } from 'react';

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

  useEffect(() => {
    const startTime = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100);
      setProgress(pct);
      if (pct <= 0) {
        clearInterval(id);
        setVisible(false);
        onDismiss();
      }
    }, 50);
    return () => clearInterval(id);
  }, [onDismiss]);

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
          onClick={() => { setVisible(false); onDismiss(); }}
          aria-label="Dismiss welcome banner"
          type="button"
        >
          ✕
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
          animation: cwb-slide-in 200ms ease-out;
        }
        @keyframes cwb-slide-in {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .cwb-body {
          display: flex;
          align-items: flex-start;
          gap: 0;
          background: var(--bg-surface, var(--bg-elevated, #1e1e2e));
          border-bottom: 1px solid var(--border-subtle);
          padding: 10px 16px 12px;
          position: relative;
        }
        .cwb-left-accent {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          background: var(--accent, #7c5af5);
          border-radius: 0 2px 2px 0;
        }
        .cwb-content {
          flex: 1;
          min-width: 0;
          padding-left: 12px;
        }
        .cwb-channel-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 4px;
        }
        .cwb-sigil {
          font-size: 14px;
          font-weight: 700;
          color: var(--accent, #7c5af5);
          line-height: 1;
        }
        .cwb-channel-name {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1;
        }
        .cwb-member-pill {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          background: var(--bg-float, var(--bg-base));
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-full, 9999px);
          padding: 1px 7px;
          line-height: 1.5;
        }
        .cwb-topic {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 60px;
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
          padding: 2px 4px;
          border-radius: var(--r-xs);
          transition: color var(--t-fast), background var(--t-fast);
          align-self: flex-start;
          margin-top: 1px;
        }
        .cwb-dismiss:hover {
          color: var(--text-primary);
          background: var(--ch-hover-bg);
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
          background: var(--accent, #7c5af5);
          opacity: 0.6;
          transition: width 50ms linear;
        }
      `}</style>
    </div>
  );
}
