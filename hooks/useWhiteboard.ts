'use client';

/**
 * useWhiteboard — collaborative whiteboard state + wire IO for a single channel.
 *
 * Wire format (text-IRC bridge over SUIMYAKU):
 *
 *   Outbound:
 *     WHITEBOARD DRAW    <channel> <stroke_json>
 *     WHITEBOARD CLEAR   <channel>
 *     WHITEBOARD SNAPSHOT <channel>
 *     WHITEBOARD ENABLE  <channel>
 *     WHITEBOARD DISABLE <channel>
 *
 *   Inbound (server fans out to channel members):
 *     :nick!user@host WHITEBOARD DRAW    <channel> <stroke_json>
 *     :nick!user@host WHITEBOARD CLEAR   <channel>
 *     :server         WHITEBOARD SNAPSHOT <channel> <stroke_json>   (replay)
 *     :server         WHITEBOARD ERROR   <channel> <reason>         (rate-limit etc.)
 *     :server         WHITEBOARD END     <channel>                  (snapshot end)
 *
 * The stroke_json is a compact JSON object; the server bounds-checks the
 * payload (<= 8KB) and applies a per-nick token bucket (60/s sustained,
 * burst 120). When ERROR with reason "rate-limit" arrives, the hook
 * surfaces a notice and pauses outbound emission for `RATE_BACKOFF_MS`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { IRCMessage } from '@/lib/irc/types';

/** Remote peer cursor position (normalised 0..1 coords). */
export interface RemoteCursor {
  nick: string;
  x: number;
  y: number;
  /** Timestamp (Date.now) for expiry logic. */
  t: number;
  /** Deterministic colour derived from nick. */
  color: string;
}

/** Drawing primitive — the unit replicated across all peers. */
export type WhiteboardTool = 'pen' | 'eraser' | 'rect' | 'circle' | 'line' | 'text';

export interface WhiteboardStroke {
  /** Unique id (nick:counter); used to dedupe local-echo against server replay. */
  id: string;
  /** Nick of the originator (assigned on inbound). Empty for unsent local strokes. */
  nick: string;
  tool: WhiteboardTool;
  /** Hex color (e.g. "#ff8800"). Eraser ignores color and paints background. */
  color: string;
  /** Stroke width in CSS pixels (1..64). */
  width: number;
  /** Normalised point list [[x,y],...] in 0..1 space relative to the canvas. */
  points: ReadonlyArray<readonly [number, number]>;
  /** Optional text payload for the `text` tool. */
  text?: string;
  /** When true, rect/circle tools fill instead of stroke. */
  fill?: boolean;
  /** Monotonic timestamp (Date.now) for ordering / GC. */
  ts: number;
}

export interface WhiteboardNotice {
  level: 'info' | 'error';
  message: string;
  ts: number;
}

interface UseWhiteboardReturn {
  /** Replayed + locally-issued strokes, in receive order. */
  strokes: ReadonlyArray<WhiteboardStroke>;
  /** Most recent inbound transient notice (rate-limit, snapshot status). */
  notice: WhiteboardNotice | null;
  /** True while we're temporarily backing off after a server rate-limit reject. */
  rateLimited: boolean;
  /** Send a finished stroke to the channel. Returns false if dropped (no client / not in channel / rate-limited). */
  drawStroke: (stroke: Omit<WhiteboardStroke, 'id' | 'nick' | 'ts'>) => boolean;
  /** Broadcast a board-clear to everyone in the channel (server enforces ACL). */
  clear: () => void;
  /** Ask the server to replay the snapshot ring (late-joiner path). */
  requestSnapshot: () => void;
  /** Export current local canvas state as a PNG data URL. */
  exportPNG: (canvas: HTMLCanvasElement | null) => string | null;
  /** Undo the last locally-drawn stroke. Does not broadcast. */
  undo: () => void;
  /** Redo the last undone stroke. */
  redo: () => void;
  /** True when there is a state to undo. */
  canUndo: boolean;
  /** True when there is a state to redo. */
  canRedo: boolean;
  /** All visible remote peer cursors (expire after 3s of inactivity). */
  remoteCursors: ReadonlyArray<RemoteCursor>;
  /** Broadcast our current cursor position (normalised 0..1) to peers. Throttled to 10/s. */
  sendCursor: (x: number, y: number) => void;
}

const RATE_BACKOFF_MS = 750;
/** Hard cap on locally-retained strokes (server ring is 128; we keep 4x). */
const MAX_LOCAL_STROKES = 512;

let strokeCounter = 0;
function nextStrokeId(nick: string): string {
  strokeCounter = (strokeCounter + 1) & 0xffffff;
  return `${nick || 'me'}:${Date.now().toString(36)}:${strokeCounter.toString(36)}`;
}

/**
 * Safe JSON parse for inbound stroke payloads. The server already
 * bounds-checks size, but we still validate shape before applying.
 */
function parseStrokePayload(raw: string): Omit<WhiteboardStroke, 'id' | 'nick' | 'ts'> | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const tool = o.tool;
  const color = typeof o.color === 'string' ? o.color : '#ffffff';
  const width = typeof o.width === 'number' ? o.width : 2;
  const points = Array.isArray(o.points) ? o.points : null;
  if (
    (tool !== 'pen' && tool !== 'eraser' && tool !== 'rect' &&
     tool !== 'circle' && tool !== 'line' && tool !== 'text') ||
    !points
  ) {
    return null;
  }
  const cleanPoints: Array<readonly [number, number]> = [];
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    cleanPoints.push([Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))]);
  }
  if (cleanPoints.length === 0 && tool !== 'text') return null;
  return {
    tool,
    color,
    width: Math.max(1, Math.min(64, width)),
    points: cleanPoints,
    text: typeof o.text === 'string' ? o.text.slice(0, 256) : undefined,
    fill: o.fill === true ? true : undefined,
  };
}

/**
 * Subscribe to inbound whiteboard messages and provide outbound helpers.
 *
 * The hook intentionally lives outside the global IRC store: whiteboard
 * state is heavy (potentially hundreds of stroke objects per channel)
 * and only matters while a <WhiteboardCanvas> is mounted.
 */
export function useWhiteboard(channel: string): UseWhiteboardReturn {
  const client = useOnyxStore(s => s.client);
  const myNick = useOnyxStore(s => s.ourNick);

  const [strokes, setStrokes] = useState<ReadonlyArray<WhiteboardStroke>>([]);
  const [notice, setNotice] = useState<WhiteboardNotice | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Undo / redo stacks (local only — not broadcast to peers) ──────────
  const undoStackRef = useRef<WhiteboardStroke[][]>([]);
  const redoStackRef = useRef<WhiteboardStroke[][]>([]);
  // Tracked as state so canUndo/canRedo re-render properly.
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);

  // ── Remote cursor state ───────────────────────────────────────────────
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const cursorThrottleRef = useRef<number>(0);

  const channelKey = channel.toLowerCase();

  /** Append (with cap) to the local stroke buffer; dedupe by id. */
  const appendStroke = useCallback((stroke: WhiteboardStroke, recordUndo = false) => {
    setStrokes(prev => {
      // Local echo: if the same id arrives back from the server, skip.
      if (prev.some(s => s.id === stroke.id)) return prev;
      const next = prev.length >= MAX_LOCAL_STROKES
        ? [...prev.slice(prev.length - MAX_LOCAL_STROKES + 1), stroke]
        : [...prev, stroke];
      if (recordUndo) {
        // Push current state before adding the new stroke.
        undoStackRef.current = [...undoStackRef.current.slice(-49), [...prev] as WhiteboardStroke[]];
        redoStackRef.current = [];
        setUndoDepth(undoStackRef.current.length);
        setRedoDepth(0);
      }
      return next;
    });
  }, []);

  // ── Inbound message subscription ─────────────────────────────────────
  useEffect(() => {
    if (!client) return;

    const handler = (msg: IRCMessage) => {
      if (msg.command !== 'WHITEBOARD') return;
      const sub = (msg.params[0] ?? '').toUpperCase();
      const targetChan = msg.params[1] ?? '';
      if (targetChan.toLowerCase() !== channelKey) return;

      switch (sub) {
        case 'DRAW':
        case 'SNAPSHOT': {
          const payload = msg.params[2] ?? '';
          const parsed = parseStrokePayload(payload);
          if (!parsed) return;
          const originator = (msg.nick ?? '') || 'unknown';
          appendStroke({
            ...parsed,
            id: nextStrokeId(originator),
            nick: originator,
            ts: Date.now(),
          });
          return;
        }
        case 'CLEAR': {
          setStrokes([]);
          setNotice({
            level: 'info',
            message: `Board cleared by ${(msg.nick ?? '') || 'server'}.`,
            ts: Date.now(),
          });
          return;
        }
        case 'END': {
          setNotice({ level: 'info', message: 'Snapshot complete.', ts: Date.now() });
          return;
        }
        case 'ERROR': {
          const reason = msg.params[2] ?? 'whiteboard error';
          setNotice({ level: 'error', message: reason, ts: Date.now() });
          if (/rate|limit|flood/i.test(reason)) {
            setRateLimited(true);
            if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
            backoffTimerRef.current = setTimeout(() => setRateLimited(false), RATE_BACKOFF_MS);
          }
          return;
        }
        case 'CURSOR': {
          const payload = msg.params[2] ?? '';
          const [xStr, yStr] = payload.split(',');
          const x = Math.max(0, Math.min(1, parseFloat(xStr)));
          const y = Math.max(0, Math.min(1, parseFloat(yStr)));
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          const nick = (msg.nick ?? '') || 'unknown';
          // Deterministic colour from nick hash.
          const hue = [...nick].reduce((a, c) => (a * 31 + c.charCodeAt(0)) & 0xffff, 0) % 360;
          const color = `hsl(${hue}, 70%, 65%)`;
          setRemoteCursors(prev => {
            const others = prev.filter(c => c.nick !== nick);
            return [...others, { nick, x, y, t: Date.now(), color }];
          });
          return;
        }
      }
    };

    client.extraMessageHandlers.add(handler);
    return () => {
      client.extraMessageHandlers.delete(handler);
      if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
    };
  }, [client, channelKey, appendStroke]);

  // ── Remote cursor expiry ─────────────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      const cutoff = Date.now() - 3000;
      setRemoteCursors(prev => prev.filter(c => c.t > cutoff));
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // ── Undo / Redo ───────────────────────────────────────────────────────
  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prevState = undoStackRef.current[undoStackRef.current.length - 1];
    setStrokes(current => {
      redoStackRef.current = [...redoStackRef.current, current as WhiteboardStroke[]];
      setRedoDepth(redoStackRef.current.length);
      return prevState;
    });
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    setUndoDepth(undoStackRef.current.length);
  }, []);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const nextState = redoStackRef.current[redoStackRef.current.length - 1];
    setStrokes(current => {
      undoStackRef.current = [...undoStackRef.current, current as WhiteboardStroke[]];
      setUndoDepth(undoStackRef.current.length);
      return nextState;
    });
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    setRedoDepth(redoStackRef.current.length);
  }, []);

  // ── Outbound helpers ────────────────────────────────────────────────
  const drawStroke = useCallback(
    (stroke: Omit<WhiteboardStroke, 'id' | 'nick' | 'ts'>): boolean => {
      if (!client || !channel) return false;
      if (rateLimited) return false;

      const full: WhiteboardStroke = {
        ...stroke,
        id: nextStrokeId(myNick),
        nick: myNick,
        ts: Date.now(),
      };

      // Optimistic local echo so the user sees their stroke immediately.
      appendStroke(full, true);

      // Encode without the id/nick/ts (server reassigns prefix on fanout).
      const payload = JSON.stringify({
        tool: stroke.tool,
        color: stroke.color,
        width: stroke.width,
        points: stroke.points,
        ...(stroke.text ? { text: stroke.text } : {}),
        ...(stroke.fill ? { fill: true } : {}),
      });

      // 8KB server cap; truncate by dropping interior points if needed.
      if (payload.length > 8000) {
        setNotice({ level: 'error', message: 'Stroke too large; segmenting.', ts: Date.now() });
        return false;
      }

      client.sendRaw('WHITEBOARD', 'DRAW', channel, payload);
      return true;
    },
    [client, channel, myNick, rateLimited, appendStroke],
  );

  const clear = useCallback(() => {
    if (!client || !channel) return;
    client.sendRaw('WHITEBOARD', 'CLEAR', channel);
    // Optimistic local clear; if server rejects we'll receive an ERROR.
    setStrokes([]);
  }, [client, channel]);

  const requestSnapshot = useCallback(() => {
    if (!client || !channel) return;
    client.sendRaw('WHITEBOARD', 'SNAPSHOT', channel);
  }, [client, channel]);

  const exportPNG = useCallback((canvas: HTMLCanvasElement | null): string | null => {
    if (!canvas) return null;
    try { return canvas.toDataURL('image/png'); } catch { return null; }
  }, []);

  /** Broadcast our normalised cursor position to peers (throttled to 10/s). */
  const sendCursor = useCallback((x: number, y: number) => {
    if (!client || !channel) return;
    const now = Date.now();
    if (now - cursorThrottleRef.current < 100) return;
    cursorThrottleRef.current = now;
    client.sendRaw('WHITEBOARD', 'CURSOR', channel, `${x.toFixed(4)},${y.toFixed(4)}`);
  }, [client, channel]);

  return useMemo(
    () => ({
      strokes, notice, rateLimited,
      drawStroke, clear, requestSnapshot, exportPNG,
      undo, redo,
      canUndo: undoDepth > 0,
      canRedo: redoDepth > 0,
      remoteCursors,
      sendCursor,
    }),
    [
      strokes, notice, rateLimited,
      drawStroke, clear, requestSnapshot, exportPNG,
      undo, redo, undoDepth, redoDepth,
      remoteCursors, sendCursor,
    ],
  );
}
