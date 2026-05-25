'use client';

import { useState, useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';

interface Props {
  channel: string;
  onClose: () => void;
}

const CATEGORIES = [
  'Just Chatting', 'Music', 'Art & Design', 'Gaming', 'Programming',
  'Science & Tech', 'Talk', 'Sports', 'Cooking', 'Education',
  'Travel', 'ASMR', 'Special Event',
];

export function GoLiveModal({ channel, onClose }: Props) {
  const startStream = useOnyxStore(s => s.startStream);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Just Chatting');
  const [customCategory, setCustomCategory] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [mode, setMode] = useState<'camera' | 'screen'>('camera');
  const [streamKey, setStreamKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const headingId = 'glm-heading';

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const effectiveCategory = useCustom ? customCategory : category;
  const canGoLive = title.trim().length > 0 && effectiveCategory.trim().length > 0;

  const handleGoLive = () => {
    if (!canGoLive) return;
    startStream(channel, title.trim(), effectiveCategory.trim(), mode, streamKey || undefined);
    onClose();
  };

  return (
    <div
      className="glm-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
    >
      <div className="glm-modal">
        {/* Header */}
        <div className="glm-header">
          <div className="glm-header-left">
            <span className="glm-live-dot" aria-hidden="true" />
            <div>
              <h2 id={headingId} className="glm-title">Go Live</h2>
              <p className="glm-channel-name">{channel}</p>
            </div>
          </div>
          <button className="glm-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div className="glm-body">
          {/* Stream title */}
          <label className="glm-label" htmlFor="glm-title-input">Stream Title</label>
          <input
            id="glm-title-input"
            ref={titleRef}
            className="glm-input"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 140))}
            placeholder="What are you streaming today?"
            maxLength={140}
            onKeyDown={(e) => { if (e.key === 'Enter' && canGoLive) handleGoLive(); }}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="glm-counter" aria-live="polite" aria-atomic="true">{title.length} / 140</div>

          {/* Category */}
          <label className="glm-label">Category</label>
          <div className="glm-cat-grid" role="group" aria-label="Stream category">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                type="button"
                className={`glm-cat-chip${!useCustom && category === cat ? ' glm-cat-chip--active' : ''}`}
                onClick={() => { setCategory(cat); setUseCustom(false); }}
                aria-pressed={!useCustom && category === cat}
              >
                {cat}
              </button>
            ))}
            <button
              type="button"
              className={`glm-cat-chip${useCustom ? ' glm-cat-chip--active' : ''}`}
              onClick={() => setUseCustom(true)}
              aria-pressed={useCustom}
            >
              Custom…
            </button>
          </div>
          {useCustom && (
            <input
              className="glm-input glm-input--sm"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value.slice(0, 80))}
              placeholder="Enter category name"
              aria-label="Custom category name"
              autoFocus
            />
          )}

          {/* Source mode */}
          <label className="glm-label">Source</label>
          <div className="glm-source-row" role="group" aria-label="Stream source">
            <button
              type="button"
              className={`glm-source-card${mode === 'camera' ? ' glm-source-card--active' : ''}`}
              onClick={() => setMode('camera')}
              aria-pressed={mode === 'camera'}
            >
              <CameraIcon />
              <span>Camera</span>
            </button>
            <button
              type="button"
              className={`glm-source-card${mode === 'screen' ? ' glm-source-card--active' : ''}`}
              onClick={() => setMode('screen')}
              aria-pressed={mode === 'screen'}
            >
              <ScreenIcon />
              <span>Screen Share</span>
            </button>
          </div>

          {/* Optional stream key */}
          <details className="glm-advanced">
            <summary className="glm-advanced-toggle">Advanced</summary>
            <div className="glm-advanced-body">
              <label className="glm-label" htmlFor="glm-stream-key">Stream Key <span className="glm-optional">(optional)</span></label>
              <div className="glm-key-wrap">
                <input
                  id="glm-stream-key"
                  className="glm-input"
                  type={showKey ? 'text' : 'password'}
                  value={streamKey}
                  onChange={(e) => setStreamKey(e.target.value)}
                  placeholder="Stream key for external encoder"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="glm-key-toggle"
                  onClick={() => setShowKey(v => !v)}
                  aria-label={showKey ? 'Hide stream key' : 'Show stream key'}
                >
                  {showKey ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>
          </details>
        </div>

        {/* Footer */}
        <div className="glm-footer">
          <button className="glm-btn-cancel" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`glm-btn-live${canGoLive ? '' : ' glm-btn-live--disabled'}`}
            type="button"
            onClick={handleGoLive}
            disabled={!canGoLive}
            aria-disabled={!canGoLive}
          >
            <span className="glm-live-dot glm-live-dot--btn" aria-hidden="true" />
            Go Live
          </button>
        </div>
      </div>

      <style>{`
        .glm-backdrop {
          position: fixed;
          inset: 0;
          z-index: 900;
          background: rgba(3, 8, 16, 0.82);
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(6px);
          animation: glm-fade-in 160ms ease-out;
        }
        @keyframes glm-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .glm-modal {
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: 16px;
          width: 100%;
          max-width: 460px;
          box-shadow: var(--shadow-xl);
          animation: glm-scale-in 180ms cubic-bezier(0.16,1,0.3,1);
          overflow: hidden;
        }
        @keyframes glm-scale-in {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* Header */
        .glm-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px 18px;
          border-bottom: 1px solid var(--border-subtle);
          background: linear-gradient(135deg, var(--accent-subtle) 0%, transparent 60%);
        }
        .glm-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .glm-live-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #e63946;
          box-shadow: 0 0 0 3px rgba(230,57,70,0.22), 0 0 8px rgba(230,57,70,0.5);
          flex-shrink: 0;
          animation: glm-pulse 2s ease-in-out infinite;
        }
        .glm-live-dot--btn {
          width: 8px;
          height: 8px;
          animation: none;
          box-shadow: 0 0 6px rgba(230,57,70,0.6);
        }
        @keyframes glm-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 3px rgba(230,57,70,0.22), 0 0 8px rgba(230,57,70,0.5); }
          50% { opacity: 0.85; box-shadow: 0 0 0 5px rgba(230,57,70,0.12), 0 0 12px rgba(230,57,70,0.6); }
        }
        .glm-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
          letter-spacing: -0.01em;
        }
        .glm-channel-name {
          font-size: 12px;
          color: var(--text-muted);
          margin: 1px 0 0;
          font-weight: 500;
        }
        .glm-close {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 6px;
          transition: background 120ms, color 120ms;
        }
        .glm-close:hover { background: var(--bg-overlay); color: var(--text-primary); }

        /* Body */
        .glm-body {
          padding: 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .glm-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-top: 12px;
          margin-bottom: 6px;
          display: block;
        }
        .glm-label:first-child { margin-top: 0; }
        .glm-input {
          width: 100%;
          background: var(--bg-overlay);
          border: 1px solid var(--border-normal);
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 14px;
          color: var(--text-primary);
          font-family: inherit;
          outline: none;
          box-sizing: border-box;
          transition: border-color 150ms, box-shadow 150ms;
        }
        .glm-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px var(--accent-glow);
        }
        .glm-input--sm { margin-top: 6px; }
        .glm-counter {
          font-size: 11px;
          color: var(--text-muted);
          text-align: right;
          margin-top: 3px;
          font-variant-numeric: tabular-nums;
        }
        .glm-optional { font-weight: 400; color: var(--text-muted); opacity: 0.7; }

        /* Category chips */
        .glm-cat-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .glm-cat-chip {
          padding: 4px 10px;
          background: var(--bg-overlay);
          border: 1px solid var(--border-normal);
          border-radius: 999px;
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary);
          cursor: pointer;
          font-family: inherit;
          transition: border-color 120ms, background 120ms, color 120ms;
        }
        .glm-cat-chip:hover {
          border-color: var(--accent-border);
          color: var(--text-primary);
          background: var(--accent-subtle);
        }
        .glm-cat-chip--active {
          border-color: var(--accent);
          background: var(--accent-subtle);
          color: var(--accent);
        }

        /* Source cards */
        .glm-source-row {
          display: flex;
          gap: 10px;
        }
        .glm-source-card {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 14px 10px;
          background: var(--bg-overlay);
          border: 1px solid var(--border-normal);
          border-radius: 10px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          font-family: inherit;
          transition: border-color 150ms, background 150ms, color 150ms;
        }
        .glm-source-card:hover {
          border-color: var(--accent-border);
          color: var(--text-primary);
          background: var(--accent-subtle);
        }
        .glm-source-card--active {
          border-color: var(--accent);
          background: var(--accent-subtle);
          color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent-glow);
        }

        /* Advanced */
        .glm-advanced { margin-top: 8px; }
        .glm-advanced-toggle {
          font-size: 12px;
          color: var(--text-muted);
          cursor: pointer;
          list-style: none;
          user-select: none;
          transition: color 120ms;
        }
        .glm-advanced-toggle::-webkit-details-marker { display: none; }
        .glm-advanced-toggle::before { content: '▸ '; }
        details[open] .glm-advanced-toggle::before { content: '▾ '; }
        .glm-advanced-toggle:hover { color: var(--text-secondary); }
        .glm-advanced-body { margin-top: 10px; }
        .glm-key-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }
        .glm-key-wrap .glm-input { padding-right: 40px; }
        .glm-key-toggle {
          position: absolute;
          right: 10px;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          padding: 2px;
          transition: color 120ms;
        }
        .glm-key-toggle:hover { color: var(--text-secondary); }

        /* Footer */
        .glm-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          padding: 14px 24px 18px;
          border-top: 1px solid var(--border-subtle);
        }
        .glm-btn-cancel {
          padding: 8px 18px;
          background: none;
          border: 1px solid var(--border-normal);
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          color: var(--text-secondary);
          cursor: pointer;
          font-family: inherit;
          transition: border-color 120ms, color 120ms, background 120ms;
        }
        .glm-btn-cancel:hover {
          border-color: var(--border-normal);
          background: var(--bg-overlay);
          color: var(--text-primary);
        }
        .glm-btn-live {
          padding: 8px 20px;
          background: linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%);
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 700;
          color: #fff;
          cursor: pointer;
          font-family: inherit;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: opacity 150ms, box-shadow 150ms;
          box-shadow: 0 4px 16px var(--accent-glow);
        }
        .glm-btn-live:hover:not(.glm-btn-live--disabled) {
          opacity: 0.92;
          box-shadow: 0 6px 20px rgba(14,165,233,0.4);
        }
        .glm-btn-live--disabled {
          background: var(--bg-overlay);
          color: var(--text-muted);
          cursor: not-allowed;
          box-shadow: none;
        }
        .glm-btn-live--disabled .glm-live-dot--btn {
          background: var(--text-muted);
          box-shadow: none;
        }
      `}</style>
    </div>
  );
}

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M1 1l12 12M13 1L1 13" />
  </svg>
);

const CameraIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M23 7l-7 5 7 5V7z"/>
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
  </svg>
);

const ScreenIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
    <line x1="8" y1="21" x2="16" y2="21"/>
    <line x1="12" y1="17" x2="12" y2="21"/>
  </svg>
);

const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);
