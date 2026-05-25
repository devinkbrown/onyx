'use client';

interface Props {
  count?: number;
}

export default function SkeletonChannel({ count = 6 }: Props) {
  return (
    <div className="skel-ch-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skel-ch-row skel-chrow-${i + 1}`}>
          <div className="skeleton-item skel-ch-icon" />
          <div className="skeleton-item skel-ch-name" />
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

        .skel-ch-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 8px 8px;
        }

        .skel-ch-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 8px;
        }

        .skel-ch-icon {
          width: 12px;
          height: 12px;
          flex-shrink: 0;
        }

        /* Vary name widths between ~80px and ~120px via nth-child trick */
        .skel-chrow-1  .skel-ch-name { width:  88px; height: 12px; }
        .skel-chrow-2  .skel-ch-name { width: 112px; height: 12px; }
        .skel-chrow-3  .skel-ch-name { width:  80px; height: 12px; }
        .skel-chrow-4  .skel-ch-name { width: 120px; height: 12px; }
        .skel-chrow-5  .skel-ch-name { width:  96px; height: 12px; }
        .skel-chrow-6  .skel-ch-name { width: 104px; height: 12px; }
        .skel-chrow-7  .skel-ch-name { width:  84px; height: 12px; }
        .skel-chrow-8  .skel-ch-name { width: 116px; height: 12px; }
        .skel-chrow-9  .skel-ch-name { width:  92px; height: 12px; }
        .skel-chrow-10 .skel-ch-name { width: 108px; height: 12px; }

        /* Stagger animation delay per row */
        .skel-chrow-1  .skeleton-item { animation-delay:   0ms; }
        .skel-chrow-2  .skeleton-item { animation-delay: 100ms; }
        .skel-chrow-3  .skeleton-item { animation-delay: 200ms; }
        .skel-chrow-4  .skeleton-item { animation-delay: 300ms; }
        .skel-chrow-5  .skeleton-item { animation-delay: 400ms; }
        .skel-chrow-6  .skeleton-item { animation-delay: 500ms; }
        .skel-chrow-7  .skeleton-item { animation-delay: 600ms; }
        .skel-chrow-8  .skeleton-item { animation-delay: 700ms; }
        .skel-chrow-9  .skeleton-item { animation-delay: 800ms; }
        .skel-chrow-10 .skeleton-item { animation-delay: 900ms; }
      `}</style>
    </div>
  );
}
