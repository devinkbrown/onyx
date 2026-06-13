'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { getMountedSuimyakuMediaEngine } from '@/lib/suimyaku-media/MediaEngine';
import type { NetworkQualityTier } from '@/lib/suimyaku-media/types';
import Tooltip from '@/components/ui/Tooltip';

// ── Tier presentation ──────────────────────────────────────────────────────────
// 0 = excellent · 1 = good · 2 = fair · 3 = poor (matches NetworkQualityTier)
const TIER_META: Record<NetworkQualityTier, { label: string; color: string; bars: number }> = {
  0: { label: 'Excellent', color: 'var(--status-online, #34d399)', bars: 4 },
  1: { label: 'Good',      color: 'var(--status-online, #34d399)', bars: 3 },
  2: { label: 'Fair',      color: 'var(--warning, #fbbf24)',       bars: 2 },
  3: { label: 'Poor',      color: 'var(--danger, #f87171)',        bars: 1 },
};

const POLL_MS = 1000;

interface NetSample {
  tier: NetworkQualityTier;
  suggestedBps: number;
  jitterMs: number;
  lossRate: number;
}

function formatBitrate(bps: number): string {
  if (bps <= 0) return '—';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}

/**
 * ConnectionQuality — a compact 4-bar signal indicator for the live media
 * session. Reads directly from the mounted SuimyakuMediaEngine singleton
 * (getNetworkStats) on a 1s poll, so it needs no store plumbing. The hover
 * tooltip surfaces bitrate, jitter, packet loss, and noise floor.
 */
export default function ConnectionQuality() {
  const [sample, setSample] = useState<NetSample | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = () => {
      if (!alive) return;
      const engine = getMountedSuimyakuMediaEngine();
      if (!engine) return;
      const s = engine.getNetworkStats();
      setSample({
        tier: s.tier,
        suggestedBps: s.suggestedBps,
        jitterMs: s.jitterMs,
        lossRate: s.lossRate,
      });
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!sample) return null;

  const meta = TIER_META[sample.tier];
  const lossPct = (sample.lossRate * 100).toFixed(sample.lossRate < 0.01 ? 1 : 0);
  const hasBitrate = sample.suggestedBps > 0;

  // Tooltip renders single-line (nowrap); keep it a compact " · " summary.
  const tooltipBody = [
    `${meta.label} connection`,
    hasBitrate ? formatBitrate(sample.suggestedBps) : null,
    `${Math.round(sample.jitterMs)}ms jitter`,
    `${lossPct}% loss`,
  ].filter(Boolean).join('  ·  ');

  return (
    <Tooltip text={tooltipBody} side="top">
      <span
        className="cq-root"
        role="img"
        aria-label={`Connection quality: ${meta.label}`}
        data-tier={sample.tier}
        style={{ '--cq-color': meta.color } as CSSProperties}
      >
        <span className="cq-bars" aria-hidden="true">
          {[1, 2, 3, 4].map(i => (
            <span
              key={i}
              className={`cq-bar ${i <= meta.bars ? 'cq-bar--on' : 'cq-bar--off'}`}
              style={{ '--cq-h': `${i * 25}%` } as CSSProperties}
            />
          ))}
        </span>
        {hasBitrate && (
          <span className="cq-rate" aria-hidden="true">{formatBitrate(sample.suggestedBps)}</span>
        )}

        <style>{`
          .cq-root {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            flex-shrink: 0;
            cursor: default;
            user-select: none;
          }

          .cq-bars {
            display: inline-flex;
            align-items: flex-end;
            gap: 1.5px;
            height: 14px;
          }

          .cq-bar {
            width: 3px;
            border-radius: 1px;
            height: var(--cq-h, 25%);
            transition: background var(--t-fast, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1)),
                        opacity var(--t-fast, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1));
          }
          .cq-bar--on  { background: var(--cq-color, var(--status-online, #34d399)); }
          .cq-bar--off {
            background: var(--text-muted, #6090a8);
            opacity: 0.28;
          }

          /* Poor/fair: the lowest lit bar pulses to draw attention */
          .cq-root[data-tier="3"] .cq-bar--on {
            animation: cq-pulse 1.1s ease-in-out infinite;
          }
          @keyframes cq-pulse {
            0%, 100% { opacity: 1; }
            50%       { opacity: 0.5; }
          }

          .cq-rate {
            font-size: 10px;
            font-weight: 600;
            color: var(--text-muted, #6090a8);
            font-variant-numeric: tabular-nums;
            letter-spacing: 0.01em;
            white-space: nowrap;
          }

          @media (prefers-reduced-motion: reduce) {
            .cq-bar,
            .cq-root[data-tier="3"] .cq-bar--on {
              transition: none;
              animation: none;
            }
          }
        `}</style>
      </span>
    </Tooltip>
  );
}
