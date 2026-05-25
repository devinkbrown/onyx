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
        {...rest}
      >
        {loading
          ? <span className="btn-spinner" aria-hidden />
          : icon
            ? <span className="btn-icon">{icon}</span>
            : null
        }
        {children && <span>{children}</span>}
      </button>

      <style>{`
        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-family: inherit;
          font-weight: 500;
          border: none;
          border-radius: var(--r-md);
          cursor: pointer;
          transition: background var(--t-fast), transform var(--t-fast), opacity var(--t-fast);
          white-space: nowrap;
          user-select: none;
        }
        .btn:active:not(:disabled) { transform: scale(0.97); }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Sizes */
        .btn--sm  { height: 32px; padding: 0 12px; font-size: 13px; }
        .btn--md  { height: 40px; padding: 0 18px; font-size: 14px; }
        .btn--lg  { height: 48px; padding: 0 24px; font-size: 15px; }

        /* Variants */
        .btn--primary  { background: var(--accent); color: #fff; }
        .btn--primary:hover:not(:disabled)  { background: var(--accent-hover); }

        .btn--secondary { background: var(--bg-elevated); color: var(--text-primary); border: 1px solid var(--border-normal); }
        .btn--secondary:hover:not(:disabled) { background: var(--bg-float); border-color: var(--border-normal); }

        .btn--ghost { background: transparent; color: var(--text-secondary); }
        .btn--ghost:hover:not(:disabled) { background: var(--ch-hover-bg); color: var(--text-primary); }

        .btn--danger { background: var(--danger); color: #fff; }
        .btn--danger:hover:not(:disabled) { background: var(--danger-hover); }

        .btn--full { width: 100%; }

        /* Icon / Spinner */
        .btn-icon { display: flex; align-items: center; }
        .btn-spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
      `}</style>
    </>
  );
}
