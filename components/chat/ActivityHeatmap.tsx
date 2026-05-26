'use client';

import { useMemo, useState } from 'react';
import type { ChatMessage } from '@/lib/irc/types';

interface Props {
  messages: ChatMessage[];
}

// ── Constants ──────────────────────────────────────────────────────────────────
// 7 days × 24 hours grid (day = 0 Mon … 6 Sun, hour = 0…23)

const DAY_ABBR = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const CELL_W = 4;
const CELL_H = 4;
const CELL_GAP = 1;
const COLS = 24;
const ROWS = 7;
const GRID_W = COLS * (CELL_W + CELL_GAP) - CELL_GAP;
const GRID_H = ROWS * (CELL_H + CELL_GAP) - CELL_GAP;

export default function ActivityHeatmap({ messages }: Props) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; day: number; hour: number; count: number } | null>(null);

  // Build 7×24 count matrix from messages
  const matrix = useMemo(() => {
    const counts: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const msg of messages) {
      if (msg.type !== 'msg' && msg.type !== 'action') continue;
      const d = new Date(msg.time);
      // JS getDay: 0=Sun,1=Mon...6=Sat → remap to 0=Mon...6=Sun
      const dayJs = d.getDay();
      const day = dayJs === 0 ? 6 : dayJs - 1;
      const hour = d.getHours();
      counts[day][hour]++;
    }
    return counts;
  }, [messages]);

  const maxCount = useMemo(() => {
    let m = 0;
    for (const row of matrix) for (const v of row) if (v > m) m = v;
    return m;
  }, [matrix]);

  const totalMessages = useMemo(() => {
    return messages.filter(m => m.type === 'msg' || m.type === 'action').length;
  }, [messages]);

  if (totalMessages === 0) return null;

  function cellOpacity(count: number): number {
    if (count === 0 || maxCount === 0) return 0;
    return 0.12 + (count / maxCount) * 0.88;
  }

  return (
    <div className="ahm-root" aria-label="Channel activity heatmap">
      <div className="ahm-grid-wrap">
        <svg
          width={GRID_W}
          height={GRID_H}
          viewBox={`0 0 ${GRID_W} ${GRID_H}`}
          aria-hidden
          style={{ display: 'block', overflow: 'visible' }}
          onMouseLeave={() => setTooltip(null)}
        >
          {matrix.map((row, day) =>
            row.map((count, hour) => {
              const x = hour * (CELL_W + CELL_GAP);
              const y = day * (CELL_H + CELL_GAP);
              const opacity = cellOpacity(count);
              return (
                <rect
                  key={`${day}-${hour}`}
                  x={x}
                  y={y}
                  width={CELL_W}
                  height={CELL_H}
                  rx={0.5}
                  fill={opacity === 0 ? 'var(--border-subtle, rgba(255,255,255,0.06))' : 'var(--accent, #0ea5e9)'}
                  fillOpacity={opacity === 0 ? 1 : opacity}
                  style={{ cursor: count > 0 ? 'pointer' : 'default' }}
                  onMouseEnter={(e) => {
                    const svgEl = (e.currentTarget as SVGElement).closest('svg')!;
                    const rect = svgEl.getBoundingClientRect();
                    setTooltip({
                      x: e.clientX - rect.left + 8,
                      y: e.clientY - rect.top - 24,
                      day,
                      hour,
                      count,
                    });
                  }}
                />
              );
            })
          )}
        </svg>

        {/* Tooltip */}
        {tooltip && tooltip.count > 0 && (
          <div
            className="ahm-tooltip"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <strong>{DAY_ABBR[tooltip.day]}</strong> {tooltip.hour}:00 — {tooltip.count} msg{tooltip.count !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      <style>{`
        .ahm-root {
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }
        .ahm-grid-wrap {
          position: relative;
        }
        .ahm-tooltip {
          position: absolute;
          background: var(--bg-float, #1e1e2e);
          border: 1px solid var(--border-subtle, rgba(255,255,255,0.12));
          border-radius: 4px;
          padding: 3px 7px;
          font-size: 10px;
          font-weight: 500;
          color: var(--text-primary, #fff);
          white-space: nowrap;
          pointer-events: none;
          z-index: 200;
        }
      `}</style>
    </div>
  );
}
