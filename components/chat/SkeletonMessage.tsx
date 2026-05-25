'use client';

interface Props {
  count?: number;
}

export default function SkeletonMessage({ count = 8 }: Props) {
  return (
    <div className="skel-msg-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skel-msg-row skel-row-${i + 1}`}>
          <div className="skeleton-avatar skel-msg-avatar" />
          <div className="skel-msg-body">
            <div className="skeleton-item skel-msg-nick" />
            <div className="skeleton-item skel-msg-text" />
          </div>
        </div>
      ))}

      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }

        .skeleton-item {
          background: linear-gradient(
            90deg,
            var(--bg-surface) 25%,
            var(--bg-overlay) 50%,
            var(--bg-surface) 75%
          );
          background-size: 200% 100%;
          animation: shimmer 1.4s ease infinite;
          border-radius: 4px;
        }

        .skeleton-avatar {
          background: linear-gradient(
            90deg,
            var(--bg-surface) 25%,
            var(--bg-overlay) 50%,
            var(--bg-surface) 75%
          );
          background-size: 200% 100%;
          animation: shimmer 1.4s ease infinite;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .skel-msg-list {
          display: flex;
          flex-direction: column;
          gap: 20px;
          padding: 16px 16px 8px;
          flex: 1;
        }

        .skel-msg-row {
          display: flex;
          align-items: flex-start;
          gap: 12px;
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
        }

        .skel-msg-nick {
          height: 12px;
          width: 80px;
        }

        .skel-msg-text {
          height: 14px;
        }

        /* Vary text line widths per row */
        .skel-row-1  .skel-msg-text { width: 72%; }
        .skel-row-2  .skel-msg-text { width: 55%; }
        .skel-row-3  .skel-msg-text { width: 83%; }
        .skel-row-4  .skel-msg-text { width: 61%; }
        .skel-row-5  .skel-msg-text { width: 78%; }
        .skel-row-6  .skel-msg-text { width: 48%; }
        .skel-row-7  .skel-msg-text { width: 90%; }
        .skel-row-8  .skel-msg-text { width: 66%; }
        .skel-row-9  .skel-msg-text { width: 74%; }
        .skel-row-10 .skel-msg-text { width: 52%; }

        /* Stagger animation delay per row */
        .skel-row-1  .skeleton-item,
        .skel-row-1  .skeleton-avatar { animation-delay:   0ms; }
        .skel-row-2  .skeleton-item,
        .skel-row-2  .skeleton-avatar { animation-delay: 100ms; }
        .skel-row-3  .skeleton-item,
        .skel-row-3  .skeleton-avatar { animation-delay: 200ms; }
        .skel-row-4  .skeleton-item,
        .skel-row-4  .skeleton-avatar { animation-delay: 300ms; }
        .skel-row-5  .skeleton-item,
        .skel-row-5  .skeleton-avatar { animation-delay: 400ms; }
        .skel-row-6  .skeleton-item,
        .skel-row-6  .skeleton-avatar { animation-delay: 500ms; }
        .skel-row-7  .skeleton-item,
        .skel-row-7  .skeleton-avatar { animation-delay: 600ms; }
        .skel-row-8  .skeleton-item,
        .skel-row-8  .skeleton-avatar { animation-delay: 700ms; }
        .skel-row-9  .skeleton-item,
        .skel-row-9  .skeleton-avatar { animation-delay: 800ms; }
        .skel-row-10 .skeleton-item,
        .skel-row-10 .skeleton-avatar { animation-delay: 900ms; }
      `}</style>
    </div>
  );
}
