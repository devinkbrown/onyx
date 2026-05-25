'use client';

/**
 * WhiteboardCanvas — collaborative drawing surface for a single channel.
 *
 * Wraps useWhiteboard() and a <canvas> to provide pen/eraser/shape
 * tools with pointer (mouse/touch/pen) input. Strokes are emitted on
 * pointer-up and replayed locally for every inbound DRAW frame.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import {
  useWhiteboard,
  type WhiteboardStroke,
  type WhiteboardTool,
} from '@/hooks/useWhiteboard';
import { WhiteboardToolbar } from './WhiteboardToolbar';

interface WhiteboardCanvasProps {
  channel: string;
  /** Called when the user clicks the close button. */
  onClose: () => void;
}


/** Internal in-progress stroke (before pointer-up). Coords are CSS pixels. */
interface DraftStroke {
  tool: WhiteboardTool;
  color: string;
  width: number;
  pointsPx: Array<readonly [number, number]>;
  pointerId: number;
}

/**
 * Smooth quadratic-bezier path through a point list.
 * For pen/eraser tools, this produces a much more natural line than
 * straight lineTo segments between every raw pointer sample.
 */
function paintSmoothPath(
  ctx: CanvasRenderingContext2D,
  resolved: Array<[number, number]>,
): void {
  if (resolved.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(resolved[0][0], resolved[0][1]);
  if (resolved.length === 1) {
    // Single point: draw a dot.
    ctx.arc(resolved[0][0], resolved[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (resolved.length === 2) {
    ctx.lineTo(resolved[1][0], resolved[1][1]);
    ctx.stroke();
    return;
  }
  // Quadratic bezier through midpoints.
  // Start at the midpoint of [0]→[1] so the first segment curves naturally,
  // then use each sample as a control point and the next midpoint as the
  // anchor — the curve passes through all midpoints.
  const mid0x = (resolved[0][0] + resolved[1][0]) / 2;
  const mid0y = (resolved[0][1] + resolved[1][1]) / 2;
  ctx.lineTo(mid0x, mid0y);
  for (let i = 1; i < resolved.length - 1; i++) {
    const midX = (resolved[i][0] + resolved[i + 1][0]) / 2;
    const midY = (resolved[i][1] + resolved[i + 1][1]) / 2;
    ctx.quadraticCurveTo(resolved[i][0], resolved[i][1], midX, midY);
  }
  const last = resolved[resolved.length - 1];
  ctx.lineTo(last[0], last[1]);
  ctx.stroke();
}

/**
 * Render a single stroke onto the given 2D context. Coordinates in the
 * stroke are normalised (0..1); we scale to the canvas backing-store size.
 */
function paintStroke(
  ctx: CanvasRenderingContext2D,
  stroke: WhiteboardStroke | DraftStroke,
  width: number,
  height: number,
): void {
  const points = 'points' in stroke ? stroke.points : stroke.pointsPx;
  if (points.length === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.width;

  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
  }

  // Whether to fill shapes (rect/circle) — from wire stroke or draft.
  const shouldFill = 'fill' in stroke ? !!(stroke as WhiteboardStroke).fill : false;

  // Resolve points to pixel space depending on stroke flavor.
  const resolved: Array<[number, number]> = 'points' in stroke
    ? (stroke.points as ReadonlyArray<readonly [number, number]>).map(
        ([nx, ny]) => [nx * width, ny * height] as [number, number],
      )
    : (stroke.pointsPx as ReadonlyArray<readonly [number, number]>).map(
        ([x, y]) => [x, y] as [number, number],
      );

  switch (stroke.tool) {
    case 'pen':
    case 'eraser': {
      paintSmoothPath(ctx, resolved);
      break;
    }
    case 'line': {
      if (resolved.length < 2) break;
      const [la, lb] = [resolved[0], resolved[resolved.length - 1]];
      ctx.beginPath();
      ctx.moveTo(la[0], la[1]);
      ctx.lineTo(lb[0], lb[1]);
      ctx.stroke();
      break;
    }
    case 'rect': {
      if (resolved.length < 2) break;
      const [ra, rb] = [resolved[0], resolved[resolved.length - 1]];
      const rx = Math.min(ra[0], rb[0]);
      const ry = Math.min(ra[1], rb[1]);
      const rw = Math.abs(rb[0] - ra[0]);
      const rh = Math.abs(rb[1] - ra[1]);
      if (shouldFill) {
        ctx.fillRect(rx, ry, rw, rh);
      } else {
        ctx.strokeRect(rx, ry, rw, rh);
      }
      break;
    }
    case 'circle': {
      if (resolved.length < 2) break;
      const [ca, cb] = [resolved[0], resolved[resolved.length - 1]];
      const cx = (ca[0] + cb[0]) / 2;
      const cy = (ca[1] + cb[1]) / 2;
      const crx = Math.abs(cb[0] - ca[0]) / 2;
      const cry = Math.abs(cb[1] - ca[1]) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, crx, cry, 0, 0, Math.PI * 2);
      if (shouldFill) { ctx.fill(); } else { ctx.stroke(); }
      break;
    }
    case 'text': {
      if (!('text' in stroke) || !stroke.text || resolved.length === 0) break;
      ctx.font = `${Math.max(12, stroke.width * 4)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(stroke.text, resolved[0][0], resolved[0][1]);
      break;
    }
  }
  ctx.restore();
}

/**
 * Downsample a noisy pointer trail to a manageable shape — keep the
 * endpoints, drop intermediate samples that are closer than `epsilon`
 * pixels from the previous kept point.
 */
function decimate(points: ReadonlyArray<readonly [number, number]>, epsilon = 1.5): Array<readonly [number, number]> {
  if (points.length <= 2) return [...points];
  const out: Array<readonly [number, number]> = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const dx = p[0] - last[0];
    const dy = p[1] - last[1];
    if (dx * dx + dy * dy >= epsilon * epsilon) {
      out.push(p);
      last = p;
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export function WhiteboardCanvas({ channel, onClose }: WhiteboardCanvasProps) {
  const ourNick  = useOnyxStore(s => s.ourNick);
  const channels = useOnyxStore(s => s.channels);

  // Derive oper/admin modes from the channel member list.
  const myModes = useMemo(() => {
    const ch = channels.get(channel.toLowerCase());
    return ch?.users.get(ourNick.toLowerCase())?.modes ?? new Set<string>();
  }, [channels, channel, ourNick]);

  const {
    strokes, notice, rateLimited,
    drawStroke, clear, requestSnapshot, exportPNG,
    undo, redo, canUndo, canRedo,
    remoteCursors, sendCursor,
  } = useWhiteboard(channel);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const draftRef     = useRef<DraftStroke | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const [, forceRepaint] = useState(0);
  // Tracked in state so cursor overlay can use canvas dimensions without a ref read during render.
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const [tool,       setTool]       = useState<WhiteboardTool>('pen');
  const [color,      setColor]      = useState<string>('#5eccff');
  const [width,      setWidth]      = useState<number>(3);
  const [fillShapes, setFillShapes] = useState<boolean>(false);
  // Tracks whether a draft stroke is in progress — mirrors draftRef for render use.
  const [isDrawing, setIsDrawing] = useState(false);

  // Text tool popup state.
  const [textInput, setTextInput] = useState<{ x: number; y: number; px: number; py: number } | null>(null);
  const [textValue, setTextValue] = useState('');

  // Oper-or-creator gate for Clear. Server enforces it; we just hint.
  const canClear = useMemo(() => myModes.has('o') || myModes.has('O') || myModes.has('a') || myModes.has('q'), [myModes]);

  // ── Sizing ──────────────────────────────────────────────────────────
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(320, Math.floor(rect.width));
    const cssH = Math.max(240, Math.floor(rect.height));
    canvas.width  = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width  = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    setCanvasSize({ w: cssW, h: cssH });
    forceRepaint(n => n + 1);
  }, []);

  useEffect(() => {
    resizeCanvas();
    const obs = new ResizeObserver(() => resizeCanvas());
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [resizeCanvas]);

  // ── Repaint on stroke change ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    for (const s of strokes) paintStroke(ctx, s, cssW, cssH);
    if (draftRef.current) paintStroke(ctx, draftRef.current, cssW, cssH);
  }, [strokes]);

  // ── Late-joiner snapshot request ────────────────────────────────────
  useEffect(() => {
    if (!channel) return;
    // Defer one tick so subscription is in place before the request.
    const t = setTimeout(() => requestSnapshot(), 0);
    return () => clearTimeout(t);
  }, [channel, requestSnapshot]);

  // ── Keyboard shortcuts: Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo ─────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip when a text input/textarea has focus (let native undo work there).
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      // Only act when focus is inside the canvas container or on the body.
      if (
        containerRef.current &&
        !containerRef.current.contains(active) &&
        active !== document.body
      ) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) { redo(); } else { undo(); }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // ── Pointer handlers ────────────────────────────────────────────────
  const localPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(rect.width,  e.clientX - rect.left)),
      Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
    ];
  }, []);

  const paintDraft = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    for (const s of strokes) paintStroke(ctx, s, cssW, cssH);
    if (draftRef.current) paintStroke(ctx, draftRef.current, cssW, cssH);
  }, [strokes]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!ourNick) return;

    // Text tool: show inline text input popup, do not start a draft.
    if (tool === 'text') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const p = localPoint(e);
      setTextInput({
        x: p[0] / rect.width,
        y: p[1] / rect.height,
        px: p[0],
        py: p[1],
      });
      setTextValue('');
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    draftRef.current = {
      tool, color, width,
      pointsPx: [p],
      pointerId: e.pointerId,
    };
    setIsDrawing(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Broadcast cursor position to peers regardless of drawing state.
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      sendCursor(
        Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
      );
    }

    const draft = draftRef.current;
    if (!draft || draft.pointerId !== e.pointerId) return;
    const p = localPoint(e);
    // For shapes we only need start+end; for pen/eraser, accumulate.
    if (draft.tool === 'pen' || draft.tool === 'eraser') {
      draft.pointsPx.push(p);
    } else {
      draft.pointsPx = [draft.pointsPx[0], p];
    }
    paintDraft();
  };

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const draft = draftRef.current;
    if (!draft || draft.pointerId !== e.pointerId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    draftRef.current = null;
    setIsDrawing(false);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const decimated = decimate(draft.pointsPx, 1.5);
    const normalised = decimated.map(
      ([x, y]) => [
        Math.max(0, Math.min(1, x / rect.width)),
        Math.max(0, Math.min(1, y / rect.height)),
      ] as readonly [number, number],
    );

    if (normalised.length === 0) return;

    const isShape = draft.tool === 'rect' || draft.tool === 'circle';
    drawStroke({
      tool: draft.tool,
      color: draft.color,
      width: draft.width,
      points: normalised,
      ...(isShape && fillShapes ? { fill: true } : {}),
    });
  };

  const onExport = useCallback(() => {
    const url = exportPNG(canvasRef.current);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `whiteboard-${channel.replace(/^[#&]+/, '')}-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [channel, exportPNG]);

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <>
    <style>{`
      @keyframes wb-cursor-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.55; transform: scale(1.35); }
      }
      .wb-cursor-dot {
        animation: wb-cursor-pulse 1.6s ease-in-out infinite;
      }
    `}</style>
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--bg-base)',
        color: 'var(--text-primary)',
        borderLeft: '1px solid var(--border-subtle)',
      }}
      aria-label={`Whiteboard for ${channel}`}
    >
      <WhiteboardToolbar
        tool={tool}
        color={color}
        width={width}
        canClear={canClear}
        rateLimited={rateLimited}
        fillShapes={fillShapes}
        canUndo={canUndo}
        canRedo={canRedo}
        onToolChange={setTool}
        onColorChange={setColor}
        onWidthChange={setWidth}
        onFillToggle={() => setFillShapes(v => !v)}
        onUndo={undo}
        onRedo={redo}
        onClear={clear}
        onExport={onExport}
        onClose={onClose}
      />

      {notice && (
        <div
          role={notice.level === 'error' ? 'alert' : 'status'}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            color: notice.level === 'error' ? '#ffb6c6' : 'var(--text-secondary)',
            background: notice.level === 'error'
              ? 'color-mix(in srgb, #ff5577 12%, transparent)'
              : 'transparent',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          {notice.message}
        </div>
      )}

      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          background:
            'repeating-linear-gradient(0deg, color-mix(in srgb, var(--border-subtle) 40%, transparent) 0 1px, transparent 1px 32px),' +
            'repeating-linear-gradient(90deg, color-mix(in srgb, var(--border-subtle) 40%, transparent) 0 1px, transparent 1px 32px),' +
            'var(--bg-void)',
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          onPointerLeave={finishStroke}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            touchAction: 'none',
            cursor: tool === 'eraser' ? 'cell' : tool === 'text' ? 'text' : 'crosshair',
          }}
          aria-label="Drawing canvas"
        />

        {/* Empty state placeholder */}
        {strokes.length === 0 && !isDrawing && tool !== 'text' && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            gap: 10,
          }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true"
              style={{ opacity: 0.18 }}>
              <path d="M8 40L18 24l8 10 8-14 6 10" stroke="var(--text-primary)" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="8" cy="40" r="2" fill="var(--text-primary)"/>
            </svg>
            <span style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              letterSpacing: '0.04em',
              userSelect: 'none',
            }}>
              Whiteboard is empty — start drawing
            </span>
          </div>
        )}

        {/* Remote cursor overlay — pointer-events:none so it never intercepts drawing */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          {canvasSize.w > 0 && remoteCursors.map(cursor => {
            const cx = cursor.x * canvasSize.w;
            const cy = cursor.y * canvasSize.h;
            return (
              <div
                key={cursor.nick}
                style={{
                  position: 'absolute',
                  left: cx,
                  top: cy,
                  transform: 'translate(-5px, -5px)',
                  pointerEvents: 'none',
                  transition: 'left 0.1s linear, top 0.1s linear',
                }}
              >
                {/* Pulsing dot cursor */}
                <div className="wb-cursor-dot" style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: cursor.color,
                  boxShadow: `0 0 6px ${cursor.color}`,
                }} />
                {/* Nick label */}
                <div style={{
                  position: 'absolute',
                  left: 14,
                  top: -1,
                  fontSize: 10,
                  fontWeight: 600,
                  color: cursor.color,
                  background: 'rgba(3, 8, 16, 0.82)',
                  padding: '1px 5px',
                  borderRadius: 3,
                  whiteSpace: 'nowrap',
                  backdropFilter: 'blur(4px)',
                  border: `1px solid ${cursor.color}33`,
                  lineHeight: '14px',
                }}>
                  {cursor.nick}
                </div>
              </div>
            );
          })}
        </div>

        {/* Text tool input popup */}
        {textInput && (
          <div
            style={{
              position: 'absolute',
              left: textInput.px,
              top: textInput.py,
              zIndex: 10,
              pointerEvents: 'auto',
            }}
            onPointerDown={e => e.stopPropagation()}
          >
            <textarea
              ref={textInputRef}
              value={textValue}
              onChange={e => setTextValue(e.target.value)}
              autoFocus
              rows={2}
              style={{
                background: 'rgba(3, 8, 16, 0.85)',
                border: '1px solid var(--accent-border)',
                borderRadius: 6,
                color,
                fontSize: Math.max(12, width * 4),
                fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                padding: '6px 8px',
                minWidth: 120,
                resize: 'both',
                backdropFilter: 'blur(8px)',
                outline: 'none',
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (textValue.trim()) {
                    drawStroke({
                      tool: 'text',
                      color,
                      width,
                      points: [[textInput.x, textInput.y]],
                      text: textValue.trim(),
                    });
                  }
                  setTextInput(null);
                }
                if (e.key === 'Escape') setTextInput(null);
              }}
              placeholder="Type text, Enter to place..."
            />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              Enter to place · Esc to cancel
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
