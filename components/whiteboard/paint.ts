/**
 * paint.ts — pure rendering helpers for the whiteboard canvas.
 *
 * Coordinates: strokes store normalised points (0..1) relative to the
 * board's logical surface. The canvas renders them into CSS-pixel space
 * after applying the current pan/zoom view transform. Keeping these
 * functions pure (no React, no refs) makes them trivial to test and
 * keeps WhiteboardCanvas focused on interaction + state.
 */

import type { WhiteboardStroke, WhiteboardTool } from '@/hooks/useWhiteboard';

/** In-progress stroke before pointer-up. Points are in CSS-pixel space. */
export interface DraftStroke {
  tool: WhiteboardTool;
  color: string;
  width: number;
  pointsPx: Array<readonly [number, number]>;
  fill?: boolean;
  pointerId: number;
}

/** The active pan/zoom view. `scale` is the zoom factor, `tx/ty` are CSS-px offsets. */
export interface View {
  scale: number;
  tx: number;
  ty: number;
}

export const IDENTITY_VIEW: View = { scale: 1, tx: 0, ty: 0 };

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/** Screen (CSS-px) → world (normalised 0..1) given canvas size + view. */
export function screenToWorld(
  sx: number, sy: number,
  cssW: number, cssH: number,
  view: View,
): [number, number] {
  const wx = (sx - view.tx) / view.scale / cssW;
  const wy = (sy - view.ty) / view.scale / cssH;
  return [wx, wy];
}

/** World (normalised 0..1) → screen (CSS-px). */
export function worldToScreen(
  wx: number, wy: number,
  cssW: number, cssH: number,
  view: View,
): [number, number] {
  return [wx * cssW * view.scale + view.tx, wy * cssH * view.scale + view.ty];
}

/**
 * Smooth quadratic-bezier path through a point list. Produces a far more
 * natural pen line than straight lineTo segments between raw samples.
 */
function paintSmoothPath(
  ctx: CanvasRenderingContext2D,
  pts: Array<[number, number]>,
): void {
  if (pts.length === 0) return;
  ctx.beginPath();
  if (pts.length === 1) {
    ctx.arc(pts[0][0], pts[0][1], Math.max(ctx.lineWidth / 2, 0.5), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 2) {
    ctx.lineTo(pts[1][0], pts[1][1]);
    ctx.stroke();
    return;
  }
  const mid0x = (pts[0][0] + pts[1][0]) / 2;
  const mid0y = (pts[0][1] + pts[1][1]) / 2;
  ctx.lineTo(mid0x, mid0y);
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i][0] + pts[i + 1][0]) / 2;
    const midY = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], midX, midY);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
  ctx.stroke();
}

/**
 * Render a single stroke into screen space. `cssW/cssH` are the logical
 * canvas dimensions; `view` applies pan/zoom so the same normalised
 * stroke renders correctly at any zoom level.
 */
export function paintStroke(
  ctx: CanvasRenderingContext2D,
  stroke: WhiteboardStroke | DraftStroke,
  cssW: number,
  cssH: number,
  view: View,
): void {
  const isWire = 'points' in stroke;
  const rawPoints = isWire ? stroke.points : stroke.pointsPx;
  if (rawPoints.length === 0 && stroke.tool !== 'text') return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Stroke width scales with zoom so lines keep their relative weight.
  ctx.lineWidth = Math.max(0.5, stroke.width * view.scale);

  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.fillStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
  }

  const shouldFill = !!stroke.fill;

  // Resolve every point to screen space.
  const resolved: Array<[number, number]> = isWire
    ? (stroke.points as ReadonlyArray<readonly [number, number]>).map(
        ([nx, ny]) => worldToScreen(nx, ny, cssW, cssH, view),
      )
    : (stroke.pointsPx as ReadonlyArray<readonly [number, number]>).map(
        ([x, y]) => [x, y] as [number, number],
      );

  switch (stroke.tool) {
    case 'pen':
    case 'eraser':
      paintSmoothPath(ctx, resolved);
      break;
    case 'line': {
      if (resolved.length < 2) break;
      const a = resolved[0];
      const b = resolved[resolved.length - 1];
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      break;
    }
    case 'rect': {
      if (resolved.length < 2) break;
      const a = resolved[0];
      const b = resolved[resolved.length - 1];
      const x = Math.min(a[0], b[0]);
      const y = Math.min(a[1], b[1]);
      const w = Math.abs(b[0] - a[0]);
      const h = Math.abs(b[1] - a[1]);
      if (shouldFill) ctx.fillRect(x, y, w, h);
      else ctx.strokeRect(x, y, w, h);
      break;
    }
    case 'circle': {
      if (resolved.length < 2) break;
      const a = resolved[0];
      const b = resolved[resolved.length - 1];
      const cx = (a[0] + b[0]) / 2;
      const cy = (a[1] + b[1]) / 2;
      const rx = Math.abs(b[0] - a[0]) / 2;
      const ry = Math.abs(b[1] - a[1]) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (shouldFill) ctx.fill();
      else ctx.stroke();
      break;
    }
    case 'text': {
      const text = 'text' in stroke ? stroke.text : undefined;
      if (!text || resolved.length === 0) break;
      ctx.font = `${Math.max(12, stroke.width * 4 * view.scale)}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(text, resolved[0][0], resolved[0][1]);
      break;
    }
  }
  ctx.restore();
}

/**
 * Clear and repaint a full stroke list plus optional draft onto a 2D
 * context. The caller is responsible for the context's DPR transform.
 */
export function repaintAll(
  ctx: CanvasRenderingContext2D,
  backingW: number,
  backingH: number,
  cssW: number,
  cssH: number,
  view: View,
  strokes: ReadonlyArray<WhiteboardStroke>,
  draft: DraftStroke | null,
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, backingW, backingH);
  ctx.restore();

  for (const s of strokes) paintStroke(ctx, s, cssW, cssH, view);
  if (draft) paintStroke(ctx, draft, cssW, cssH, view);
}

/**
 * Downsample a noisy pointer trail — keep endpoints, drop intermediate
 * samples closer than `epsilon` px from the previous kept point.
 */
export function decimate(
  points: ReadonlyArray<readonly [number, number]>,
  epsilon = 1.5,
): Array<readonly [number, number]> {
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

/** Deterministic vivid color from a nick (matches the hook's cursor hashing). */
export function nickColor(nick: string): string {
  const hue = [...nick].reduce((a, c) => (a * 31 + c.charCodeAt(0)) & 0xffff, 0) % 360;
  return `hsl(${hue}, 70%, 65%)`;
}
