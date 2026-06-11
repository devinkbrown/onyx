'use client';

import { useState } from 'react';

interface ErrorStateProps {
  title?: string;
  message?: string;
  details?: string;
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
}

export default function ErrorState({
  title = 'Something went off course',
  message = 'The last request could not be completed.',
  details,
  retryLabel = 'Retry',
  onRetry,
  className = '',
}: ErrorStateProps) {
  const [copied, setCopied] = useState(false);
  const detailText = details || `${title}\n${message}`;

  const copyDetails = async () => {
    try {
      await navigator.clipboard?.writeText(detailText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={`err-state ${className}`.trim()} role="alert" data-testid="error-state">
      <div className="err-mark" aria-hidden>
        <span />
      </div>
      <div className="err-copy">
        <h2 className="err-title">{title}</h2>
        <p className="err-message">{message}</p>
      </div>
      <div className="err-actions">
        {onRetry && (
          <button className="err-btn err-btn--primary" type="button" onClick={onRetry}>
            {retryLabel}
          </button>
        )}
        <button className="err-btn err-btn--secondary" type="button" onClick={copyDetails}>
          {copied ? 'Copied' : 'Copy details'}
        </button>
      </div>

      <style>{`
        .err-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--sp-4, 16px);
          padding: var(--sp-16, 64px);
          min-height: 220px;
          text-align: center;
          color: var(--text-primary, #eef4ff);
          background: var(--elev-tint-1, color-mix(in srgb, var(--accent, #0ea5e9) 2%, transparent));
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 8px 18px rgba(0,0,0,.28));
          border-radius: var(--r-xl, 16px) var(--r-md, 8px) var(--r-2xl, 20px) var(--r-lg, 12px);
        }
        .err-mark {
          width: 54px;
          height: 54px;
          display: grid;
          place-items: center;
          border-radius: 43% 57% 49% 51%;
          background: color-mix(in srgb, var(--danger, #f87171) 15%, var(--bg-elevated, #121923));
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-2, 0 14px 32px rgba(0,0,0,.34));
        }
        .err-mark span {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 1px solid color-mix(in srgb, var(--danger, #f87171) 70%, transparent);
          position: relative;
        }
        .err-mark span::before,
        .err-mark span::after {
          content: '';
          position: absolute;
          left: 50%;
          top: 5px;
          width: 2px;
          height: 8px;
          border-radius: 2px;
          background: var(--danger, #f87171);
          transform: translateX(-50%);
        }
        .err-mark span::after {
          top: 15px;
          height: 2px;
        }
        .err-copy {
          display: flex;
          flex-direction: column;
          gap: var(--sp-2, 8px);
          max-width: 420px;
        }
        .err-title {
          margin: 0;
          font-family: var(--font-display), Georgia, serif;
          font-size: var(--text-xl, 1.25rem);
          font-weight: 650;
          line-height: 1.2;
          letter-spacing: 0;
        }
        .err-message {
          margin: 0;
          color: var(--text-muted, #7f8da3);
          font-size: var(--text-sm, .8125rem);
          line-height: 1.55;
        }
        .err-actions {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: var(--sp-2, 8px);
        }
        .err-btn {
          min-height: 36px;
          padding: 0 var(--sp-4, 16px);
          border-radius: var(--r-sm, 6px) var(--r-md, 8px) var(--r-sm, 6px) var(--r-lg, 12px);
          font-family: inherit;
          font-size: var(--text-sm, .8125rem);
          font-weight: 700;
          letter-spacing: 0;
          cursor: pointer;
          transition:
            background var(--t-control, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1)),
            transform var(--t-control, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1));
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), 0 1px 2px rgba(0,0,0,.32);
        }
        .err-btn--primary {
          color: var(--accent-contrast, #fff);
          background: color-mix(in srgb, var(--accent, #0ea5e9) 86%, #000 14%);
          border: 1px solid color-mix(in srgb, var(--accent, #0ea5e9) 42%, transparent);
        }
        .err-btn--secondary {
          color: var(--text-primary, #eef4ff);
          background: var(--elev-tint-2, color-mix(in srgb, var(--accent, #0ea5e9) 3%, transparent));
          border: 1px solid color-mix(in srgb, var(--text-muted, #7f8da3) 18%, transparent);
        }
        .err-btn:hover {
          transform: translateY(-1px);
        }
        .err-btn:active {
          transform: translateY(0);
        }
        .err-btn:focus-visible {
          outline: 2px solid var(--accent, #0ea5e9);
          outline-offset: 2px;
        }

        @media (prefers-reduced-motion: reduce) {
          .err-btn {
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
