'use client';

/**
 * RemoteCursors — live multi-user cursor overlay for the whiteboard.
 *
 * Renders one labelled pointer per remote peer. Coordinates arrive
 * normalised (0..1) from the SUIMYAKU relay and are mapped through the
 * same pan/zoom view as the canvas so cursors track strokes exactly.
 * The overlay is pointer-events:none so it never intercepts drawing.
 */

import { memo } from 'react';
import type { RemoteCursor } from '@/hooks/useWhiteboard';
import { worldToScreen, type View } from './paint';

interface RemoteCursorsProps {
  cursors: ReadonlyArray<RemoteCursor>;
  cssW: number;
  cssH: number;
  view: View;
}

function RemoteCursorsImpl({ cursors, cssW, cssH, view }: RemoteCursorsProps) {
  if (cssW <= 0) return null;
  return (
    <div className="wb-cursor-layer" aria-hidden="true">
      <style>{`
        .wb-cursor-layer { position: absolute; inset: 0; z-index: 5; pointer-events: none; overflow: hidden; }
        .wb-cursor {
          position: absolute;
          top: 0; left: 0;
          will-change: transform;
          transition: transform 90ms linear;
        }
        .wb-cursor-arrow { display: block; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.55)); }
        .wb-cursor-flag {
          position: absolute;
          left: 13px; top: 12px;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 7px 2px 6px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.01em;
          color: var(--bg-void);
          border-radius: 3px 7px 7px 7px;
          white-space: nowrap;
          box-shadow: 0 2px 6px rgba(0,0,0,0.45);
        }
        .wb-cursor-flag-dot {
          width: 5px; height: 5px;
          border-radius: 50%;
          background: color-mix(in srgb, var(--bg-void) 55%, transparent);
        }
        @media (prefers-reduced-motion: reduce) {
          .wb-cursor { transition: none; }
        }
      `}</style>
      {cursors.map(c => {
        const [sx, sy] = worldToScreen(c.x, c.y, cssW, cssH, view);
        // Skip cursors panned off-canvas to avoid clutter.
        if (sx < -40 || sy < -40 || sx > cssW + 40 || sy > cssH + 40) return null;
        return (
          <div
            key={c.nick}
            className="wb-cursor"
            style={{ transform: `translate(${sx}px, ${sy}px)` }}
          >
            <svg className="wb-cursor-arrow" width="20" height="22" viewBox="0 0 20 22" fill="none">
              <path
                d="M2 1.5L17 11l-6.4 1.2L7.6 19 2 1.5Z"
                fill={c.color}
                stroke="rgba(0,0,0,0.45)"
                strokeWidth="1"
                strokeLinejoin="round"
              />
            </svg>
            <span className="wb-cursor-flag" style={{ background: c.color }}>
              <span className="wb-cursor-flag-dot" />
              {c.nick}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export const RemoteCursors = memo(RemoteCursorsImpl);
