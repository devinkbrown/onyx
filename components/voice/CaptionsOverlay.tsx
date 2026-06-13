'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

interface CaptionEventDetail {
  nick?: string;
  text?: string;
  final?: boolean;
}

interface CaptionLine {
  id: number;
  nick: string;
  text: string;
  final: boolean;
}

function nickColor(nick: string): string {
  let hash = 0;
  for (const c of nick) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return `hsl(${Math.abs(hash) % 360}, 64%, 68%)`;
}

export default function CaptionsOverlay() {
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    const clearLineLater = (id: number) => {
      const existing = timers.get(id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        timers.delete(id);
        setLines(prev => prev.filter(line => line.id !== id));
      }, 8000);
      timers.set(id, timer);
    };

    const onCaption = (event: Event) => {
      // OCEAN-INTEGRATION: serial media wiring dispatches ocean:caption with { nick, text, final }.
      const detail = (event as CustomEvent<CaptionEventDetail>).detail ?? {};
      const nick = detail.nick?.trim() || 'Voice';
      const text = detail.text?.trim() || '';
      if (!text) return;

      setLines(prev => {
        const last = prev[prev.length - 1];
        if (last && last.nick === nick && !last.final) {
          const updated = { ...last, text, final: detail.final === true };
          if (updated.final) clearLineLater(updated.id);
          return [...prev.slice(0, -1), updated].slice(-2);
        }

        const id = nextIdRef.current++;
        const next: CaptionLine = { id, nick, text, final: detail.final === true };
        if (next.final) clearLineLater(id);
        return [...prev, next].slice(-2);
      });
    };

    window.addEventListener('ocean:caption', onCaption);
    return () => {
      window.removeEventListener('ocean:caption', onCaption);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  if (lines.length === 0) return null;

  return (
    <div className="captions-overlay glass-2 elev-3" aria-live="polite" data-testid="captions-overlay">
      {lines.map(line => (
        <p
          key={line.id}
          className={`caption-line${line.final ? ' caption-line--final' : ' caption-line--interim'}`}
          style={{ '--caption-color': nickColor(line.nick) } as CSSProperties}
        >
          <span className="caption-nick">{line.nick}</span>
          <span className="caption-text">{line.text}</span>
        </p>
      ))}

      <style>{`
        .captions-overlay {
          position: fixed;
          left: 50%;
          bottom: calc(var(--sp-16, 64px) + var(--sp-6, 24px));
          z-index: var(--z-overlay, 200);
          width: min(760px, calc(100vw - var(--sp-8, 32px)));
          max-height: calc((var(--text-lg, 1.0625rem) * 1.45 * 2) + var(--sp-5, 20px));
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: var(--sp-1, 4px);
          padding: var(--sp-3, 12px) var(--sp-5, 20px);
          border-radius: var(--r-md, 10px) var(--r-2xl, 20px) var(--r-lg, 14px) var(--r-xl, 16px);
          color: rgba(255,255,255,0.96);
          pointer-events: none;
          overflow: hidden;
          animation: caption-band-in var(--t-overlay-in, 320ms) var(--ease-out, cubic-bezier(.16,1,.3,1)) both;
        }

        .caption-line {
          display: flex;
          align-items: baseline;
          gap: var(--sp-2, 8px);
          margin: 0;
          min-width: 0;
          font-size: var(--text-lg, 1.0625rem);
          line-height: 1.35;
          transition: opacity var(--t-surface, 220ms) var(--ease-out, cubic-bezier(.16,1,.3,1)),
                      transform var(--t-surface, 220ms) var(--ease-out, cubic-bezier(.16,1,.3,1));
        }

        .caption-line--interim {
          opacity: 0.7;
        }

        .caption-line--final {
          opacity: 1;
        }

        .caption-nick {
          flex: 0 0 auto;
          color: var(--caption-color);
          font-family: var(--font-display), Georgia, serif;
          font-weight: 700;
        }

        .caption-nick::after {
          content: ':';
          color: rgba(255,255,255,0.52);
        }

        .caption-text {
          min-width: 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        @keyframes caption-band-in {
          from { opacity: 0; transform: translate(-50%, var(--sp-3, 12px)); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .captions-overlay,
          .caption-line {
            animation: none;
            transition: none;
          }
        }

        @media (max-width: 640px) {
          .captions-overlay {
            bottom: calc(var(--sp-16, 64px) + var(--sp-3, 12px));
            width: calc(100vw - var(--sp-4, 16px));
            padding: var(--sp-2, 8px) var(--sp-3, 12px);
          }
          .caption-line {
            font-size: var(--text-base, .875rem);
          }
        }
      `}</style>
    </div>
  );
}
