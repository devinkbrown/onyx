'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';

// ── Sparkline ──────────────────────────────────────────────────────────────────

interface LatencySparklineProps {
  history: number[];
}

function LatencySparkline({ history }: LatencySparklineProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; value: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (history.length < 2) return null;

  const min = Math.min(...history);
  const max = Math.max(...history, 1);
  const avg = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
  const w = 72;
  const h = 20;

  const points = history.map((v, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - ((v - 0) / max) * h;
    return `${x},${y}`;
  }).join(' ');

  const last = history[history.length - 1];
  const color = last < 100 ? '#23a55a' : last < 300 ? '#f0b232' : '#f04747';

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const idx = Math.min(
      history.length - 1,
      Math.max(0, Math.round((relX / rect.width) * (history.length - 1)))
    );
    const v = history[idx];
    const x = (idx / (history.length - 1)) * w;
    const y = h - (v / max) * h;
    setTooltip({ x, y, value: v });
  }, [history, max, w, h]);

  return (
    <div className="csb-sparkline-group" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <svg
        ref={svgRef}
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ opacity: 0.85, cursor: 'crosshair', display: 'block' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {tooltip && (
          <>
            <circle cx={tooltip.x} cy={tooltip.y} r={2.5} fill={color} />
            <line x1={tooltip.x} y1={0} x2={tooltip.x} y2={h} stroke={color} strokeWidth="0.5" strokeDasharray="2,2" opacity="0.5" />
          </>
        )}
      </svg>
      <div className="csb-sparkline-stats">
        <span style={{ color: '#23a55a' }}>↓{min}ms</span>
        <span style={{ opacity: 0.7 }}>{avg}ms</span>
        <span style={{ color: '#f04747' }}>↑{max}ms</span>
      </div>
      {tooltip && (
        <div
          className="csb-sparkline-tooltip"
          style={{
            left: Math.min(tooltip.x, w - 44),
            top: Math.max(0, tooltip.y - 22),
          }}
        >
          {tooltip.value}ms
        </div>
      )}
    </div>
  );
}

// ── Uptime formatter ───────────────────────────────────────────────────────────

function formatUptime(since: Date): string {
  const secs = Math.floor((Date.now() - since.getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ConnectionStatusBar() {
  const connectionStatus  = useOnyxStore(s => s.connectionStatus);
  const reconnectIn       = useOnyxStore(s => s.reconnectIn);
  const latencyMs         = useOnyxStore(s => s.latencyMs);
  const latencyHistory    = useOnyxStore(s => s.latencyHistory);
  const connectedAt       = useOnyxStore(s => s.connectedAt);
  const reconnectNow      = useOnyxStore(s => s.reconnectNow);
  const server            = useOnyxStore(s => s.server);
  const connect           = useOnyxStore(s => s.connect);
  const openServerInfo    = useOnyxStore(s => s.openServerInfo);

  const [uptime, setUptime] = useState<string>('');

  useEffect(() => {
    if (!connectedAt) {
      setUptime('');
      return;
    }
    setUptime(formatUptime(connectedAt));
    const interval = setInterval(() => {
      setUptime(formatUptime(connectedAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [connectedAt]);

  // Disconnected / reconnecting states are handled by ConnectionBanner
  if (connectionStatus !== 'connected') return null;

  // Under 100ms — only show if we have sparkline history or uptime
  const hasExtras = latencyHistory.length >= 2 || (connectedAt !== null);
  if ((latencyMs === null || latencyMs < 100) && !hasExtras) return null;

  const isDegraded = latencyMs !== null && latencyMs >= 100 && latencyMs < 500;
  const isHigh     = latencyMs !== null && latencyMs >= 500;

  const handleReconnect = () => {
    if (server) reconnectNow();
  };

  // Info button
  const InfoButton = (
    <button
      className="csb-info-btn"
      onClick={openServerInfo}
      aria-label="Server info"
      title="Server info"
    >
      ℹ
    </button>
  );

  if (isHigh) {
    return (
      <div className="csb-banner csb-banner--high" role="alert" aria-live="assertive">
        <span className="csb-banner-icon" aria-hidden>⚠</span>
        <span className="csb-banner-text">High latency: {latencyMs}ms</span>
        {latencyHistory.length >= 2 && (
          <div className="csb-sparkline-wrap" title="Ping history">
            <LatencySparkline history={latencyHistory} />
          </div>
        )}
        {connectedAt && (
          <span className="csb-uptime" title="Connected for">⏱ {uptime}</span>
        )}
        {server && (
          <button className="csb-banner-btn" onClick={handleReconnect}>
            Reconnect
          </button>
        )}
        {InfoButton}
        <style>{`
          .csb-banner {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            padding: 0 16px;
            height: 36px;
            font-size: 13px;
            font-weight: 500;
            flex-shrink: 0;
            position: sticky;
            top: 0;
            z-index: 200;
          }
          .csb-banner--high {
            background: rgba(249, 115, 22, 0.12);
            border-bottom: 1px solid rgba(249, 115, 22, 0.3);
            color: #f97316;
          }
          .csb-banner-icon { font-size: 14px; line-height: 1; }
          .csb-banner-text { flex: 1; text-align: center; }
          .csb-sparkline-wrap { display: flex; align-items: center; }
          .csb-sparkline-group { position: relative; }
          .csb-sparkline-stats {
            display: flex;
            gap: 4px;
            font-size: 9px;
            font-weight: 600;
            letter-spacing: -0.01em;
            font-variant-numeric: tabular-nums;
            justify-content: space-between;
            opacity: 0.85;
            line-height: 1;
          }
          .csb-sparkline-tooltip {
            position: absolute;
            background: var(--bg-float, #1e1e2e);
            border: 1px solid var(--border-subtle, rgba(255,255,255,0.12));
            border-radius: 4px;
            padding: 2px 6px;
            font-size: 10px;
            font-weight: 700;
            color: var(--text-primary, #fff);
            white-space: nowrap;
            pointer-events: none;
            z-index: 100;
          }
          .csb-uptime {
            font-size: 11px;
            opacity: 0.7;
            white-space: nowrap;
          }
          .csb-banner-btn {
            background: currentColor;
            color: var(--bg-base);
            border: none;
            border-radius: var(--r-sm);
            padding: 4px 12px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: opacity 120ms;
            flex-shrink: 0;
          }
          .csb-banner-btn:hover { opacity: 0.85; }
          .csb-banner-btn:active { opacity: 0.7; }
          .csb-info-btn {
            background: none;
            border: none;
            cursor: pointer;
            color: currentColor;
            font-size: 14px;
            line-height: 1;
            padding: 2px 4px;
            opacity: 0.6;
            border-radius: var(--r-sm);
            transition: opacity 120ms;
            flex-shrink: 0;
          }
          .csb-info-btn:hover { opacity: 1; }
        `}</style>
      </div>
    );
  }

  if (isDegraded) {
    return (
      <div className="csb-pill" role="status" aria-live="polite" title={`Latency: ${latencyMs}ms`}>
        <span className="csb-pill-icon" aria-hidden>⚠</span>
        <span>{latencyMs}ms</span>
        {latencyHistory.length >= 2 && (
          <div className="csb-sparkline-wrap" title="Ping history">
            <LatencySparkline history={latencyHistory} />
          </div>
        )}
        {connectedAt && (
          <span className="csb-uptime" title="Connected for">⏱ {uptime}</span>
        )}
        {InfoButton}
        <style>{`
          .csb-pill {
            position: fixed;
            bottom: 16px;
            right: 16px;
            z-index: 150;
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 3px 9px;
            background: rgba(251, 191, 36, 0.12);
            border: 1px solid rgba(251, 191, 36, 0.3);
            border-radius: 999px;
            color: #fbbf24;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.01em;
            user-select: none;
            backdrop-filter: blur(8px);
          }
          .csb-pill-icon { font-size: 10px; line-height: 1; }
          .csb-sparkline-wrap { display: flex; align-items: center; }
          .csb-sparkline-group { position: relative; }
          .csb-sparkline-stats {
            display: flex;
            gap: 4px;
            font-size: 9px;
            font-weight: 600;
            letter-spacing: -0.01em;
            font-variant-numeric: tabular-nums;
            justify-content: space-between;
            opacity: 0.85;
            line-height: 1;
          }
          .csb-sparkline-tooltip {
            position: absolute;
            background: var(--bg-float, #1e1e2e);
            border: 1px solid var(--border-subtle, rgba(255,255,255,0.12));
            border-radius: 4px;
            padding: 2px 6px;
            font-size: 10px;
            font-weight: 700;
            color: var(--text-primary, #fff);
            white-space: nowrap;
            pointer-events: none;
            z-index: 100;
          }
          .csb-uptime {
            font-size: 11px;
            opacity: 0.7;
            white-space: nowrap;
          }
          .csb-info-btn {
            background: none;
            border: none;
            cursor: pointer;
            color: currentColor;
            font-size: 12px;
            line-height: 1;
            padding: 0 2px;
            opacity: 0.6;
            border-radius: var(--r-sm);
            transition: opacity 120ms;
          }
          .csb-info-btn:hover { opacity: 1; }
        `}</style>
      </div>
    );
  }

  // Low latency — show a subtle always-visible pill with sparkline + uptime when connected
  if (hasExtras) {
    return (
      <div className="csb-quiet" role="status" aria-live="polite">
        {latencyMs !== null && <span className="csb-quiet-ms">{latencyMs}ms</span>}
        {latencyHistory.length >= 2 && (
          <div className="csb-sparkline-wrap" title="Ping history">
            <LatencySparkline history={latencyHistory} />
          </div>
        )}
        {connectedAt && (
          <span className="csb-uptime" title="Connected for">⏱ {uptime}</span>
        )}
        {InfoButton}
        <style>{`
          .csb-quiet {
            position: absolute;
            top: 12px;
            right: 16px;
            z-index: 50;
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 3px 8px;
            background: rgba(var(--bg-elevated-rgb, 40,40,60), 0.6);
            border: 1px solid var(--border-subtle);
            border-radius: 999px;
            color: var(--text-muted);
            font-size: 11px;
            font-weight: 500;
            user-select: none;
            pointer-events: auto;
          }
          .csb-quiet-ms { opacity: 0.8; }
          .csb-sparkline-wrap { display: flex; align-items: center; }
          .csb-sparkline-group { position: relative; }
          .csb-sparkline-stats {
            display: flex;
            gap: 4px;
            font-size: 9px;
            font-weight: 600;
            letter-spacing: -0.01em;
            font-variant-numeric: tabular-nums;
            justify-content: space-between;
            opacity: 0.85;
            line-height: 1;
          }
          .csb-sparkline-tooltip {
            position: absolute;
            background: var(--bg-float, #1e1e2e);
            border: 1px solid var(--border-subtle, rgba(255,255,255,0.12));
            border-radius: 4px;
            padding: 2px 6px;
            font-size: 10px;
            font-weight: 700;
            color: var(--text-primary, #fff);
            white-space: nowrap;
            pointer-events: none;
            z-index: 100;
          }
          .csb-uptime {
            font-size: 11px;
            opacity: 0.7;
            white-space: nowrap;
          }
          .csb-info-btn {
            background: none;
            border: none;
            cursor: pointer;
            color: currentColor;
            font-size: 12px;
            line-height: 1;
            padding: 0 2px;
            opacity: 0.6;
            border-radius: var(--r-sm);
            transition: opacity 120ms;
          }
          .csb-info-btn:hover { opacity: 1; }
        `}</style>
      </div>
    );
  }

  return null;
}
