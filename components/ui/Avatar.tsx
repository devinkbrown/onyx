'use client';

import { getNickColor } from '@/lib/nick-color';

/* ── Color utility ─────────────────────────────────────────────── */

function darkenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - Math.round(2.55 * percent));
  const g = Math.max(0, ((num >> 8) & 0xff) - Math.round(2.55 * percent));
  const b = Math.max(0, (num & 0xff) - Math.round(2.55 * percent));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/* ── Types ─────────────────────────────────────────────────────── */

export interface AvatarProps {
  nick: string;
  size?: 18 | 20 | 24 | 28 | 32 | 36 | 40 | 48 | 52 | 56 | 64 | 72;
  status?: 'online' | 'idle' | 'dnd' | 'offline' | null;
  speaking?: boolean;
  muted?: boolean;
  deafened?: boolean;
  animated?: boolean;
  showTooltip?: boolean;
  className?: string;
  /** Optional avatar image URL — supports GIFs which animate automatically */
  src?: string;
}

/* ── Constants ─────────────────────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  online:  '#22c55e',
  idle:    '#f59e0b',
  dnd:     '#ef4444',
  offline: '#4b5563',
};

/* ── Avatar ────────────────────────────────────────────────────── */

export default function Avatar({
  nick,
  size = 36,
  status,
  speaking = false,
  muted = false,
  deafened = false,
  animated = false,
  showTooltip = false,
  className = '',
  src,
}: AvatarProps) {
  const nickColor  = getNickColor(nick);
  const darkColor  = darkenColor(nickColor, 20);
  const letter     = nick.replace(/^[~@+.]+/, '').charAt(0).toUpperCase();
  const fontSize   = Math.round(size * 0.44);
  const isGif      = !!src?.match(/\.gif($|\?)/i);

  /* Box-shadow builds up in layers:
     1. speaking glow (or nothing)
     2. status ring (or nothing) */
  let boxShadow: string | undefined;

  if (speaking) {
    boxShadow = undefined; // handled by CSS animation class
  } else if (status && STATUS_COLORS[status]) {
    const c = STATUS_COLORS[status];
    boxShadow = `0 0 0 2px var(--bg-deep), 0 0 0 4px ${c}`;
  }

  const overlayIcon = deafened ? '🔕' : muted ? '🔇' : null;

  return (
    <span
      className={[
        'av-wrap',
        speaking   ? 'av-speaking' : '',
        animated   ? 'av-animated' : '',
        className,
      ].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      aria-label={nick}
    >
      {/* Core circle */}
      <span
        className="av-inner"
        style={{
          background: src ? 'transparent' : `linear-gradient(135deg, ${nickColor}, ${darkColor})`,
          width: size,
          height: size,
          fontSize,
          boxShadow: speaking ? undefined : boxShadow,
        }}
      >
        {src ? (
          <img
            src={src}
            className={`av-img${isGif ? ' av-img--animated' : ''}`}
            loading={isGif ? 'eager' : 'lazy'}
            decoding="async"
            alt={nick}
          />
        ) : letter}
      </span>

      {/* GIF badge */}
      {isGif && (
        <span
          className="av-gif-badge"
          aria-label="Animated avatar"
        >
          GIF
        </span>
      )}

      {/* Muted / deafened overlay */}
      {overlayIcon && (
        <span className="av-overlay" aria-hidden>
          {overlayIcon}
        </span>
      )}

      {/* Hover tooltip */}
      {showTooltip && (
        <span className="av-tooltip" role="tooltip">
          {nick}
        </span>
      )}

      <style>{`
        .av-wrap {
          position: relative;
          display: inline-flex;
          flex-shrink: 0;
          border-radius: 50%;
        }

        .av-inner {
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.92);
          letter-spacing: 0.02em;
          user-select: none;
          transition: box-shadow 0.2s ease;
        }

        /* ── Speaking ring ──────────────────────────────────────── */
        .av-speaking .av-inner {
          animation: av-speaking-pulse 1.4s ease-in-out infinite;
        }

        @keyframes av-speaking-pulse {
          0%, 100% {
            box-shadow:
              0 0 0 2px var(--bg-deep),
              0 0 0 4px #7c5af5,
              0 0 0 6px rgba(124, 90, 245, 0.3);
          }
          50% {
            box-shadow:
              0 0 0 2px var(--bg-deep),
              0 0 0 5px #7c5af5,
              0 0 0 10px rgba(124, 90, 245, 0.5);
          }
        }

        /* ── Entrance animation ─────────────────────────────────── */
        .av-animated .av-inner {
          animation: av-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }

        @keyframes av-pop {
          0%   { transform: scale(0.7); opacity: 0; }
          70%  { transform: scale(1.08); }
          100% { transform: scale(1); opacity: 1; }
        }

        /* Speaking + animated: speaking wins after entrance completes */
        .av-animated.av-speaking .av-inner {
          animation:
            av-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both,
            av-speaking-pulse 1.4s ease-in-out 0.35s infinite;
        }

        /* ── Image avatar ───────────────────────────────────────── */
        .av-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 50%;
          display: block;
        }

        .av-img--animated {
          /* Ensure GIFs play — don't apply grayscale or other filters */
          filter: none !important;
        }

        /* ── GIF badge ──────────────────────────────────────────── */
        .av-gif-badge {
          position: absolute;
          top: -2px;
          right: -2px;
          font-size: 8px;
          background: var(--gold, #e8b84b);
          color: #000;
          border-radius: 3px;
          padding: 1px 3px;
          font-weight: 700;
          line-height: 1;
          pointer-events: none;
          z-index: 1;
        }

        /* ── Overlay badge ──────────────────────────────────────── */
        .av-overlay {
          position: absolute;
          bottom: -2px;
          right: -2px;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--bg-deep, #0d0d12);
          border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 8px;
          line-height: 1;
        }

        /* ── Tooltip ────────────────────────────────────────────── */
        .av-tooltip {
          position: absolute;
          bottom: calc(100% + 4px);
          left: 50%;
          transform: translateX(-50%);
          background: var(--bg-overlay, rgba(20, 18, 30, 0.95));
          padding: 3px 8px;
          border-radius: 4px;
          white-space: nowrap;
          font-size: 12px;
          font-weight: 500;
          color: var(--text-primary, #f0eeff);
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.12s ease;
          z-index: 50;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        }

        .av-wrap:hover .av-tooltip {
          opacity: 1;
        }
      `}</style>
    </span>
  );
}
