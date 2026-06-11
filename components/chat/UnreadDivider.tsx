'use client';

export default function UnreadDivider() {
  return (
    <div className="unread-divider" role="separator" aria-label="New messages">
      <span className="unread-divider__line" aria-hidden />
      <span className="unread-divider__label">NEW</span>
      <span className="unread-divider__line" aria-hidden />
      <style>{`
        .unread-divider {
          display: flex;
          align-items: center;
          gap: var(--sp-3, 12px);
          padding: var(--sp-2, 8px) var(--sp-4, 16px);
          margin: var(--sp-3, 12px) 0 var(--sp-2, 8px);
          position: relative;
          overflow: hidden;
          isolation: isolate;
        }
        .unread-divider::after {
          content: '';
          position: absolute;
          left: var(--sp-4, 16px);
          right: var(--sp-4, 16px);
          top: 50%;
          height: 1px;
          transform: translateX(-110%);
          background: var(--lux, #d8b96a);
          opacity: 0.55;
          clip-path: inset(0 76% 0 0);
          animation: unread-divider-shimmer 760ms var(--ease-out, cubic-bezier(.16,1,.3,1)) 80ms both;
          pointer-events: none;
        }
        .unread-divider__line {
          flex: 1;
          height: 1px;
          background: color-mix(in srgb, var(--lux, #d8b96a) 62%, transparent);
          opacity: 0.7;
        }
        .unread-divider__label {
          font-size: var(--text-2xs, .6875rem);
          font-weight: 800;
          letter-spacing: 0.12em;
          color: var(--lux, #d8b96a);
          background: color-mix(in srgb, var(--bg-elevated, #132131) 86%, transparent);
          border: 1px solid color-mix(in srgb, var(--lux, #d8b96a) 32%, transparent);
          border-radius: var(--r-full, 9999px);
          padding: 2px var(--sp-2, 8px);
          line-height: 1.25;
        }
        @keyframes unread-divider-shimmer {
          from { transform: translateX(-110%); }
          to { transform: translateX(110%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .unread-divider::after { animation: none; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
