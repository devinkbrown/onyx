'use client';

import { useEffect, useRef } from 'react';

export interface EmptyStateProps {
  icon: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  size?: 'sm' | 'md' | 'lg';
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
}: EmptyStateProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    const raf = requestAnimationFrame(() => {
      el.style.transition = 'opacity 400ms ease, transform 400ms ease';
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={rootRef} className={`es-root es-root--${size}`} aria-live="polite">
      <span className={`es-icon es-icon--${size}`} aria-hidden="true">{icon}</span>
      <p className="es-title">{title}</p>
      {description && <p className="es-desc">{description}</p>}
      {action && (
        <button className="es-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}

      <style>{`
        .es-root {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 8px;
          padding: 32px 20px;
        }
        .es-root--sm { padding: 20px 16px; }
        .es-root--md { padding: 32px 20px; }
        .es-root--lg { padding: 48px 24px; }

        .es-icon {
          display: block;
          line-height: 1;
          filter: drop-shadow(0 2px 8px rgba(124,90,245,0.18));
        }
        .es-icon--sm { font-size: 32px; }
        .es-icon--md { font-size: 48px; }
        .es-icon--lg { font-size: 64px; }

        .es-title {
          margin: 4px 0 0;
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.1px;
          line-height: 1.35;
        }
        .es-root--sm .es-title { font-size: 13px; margin-top: 2px; }
        .es-root--lg .es-title { font-size: 17px; }

        .es-desc {
          margin: 0;
          font-size: 13px;
          color: var(--text-muted);
          line-height: 1.55;
          max-width: 280px;
        }
        .es-root--sm .es-desc { font-size: 12px; }
        .es-root--lg .es-desc { font-size: 14px; max-width: 320px; }

        .es-action {
          margin-top: 6px;
          padding: 8px 18px;
          border-radius: var(--r-md);
          background: var(--accent);
          color: #fff;
          border: none;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          transition: opacity 150ms, transform 150ms;
          white-space: nowrap;
        }
        .es-action:hover { opacity: 0.85; transform: translateY(-1px); }
        .es-action:active { opacity: 1; transform: translateY(0); }
      `}</style>
    </div>
  );
}
