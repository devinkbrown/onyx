'use client';

interface Props {
  count?: number;
}

export default function SkeletonMessage({ count = 8 }: Props) {
  return (
    <div className="skel-msg-list" aria-hidden="true" data-testid="skeleton-message">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skel-msg-row skel-row-${i + 1}`}>
          <div className="skeleton-avatar skel-msg-avatar" />
          <div className="skel-msg-body">
            <div className="skel-msg-head">
              <div className="skeleton-item skel-msg-nick" />
              <div className="skeleton-item skel-msg-time" />
            </div>
            <div className="skeleton-item skel-msg-line1" />
            <div className="skeleton-item skel-msg-line2" />
          </div>
        </div>
      ))}

      <style>{`
        @keyframes skel-msg-shimmer {
          from { background-position: -200% center; }
          to   { background-position:  200% center; }
        }

        .skeleton-item {
          background: linear-gradient(
            90deg,
            var(--elev-tint-1, var(--bg-elevated)) 25%,
            var(--elev-tint-3, var(--bg-float)) 50%,
            var(--elev-tint-1, var(--bg-elevated)) 75%
          );
          background-size: 200% 100%;
          animation: skel-msg-shimmer 1.8s var(--ease-out, ease) infinite;
          border-radius: var(--r-xs, 4px) var(--r-sm, 6px) var(--r-xs, 4px) var(--r-md, 8px);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
        }

        .skeleton-avatar {
          background: linear-gradient(
            90deg,
            var(--elev-tint-1, var(--bg-elevated)) 25%,
            var(--elev-tint-3, var(--bg-float)) 50%,
            var(--elev-tint-1, var(--bg-elevated)) 75%
          );
          background-size: 200% 100%;
          animation: skel-msg-shimmer 1.8s var(--ease-out, ease) infinite;
          border-radius: 50%;
          flex-shrink: 0;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
        }

        .skel-msg-list {
          display: flex;
          flex-direction: column;
          gap: var(--sp-4, 16px);
          padding: var(--sp-5, 20px) var(--sp-4, 16px) var(--sp-3, 12px);
          flex: 1;
        }

        .skel-msg-row {
          display: flex;
          align-items: flex-start;
          gap: var(--sp-3, 12px);
          min-height: 36px;
        }

        .skel-msg-avatar {
          width: 36px;
          height: 36px;
        }

        .skel-msg-body {
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex: 1;
          min-width: 0;
          padding-top: 2px;
        }

        .skel-msg-head {
          display: flex;
          align-items: center;
          gap: var(--sp-2, 8px);
          height: 14px;
        }

        .skel-msg-nick {
          height: 10px;
          width: 92px;
        }

        .skel-msg-time {
          height: 8px;
          width: 38px;
          opacity: 0.72;
        }

        .skel-msg-line1,
        .skel-msg-line2 {
          height: 10px;
        }

        /* Vary content line widths per row — three lines each */
        .skel-row-1  .skel-msg-line1 { width: 90%; }
        .skel-row-1  .skel-msg-line2 { width: 60%; }

        .skel-row-2  .skel-msg-line1 { width: 75%; }
        .skel-row-2  .skel-msg-line2 { width: 55%; }

        .skel-row-3  .skel-msg-line1 { width: 88%; }
        .skel-row-3  .skel-msg-line2 { width: 70%; }

        .skel-row-4  .skel-msg-line1 { width: 65%; }
        .skel-row-4  .skel-msg-line2 { display: none; }

        .skel-row-5  .skel-msg-line1 { width: 82%; }
        .skel-row-5  .skel-msg-line2 { width: 50%; }

        .skel-row-6  .skel-msg-line1 { width: 92%; }
        .skel-row-6  .skel-msg-line2 { width: 78%; }

        .skel-row-7  .skel-msg-line1 { width: 58%; }
        .skel-row-7  .skel-msg-line2 { display: none; }

        .skel-row-8  .skel-msg-line1 { width: 77%; }
        .skel-row-8  .skel-msg-line2 { width: 62%; }

        .skel-row-9  .skel-msg-line1 { width: 85%; }
        .skel-row-9  .skel-msg-line2 { width: 68%; }

        .skel-row-10 .skel-msg-line1 { width: 70%; }
        .skel-row-10 .skel-msg-line2 { display: none; }

        /* Stagger animation delay per row */
        .skel-row-1  .skeleton-item, .skel-row-1  .skeleton-avatar { animation-delay:   0ms; }
        .skel-row-2  .skeleton-item, .skel-row-2  .skeleton-avatar { animation-delay:  80ms; }
        .skel-row-3  .skeleton-item, .skel-row-3  .skeleton-avatar { animation-delay: 160ms; }
        .skel-row-4  .skeleton-item, .skel-row-4  .skeleton-avatar { animation-delay: 240ms; }
        .skel-row-5  .skeleton-item, .skel-row-5  .skeleton-avatar { animation-delay: 320ms; }
        .skel-row-6  .skeleton-item, .skel-row-6  .skeleton-avatar { animation-delay: 400ms; }
        .skel-row-7  .skeleton-item, .skel-row-7  .skeleton-avatar { animation-delay: 480ms; }
        .skel-row-8  .skeleton-item, .skel-row-8  .skeleton-avatar { animation-delay: 560ms; }
        .skel-row-9  .skeleton-item, .skel-row-9  .skeleton-avatar { animation-delay: 640ms; }
        .skel-row-10 .skeleton-item, .skel-row-10 .skeleton-avatar { animation-delay: 720ms; }

        @media (prefers-reduced-motion: reduce) {
          .skeleton-item,
          .skeleton-avatar {
            animation: none;
            background-position: 50% 50%;
          }
        }
      `}</style>
    </div>
  );
}
