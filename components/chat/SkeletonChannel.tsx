'use client';

interface Props {
  count?: number;
}

export default function SkeletonChannel({ count = 6 }: Props) {
  return (
    <div className="skel-ch-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skel-ch-row skel-chrow-${i + 1}`}>
          <div className="skel-ch-item skel-ch-icon" />
          <div className="skel-ch-right">
            <div className="skel-ch-item skel-ch-name" />
            <div className="skel-ch-item skel-ch-count" />
          </div>
        </div>
      ))}

      <style>{`
        @keyframes skel-ch-shimmer {
          from { background-position: -200% center; }
          to   { background-position:  200% center; }
        }

        .skel-ch-item {
          background: linear-gradient(
            90deg,
            var(--bg-elevated) 25%,
            var(--bg-float)    50%,
            var(--bg-elevated) 75%
          );
          background-size: 200% 100%;
          animation: skel-ch-shimmer 1.6s ease-in-out infinite;
          border-radius: 4px;
          flex-shrink: 0;
        }

        .skel-ch-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 6px 8px;
        }

        /* 28px compact row height */
        .skel-ch-row {
          display: flex;
          align-items: center;
          gap: 7px;
          height: 28px;
          padding: 0 8px;
        }

        .skel-ch-icon {
          width: 12px;
          height: 11px;
        }

        /* Name + count in one line with space-between */
        .skel-ch-right {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-width: 0;
        }

        .skel-ch-name  { height: 11px; }
        .skel-ch-count { height: 11px; width: 20px; border-radius: 6px; }

        /* Vary name widths */
        .skel-chrow-1  .skel-ch-name { width:  88px; }
        .skel-chrow-2  .skel-ch-name { width: 112px; }
        .skel-chrow-3  .skel-ch-name { width:  76px; }
        .skel-chrow-4  .skel-ch-name { width: 120px; }
        .skel-chrow-5  .skel-ch-name { width:  96px; }
        .skel-chrow-6  .skel-ch-name { width: 104px; }
        .skel-chrow-7  .skel-ch-name { width:  80px; }
        .skel-chrow-8  .skel-ch-name { width: 116px; }
        .skel-chrow-9  .skel-ch-name { width:  92px; }
        .skel-chrow-10 .skel-ch-name { width: 108px; }

        /* Hide count on some rows for variety */
        .skel-chrow-2 .skel-ch-count,
        .skel-chrow-4 .skel-ch-count,
        .skel-chrow-7 .skel-ch-count { display: none; }

        /* Stagger */
        .skel-chrow-1  .skel-ch-item { animation-delay:   0ms; }
        .skel-chrow-2  .skel-ch-item { animation-delay:  70ms; }
        .skel-chrow-3  .skel-ch-item { animation-delay: 140ms; }
        .skel-chrow-4  .skel-ch-item { animation-delay: 210ms; }
        .skel-chrow-5  .skel-ch-item { animation-delay: 280ms; }
        .skel-chrow-6  .skel-ch-item { animation-delay: 350ms; }
        .skel-chrow-7  .skel-ch-item { animation-delay: 420ms; }
        .skel-chrow-8  .skel-ch-item { animation-delay: 490ms; }
        .skel-chrow-9  .skel-ch-item { animation-delay: 560ms; }
        .skel-chrow-10 .skel-ch-item { animation-delay: 630ms; }
      `}</style>
    </div>
  );
}
