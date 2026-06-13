'use client';

/**
 * WhiteboardToolbar — tool palette, stroke + color controls, board
 * actions and live presence for the collaborative whiteboard.
 *
 * Pure presentational: the parent owns all state. Interaction states
 * (hover / focus-visible / active / selected / disabled) are driven by
 * CSS classes co-located below so they stay crisp and reduced-motion
 * aware rather than relying on brittle inline style branches.
 */

import { useId, useState, type ReactElement } from 'react';
import type { WhiteboardTool } from '@/hooks/useWhiteboard';
import {
  PenIcon, LineIcon, RectIcon, CircleIcon, TextIcon, EraserIcon,
  UndoIcon, RedoIcon, FillIcon, ExportIcon, TrashIcon, CloseIcon,
  ZoomInIcon, ZoomOutIcon, FitIcon,
} from './icons';

/** A peer currently present on the board (derived from channel membership). */
export interface WhiteboardPeer {
  nick: string;
  color: string;
  /** Highest channel role char (q/o/v) for a subtle ring accent. */
  role?: string;
  /** True when this peer's cursor has been seen moving recently. */
  active?: boolean;
}

interface WhiteboardToolbarProps {
  tool: WhiteboardTool;
  color: string;
  width: number;
  canClear: boolean;
  rateLimited: boolean;
  fillShapes: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Current zoom factor (1 == 100%). */
  zoom: number;
  /** Live collaborators on the board. */
  peers: ReadonlyArray<WhiteboardPeer>;
  onToolChange: (tool: WhiteboardTool) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onFillToggle: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onExport: () => void;
  onClose: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

interface ToolDef {
  id: WhiteboardTool;
  label: string;
  /** Single-key shortcut. */
  key: string;
  Icon: (props: { size?: number; className?: string }) => ReactElement;
}

const TOOL_BUTTONS: ReadonlyArray<ToolDef> = [
  { id: 'pen',    label: 'Pen',    key: 'P', Icon: PenIcon },
  { id: 'line',   label: 'Line',   key: 'L', Icon: LineIcon },
  { id: 'rect',   label: 'Rectangle', key: 'R', Icon: RectIcon },
  { id: 'circle', label: 'Ellipse', key: 'O', Icon: CircleIcon },
  { id: 'text',   label: 'Text',   key: 'T', Icon: TextIcon },
  { id: 'eraser', label: 'Eraser', key: 'E', Icon: EraserIcon },
];

/** Shape tools that support fill. */
const SHAPE_TOOLS: ReadonlySet<WhiteboardTool> = new Set(['rect', 'circle']);

/** Curated Deep Lacquer palette — luminous strokes that read on the void. */
const SWATCHES = [
  '#dff0ff', '#5eccff', '#0ea5e9', '#a78bfa',
  '#7ee787', '#ffe680', '#ffae42', '#ff5577',
];

/** Width presets shown as proportional dots. */
const WIDTH_PRESETS = [1, 3, 6, 12, 24] as const;

const MAX_PEER_AVATARS = 4;

function roleRing(role?: string): string {
  if (role === 'q' || role === 'a') return 'var(--gold)';
  if (role === 'o' || role === 'h') return 'var(--accent)';
  if (role === 'v') return '#7ee787';
  return 'transparent';
}

export function WhiteboardToolbar({
  tool, color, width, canClear, rateLimited,
  fillShapes, canUndo, canRedo, zoom, peers,
  onToolChange, onColorChange, onWidthChange,
  onFillToggle, onUndo, onRedo,
  onClear, onExport, onClose,
  onZoomIn, onZoomOut, onZoomReset,
}: WhiteboardToolbarProps) {
  const isShapeTool = SHAPE_TOOLS.has(tool);
  const colorInputId = useId();
  const [confirmingClear, setConfirmingClear] = useState(false);

  const handleClear = () => {
    if (confirmingClear) {
      onClear();
      setConfirmingClear(false);
      return;
    }
    setConfirmingClear(true);
    window.setTimeout(() => setConfirmingClear(false), 3200);
  };

  const visiblePeers = peers.slice(0, MAX_PEER_AVATARS);
  const overflowPeers = peers.length - visiblePeers.length;
  const zoomPct = Math.round(zoom * 100);

  return (
    <div role="toolbar" aria-label="Whiteboard tools" className="wb-toolbar">
      <ToolbarStyles />

      {/* History */}
      <div className="wb-group" role="group" aria-label="History">
        <button
          type="button" className="wb-btn"
          title="Undo — Ctrl+Z" aria-label="Undo"
          disabled={!canUndo} onClick={onUndo}
        >
          <UndoIcon />
        </button>
        <button
          type="button" className="wb-btn"
          title="Redo — Ctrl+Shift+Z" aria-label="Redo"
          disabled={!canRedo} onClick={onRedo}
        >
          <RedoIcon />
        </button>
      </div>

      <span className="wb-divider" aria-hidden="true" />

      {/* Tool palette */}
      <div className="wb-group" role="radiogroup" aria-label="Drawing tools">
        {TOOL_BUTTONS.map(({ id, label, key, Icon }) => {
          const active = tool === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-keyshortcuts={key}
              className={`wb-btn wb-tool${active ? ' is-active' : ''}`}
              title={`${label} — ${key}`}
              aria-label={label}
              onClick={() => onToolChange(id)}
            >
              <Icon />
              <span className="wb-kbd" aria-hidden="true">{key}</span>
            </button>
          );
        })}
      </div>

      {/* Fill toggle — only for shape tools */}
      {isShapeTool && (
        <button
          type="button"
          className={`wb-btn wb-tool${fillShapes ? ' is-active' : ''}`}
          title={fillShapes ? 'Filled — click for outline' : 'Outline — click for fill'}
          aria-label="Toggle shape fill"
          aria-pressed={fillShapes}
          onClick={onFillToggle}
        >
          <FillIcon />
        </button>
      )}

      <span className="wb-divider" aria-hidden="true" />

      {/* Color */}
      <div className="wb-group wb-swatches" role="group" aria-label="Stroke color">
        {SWATCHES.map(c => {
          const active = color.toLowerCase() === c.toLowerCase();
          return (
            <button
              key={c}
              type="button"
              className={`wb-swatch${active ? ' is-active' : ''}`}
              title={c}
              aria-label={`Color ${c}`}
              aria-pressed={active}
              style={{ ['--swatch' as string]: c }}
              onClick={() => onColorChange(c)}
            />
          );
        })}
        <label className="wb-color-well" title="Custom color" htmlFor={colorInputId}>
          <span className="wb-color-well-chip" style={{ background: color }} />
          <input
            id={colorInputId}
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#5eccff'}
            onChange={e => onColorChange(e.target.value)}
            aria-label="Custom stroke color"
          />
        </label>
      </div>

      <span className="wb-divider" aria-hidden="true" />

      {/* Stroke width */}
      <div className="wb-group wb-widths" role="group" aria-label="Stroke width">
        {WIDTH_PRESETS.map(preset => {
          const active = width === preset;
          const dot = Math.min(3 + preset * 1.1, 22);
          return (
            <button
              key={preset}
              type="button"
              className={`wb-width${active ? ' is-active' : ''}`}
              title={`${preset}px`}
              aria-label={`Stroke width ${preset} pixels`}
              aria-pressed={active}
              onClick={() => onWidthChange(preset)}
            >
              <span className="wb-width-dot" style={{ width: dot, height: dot }} />
            </button>
          );
        })}
        <input
          type="range" className="wb-range"
          min={1} max={32} value={width}
          onChange={e => onWidthChange(parseInt(e.target.value, 10) || 1)}
          aria-label="Stroke width (fine)"
          title={`Width: ${width}px`}
        />
        <span className="wb-width-readout">{width}</span>
      </div>

      <span className="wb-spacer" />

      {/* Presence cluster */}
      {peers.length > 0 && (
        <div className="wb-presence" role="group" aria-label={`${peers.length} collaborator${peers.length === 1 ? '' : 's'}`}>
          {visiblePeers.map(p => (
            <span
              key={p.nick}
              className={`wb-avatar${p.active ? ' is-active' : ''}`}
              title={p.nick}
              style={{
                ['--peer' as string]: p.color,
                ['--ring' as string]: roleRing(p.role),
              }}
            >
              {p.nick.slice(0, 1).toUpperCase()}
            </span>
          ))}
          {overflowPeers > 0 && (
            <span className="wb-avatar wb-avatar-more" title={`${overflowPeers} more`}>
              +{overflowPeers}
            </span>
          )}
        </div>
      )}

      {rateLimited && (
        <span className="wb-badge" role="status" title="Slowing outbound strokes to stay under the server flood limit">
          <span className="wb-badge-dot" aria-hidden="true" />
          rate-limited
        </span>
      )}

      <span className="wb-divider" aria-hidden="true" />

      {/* Zoom */}
      <div className="wb-group" role="group" aria-label="Zoom">
        <button type="button" className="wb-btn" title="Zoom out — Ctrl+-" aria-label="Zoom out" onClick={onZoomOut}>
          <ZoomOutIcon />
        </button>
        <button
          type="button" className="wb-btn wb-zoom-readout"
          title="Reset zoom — Ctrl+0" aria-label={`Zoom ${zoomPct} percent, click to reset`}
          onClick={onZoomReset}
        >
          {zoomPct}%
        </button>
        <button type="button" className="wb-btn" title="Zoom in — Ctrl+=" aria-label="Zoom in" onClick={onZoomIn}>
          <ZoomInIcon />
        </button>
        <button type="button" className="wb-btn" title="Fit to view — Shift+1" aria-label="Fit to view" onClick={onZoomReset}>
          <FitIcon />
        </button>
      </div>

      <span className="wb-divider" aria-hidden="true" />

      {/* Board actions */}
      <div className="wb-group" role="group" aria-label="Board actions">
        <button type="button" className="wb-btn" title="Export as PNG" aria-label="Export as PNG" onClick={onExport}>
          <ExportIcon />
        </button>
        <button
          type="button"
          className={`wb-btn wb-destructive${confirmingClear ? ' is-confirming' : ''}`}
          title={canClear ? 'Clear board' : 'Only an operator or session creator can clear the board'}
          aria-label={confirmingClear ? 'Confirm clear board' : 'Clear board'}
          disabled={!canClear}
          onClick={handleClear}
        >
          {confirmingClear ? <span className="wb-confirm-text">Sure?</span> : <TrashIcon />}
        </button>
        <button type="button" className="wb-btn" title="Close whiteboard — Esc" aria-label="Close whiteboard" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

function ToolbarStyles() {
  return (
    <style>{`
      .wb-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        padding: 9px 12px;
        background:
          linear-gradient(180deg,
            color-mix(in srgb, var(--bg-float) 55%, transparent),
            color-mix(in srgb, var(--bg-deep) 86%, transparent));
        border-bottom: 1px solid var(--border-normal);
        box-shadow: var(--shadow-sm), inset 0 1px 0 color-mix(in srgb, var(--accent) 8%, transparent);
        backdrop-filter: blur(14px) saturate(1.1);
        flex-shrink: 0;
        position: relative;
        z-index: 2;
      }
      .wb-group { display: inline-flex; align-items: center; gap: 3px; }
      .wb-spacer { flex: 1 1 auto; min-width: 8px; }
      .wb-divider {
        width: 1px;
        align-self: stretch;
        margin: 2px 3px;
        background: linear-gradient(180deg, transparent, var(--border-normal), transparent);
        flex-shrink: 0;
      }

      /* ── Base button ──────────────────────────────────────────── */
      .wb-btn {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 34px;
        min-width: 34px;
        padding: 0 7px;
        border-radius: var(--r-md);
        border: 1px solid var(--border-normal);
        background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
        color: var(--text-secondary);
        font-size: var(--text-xs);
        font-weight: 600;
        cursor: pointer;
        transition: background 140ms var(--ease-out),
                    border-color 140ms var(--ease-out),
                    color 140ms var(--ease-out),
                    transform 120ms var(--ease-spring),
                    box-shadow 140ms var(--ease-out);
        user-select: none;
        -webkit-tap-highlight-color: transparent;
      }
      .wb-btn:hover:not(:disabled) {
        background: var(--bg-float);
        border-color: color-mix(in srgb, var(--accent) 30%, var(--border-normal));
        color: var(--text-primary);
      }
      .wb-btn:active:not(:disabled) { transform: translateY(1px) scale(0.97); }
      .wb-btn:focus-visible {
        outline: none;
        border-color: var(--accent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent);
      }
      .wb-btn:disabled { opacity: 0.32; cursor: not-allowed; }

      /* ── Tool buttons ─────────────────────────────────────────── */
      .wb-tool { width: 40px; padding: 0; }
      .wb-tool.is-active {
        background: linear-gradient(180deg,
          color-mix(in srgb, var(--accent) 30%, var(--bg-elevated)),
          color-mix(in srgb, var(--accent) 16%, var(--bg-elevated)));
        border-color: var(--accent);
        color: var(--text-primary);
        box-shadow:
          0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent),
          0 4px 14px -4px var(--accent-glow),
          inset 0 1px 0 color-mix(in srgb, #fff 14%, transparent);
      }
      .wb-tool.is-active::after {
        content: '';
        position: absolute;
        left: 50%; bottom: -1px;
        width: 14px; height: 2px;
        transform: translateX(-50%);
        border-radius: 2px;
        background: var(--accent);
        box-shadow: 0 0 6px var(--accent);
      }
      .wb-kbd {
        position: absolute;
        top: 2px; right: 3px;
        font-size: 8px;
        line-height: 1;
        font-weight: 700;
        letter-spacing: 0.02em;
        color: var(--text-muted);
        opacity: 0.6;
        pointer-events: none;
      }
      .wb-tool.is-active .wb-kbd { color: var(--accent-hover); opacity: 0.9; }

      /* ── Color swatches ───────────────────────────────────────── */
      .wb-swatches { gap: 5px; }
      .wb-swatch {
        width: 21px; height: 21px;
        border-radius: 50%;
        border: 1px solid color-mix(in srgb, #000 35%, transparent);
        background: var(--swatch);
        cursor: pointer;
        padding: 0;
        box-shadow: inset 0 1px 1px color-mix(in srgb, #fff 22%, transparent), var(--shadow-sm);
        transition: transform 140ms var(--ease-spring), box-shadow 140ms var(--ease-out);
      }
      .wb-swatch:hover { transform: scale(1.18); }
      .wb-swatch:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px var(--bg-deep), 0 0 0 4px var(--accent);
      }
      .wb-swatch.is-active {
        transform: scale(1.22);
        box-shadow:
          0 0 0 2px var(--bg-deep),
          0 0 0 4px color-mix(in srgb, var(--swatch) 80%, white),
          0 0 12px color-mix(in srgb, var(--swatch) 60%, transparent);
      }
      .wb-color-well {
        position: relative;
        display: inline-flex;
        width: 26px; height: 26px;
        border-radius: var(--r-sm);
        border: 1px solid var(--border-normal);
        overflow: hidden;
        cursor: pointer;
        background:
          conic-gradient(from 0deg, #ff5577, #ffae42, #ffe680, #7ee787, #5eccff, #a78bfa, #ff5577);
      }
      .wb-color-well:hover { border-color: var(--accent); }
      .wb-color-well-chip {
        position: absolute; inset: 4px;
        border-radius: 3px;
        box-shadow: inset 0 0 0 1px color-mix(in srgb, #000 30%, transparent);
      }
      .wb-color-well input {
        position: absolute; inset: 0;
        opacity: 0;
        cursor: pointer;
        width: 100%; height: 100%;
        border: 0; padding: 0;
      }

      /* ── Width presets ────────────────────────────────────────── */
      .wb-widths { gap: 4px; }
      .wb-width {
        width: 28px; height: 28px;
        border-radius: var(--r-sm);
        border: 1px solid var(--border-normal);
        background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: background 140ms var(--ease-out), border-color 140ms var(--ease-out);
      }
      .wb-width:hover { border-color: color-mix(in srgb, var(--accent) 30%, var(--border-normal)); }
      .wb-width:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent);
        border-color: var(--accent);
      }
      .wb-width.is-active {
        border-color: var(--accent);
        background: color-mix(in srgb, var(--accent) 16%, var(--bg-elevated));
      }
      .wb-width-dot {
        border-radius: 50%;
        background: var(--text-muted);
        transition: background 140ms var(--ease-out);
      }
      .wb-width.is-active .wb-width-dot {
        background: var(--accent);
        box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 70%, transparent);
      }
      .wb-range { accent-color: var(--accent); width: 70px; cursor: pointer; }
      .wb-range:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
      .wb-width-readout {
        min-width: 18px;
        text-align: right;
        color: var(--text-secondary);
        font-size: var(--text-xs);
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }

      /* ── Presence ─────────────────────────────────────────────── */
      .wb-presence { display: inline-flex; align-items: center; padding-left: 2px; }
      .wb-avatar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px; height: 26px;
        margin-left: -7px;
        border-radius: 50%;
        font-size: 11px;
        font-weight: 700;
        color: var(--bg-void);
        background: var(--peer);
        border: 2px solid var(--bg-deep);
        box-shadow: 0 0 0 1.5px var(--ring), var(--shadow-sm);
        cursor: default;
        transition: transform 160ms var(--ease-spring);
      }
      .wb-avatar:first-child { margin-left: 0; }
      .wb-avatar:hover { transform: translateY(-2px) scale(1.08); z-index: 1; }
      .wb-avatar.is-active { animation: wb-avatar-glow 2.4s ease-in-out infinite; }
      .wb-avatar-more {
        background: var(--bg-float);
        color: var(--text-secondary);
        font-size: 10px;
        box-shadow: var(--shadow-sm);
      }
      @keyframes wb-avatar-glow {
        0%, 100% { box-shadow: 0 0 0 1.5px var(--ring), 0 0 0 0 transparent; }
        50% { box-shadow: 0 0 0 1.5px var(--ring), 0 0 8px 1px var(--peer); }
      }

      /* ── Rate-limit badge ─────────────────────────────────────── */
      .wb-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: var(--text-2xs);
        font-weight: 600;
        letter-spacing: 0.02em;
        padding: 3px 9px;
        border-radius: 999px;
        background: color-mix(in srgb, #ff5577 16%, transparent);
        color: #ffb6c6;
        border: 1px solid color-mix(in srgb, #ff5577 45%, transparent);
        white-space: nowrap;
      }
      .wb-badge-dot {
        width: 6px; height: 6px;
        border-radius: 50%;
        background: #ff5577;
        animation: wb-badge-blink 1s steps(2, jump-none) infinite;
      }
      @keyframes wb-badge-blink { 50% { opacity: 0.25; } }

      .wb-zoom-readout {
        font-variant-numeric: tabular-nums;
        min-width: 46px;
        letter-spacing: 0.01em;
      }

      /* ── Destructive ──────────────────────────────────────────── */
      .wb-destructive:hover:not(:disabled) {
        background: color-mix(in srgb, #ef4444 18%, var(--bg-elevated));
        border-color: color-mix(in srgb, #ef4444 55%, transparent);
        color: #fca5a5;
      }
      .wb-destructive.is-confirming {
        background: color-mix(in srgb, #ef4444 30%, var(--bg-elevated));
        border-color: #ef4444;
        color: #fff;
        animation: wb-pulse-warn 1.1s ease-in-out infinite;
      }
      .wb-confirm-text { font-size: var(--text-2xs); font-weight: 700; padding: 0 2px; }
      @keyframes wb-pulse-warn {
        0%, 100% { box-shadow: 0 0 0 0 transparent; }
        50% { box-shadow: 0 0 0 3px color-mix(in srgb, #ef4444 35%, transparent); }
      }

      @media (prefers-reduced-motion: reduce) {
        .wb-btn, .wb-swatch, .wb-width, .wb-width-dot, .wb-avatar { transition: none; }
        .wb-btn:active:not(:disabled) { transform: none; }
        .wb-avatar.is-active, .wb-badge-dot, .wb-destructive.is-confirming { animation: none; }
      }
    `}</style>
  );
}
