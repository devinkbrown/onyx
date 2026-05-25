'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';

export interface SpatialPosition {
  x: number;
  y: number;
  z: number;
}

export interface SpatialPeer extends SpatialPosition {
  nick: string;
  isSelf: boolean;
  speaking: boolean;
  inVoice: boolean;
  stale: boolean;
}

interface UseSpatialResult {
  /** Listener (self) position. */
  self: SpatialPosition;
  /** All channel participants (including self) with position + presence info. */
  peers: SpatialPeer[];
  /** Move self and broadcast over the wire (throttled internally). */
  moveSelf: (pos: Partial<SpatialPosition>) => void;
  /** True if the active buffer is a channel. */
  isChannel: boolean;
}

/**
 * Clamp helper. SPATIAL coords are normalised to -1..+1 (x,y) and -10..+10 (z).
 */
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * useSpatial — exposes spatial-pad state for one channel and gives the
 * caller a throttled move-self function that emits MEDIA SPATIAL wire frames.
 *
 * Server-side rate-limit lives in m_ladon_spatial.c; this hook adds a
 * client-side coalescer (~30 Hz) so we don't flood while dragging.
 */
export function useSpatial(channel: string): UseSpatialResult {
  const chanKey = channel.toLowerCase();
  const isChannel = channel.startsWith('#') || channel.startsWith('&');

  const myNick       = useOnyxStore(s => s.ourNick);
  const client       = useOnyxStore(s => s.client);
  const channels     = useOnyxStore(s => s.channels);
  const positionsMap = useOnyxStore(s => s.spatialPositions);
  const voice        = useOnyxStore(s => s.voice);

  const myNickKey = myNick.toLowerCase();

  const chanPositions = positionsMap.get(chanKey);
  const channelObj    = channels.get(chanKey);

  const self: SpatialPosition = useMemo(() => {
    const own = chanPositions?.get(myNickKey);
    return own ? { x: own.x, y: own.y, z: own.z } : { x: 0, y: 0, z: 0 };
  }, [chanPositions, myNickKey]);

  const peers: SpatialPeer[] = useMemo(() => {
    if (!channelObj) return [];
    const list: SpatialPeer[] = [];
    for (const user of channelObj.users.values()) {
      const key    = user.nick.toLowerCase();
      const isSelf = key === myNickKey;
      const pos    = chanPositions?.get(key);
      const peer   = voice.peers.get(key);
      list.push({
        nick:    user.nick,
        isSelf,
        x: pos?.x ?? (isSelf ? self.x : 0),
        y: pos?.y ?? (isSelf ? self.y : 0),
        z: pos?.z ?? (isSelf ? self.z : 0),
        inVoice:  !!peer,
        speaking: peer?.speaking ?? false,
        stale:    false,
      });
    }
    // self first for predictable z-order
    list.sort((a, b) => (a.isSelf === b.isSelf ? 0 : a.isSelf ? -1 : 1));
    return list;
  }, [channelObj, chanPositions, myNickKey, self.x, self.y, self.z, voice.peers]);

  // ── Outbound: throttle wire sends ──────────────────────────────────────────
  const pending    = useRef<SpatialPosition | null>(null);
  const lastSent   = useRef<number>(0);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback((pos: SpatialPosition) => {
    if (!client || !isChannel) return;
    client.sendRaw(
      'MEDIA',
      channel,
      'SPATIAL',
      JSON.stringify({ x: pos.x, y: pos.y, z: pos.z }),
    );
    lastSent.current = Date.now();
  }, [client, channel, isChannel]);

  const flush = useCallback(() => {
    flushTimer.current = null;
    if (!pending.current) return;
    const next = pending.current;
    pending.current = null;
    send(next);
  }, [send]);

  const moveSelf = useCallback((delta: Partial<SpatialPosition>) => {
    const next: SpatialPosition = {
      x: clamp(delta.x ?? self.x, -1, 1),
      y: clamp(delta.y ?? self.y, -1, 1),
      z: clamp(delta.z ?? self.z, -10, 10),
    };

    // Optimistic local update so the dot follows the pointer instantly.
    useOnyxStore.setState(s => {
      const sp      = new Map(s.spatialPositions);
      const chanMap = new Map(sp.get(chanKey) ?? new Map<string, { x: number; y: number; z: number; t: number }>());
      chanMap.set(myNickKey, { ...next, t: Date.now() });
      sp.set(chanKey, chanMap);
      return { spatialPositions: sp };
    });

    pending.current = next;
    const elapsed = Date.now() - lastSent.current;
    if (elapsed >= 33) {
      flush();
    } else if (!flushTimer.current) {
      flushTimer.current = setTimeout(flush, 33 - elapsed);
    }
  }, [self.x, self.y, self.z, chanKey, myNickKey, flush]);

  useEffect(() => () => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
  }, []);

  // ── Mirror remote positions into LADON media peer panning ──────────────────
  // Ocean uses voice.peers for per-peer audio state; spatial panning is
  // informational — callers can use peer.x to drive audio pan themselves.

  return { self, peers, moveSelf, isChannel };
}
