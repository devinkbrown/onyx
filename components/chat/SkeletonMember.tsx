'use client';

interface Props {
  count?: number;
}

export default function SkeletonMember({ count = 10 }: Props) {
  return (
    <div className="skel-ml-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skel-ml-row skel-mlrow-${i + 1}`}>
          <div className="skel-ml-avatar-el" />
          <div className="skel-ml-item skel-ml-name" />
        </div>
      ))}

      <style>{`
        @keyframes skel-ml-shimmer {
          from { background-position: -200% center; }
          to   { background-position:  200% center; }
        }

        .skel-ml-item {
          background: linear-gradient(
            90deg,
            var(--bg-elevated) 25%,
            var(--bg-float)    50%,
            var(--bg-elevated) 75%
          );
          background-size: 200% 100%;
          animation: skel-ml-shimmer 1.6s ease-in-out infinite;
          border-radius: 4px;
        }

        .skel-ml-avatar-el {
          background: linear-gradient(
            90deg,
            var(--bg-elevated) 25%,
            var(--bg-float)    50%,
            var(--bg-elevated) 75%
          );
          background-size: 200% 100%;
          animation: skel-ml-shimmer 1.6s ease-in-out infinite;
          border-radius: 50%;
          flex-shrink: 0;
          /* 24px avatar per spec */
          width: 24px;
          height: 24px;
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
          gap: 9px;
          padding: 4px 8px;
          height: 32px;
        }

        /* Vary name widths */
        .skel-mlrow-1  .skel-ml-name { width:  72px; height: 11px; }
        .skel-mlrow-2  .skel-ml-name { width:  92px; height: 11px; }
        .skel-mlrow-3  .skel-ml-name { width:  58px; height: 11px; }
        .skel-mlrow-4  .skel-ml-name { width:  86px; height: 11px; }
        .skel-mlrow-5  .skel-ml-name { width:  68px; height: 11px; }
        .skel-mlrow-6  .skel-ml-name { width:  80px; height: 11px; }
        .skel-mlrow-7  .skel-ml-name { width:  74px; height: 11px; }
        .skel-mlrow-8  .skel-ml-name { width:  64px; height: 11px; }
        .skel-mlrow-9  .skel-ml-name { width:  88px; height: 11px; }
        .skel-mlrow-10 .skel-ml-name { width:  70px; height: 11px; }

        /* Stagger animation delay per row */
        .skel-mlrow-1  .skel-ml-item, .skel-mlrow-1  .skel-ml-avatar-el { animation-delay:   0ms; }
        .skel-mlrow-2  .skel-ml-item, .skel-mlrow-2  .skel-ml-avatar-el { animation-delay:  70ms; }
        .skel-mlrow-3  .skel-ml-item, .skel-mlrow-3  .skel-ml-avatar-el { animation-delay: 140ms; }
        .skel-mlrow-4  .skel-ml-item, .skel-mlrow-4  .skel-ml-avatar-el { animation-delay: 210ms; }
        .skel-mlrow-5  .skel-ml-item, .skel-mlrow-5  .skel-ml-avatar-el { animation-delay: 280ms; }
        .skel-mlrow-6  .skel-ml-item, .skel-mlrow-6  .skel-ml-avatar-el { animation-delay: 350ms; }
        .skel-mlrow-7  .skel-ml-item, .skel-mlrow-7  .skel-ml-avatar-el { animation-delay: 420ms; }
        .skel-mlrow-8  .skel-ml-item, .skel-mlrow-8  .skel-ml-avatar-el { animation-delay: 490ms; }
        .skel-mlrow-9  .skel-ml-item, .skel-mlrow-9  .skel-ml-avatar-el { animation-delay: 560ms; }
        .skel-mlrow-10 .skel-ml-item, .skel-mlrow-10 .skel-ml-avatar-el { animation-delay: 630ms; }
      `}</style>
    </div>
  );
}
