'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

interface VoiceReactionDetail {
  nick?: string;
  emoji?: string;
}

interface FloatingReaction {
  id: number;
  nick: string;
  emoji: string;
  /** horizontal launch offset, -1..1 */
  drift: number;
  /** small launch jitter for the X start, in px */
  startX: number;
}

const REACTION_LIFETIME_MS = 2600;
const MAX_CONCURRENT = 24;

/**
 * ReactionsOverlay — floating emoji reactions that rise and fade during a
 * live call. Listens for `ocean:voice-reaction` CustomEvents dispatched by
 * useSuimyakuMedia's onReaction callback (server MEDIA REACT relay) and by
 * the local send path, so a participant sees their own reaction too.
 *
 * Render this inside the VoiceBar so reactions are anchored to the call dock.
 */
export default function ReactionsOverlay() {
  const [items, setItems] = useState<FloatingReaction[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const onReaction = (event: Event) => {
      const detail = (event as CustomEvent<VoiceReactionDetail>).detail ?? {};
      const emoji = detail.emoji?.trim();
      if (!emoji) return;
      const nick = detail.nick?.trim() || 'Someone';
      const id = nextIdRef.current++;

      setItems(prev => {
        const next: FloatingReaction = {
          id,
          nick,
          emoji,
          drift: (Math.random() * 2 - 1) * 0.6,
          startX: Math.round((Math.random() * 2 - 1) * 18),
        };
        return [...prev, next].slice(-MAX_CONCURRENT);
      });

      const timer = setTimeout(() => {
        timersRef.current.delete(id);
        setItems(prev => prev.filter(it => it.id !== id));
      }, REACTION_LIFETIME_MS);
      timersRef.current.set(id, timer);
    };

    window.addEventListener('ocean:voice-reaction', onReaction);
    const timers = timersRef.current;
    return () => {
      window.removeEventListener('ocean:voice-reaction', onReaction);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="rxo-root" aria-hidden="true" data-testid="voice-reactions-overlay">
      {items.map(it => (
        <span
          key={it.id}
          className="rxo-item"
          style={{
            '--rxo-drift': `${it.drift * 56}px`,
            '--rxo-start-x': `${it.startX}px`,
          } as CSSProperties}
        >
          <span className="rxo-emoji">{it.emoji}</span>
          <span className="rxo-nick">{it.nick}</span>
        </span>
      ))}

      <style>{`
        .rxo-root {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 0;
          pointer-events: none;
          z-index: 60;
        }

        .rxo-item {
          position: absolute;
          left: 50%;
          bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          transform: translateX(calc(-50% + var(--rxo-start-x, 0px)));
          animation: rxo-rise 2600ms var(--ease-out, cubic-bezier(.16,1,.3,1)) forwards;
          will-change: transform, opacity;
        }

        .rxo-emoji {
          font-size: 26px;
          line-height: 1;
          filter: drop-shadow(0 4px 10px rgba(0,0,0,0.5));
        }

        .rxo-nick {
          font-size: 9.5px;
          font-weight: 700;
          color: rgba(255,255,255,0.86);
          letter-spacing: 0.02em;
          padding: 1px 6px;
          border-radius: var(--r-full, 9999px);
          background: color-mix(in srgb, #050505 64%, transparent);
          max-width: 92px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @keyframes rxo-rise {
          0% {
            opacity: 0;
            transform: translateX(calc(-50% + var(--rxo-start-x, 0px))) translateY(6px) scale(0.6);
          }
          14% {
            opacity: 1;
            transform: translateX(calc(-50% + var(--rxo-start-x, 0px))) translateY(-8px) scale(1.08);
          }
          78% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform:
              translateX(calc(-50% + var(--rxo-start-x, 0px) + var(--rxo-drift, 0px)))
              translateY(-128px) scale(0.92);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .rxo-item {
            /* No flight; brief fade in place near the dock. */
            animation: rxo-fade 1600ms ease-out forwards;
            bottom: 12px;
          }
          @keyframes rxo-fade {
            0%   { opacity: 0; transform: translateX(-50%) scale(0.8); }
            16%  { opacity: 1; transform: translateX(-50%) scale(1); }
            72%  { opacity: 1; }
            100% { opacity: 0; transform: translateX(-50%) scale(1); }
          }
        }
      `}</style>
    </div>
  );
}
