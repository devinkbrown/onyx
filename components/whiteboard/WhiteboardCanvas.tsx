'use client';

/**
 * WhiteboardCanvas — collaborative drawing surface for a single channel.
 *
 * Architecture:
 *   • Committed strokes paint onto a base <canvas>; that canvas is only
 *     repainted when the stroke list or view (pan/zoom) changes.
 *   • The in-progress draft + interaction feedback paint onto an overlay
 *     <canvas> driven by requestAnimationFrame, so dragging never forces
 *     React re-renders or full-list repaints (avoids re-render churn).
 *   • Pan/zoom is a single view transform applied at paint time; strokes
 *     stay normalised on the wire, so zoom is purely a local concern.
 *   • Presence + cursors derive from channel membership and the hook's
 *     remoteCursors — no separate sync backend is invented.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import { useWhiteboard, type WhiteboardTool } from '@/hooks/useWhiteboard';
import { WhiteboardToolbar, type WhiteboardPeer } from './WhiteboardToolbar';
import { RemoteCursors } from './RemoteCursors';
import {
  type DraftStroke, type View, IDENTITY_VIEW, clampZoom,
  screenToWorld, repaintAll, paintStroke, decimate, nickColor,
} from './paint';

interface WhiteboardCanvasProps {
  channel: string;
  onClose: () => void;
}

const DPR_CAP = 2;
const ZOOM_STEP = 1.2;
const TOOL_HOTKEYS: Record<string, WhiteboardTool> = {
  p: 'pen', l: 'line', r: 'rect', o: 'circle', t: 'text', e: 'eraser',
};

function dpr(): number {
  return Math.min(window.devicePixelRatio || 1, DPR_CAP);
}

export function WhiteboardCanvas({ channel, onClose }: WhiteboardCanvasProps) {
  const ourNick  = useOnyxStore(s => s.ourNick);
  const channels = useOnyxStore(s => s.channels);
  const connectionStatus = useOnyxStore(s => s.connectionStatus);
  // Only treat hard drops as "disconnected"; a transient connecting/reconnecting
  // state should not flash the blocking overlay over an active board.
  const isDisconnected = connectionStatus === 'disconnected';

  // Channel membership → presence + permission gating.
  const channelEntry = channels.get(channel.toLowerCase());
  const myModes = useMemo(
    () => channelEntry?.users.get(ourNick.toLowerCase())?.modes ?? new Set<string>(),
    [channelEntry, ourNick],
  );

  const {
    strokes, notice, rateLimited,
    drawStroke, clear, requestSnapshot, exportPNG,
    undo, redo, canUndo, canRedo,
    remoteCursors, sendCursor,
  } = useWhiteboard(channel);

  const containerRef = useRef<HTMLDivElement>(null);
  const baseRef      = useRef<HTMLCanvasElement>(null);
  const overlayRef   = useRef<HTMLCanvasElement>(null);
  const inputRef     = useRef<HTMLCanvasElement>(null);
  const draftRef     = useRef<DraftStroke | null>(null);
  const rafRef       = useRef<number>(0);
  const panRef       = useRef<{ pointerId: number; startX: number; startY: number; origin: View } | null>(null);

  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [view, setView] = useState<View>(IDENTITY_VIEW);
  const viewRef = useRef<View>(IDENTITY_VIEW);
  viewRef.current = view;

  const [tool,       setTool]       = useState<WhiteboardTool>('pen');
  const [color,      setColor]      = useState<string>('#5eccff');
  const [width,      setWidth]      = useState<number>(3);
  const [fillShapes, setFillShapes] = useState<boolean>(false);
  const [isDrawing,  setIsDrawing]  = useState(false);
  const [spaceHeld,  setSpaceHeld]  = useState(false);
  const [snapshotPending, setSnapshotPending] = useState(true);

  const [textInput, setTextInput] = useState<{ wx: number; wy: number } | null>(null);
  const [textValue, setTextValue] = useState('');

  const canClear = useMemo(
    () => myModes.has('o') || myModes.has('O') || myModes.has('a') || myModes.has('q'),
    [myModes],
  );

  // ── Presence: live collaborators from channel membership ─────────────
  const peers = useMemo<WhiteboardPeer[]>(() => {
    if (!channelEntry) return [];
    const activeNicks = new Set(remoteCursors.map(c => c.nick.toLowerCase()));
    const out: WhiteboardPeer[] = [];
    for (const [, u] of channelEntry.users) {
      if (u.nick.toLowerCase() === ourNick.toLowerCase()) continue;
      const role = u.modes.has('q') ? 'q' : u.modes.has('o') ? 'o' : u.modes.has('v') ? 'v' : '';
      out.push({
        nick: u.nick,
        color: nickColor(u.nick),
        role,
        active: activeNicks.has(u.nick.toLowerCase()),
      });
    }
    // Active collaborators first, then by name.
    out.sort((a, b) => (Number(b.active) - Number(a.active)) || a.nick.localeCompare(b.nick));
    return out;
  }, [channelEntry, ourNick, remoteCursors]);

  // ── Sizing ───────────────────────────────────────────────────────────
  const resizeCanvas = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const ratio = dpr();
    const cssW = Math.max(320, Math.floor(rect.width));
    const cssH = Math.max(240, Math.floor(rect.height));
    for (const canvas of [baseRef.current, overlayRef.current]) {
      if (!canvas) continue;
      canvas.width  = Math.floor(cssW * ratio);
      canvas.height = Math.floor(cssH * ratio);
      canvas.style.width  = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    setCanvasSize({ w: cssW, h: cssH });
  }, []);

  useEffect(() => {
    resizeCanvas();
    const obs = new ResizeObserver(() => resizeCanvas());
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [resizeCanvas]);

  // ── Base layer repaint (committed strokes only) ──────────────────────
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ratio = dpr();
    repaintAll(
      ctx, canvas.width, canvas.height,
      canvas.width / ratio, canvas.height / ratio,
      view, strokes, null,
    );
  }, [strokes, view, canvasSize]);

  // ── Overlay layer: draft + interaction feedback via rAF ──────────────
  const scheduleOverlay = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const canvas = overlayRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const ratio = dpr();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      const draft = draftRef.current;
      if (!draft) return;
      if (draft.tool === 'eraser') {
        // The real erase happens on the committed base layer; on the
        // transparent overlay a destination-out stroke would be invisible,
        // so show a soft neutral "ghost" trail to preview the erase path.
        paintStroke(
          ctx,
          { ...draft, tool: 'pen', color: 'rgba(223,240,255,0.35)' },
          canvas.width / ratio, canvas.height / ratio, viewRef.current,
        );
      } else {
        paintStroke(ctx, draft, canvas.width / ratio, canvas.height / ratio, viewRef.current);
      }
    });
  }, []);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  // ── Late-joiner snapshot request ─────────────────────────────────────
  useEffect(() => {
    if (!channel) return;
    setSnapshotPending(true);
    const t = setTimeout(() => requestSnapshot(), 0);
    // Snapshot considered settled either on first stroke or a short grace window.
    const grace = setTimeout(() => setSnapshotPending(false), 1500);
    return () => { clearTimeout(t); clearTimeout(grace); };
  }, [channel, requestSnapshot]);

  useEffect(() => {
    if (strokes.length > 0) setSnapshotPending(false);
  }, [strokes.length]);

  // ── Zoom helpers ─────────────────────────────────────────────────────
  const zoomAt = useCallback((factor: number, anchorX: number, anchorY: number) => {
    setView(v => {
      const next = clampZoom(v.scale * factor);
      const k = next / v.scale;
      // Keep the anchor point stationary under the cursor.
      return {
        scale: next,
        tx: anchorX - (anchorX - v.tx) * k,
        ty: anchorY - (anchorY - v.ty) * k,
      };
    });
  }, []);

  const zoomCenter = useCallback((factor: number) => {
    zoomAt(factor, canvasSize.w / 2, canvasSize.h / 2);
  }, [zoomAt, canvasSize]);

  const resetView = useCallback(() => setView(IDENTITY_VIEW), []);

  // Native non-passive wheel listener so we can preventDefault for ctrl/cmd+wheel zoom.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return; // plain scroll left to the page
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ── Keyboard: tool hotkeys, undo/redo, zoom, pan ─────────────────────
  useEffect(() => {
    const isEditable = (el: Element | null) =>
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (isEditable(active)) return;
      const inScope =
        containerRef.current &&
        (containerRef.current.contains(active) || active === document.body);
      if (!inScope) return;

      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomCenter(ZOOM_STEP); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomCenter(1 / ZOOM_STEP); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); resetView(); return; }
      if (e.shiftKey && e.key === '!') { e.preventDefault(); resetView(); return; }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === ' ') { setSpaceHeld(true); return; }
      if (e.key === 'Escape') { setTextInput(null); return; }

      const mapped = TOOL_HOTKEYS[e.key.toLowerCase()];
      if (mapped) { setTool(mapped); }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false);
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [undo, redo, zoomCenter, resetView]);

  // ── Pointer geometry ─────────────────────────────────────────────────
  const localPoint = useCallback((e: React.PointerEvent): [number, number] => {
    const canvas = overlayRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }, []);

  // Pan when space is held (cursor turns to grab) or the middle mouse button is used.
  const wantsPan = (e: React.PointerEvent) => spaceHeld || e.button === 1;

  // ── Pointer handlers ─────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!ourNick) return;

    // Pan (space-drag / middle button).
    if (wantsPan(e)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      panRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origin: viewRef.current };
      return;
    }

    if (tool === 'text') {
      const [px, py] = localPoint(e);
      const [wx, wy] = screenToWorld(px, py, canvasSize.w, canvasSize.h, viewRef.current);
      setTextInput({ wx, wy });
      setTextValue('');
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    const isShape = tool === 'rect' || tool === 'circle';
    draftRef.current = {
      tool, color, width,
      pointsPx: [p],
      pointerId: e.pointerId,
      ...(isShape && fillShapes ? { fill: true } : {}),
    };
    setIsDrawing(true);
    scheduleOverlay();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Pan in progress.
    const pan = panRef.current;
    if (pan && pan.pointerId === e.pointerId) {
      setView({
        scale: pan.origin.scale,
        tx: pan.origin.tx + (e.clientX - pan.startX),
        ty: pan.origin.ty + (e.clientY - pan.startY),
      });
      return;
    }

    // Broadcast cursor (world coords) regardless of drawing state.
    const [px, py] = localPoint(e);
    const [wx, wy] = screenToWorld(px, py, canvasSize.w, canvasSize.h, viewRef.current);
    sendCursor(Math.max(0, Math.min(1, wx)), Math.max(0, Math.min(1, wy)));

    const draft = draftRef.current;
    if (!draft || draft.pointerId !== e.pointerId) return;
    if (draft.tool === 'pen' || draft.tool === 'eraser') {
      draft.pointsPx.push([px, py]);
    } else {
      draft.pointsPx = [draft.pointsPx[0], [px, py]];
    }
    scheduleOverlay();
  };

  const clearOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }, []);

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // End pan.
    if (panRef.current && panRef.current.pointerId === e.pointerId) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      panRef.current = null;
      return;
    }

    const draft = draftRef.current;
    if (!draft || draft.pointerId !== e.pointerId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    draftRef.current = null;
    setIsDrawing(false);
    clearOverlay();

    if (canvasSize.w <= 0 || canvasSize.h <= 0) return;
    const v = viewRef.current;
    const decimated = decimate(draft.pointsPx, 1.5);
    const normalised = decimated.map(([x, y]) => {
      const [wx, wy] = screenToWorld(x, y, canvasSize.w, canvasSize.h, v);
      return [
        Math.max(0, Math.min(1, wx)),
        Math.max(0, Math.min(1, wy)),
      ] as readonly [number, number];
    });
    if (normalised.length === 0) return;

    drawStroke({
      tool: draft.tool,
      color: draft.color,
      width: draft.width,
      points: normalised,
      ...(draft.fill ? { fill: true } : {}),
    });
  };

  const onExport = useCallback(() => {
    const url = exportPNG(baseRef.current);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `whiteboard-${channel.replace(/^[#&]+/, '')}-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [channel, exportPNG]);

  const cursorStyle =
    spaceHeld ? (panRef.current ? 'grabbing' : 'grab')
    : tool === 'eraser' ? 'cell'
    : tool === 'text' ? 'text'
    : 'crosshair';

  const isEmpty = strokes.length === 0 && !isDrawing && !snapshotPending;

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="wb-root" aria-label={`Whiteboard for ${channel}`}>
      <style>{`
        .wb-root {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          background: var(--bg-base);
          color: var(--text-primary);
          border-left: 1px solid var(--border-normal);
        }
        .wb-notice {
          display: flex; align-items: center; gap: 8px;
          padding: 7px 14px;
          font-size: var(--text-xs);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .wb-notice-info { color: var(--text-secondary); }
        .wb-notice-error {
          color: #ffb6c6;
          background: color-mix(in srgb, #ff5577 12%, transparent);
        }
        .wb-stage {
          flex: 1; min-height: 0; position: relative; overflow: hidden;
          background:
            radial-gradient(120% 90% at 50% -10%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 60%),
            var(--bg-void);
        }
        .wb-grid {
          position: absolute; inset: 0;
          pointer-events: none;
          background-image:
            repeating-linear-gradient(0deg, color-mix(in srgb, var(--border-normal) 55%, transparent) 0 1px, transparent 1px var(--wb-grid)),
            repeating-linear-gradient(90deg, color-mix(in srgb, var(--border-normal) 55%, transparent) 0 1px, transparent 1px var(--wb-grid));
          background-position: var(--wb-gx) var(--wb-gy);
          mask-image: radial-gradient(130% 130% at 50% 50%, #000 60%, transparent 100%);
        }
        .wb-canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; touch-action: none; }
        .wb-canvas-overlay { pointer-events: none; }
        .wb-empty {
          position: absolute; inset: 0; z-index: 4;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 14px; pointer-events: none; text-align: center; padding: 24px;
        }
        .wb-empty-glyph {
          width: 64px; height: 64px;
          display: grid; place-items: center;
          border-radius: var(--r-xl);
          background: color-mix(in srgb, var(--accent) 9%, transparent);
          border: 1px solid var(--border-normal);
          box-shadow: var(--shadow-md), inset 0 1px 0 color-mix(in srgb, #fff 8%, transparent);
        }
        .wb-empty-title {
          font-family: var(--font-display);
          font-size: var(--text-lg);
          font-weight: 600;
          color: var(--text-primary);
          letter-spacing: 0.01em;
        }
        .wb-empty-sub { font-size: var(--text-xs); color: var(--text-muted); max-width: 240px; line-height: 1.5; }
        .wb-empty-keys { display: inline-flex; gap: 6px; margin-top: 2px; }
        .wb-empty-key {
          font-size: 9px; font-weight: 700;
          padding: 2px 6px;
          border-radius: var(--r-sm);
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          color: var(--text-secondary);
        }
        .wb-loading {
          position: absolute; inset: 0; z-index: 4;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 12px; pointer-events: none;
        }
        .wb-spinner {
          width: 30px; height: 30px;
          border-radius: 50%;
          border: 2.5px solid color-mix(in srgb, var(--accent) 22%, transparent);
          border-top-color: var(--accent);
          animation: wb-spin 0.7s linear infinite;
        }
        .wb-loading-text { font-size: var(--text-xs); color: var(--text-muted); letter-spacing: 0.03em; }
        @keyframes wb-spin { to { transform: rotate(360deg); } }
        .wb-disconnected {
          position: absolute; inset: 0; z-index: 6;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 10px; text-align: center; padding: 24px;
          background: color-mix(in srgb, var(--bg-void) 70%, transparent);
          backdrop-filter: blur(2px);
        }
        .wb-disconnected-title { font-size: var(--text-sm); font-weight: 600; color: #ffb6c6; }
        .wb-disconnected-sub { font-size: var(--text-xs); color: var(--text-muted); }
        .wb-text-pop { position: absolute; z-index: 10; }
        .wb-text-input {
          background: color-mix(in srgb, var(--bg-void) 82%, transparent);
          border: 1px solid var(--accent-border);
          border-radius: var(--r-sm);
          font-family: var(--font-ui);
          padding: 6px 8px;
          min-width: 130px;
          resize: both;
          backdrop-filter: blur(8px);
          outline: none;
          box-shadow: var(--shadow-md);
        }
        .wb-text-input:focus { border-color: var(--accent); box-shadow: var(--shadow-md), 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent); }
        .wb-text-hint { font-size: 9px; color: var(--text-muted); margin-top: 3px; }
        @media (prefers-reduced-motion: reduce) {
          .wb-spinner { animation-duration: 1.6s; }
        }
      `}</style>

      <WhiteboardToolbar
        tool={tool}
        color={color}
        width={width}
        canClear={canClear}
        rateLimited={rateLimited}
        fillShapes={fillShapes}
        canUndo={canUndo}
        canRedo={canRedo}
        zoom={view.scale}
        peers={peers}
        onToolChange={setTool}
        onColorChange={setColor}
        onWidthChange={setWidth}
        onFillToggle={() => setFillShapes(v => !v)}
        onUndo={undo}
        onRedo={redo}
        onClear={clear}
        onExport={onExport}
        onClose={onClose}
        onZoomIn={() => zoomCenter(ZOOM_STEP)}
        onZoomOut={() => zoomCenter(1 / ZOOM_STEP)}
        onZoomReset={resetView}
      />

      {notice && (
        <div
          role={notice.level === 'error' ? 'alert' : 'status'}
          className={`wb-notice ${notice.level === 'error' ? 'wb-notice-error' : 'wb-notice-info'}`}
        >
          {notice.message}
        </div>
      )}

      <div
        ref={containerRef}
        className="wb-stage"
        style={{
          ['--wb-grid' as string]: `${32 * view.scale}px`,
          ['--wb-gx' as string]: `${view.tx}px`,
          ['--wb-gy' as string]: `${view.ty}px`,
        }}
      >
        <div className="wb-grid" aria-hidden="true" />

        <canvas ref={baseRef} className="wb-canvas" aria-label="Whiteboard drawing surface" role="img" />
        <canvas
          ref={overlayRef}
          className="wb-canvas wb-canvas-overlay"
          aria-hidden="true"
        />
        {/* Transparent interaction surface on top so pointer events hit one node. */}
        <canvas
          ref={inputRef}
          className="wb-canvas"
          style={{ background: 'transparent', cursor: cursorStyle, zIndex: 3 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          onPointerLeave={finishStroke}
          aria-label="Drawing input layer"
        />

        {snapshotPending && strokes.length === 0 && (
          <div className="wb-loading">
            <div className="wb-spinner" />
            <span className="wb-loading-text">Loading board…</span>
          </div>
        )}

        {isEmpty && (
          <div className="wb-empty">
            <div className="wb-empty-glyph">
              <svg width="30" height="30" viewBox="0 0 48 48" fill="none" aria-hidden="true">
                <path d="M8 40L18 24l8 10 8-14 6 10" stroke="var(--accent)" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="8" cy="40" r="2.4" fill="var(--accent)" />
              </svg>
            </div>
            <div className="wb-empty-title">A blank canvas</div>
            <div className="wb-empty-sub">
              Sketch, diagram, and brainstorm together. Everything you draw syncs live to everyone in {channel}.
            </div>
            <div className="wb-empty-keys">
              <span className="wb-empty-key">P pen</span>
              <span className="wb-empty-key">R rect</span>
              <span className="wb-empty-key">T text</span>
              <span className="wb-empty-key">Space pan</span>
            </div>
          </div>
        )}

        <RemoteCursors cursors={remoteCursors} cssW={canvasSize.w} cssH={canvasSize.h} view={view} />

        {isDisconnected && (
          <div className="wb-disconnected" role="alert">
            <div className="wb-disconnected-title">Disconnected</div>
            <div className="wb-disconnected-sub">Reconnecting to the server — your drawing won’t sync until the link is back.</div>
          </div>
        )}

        {textInput && (
          <TextPopup
            wx={textInput.wx}
            wy={textInput.wy}
            cssW={canvasSize.w}
            cssH={canvasSize.h}
            view={view}
            color={color}
            width={width}
            value={textValue}
            onChange={setTextValue}
            onCommit={(value) => {
              if (value.trim()) {
                drawStroke({ tool: 'text', color, width, points: [[textInput.wx, textInput.wy]], text: value.trim() });
              }
              setTextInput(null);
            }}
            onCancel={() => setTextInput(null)}
          />
        )}
      </div>
    </div>
  );
}

/** Inline text entry popup positioned in screen space via the view transform. */
function TextPopup({
  wx, wy, cssW, cssH, view, color, width, value, onChange, onCommit, onCancel,
}: {
  wx: number; wy: number; cssW: number; cssH: number; view: View;
  color: string; width: number; value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const px = wx * cssW * view.scale + view.tx;
  const py = wy * cssH * view.scale + view.ty;
  return (
    <div className="wb-text-pop" style={{ left: px, top: py }} onPointerDown={e => e.stopPropagation()}>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        autoFocus
        rows={2}
        className="wb-text-input"
        style={{ color, fontSize: Math.max(12, width * 4 * view.scale) }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onCommit(value); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        placeholder="Type, Enter to place…"
      />
      <div className="wb-text-hint">Enter to place · Shift+Enter for newline · Esc to cancel</div>
    </div>
  );
}
