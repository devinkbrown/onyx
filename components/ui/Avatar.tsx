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

// Named size presets: xs=20, sm=24, md=32, lg=40, xl=80
export type AvatarSizePreset = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export const AVATAR_SIZE_PX: Record<AvatarSizePreset, number> = {
  xs: 20,
  sm: 24,
  md: 32,
  lg: 40,
  xl: 80,
};

export interface AvatarProps {
  nick: string;
  size?: 18 | 20 | 24 | 28 | 32 | 36 | 40 | 48 | 52 | 56 | 64 | 72 | 80;
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

/* Presence colors resolve to canonical design tokens (--status-*-solid) so
   every dot in the app reads identically regardless of theme tint. */
const STATUS_COLORS: Record<string, string> = {
  online:  'var(--status-online-solid, #23a55a)',
  idle:    'var(--status-idle-solid, #f0b232)',
  dnd:     'var(--status-dnd-solid, #f04747)',
  offline: 'var(--status-offline-solid, #80848e)',
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
     1. speaking ring (or nothing)
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
      tabIndex={showTooltip ? 0 : undefined}
      aria-label={status ? `${nick}, ${status}` : nick}
    >
      {/* Core circle */}
      <span
        className="av-inner"
        style={{
          background: src ? 'transparent' : `color-mix(in srgb, ${nickColor} 84%, ${darkColor})`,
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

      {/* Status dot — visual indicator + sr-only text for screen readers */}
      {status && STATUS_COLORS[status] && (
        <>
          <span
            className={`av-status-dot av-status-dot--${status}`}
            aria-hidden
            style={{
              background: STATUS_COLORS[status],
              width: Math.max(8, Math.round(size * 0.26)),
              height: Math.max(8, Math.round(size * 0.26)),
            }}
          />
          <span className="sr-only">{status}</span>
        </>
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
          transition: transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
          outline: none;
        }
        .av-wrap:hover {
          transform: translateY(-1px);
        }
        .av-wrap:active {
          transform: translateY(0.5px);
        }
        .av-wrap:focus-visible {
          outline: 2px solid var(--accent, #0ea5e9);
          outline-offset: 2px;
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
          transition: box-shadow 0.15s ease;
        }

        /* ── Speaking ring ──────────────────────────────────────── */
        .av-speaking .av-inner {
          animation: av-speaking-pulse 1.4s ease-in-out infinite;
        }

        @keyframes av-speaking-pulse {
          0%, 100% {
            box-shadow:
              0 0 0 2px var(--bg-deep, #06101d),
              0 0 0 4px var(--status-online-solid, #23a55a),
              0 0 0 6px color-mix(in srgb, var(--status-online-solid, #23a55a) 28%, transparent);
          }
          50% {
            box-shadow:
              0 0 0 2px var(--bg-deep, #06101d),
              0 0 0 5px var(--status-online-solid, #23a55a),
              0 0 0 10px color-mix(in srgb, var(--status-online-solid, #23a55a) 42%, transparent);
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

        /* ── Status indicator dot ─────────────────────────────────── */
        .av-status-dot {
          position: absolute;
          bottom: -1px;
          right: -1px;
          border-radius: 50%;
          border: 2px solid var(--bg-void, #030810);
          transition: background 300ms ease, box-shadow 300ms ease;
          pointer-events: none;
          z-index: 2;
        }
        .av-status-dot--online {
          box-shadow: inset 0 0 0 1px color-mix(in srgb, #fff 28%, transparent);
        }
        .av-status-dot--offline { opacity: 0.5; }

        /* ── GIF badge ──────────────────────────────────────────── */
        .av-gif-badge {
          position: absolute;
          top: -2px;
          right: -2px;
          font-size: 8px;
          background: var(--gold, #d8b96a);
          color: #000;
          border-radius: 3px;
          padding: 1px 3px;
          font-weight: 700;
          line-height: 1;
          pointer-events: none;
          z-index: 1;
        }

        /* ── Overlay badge (mute/deafen) ────────────────────────── */
        .av-overlay {
          position: absolute;
          bottom: -2px;
          right: -2px;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--bg-deep, #06101d);
          border: 1.5px solid var(--bg-deep, #06101d);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 8px;
          line-height: 1;
        }

        /* ── Tooltip ────────────────────────────────────────────── */
        .av-tooltip {
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          background: var(--bg-elevated, #132131);
          border: 1px solid var(--border-normal, rgba(14,165,233,0.15));
          padding: 4px 9px;
          border-radius: 6px;
          white-space: nowrap;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-primary, #dff0ff);
          pointer-events: none;
          opacity: 0;
          transition: opacity var(--t-micro, 120ms) var(--ease-out, ease);
          z-index: var(--z-popover, 50);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--shadow-md, 0 4px 16px rgba(0, 0, 0, 0.5));
        }

        .av-wrap:hover .av-tooltip {
          opacity: 1;
        }
        .av-wrap:focus-visible .av-tooltip {
          opacity: 1;
        }
        @media (prefers-reduced-motion: reduce) {
          .av-wrap,
          .av-inner,
          .av-status-dot,
          .av-tooltip {
            transition-duration: 1ms;
          }
          .av-animated .av-inner,
          .av-speaking .av-inner,
          .av-animated.av-speaking .av-inner {
            animation-duration: 1ms;
            animation-iteration-count: 1;
          }
          .av-wrap:hover,
          .av-wrap:active {
            transform: none;
          }
        }
      `}</style>
    </span>
  );
}
