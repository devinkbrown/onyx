'use client';

import { ButtonHTMLAttributes } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

export default function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  fullWidth = false,
  icon,
  children,
  disabled,
  className = '',
  type = 'button',
  ...rest
}: Props) {
  const base = 'btn';
  const variantClass = `btn--${variant}`;
  const sizeClass = `btn--${size}`;
  const widthClass = fullWidth ? 'btn--full' : '';

  return (
    <>
      <button
        className={`${base} ${variantClass} ${sizeClass} ${widthClass} ${className}`}
        disabled={disabled || loading}
        type={type}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading ? <span className="btn-spinner" aria-hidden /> : icon ? <span className="btn-icon">{icon}</span> : null}
        {children && <span className="btn-label">{children}</span>}
      </button>

      <style>{`
        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: var(--sp-2, 8px);
          font-family: var(--font-ui, inherit);
          font-size: var(--text-sm, 0.8125rem);
          font-weight: 600;
          border: 1px solid transparent;
          cursor: pointer;
          transition:
            background-color var(--t-control, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1)),
            border-color var(--t-control, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1)),
            color var(--t-control, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1)),
            box-shadow var(--t-control, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1)),
            transform var(--t-micro, 90ms) var(--ease-out, cubic-bezier(.16,1,.3,1)),
            opacity var(--t-control, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1));
          white-space: nowrap;
          user-select: none;
          letter-spacing: 0;
          position: relative;
          height: 36px;
          padding: 0 var(--sp-3, 12px);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
        }
        .btn:hover:not(:disabled) { transform: translateY(-1px); }
        .btn:active:not(:disabled) { transform: translateY(0.5px); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
        .btn[aria-busy="true"] { cursor: progress; }
        .btn:focus-visible {
          outline: var(--focus-ring-width, 2px) solid var(--focus-ring, var(--accent, #0ea5e9));
          outline-offset: var(--focus-ring-offset, 2px);
        }
        .btn-label { display: inline-flex; align-items: center; }

        /* Sizes */
        .btn--sm  { height: 28px; padding: 0 var(--sp-2, 8px); font-size: var(--text-xs, 0.75rem); }
        .btn--md  { height: 36px; padding: 0 var(--sp-3, 12px); font-size: var(--text-sm, 0.8125rem); }
        .btn--lg  { height: 44px; padding: 0 var(--sp-5, 20px); font-size: var(--text-base, 0.875rem); }

        .btn--primary {
          background-color: var(--accent, #0ea5e9);
          color: var(--on-accent, #fff);
          border-color: color-mix(in srgb, var(--accent, #0ea5e9) 82%, #fff 18%);
          border-radius: var(--r-md, 8px) var(--r-lg, 12px) var(--r-md, 8px) var(--r-sm, 6px);
          box-shadow:
            var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)),
            var(--elev-shadow-1, 0 8px 24px rgba(0,0,0,.28));
        }
        .btn--primary:hover:not(:disabled) {
          background-color: color-mix(in srgb, var(--accent, #0ea5e9) 94%, #000 6%);
          border-color: color-mix(in srgb, var(--accent, #0ea5e9) 76%, #fff 24%);
          box-shadow:
            var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)),
            var(--elev-shadow-2, 0 18px 48px rgba(0,0,0,.38));
        }
        .btn--primary:active:not(:disabled) {
          background-color: color-mix(in srgb, var(--accent, #0ea5e9) 88%, #000 12%);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 8px 24px rgba(0,0,0,.28));
        }

        .btn--secondary {
          background: var(--elev-tint-1, var(--bg-elevated, #132131));
          color: var(--text-primary, #f0f4ff);
          border-color: var(--border-subtle, rgba(255,255,255,.12));
          border-radius: var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px) var(--r-lg, 12px);
          box-shadow:
            var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)),
            var(--elev-shadow-1, 0 8px 24px rgba(0,0,0,.28));
        }
        .btn--secondary:hover:not(:disabled) {
          background: color-mix(in srgb, var(--elev-tint-1, var(--bg-elevated, #132131)) 92%, var(--text-primary, #fff) 8%);
          border-color: color-mix(in srgb, var(--border-normal, rgba(255,255,255,.18)) 76%, var(--text-primary, #fff) 24%);
        }
        .btn--secondary:active:not(:disabled) {
          background: color-mix(in srgb, var(--elev-tint-1, var(--bg-elevated, #132131)) 90%, #000 10%);
        }

        .btn--ghost {
          background: transparent;
          color: var(--text-secondary, #a0a8c8);
          border-color: transparent;
          border-radius: var(--r-sm, 6px) var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px);
          box-shadow: none;
        }
        .btn--ghost:hover:not(:disabled) {
          background: color-mix(in srgb, var(--text-primary, #f0f4ff) 8%, transparent);
          color: var(--text-primary, #f0f4ff);
        }
        .btn--ghost:active:not(:disabled) {
          background: color-mix(in srgb, var(--text-primary, #f0f4ff) 12%, transparent);
          color: var(--text-primary, #f0f4ff);
        }

        .btn--danger {
          background: var(--danger, #f87171);
          color: var(--danger-contrast, #fff);
          border-color: color-mix(in srgb, var(--danger, #f87171) 80%, #fff 20%);
          border-radius: var(--r-md, 8px) var(--r-sm, 6px) var(--r-lg, 12px) var(--r-md, 8px);
          box-shadow:
            var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)),
            var(--elev-shadow-1, 0 8px 24px rgba(0,0,0,.28));
        }
        .btn--danger:hover:not(:disabled) {
          background: color-mix(in srgb, var(--danger, #f87171) 94%, #000 6%);
          box-shadow:
            var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)),
            var(--elev-shadow-2, 0 18px 48px rgba(0,0,0,.38));
        }
        .btn--danger:active:not(:disabled) {
          background: color-mix(in srgb, var(--danger, #f87171) 88%, #000 12%);
        }

        .btn--full { width: 100%; }

        /* Icon / Spinner */
        .btn-icon { display: flex; align-items: center; flex-shrink: 0; }
        .btn-spinner {
          width: 13px; height: 13px;
          border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
          border-top-color: currentColor;
          border-radius: 50%;
          animation: btn-spin 0.65s linear infinite;
          flex-shrink: 0;
        }
        @keyframes btn-spin {
          to { transform: rotate(360deg); }
        }

        @media (prefers-reduced-motion: reduce) {
          .btn,
          .btn-spinner {
            transition-duration: 1ms;
            animation-duration: 1ms;
            animation-iteration-count: 1;
          }
          .btn:hover:not(:disabled),
          .btn:active:not(:disabled) {
            transform: none;
          }
        }
      `}</style>
    </>
  );
}
