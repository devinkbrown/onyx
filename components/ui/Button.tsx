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
        {...rest}
      >
        {/* Only show built-in spinner when loading AND caller didn't provide
            custom loading content as children (avoids double-spinner). */}
        {loading && !children ? <span className="btn-spinner" aria-hidden /> : null}
        {!loading && icon ? <span className="btn-icon">{icon}</span> : null}
        {children && <span>{children}</span>}
      </button>

      <style>{`
        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          font-family: inherit;
          font-size: 14px;
          font-weight: 600;
          border: 1px solid transparent;
          border-radius: var(--r-md, 8px);
          cursor: pointer;
          transition:
            background 150ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
            border-color 150ms,
            box-shadow 150ms,
            transform 150ms,
            opacity 150ms;
          white-space: nowrap;
          user-select: none;
          letter-spacing: 0.01em;
          position: relative;
          height: 36px;
          padding: 0 12px;
        }
        .btn:active:not(:disabled) { transform: scale(0.97); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
        .btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--bg-base, #0c1828), 0 0 0 4px var(--accent, #0ea5e9);
        }

        /* Sizes */
        .btn--sm  { height: 28px; padding: 0 10px; font-size: 12px; }
        .btn--md  { height: 36px; padding: 0 12px; font-size: 14px; }
        .btn--lg  { height: 44px; padding: 0 20px; font-size: 15px; }

        /* ── Primary — accent gradient bg, white text, glow on hover ── */
        .btn--primary {
          background: linear-gradient(135deg, var(--accent, #0ea5e9), color-mix(in srgb, var(--accent, #0ea5e9) 80%, #06b6d4));
          color: #fff;
          border-color: rgba(255,255,255,0.1);
          box-shadow: 0 1px 3px rgba(0,0,0,0.35), 0 0 0 0 var(--accent-glow, rgba(14,165,233,0.4));
        }
        .btn--primary:hover:not(:disabled) {
          background: linear-gradient(135deg, var(--accent-hover, #38bdf8), color-mix(in srgb, var(--accent-hover, #38bdf8) 80%, #22d3ee));
          box-shadow:
            0 4px 12px var(--accent-glow, rgba(14,165,233,0.45)),
            0 0 0 1px rgba(255,255,255,0.1) inset;
        }
        .btn--primary:active:not(:disabled) {
          background: linear-gradient(135deg, var(--accent, #0ea5e9), color-mix(in srgb, var(--accent, #0ea5e9) 70%, #0284c7));
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        }

        /* ── Secondary — transparent bg, 1px accent border, accent text ── */
        .btn--secondary {
          background: transparent;
          color: var(--accent, #0ea5e9);
          border-color: var(--accent, #0ea5e9);
        }
        .btn--secondary:hover:not(:disabled) {
          background: var(--accent-subtle, rgba(14,165,233,0.1));
          border-color: var(--accent-hover, #38bdf8);
          color: var(--accent-hover, #38bdf8);
        }

        /* ── Ghost — transparent, no border, hover shows float bg ── */
        .btn--ghost {
          background: transparent;
          color: var(--text-secondary, #a0a8c8);
          border-color: transparent;
        }
        .btn--ghost:hover:not(:disabled) {
          background: var(--bg-float, #1a2c40);
          color: var(--text-primary, #f0f4ff);
        }

        /* ── Danger — solid red bg, white text, red glow on hover ── */
        .btn--danger {
          background: var(--danger, #f87171);
          color: #fff;
          border-color: rgba(255,255,255,0.08);
          box-shadow: 0 1px 4px rgba(248,113,113,0.3);
        }
        .btn--danger:hover:not(:disabled) {
          background: color-mix(in srgb, var(--danger, #f87171) 85%, #fff 15%);
          box-shadow: 0 4px 12px rgba(248,113,113,0.5);
        }
        .btn--danger:active:not(:disabled) {
          background: color-mix(in srgb, var(--danger, #f87171) 90%, #000 10%);
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        }

        .btn--full { width: 100%; }

        /* Icon / Spinner */
        .btn-icon { display: flex; align-items: center; }
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

        /* Focus ring accessible outline */
        .btn:focus-visible {
          outline: 2px solid var(--accent, #0ea5e9);
          outline-offset: 2px;
          box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent, #0ea5e9) 20%, transparent);
        }
      `}</style>
    </>
  );
}
