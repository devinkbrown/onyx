'use client';

interface Props {
  count?: number;
}

export default function SkeletonMember({ count = 10 }: Props) {
  return (
    <div className="skel-ml-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skel-ml-row skel-mlrow-${i + 1}`}>
          <div className="skeleton-avatar skel-ml-avatar" />
          <div className="skeleton-item skel-ml-name" />
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

        .skel-ml-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 8px 8px;
        }

        .skel-ml-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 4px 8px;
        }

        .skel-ml-avatar {
          width: 32px;
          height: 32px;
        }

        /* Vary name widths between ~60px and ~90px */
        .skel-mlrow-1  .skel-ml-name { width:  72px; height: 12px; }
        .skel-mlrow-2  .skel-ml-name { width:  88px; height: 12px; }
        .skel-mlrow-3  .skel-ml-name { width:  60px; height: 12px; }
        .skel-mlrow-4  .skel-ml-name { width:  90px; height: 12px; }
        .skel-mlrow-5  .skel-ml-name { width:  68px; height: 12px; }
        .skel-mlrow-6  .skel-ml-name { width:  82px; height: 12px; }
        .skel-mlrow-7  .skel-ml-name { width:  76px; height: 12px; }
        .skel-mlrow-8  .skel-ml-name { width:  64px; height: 12px; }
        .skel-mlrow-9  .skel-ml-name { width:  86px; height: 12px; }
        .skel-mlrow-10 .skel-ml-name { width:  70px; height: 12px; }

        /* Stagger animation delay per row */
        .skel-mlrow-1  .skeleton-item,
        .skel-mlrow-1  .skeleton-avatar { animation-delay:   0ms; }
        .skel-mlrow-2  .skeleton-item,
        .skel-mlrow-2  .skeleton-avatar { animation-delay: 100ms; }
        .skel-mlrow-3  .skeleton-item,
        .skel-mlrow-3  .skeleton-avatar { animation-delay: 200ms; }
        .skel-mlrow-4  .skeleton-item,
        .skel-mlrow-4  .skeleton-avatar { animation-delay: 300ms; }
        .skel-mlrow-5  .skeleton-item,
        .skel-mlrow-5  .skeleton-avatar { animation-delay: 400ms; }
        .skel-mlrow-6  .skeleton-item,
        .skel-mlrow-6  .skeleton-avatar { animation-delay: 500ms; }
        .skel-mlrow-7  .skeleton-item,
        .skel-mlrow-7  .skeleton-avatar { animation-delay: 600ms; }
        .skel-mlrow-8  .skeleton-item,
        .skel-mlrow-8  .skeleton-avatar { animation-delay: 700ms; }
        .skel-mlrow-9  .skeleton-item,
        .skel-mlrow-9  .skeleton-avatar { animation-delay: 800ms; }
        .skel-mlrow-10 .skeleton-item,
        .skel-mlrow-10 .skeleton-avatar { animation-delay: 900ms; }
      `}</style>
    </div>
  );
}
