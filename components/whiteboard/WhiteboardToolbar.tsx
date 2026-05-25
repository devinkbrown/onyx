'use client';

/**
 * WhiteboardToolbar — tool + color + width controls for the whiteboard.
 *
 * Pure presentational: the parent owns all state.
 */

import type { WhiteboardTool } from '@/hooks/useWhiteboard';

interface WhiteboardToolbarProps {
  tool: WhiteboardTool;
  color: string;
  width: number;
  canClear: boolean;
  rateLimited: boolean;
  fillShapes: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onToolChange: (tool: WhiteboardTool) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onFillToggle: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onExport: () => void;
  onClose: () => void;
}

const TOOL_BUTTONS: ReadonlyArray<{ id: WhiteboardTool; label: string; glyph: string }> = [
  { id: 'pen',    label: 'Pen',    glyph: '✎' },
  { id: 'line',   label: 'Line',   glyph: '╱' },
  { id: 'rect',   label: 'Rect',   glyph: '▭' },
  { id: 'circle', label: 'Circle', glyph: '◯' },
  { id: 'text',   label: 'Text',   glyph: 'T' },
  { id: 'eraser', label: 'Eraser', glyph: '⌫' },
];

/** Shape tools that support fill. */
const SHAPE_TOOLS: ReadonlySet<WhiteboardTool> = new Set(['rect', 'circle']);

const SWATCHES = [
  '#f5f5fa', '#101030', '#ff5577', '#ffae42',
  '#ffe680', '#7ee787', '#5eccff', '#a78bfa',
];

/** Width presets shown as proportional dots. */
const WIDTH_PRESETS = [1, 3, 6, 12, 24] as const;

const buttonBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 36,
  minWidth: 36,
  padding: '0 8px',
  borderRadius: 8,
  border: '1px solid var(--border-normal)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  fontSize: 13,
  cursor: 'pointer',
  transition: 'background 0.12s, border-color 0.12s, transform 0.1s',
  userSelect: 'none',
};

function ToolButton({
  active,
  disabled,
  onClick,
  title,
  children,
  accentLeft = false,
  destructive = false,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  accentLeft?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...buttonBase,
        background: destructive
          ? 'color-mix(in srgb, #ef4444 14%, var(--bg-elevated))'
          : active
            ? 'color-mix(in srgb, var(--accent) 22%, var(--bg-elevated))'
            : 'var(--bg-elevated)',
        borderColor: destructive
          ? 'rgba(239,68,68,0.35)'
          : active ? 'var(--accent-border)' : 'var(--border-normal)',
        borderLeft: active && accentLeft
          ? '2px solid var(--accent)'
          : active
            ? '1px solid var(--accent-border)'
            : '1px solid var(--border-normal)',
        color: destructive ? '#fca5a5' : active ? 'var(--text-primary)' : 'var(--text-secondary)',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <span
      aria-hidden="true"
      style={{ width: 1, height: 22, background: 'var(--border-normal)', flexShrink: 0 }}
    />
  );
}

export function WhiteboardToolbar({
  tool, color, width, canClear, rateLimited,
  fillShapes, canUndo, canRedo,
  onToolChange, onColorChange, onWidthChange,
  onFillToggle, onUndo, onRedo,
  onClear, onExport, onClose,
}: WhiteboardToolbarProps) {
  const isShapeTool = SHAPE_TOOLS.has(tool);

  const handleClear = () => {
    if (window.confirm('Clear the entire whiteboard? This cannot be undone.')) {
      onClear();
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Whiteboard tools"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        background: 'rgba(6, 16, 29, 0.92)',
        borderBottom: '1px solid var(--border-normal)',
        borderTop: '1px solid var(--border-subtle)',
        backdropFilter: 'blur(12px)',
        flexShrink: 0,
      }}
    >
      {/* Undo / Redo */}
      <div style={{ display: 'inline-flex', gap: 4 }}>
        <ToolButton
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>↩</span>
        </ToolButton>
        <ToolButton
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>↪</span>
        </ToolButton>
      </div>

      <Divider />

      {/* Drawing tools */}
      <div style={{ display: 'inline-flex', gap: 4 }}>
        {TOOL_BUTTONS.map(t => (
          <ToolButton
            key={t.id}
            active={tool === t.id}
            accentLeft
            title={t.label}
            onClick={() => onToolChange(t.id)}
          >
            <span
              aria-hidden="true"
              style={{
                fontSize: t.id === 'text' ? 13 : 15,
                fontWeight: t.id === 'text' ? 700 : 400,
                lineHeight: 1,
              }}
            >
              {t.glyph}
            </span>
          </ToolButton>
        ))}
      </div>

      {/* Fill toggle — only shown for shape tools */}
      {isShapeTool && (
        <ToolButton
          active={fillShapes}
          accentLeft
          title={fillShapes ? 'Filled shape (click to toggle outline)' : 'Outline shape (click to toggle fill)'}
          onClick={onFillToggle}
        >
          <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>
            {fillShapes ? '▪' : '▫'}
          </span>
        </ToolButton>
      )}

      <Divider />

      {/* Color swatches */}
      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        {SWATCHES.map(c => (
          <button
            key={c}
            type="button"
            title={c}
            aria-label={`Color ${c}`}
            aria-pressed={color === c}
            onClick={() => onColorChange(c)}
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: color === c
                ? '2px solid var(--text-primary)'
                : '1px solid var(--border-normal)',
              background: c,
              cursor: 'pointer',
              padding: 0,
              transition: 'border-color 0.12s, transform 0.1s',
              transform: color === c ? 'scale(1.2)' : 'scale(1)',
              flexShrink: 0,
            }}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={e => onColorChange(e.target.value)}
          aria-label="Custom color"
          title="Custom color"
          style={{
            width: 26,
            height: 26,
            border: '1px solid var(--border-normal)',
            borderRadius: 6,
            background: 'transparent',
            cursor: 'pointer',
            padding: 0,
          }}
        />
      </div>

      <Divider />

      {/* Width presets */}
      <div
        style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}
        role="group"
        aria-label="Stroke width presets"
      >
        {WIDTH_PRESETS.map(preset => {
          const isActive = width === preset;
          const dotSize = Math.min(4 + preset * 1.2, 24);
          return (
            <button
              key={preset}
              type="button"
              title={`${preset}px`}
              aria-label={`Stroke width ${preset}px`}
              aria-pressed={isActive}
              onClick={() => onWidthChange(preset)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: isActive
                  ? '1px solid var(--accent-border)'
                  : '1px solid var(--border-normal)',
                background: isActive
                  ? 'color-mix(in srgb, var(--accent) 18%, var(--bg-elevated))'
                  : 'var(--bg-elevated)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.12s, border-color 0.12s',
                padding: 0,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  display: 'block',
                  width: dotSize,
                  height: dotSize,
                  borderRadius: '50%',
                  background: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                  transition: 'background 0.12s',
                }}
              />
            </button>
          );
        })}
        {/* Fine-grained slider for non-preset sizes */}
        <input
          type="range"
          min={1}
          max={32}
          value={width}
          onChange={e => onWidthChange(parseInt(e.target.value, 10) || 1)}
          aria-label="Stroke width (fine)"
          title={`Width: ${width}px`}
          style={{ accentColor: 'var(--accent)', width: 72 }}
        />
        <span
          style={{
            minWidth: 22,
            textAlign: 'right',
            color: 'var(--text-secondary)',
            fontSize: 12,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {width}
        </span>
      </div>

      {/* Spacer */}
      <span style={{ flex: 1 }} />

      {/* Rate-limited status badge */}
      {rateLimited && (
        <span
          role="status"
          style={{
            fontSize: 11,
            padding: '3px 8px',
            borderRadius: 999,
            background: 'color-mix(in srgb, #ff5577 18%, transparent)',
            color: '#ffb6c6',
            border: '1px solid color-mix(in srgb, #ff5577 50%, transparent)',
            flexShrink: 0,
          }}
        >
          rate-limited
        </span>
      )}

      {/* Action buttons */}
      <div style={{ display: 'inline-flex', gap: 4 }}>
        <ToolButton title="Export PNG" onClick={onExport}>
          <span style={{ fontSize: 11, letterSpacing: '0.04em' }}>PNG</span>
        </ToolButton>
        <ToolButton
          title={canClear ? 'Clear board (destructive)' : 'Only an oper or session creator can clear'}
          disabled={!canClear}
          onClick={handleClear}
          destructive
        >
          <span style={{ fontSize: 11 }}>Clear</span>
        </ToolButton>
        <ToolButton title="Close whiteboard" onClick={onClose}>
          <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>×</span>
        </ToolButton>
      </div>
    </div>
  );
}
