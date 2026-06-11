'use client';

import type React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'historyExhausted';
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  variant = 'default',
  className = '',
}: EmptyStateProps) {
  const resolvedTitle = title ?? (variant === 'historyExhausted' ? 'You have reached the sea floor' : 'Nothing here yet');
  const resolvedDescription = description ?? (variant === 'historyExhausted'
    ? 'There are no older messages to surface in this channel.'
    : undefined);

  return (
    <div
      className={`es-root es-root--${size} es-root--${variant} ${className}`.trim()}
      aria-live="polite"
      data-testid="empty-state"
    >
      <div className="es-figure" aria-hidden="true">
        <span className="es-ring es-ring--outer" />
        <span className="es-ring es-ring--middle" />
        <span className="es-ring es-ring--inner" />
        <span className="es-current" />
        {icon && <span className="es-icon">{icon}</span>}
      </div>

      <h2 className="es-title">{resolvedTitle}</h2>
      {resolvedDescription && <p className="es-desc">{resolvedDescription}</p>}
      {action && (
        <button className="es-action" type="button" onClick={action.onClick}>
          {action.label}
        </button>
      )}

      <style>{`
        .es-root {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: var(--sp-3, 12px);
          overflow: hidden;
          padding: var(--sp-16, 64px);
          color: var(--text-primary, #eef4ff);
        }

        .es-figure {
          position: relative;
          width: 112px;
          height: 112px;
          display: grid;
          place-items: center;
          margin-bottom: var(--sp-2, 8px);
        }
        .es-root--sm .es-figure {
          width: 88px;
          height: 88px;
        }
        .es-root--lg .es-figure {
          width: 136px;
          height: 136px;
        }
        .es-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 1px solid color-mix(in srgb, var(--text-muted, #6d7890) 30%, transparent);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
        }
        .es-ring--middle {
          inset: 17%;
          opacity: 0.72;
        }
        .es-ring--inner {
          inset: 34%;
          opacity: 0.55;
        }
        .es-current {
          position: relative;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: color-mix(in srgb, var(--lux, #d8b96a) 72%, var(--bg-deep, #05080e));
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 8px 18px rgba(0,0,0,.28));
        }
        .es-icon {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted, #7f8da3);
          font-size: var(--text-2xl, 24px);
          line-height: 1;
          transform: translateY(-1px);
        }

        .es-title {
          position: relative;
          z-index: 1;
          margin: 0;
          font-family: var(--font-display), Georgia, serif;
          font-size: var(--text-xl, 1.25rem);
          font-weight: 650;
          color: var(--text-primary, #eef4ff);
          letter-spacing: 0;
          line-height: 1.2;
        }
        .es-root--sm .es-title { font-size: var(--text-lg, 1.0625rem); }
        .es-root--lg .es-title { font-size: var(--text-2xl, 1.5rem); }

        .es-desc {
          position: relative;
          z-index: 1;
          margin: 0;
          font-size: var(--text-sm, .8125rem);
          color: var(--text-muted, #7f8da3);
          line-height: 1.55;
          max-width: 320px;
          text-align: center;
        }

        .es-action {
          position: relative;
          z-index: 1;
          margin-top: var(--sp-2, 8px);
          min-height: 36px;
          padding: 0 var(--sp-4, 16px);
          border-radius: var(--r-md, 8px) var(--r-sm, 6px) var(--r-lg, 12px) var(--r-sm, 6px);
          background: color-mix(in srgb, var(--accent, #0ea5e9) 86%, #000 14%);
          color: var(--accent-contrast, #fff);
          border: 1px solid color-mix(in srgb, var(--accent, #0ea5e9) 42%, transparent);
          cursor: pointer;
          font-size: var(--text-sm, .8125rem);
          font-weight: 700;
          font-family: inherit;
          letter-spacing: 0;
          transition:
            background var(--t-control, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1)),
            transform var(--t-control, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1));
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), 0 1px 2px rgba(0,0,0,.32);
        }
        .es-action:hover {
          background: color-mix(in srgb, var(--accent, #0ea5e9) 92%, #000 8%);
          transform: translateY(-1px);
        }
        .es-action:active {
          transform: translateY(0);
        }
        .es-action:focus-visible {
          outline: 2px solid var(--accent, #0ea5e9);
          outline-offset: 2px;
        }

        @media (prefers-reduced-motion: no-preference) {
          .es-root {
            animation: es-enter var(--t-overlay-in, 320ms) var(--ease-out, cubic-bezier(.16,1,.3,1)) both;
          }
          @keyframes es-enter {
            from { opacity: 0; transform: translateY(var(--sp-3, 12px)); }
            to { opacity: 1; transform: translateY(0); }
          }
        }
      `}</style>
    </div>
  );
}
