'use client';

interface SpeakingBarsProps {
  speaking: boolean;
  size?: 'sm' | 'md';
}

/**
 * Animated equalizer bars shown next to a nick who is currently speaking.
 * Three bars bounce up and down when speaking=true; quiet when not.
 */
export default function SpeakingBars({ speaking, size = 'sm' }: SpeakingBarsProps) {
  const barH = size === 'md' ? 14 : 10;
  const barW = size === 'md' ? 3 : 2;
  const gap  = size === 'md' ? 2 : 1;
  const width = barW * 3 + gap * 2;

  return (
    <span
      className={`sb-wrap${speaking ? ' sb-wrap--speaking' : ''}`}
      aria-label={speaking ? 'Speaking' : 'Silent'}
      aria-hidden="true"
      style={{ width, height: barH, gap } as React.CSSProperties}
    >
      <span className="sb-bar sb-bar--1" style={{ width: barW, '--bar-max': `${barH}px` } as React.CSSProperties} />
      <span className="sb-bar sb-bar--2" style={{ width: barW, '--bar-max': `${barH}px` } as React.CSSProperties} />
      <span className="sb-bar sb-bar--3" style={{ width: barW, '--bar-max': `${barH}px` } as React.CSSProperties} />
      <style>{`
        @keyframes sb-bounce-1 {
          0%, 100% { transform: scaleY(0.2); }
          25%       { transform: scaleY(1.0); }
          50%       { transform: scaleY(0.4); }
          75%       { transform: scaleY(0.8); }
        }
        @keyframes sb-bounce-2 {
          0%, 100% { transform: scaleY(0.5); }
          30%       { transform: scaleY(0.2); }
          60%       { transform: scaleY(1.0); }
          80%       { transform: scaleY(0.6); }
        }
        @keyframes sb-bounce-3 {
          0%, 100% { transform: scaleY(0.8); }
          20%       { transform: scaleY(0.3); }
          55%       { transform: scaleY(1.0); }
          70%       { transform: scaleY(0.4); }
        }

        .sb-wrap {
          display: inline-flex;
          align-items: flex-end;
          flex-shrink: 0;
        }

        .sb-bar {
          border-radius: 1px;
          background: var(--text-muted);
          transform-origin: bottom;
          transform: scaleY(0.25);
          height: var(--bar-max, 10px);
          transition: background 200ms;
        }

        .sb-wrap--speaking .sb-bar {
          background: var(--accent, #7c5af5);
        }

        .sb-wrap--speaking .sb-bar--1 {
          animation: sb-bounce-1 700ms ease-in-out infinite;
        }
        .sb-wrap--speaking .sb-bar--2 {
          animation: sb-bounce-2 700ms ease-in-out infinite 120ms;
        }
        .sb-wrap--speaking .sb-bar--3 {
          animation: sb-bounce-3 700ms ease-in-out infinite 240ms;
        }
      `}</style>
    </span>
  );
}
