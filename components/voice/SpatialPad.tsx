'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useSpatial, type SpatialPeer } from '@/hooks/useSpatial';

interface SpatialPadProps {
  channel: string;
  /** Pad edge length in CSS pixels. Square. Defaults to 360. */
  size?: number;
  onClose?: () => void;
}

/**
 * Deterministic per-nick color derived from a djb2-variant hash.
 * Returns an HSL color string with good saturation and lightness for
 * readability against dark backgrounds.
 */
function nickColor(nick: string): string {
  let h = 5381;
  for (let i = 0; i < nick.length; i++) {
    h = ((h << 5) + h) ^ nick.charCodeAt(i);
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 70%, 65%)`;
}

/**
 * SpatialPad — polar radar UI for LADON listener-centric spatial audio.
 *
 * Self sits at the visual centre. Drag anywhere on the pad to move your
 * listener position; MEDIA SPATIAL frames are broadcast to peers over IRC.
 * Other-user dots pulse when speaking and fade/scale with Z distance.
 *
 * The concentric range rings and cardinal markers are purely cosmetic —
 * the server enforces the actual audio model.
 */
export function SpatialPad({ channel, size = 360, onClose }: SpatialPadProps) {
  const { self, peers, moveSelf, isChannel } = useSpatial(channel);
  const padRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selfZ, setSelfZ] = useState(0);

  // Render self separately at visual centre — always 0,0 from listener POV
  const others = useMemo(() => peers.filter(p => !p.isSelf), [peers]);

  // Nearest active speaker (for footer readout)
  const nearest = useMemo(() => {
    let best: { peer: SpatialPeer; dist: number } | null = null;
    for (const p of others) {
      if (p.stale) continue;
      const d = Math.hypot(p.x - self.x, p.y - self.y, (p.z - self.z) / 10);
      if (!best || d < best.dist) best = { peer: p, dist: d };
    }
    return best;
  }, [others, self.x, self.y, self.z]);

  // Convert normalised (-1..1) coords to pixel offsets within the pad.
  // y is inverted so +y means "in front of" the listener (up on screen).
  const toPixel = useCallback((x: number, y: number) => {
    const half   = size / 2;
    const usable = half - 22;
    return { px: half + x * usable, py: half - y * usable };
  }, [size]);

  const fromPointer = useCallback((clientX: number, clientY: number) => {
    const pad = padRef.current;
    if (!pad) return null;
    const rect   = pad.getBoundingClientRect();
    const half   = rect.width / 2;
    const usable = half - 22;
    const rx = (clientX - rect.left - half) / usable;
    const ry = -(clientY - rect.top  - half) / usable;
    return {
      x: Math.max(-1, Math.min(1, rx)),
      y: Math.max(-1, Math.min(1, ry)),
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isChannel) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setDragging(true);
    const pt = fromPointer(e.clientX, e.clientY);
    if (pt) moveSelf({ x: pt.x, y: pt.y, z: selfZ });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const pt = fromPointer(e.clientX, e.clientY);
    if (pt) moveSelf({ x: pt.x, y: pt.y, z: selfZ });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    setDragging(false);
  };

  const speakingCount = others.filter(p => p.speaking).length;
  const inVoiceCount  = others.filter(p => p.inVoice).length;
  const halfPx        = size / 2;

  const rings: { r: number; label: string }[] = [
    { r: 0.33, label: 'Near' },
    { r: 0.66, label: 'Mid'  },
    { r: 1.0,  label: 'Far'  },
  ];

  return (
    <div className="sp-root" style={{ '--sp-size': `${size}px` } as React.CSSProperties}>
      {/* Header */}
      <div className="sp-header">
        <span className="sp-header-title">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <circle cx="6" cy="6" r="2" fill="currentColor" />
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5" />
            <circle cx="6" cy="6" r="7" stroke="currentColor" strokeWidth="0.7" fill="none" opacity="0.25" />
          </svg>
          Spatial Audio
        </span>
        <div className="sp-header-right">
          <span className="sp-header-stat">
            {inVoiceCount} in voice{speakingCount > 0 ? ` · ${speakingCount} speaking` : ''}
          </span>
          {onClose && (
            <button className="sp-close-btn" onClick={onClose} aria-label="Close spatial audio">
              ×
            </button>
          )}
        </div>
      </div>

      {/* Pad + Z slider row */}
      <div className="sp-body">
        {/* Radar pad */}
        <div
          ref={padRef}
          className={`sp-pad${dragging ? ' sp-pad--dragging' : ''}${!isChannel ? ' sp-pad--readonly' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          aria-label="Spatial audio pad — drag to reposition"
          role="region"
        >
          {/* Range rings with distance labels */}
          {rings.map(({ r, label }) => (
            <div
              key={r}
              className="sp-ring"
              style={{
                width:  `${r * (size - 44)}px`,
                height: `${r * (size - 44)}px`,
                left:   `${halfPx - r * (size - 44) / 2}px`,
                top:    `${halfPx - r * (size - 44) / 2}px`,
              }}
            >
              <span className="sp-ring-label">{label}</span>
            </div>
          ))}

          {/* Cardinal markers */}
          <span className="sp-cardinal sp-cardinal--n">N</span>
          <span className="sp-cardinal sp-cardinal--s">S</span>
          <span className="sp-cardinal sp-cardinal--e">E</span>
          <span className="sp-cardinal sp-cardinal--w">W</span>

          {/* Crosshair */}
          <div className="sp-cross-h" style={{ top: halfPx }} />
          <div className="sp-cross-v" style={{ left: halfPx }} />

          {/* Peer dots */}
          {others.map(p => {
            const { px, py } = toPixel(p.x, p.y);
            const zScale  = Math.max(0.65, Math.min(1.2, 1 - (p.z / 20)));
            const dotSize = Math.round(28 * zScale);
            const alpha   = Math.max(0.25, 1 - Math.abs(p.z) / 12);
            const color   = nickColor(p.nick);
            return (
              <div
                key={p.nick}
                className={`sp-peer${p.speaking ? ' sp-peer--speaking' : ''}${p.inVoice ? ' sp-peer--voice' : ''}${p.stale ? ' sp-peer--stale' : ''}`}
                style={{
                  left: px,
                  top:  py,
                  opacity: alpha,
                  width:   dotSize,
                  height:  dotSize,
                  borderColor: p.speaking ? color : p.inVoice ? `${color}66` : 'rgba(255,255,255,0.08)',
                  boxShadow: p.speaking ? `0 0 10px ${color}80` : 'none',
                  transition: 'left 0.2s cubic-bezier(0.22, 1, 0.36, 1), top 0.2s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.15s, box-shadow 0.15s',
                }}
                title={p.nick}
                aria-label={`${p.nick}${p.speaking ? ' — speaking' : ''}`}
              >
                <span className="sp-peer-initial" style={{ color }}>{p.nick[0]?.toUpperCase() ?? '?'}</span>
                {p.speaking && <span className="sp-peer-pulse" aria-hidden style={{ borderColor: color }} />}
                {/* Nick tooltip label */}
                <div className="sp-peer-label">{p.nick}</div>
                {/* Audio waveform bars when speaking */}
                {p.speaking && (
                  <div className="sp-audio-bars" aria-hidden style={{ '--peer-color': color } as React.CSSProperties}>
                    {[0, 1, 2].map(i => (
                      <div key={i} className="sp-audio-bar" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Self dot (always at visual centre; dragging changes listener coords) */}
          <div
            className={`sp-self${dragging ? ' sp-self--dragging' : ''}`}
            style={{ left: halfPx, top: halfPx }}
            aria-label="You (listener position)"
          >
            <span className="sp-self-icon" aria-hidden>◉</span>
          </div>
        </div>

        {/* Z-axis depth slider */}
        {isChannel && (
          <div className="sp-z-rail">
            <span className="sp-z-label">Far</span>
            <input
              type="range"
              min={-10}
              max={10}
              step={0.5}
              value={selfZ}
              onChange={e => {
                const z = parseFloat(e.target.value);
                setSelfZ(z);
                moveSelf({ x: self.x, y: self.y, z });
              }}
              className="sp-z-slider"
              aria-label="Depth position"
              style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
            />
            <span className="sp-z-label">Near</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sp-footer">
        <span className="sp-pos-label">
          x:{self.x.toFixed(2)} y:{self.y.toFixed(2)} z:{self.z.toFixed(1)}
        </span>
        {nearest && (
          <span className="sp-nearest">
            Nearest: <strong>{nearest.peer.nick}</strong> ({nearest.dist.toFixed(2)})
          </span>
        )}
        {!isChannel && (
          <span className="sp-readonly-note">Spatial audio is channel-only</span>
        )}
      </div>

      <style>{`
        .sp-root {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 14px;
          background: linear-gradient(160deg, var(--bg-elevated) 0%, var(--bg-deep) 100%);
          border: 1px solid var(--accent-border);
          border-radius: 12px;
          box-shadow: 0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px var(--accent-subtle);
          width: fit-content;
          box-sizing: border-box;
          user-select: none;
        }

        .sp-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .sp-header-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--accent);
        }
        .sp-header-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .sp-header-stat {
          font-size: 11px;
          color: var(--text-muted);
        }
        .sp-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          padding: 2px 4px;
          border-radius: 4px;
          transition: color 0.12s, background 0.12s;
        }
        .sp-close-btn:hover {
          color: var(--text-primary);
          background: rgba(255,255,255,0.08);
        }

        .sp-body {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .sp-pad {
          position: relative;
          width: var(--sp-size);
          height: var(--sp-size);
          border-radius: 50%;
          background: radial-gradient(circle at 50% 50%,
            var(--accent-subtle) 0%,
            rgba(14,165,233,0.01) 50%,
            rgba(0,0,0,0.3) 100%);
          border: 1px solid var(--border-normal);
          overflow: hidden;
          cursor: crosshair;
          touch-action: none;
          flex-shrink: 0;
        }
        .sp-pad--readonly { cursor: default; }
        .sp-pad--dragging { cursor: grabbing; }

        .sp-ring {
          position: absolute;
          border-radius: 50%;
          border: 1px solid var(--accent-subtle);
          pointer-events: none;
        }
        .sp-ring-label {
          position: absolute;
          top: 6px;
          right: 14px;
          font-size: 8px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
          line-height: 1;
        }

        .sp-cross-h, .sp-cross-v {
          position: absolute;
          background: var(--accent-subtle);
          pointer-events: none;
        }
        .sp-cross-h {
          left: 0; right: 0; height: 1px;
          transform: translateY(-50%);
        }
        .sp-cross-v {
          top: 0; bottom: 0; width: 1px;
          transform: translateX(-50%);
        }

        .sp-cardinal {
          position: absolute;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          pointer-events: none;
          line-height: 1;
        }
        .sp-cardinal--n { top: 6px;    left: 50%; transform: translateX(-50%); }
        .sp-cardinal--s { bottom: 6px; left: 50%; transform: translateX(-50%); }
        .sp-cardinal--e { right: 6px;  top: 50%;  transform: translateY(-50%); }
        .sp-cardinal--w { left: 6px;   top: 50%;  transform: translateY(-50%); }

        /* Peer dot */
        .sp-peer {
          position: absolute;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: var(--bg-elevated);
          border: 2px solid rgba(255,255,255,0.08);
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
        }
        .sp-peer--speaking {
          animation: sp-peer-breathe 1.4s ease-in-out infinite;
        }
        .sp-peer--stale { opacity: 0.35 !important; }
        @keyframes sp-peer-breathe {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50%       { transform: translate(-50%, -50%) scale(1.14); }
        }

        .sp-peer-initial {
          font-size: 10px;
          font-weight: 700;
          line-height: 1;
        }
        .sp-peer-pulse {
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          border: 2px solid var(--accent);
          animation: sp-pulse-ring 1.4s ease-out infinite;
          pointer-events: none;
        }
        @keyframes sp-pulse-ring {
          0%   { opacity: 0.6; transform: scale(1); }
          100% { opacity: 0;   transform: scale(1.7); }
        }

        /* Nick tooltip label */
        .sp-peer-label {
          position: absolute;
          top: calc(100% + 4px);
          left: 50%;
          transform: translateX(-50%);
          background: rgba(3, 8, 16, 0.9);
          border: 1px solid var(--border-normal);
          border-radius: 4px;
          padding: 2px 6px;
          font-size: 10px;
          font-weight: 600;
          white-space: nowrap;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.15s;
          backdrop-filter: blur(4px);
          z-index: 10;
          color: var(--text-primary);
        }
        .sp-peer:hover .sp-peer-label {
          opacity: 1;
        }

        /* Audio waveform bars */
        .sp-audio-bars {
          position: absolute;
          bottom: -14px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 2px;
          align-items: flex-end;
          height: 10px;
          pointer-events: none;
        }
        .sp-audio-bar {
          width: 3px;
          height: 6px;
          border-radius: 2px;
          background: var(--peer-color, var(--accent));
          animation: sp-bar-bounce 0.8s ease-in-out infinite alternate;
        }
        @keyframes sp-bar-bounce {
          0%   { height: 3px; }
          100% { height: 10px; }
        }

        /* Self dot */
        .sp-self {
          position: absolute;
          width: 32px;
          height: 32px;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: var(--accent-subtle);
          border: 2px solid var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 12px var(--accent-glow);
          pointer-events: none;
          z-index: 2;
          transition: box-shadow 0.15s;
        }
        .sp-self--dragging {
          box-shadow: 0 0 20px var(--accent-glow), 0 0 0 3px var(--accent-subtle);
        }
        .sp-self-icon {
          font-size: 14px;
          color: var(--accent);
          line-height: 1;
        }

        /* Z-axis slider */
        .sp-z-rail {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 8px 0;
        }
        .sp-z-label {
          font-size: 9px;
          font-weight: 600;
          color: var(--text-muted);
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .sp-z-slider {
          height: calc(var(--sp-size) - 16px);
          width: 20px;
          accent-color: var(--accent);
          cursor: pointer;
        }

        .sp-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
        }
        .sp-pos-label {
          font-size: 10px;
          font-family: ui-monospace, 'Cascadia Code', monospace;
          color: var(--text-muted);
          letter-spacing: 0.04em;
        }
        .sp-nearest {
          font-size: 11px;
          color: var(--text-secondary);
        }
        .sp-nearest strong {
          color: var(--accent);
          font-weight: 600;
        }
        .sp-readonly-note {
          font-size: 11px;
          color: var(--text-muted);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
