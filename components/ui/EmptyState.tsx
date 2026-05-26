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
    el.style.transform = 'translateY(12px)';
    const raf = requestAnimationFrame(() => {
      el.style.transition = 'opacity 420ms cubic-bezier(0.16,1,0.3,1), transform 420ms cubic-bezier(0.16,1,0.3,1)';
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={rootRef} className={`es-root es-root--${size}`} aria-live="polite">
      {/* Ocean depth decorations */}
      <div className="es-depth" aria-hidden="true">
        <div className="es-depth-ring es-depth-ring--1" />
        <div className="es-depth-ring es-depth-ring--2" />
        <div className="es-depth-ring es-depth-ring--3" />
      </div>

      <div className={`es-icon-wrap es-icon-wrap--${size}`} aria-hidden="true">
        <div className="es-icon-glow" />
        <span className={`es-icon es-icon--${size}`}>{icon}</span>
      </div>

      <p className="es-title">{title}</p>
      {description && <p className="es-desc">{description}</p>}
      {action && (
        <button className="es-action" onClick={action.onClick}>
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
          gap: 8px;
          overflow: hidden;
        }
        .es-root--sm { padding: 28px 20px; }
        .es-root--md { padding: 48px 24px; }
        .es-root--lg { padding: 64px 32px; }

        /* Depth rings — faint concentric halos */
        .es-depth {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }
        .es-depth-ring {
          position: absolute;
          border-radius: 50%;
          border: 1px solid var(--accent, #0ea5e9);
        }
        .es-depth-ring--1 {
          width: 80px; height: 80px;
          opacity: 0.06;
        }
        .es-depth-ring--2 {
          width: 140px; height: 140px;
          opacity: 0.04;
        }
        .es-depth-ring--3 {
          width: 200px; height: 200px;
          opacity: 0.025;
        }
        .es-root--sm .es-depth-ring--1 { width: 60px; height: 60px; }
        .es-root--sm .es-depth-ring--2 { width: 100px; height: 100px; }
        .es-root--sm .es-depth-ring--3 { width: 140px; height: 140px; }
        .es-root--lg .es-depth-ring--1 { width: 100px; height: 100px; }
        .es-root--lg .es-depth-ring--2 { width: 180px; height: 180px; }
        .es-root--lg .es-depth-ring--3 { width: 260px; height: 260px; }

        /* Icon wrapper with glow */
        .es-icon-wrap {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 6px;
          z-index: 1;
        }
        .es-icon-wrap--sm { width: 48px; height: 48px; }
        .es-icon-wrap--md { width: 60px; height: 60px; }
        .es-icon-wrap--lg { width: 80px; height: 80px; }

        .es-icon-glow {
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          background: radial-gradient(circle, var(--accent-glow, rgba(14,165,233,0.18)) 0%, transparent 70%);
          filter: blur(4px);
        }

        .es-icon {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          line-height: 1;
        }
        .es-icon--sm { font-size: 24px; }
        .es-icon--md { font-size: 32px; }
        .es-icon--lg { font-size: 44px; }

        .es-title {
          position: relative;
          z-index: 1;
          margin: 4px 0 0;
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary, #dff0ff);
          letter-spacing: -0.1px;
          line-height: 1.3;
        }
        .es-root--sm .es-title { font-size: 13px; margin-top: 2px; }
        .es-root--lg .es-title { font-size: 18px; }

        .es-desc {
          position: relative;
          z-index: 1;
          margin: 0;
          font-size: 13px;
          color: var(--text-muted, #3d6480);
          line-height: 1.55;
          max-width: 260px;
          text-align: center;
        }
        .es-root--sm .es-desc { font-size: 12px; max-width: 220px; }
        .es-root--lg .es-desc { font-size: 14px; max-width: 300px; }

        .es-action {
          position: relative;
          z-index: 1;
          margin-top: 10px;
          padding: 0 18px;
          height: 36px;
          border-radius: var(--r-md, 8px);
          background: linear-gradient(135deg, var(--accent, #0ea5e9), color-mix(in srgb, var(--accent, #0ea5e9) 80%, #06b6d4));
          color: #fff;
          border: 1px solid rgba(255,255,255,0.1);
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          letter-spacing: 0.01em;
          transition:
            box-shadow 160ms cubic-bezier(0.16,1,0.3,1),
            transform 160ms cubic-bezier(0.16,1,0.3,1);
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          box-shadow: 0 2px 8px var(--accent-glow, rgba(14,165,233,0.25));
        }
        .es-action:hover {
          box-shadow: 0 4px 16px var(--accent-glow, rgba(14,165,233,0.45));
          transform: translateY(-1px);
        }
        .es-action:active {
          box-shadow: 0 1px 4px rgba(0,0,0,0.3);
          transform: translateY(0);
        }
        .es-action:focus-visible {
          outline: 2px solid var(--accent, #0ea5e9);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
