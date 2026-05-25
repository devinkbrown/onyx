'use client';

/**
 * useBreakout(channel)
 *
 * Owns breakout-room state for a single parent channel. Subscribes to
 * incoming IRC NOTICE traffic via the IRC client and parses
 * ophion's m_ladon_breakout NOTICE protocol into a stable React-friendly
 * room list.
 *
 * Server-emitted NOTICE shapes (see modules/m_ladon_breakout.c):
 *   - Channel: "Breakout room '<name>' created (ID=<id>)"
 *   - Channel: "Breakout '<name>' (ID=<id>) now <n> member(s)"
 *   - Channel: "Breakout room (ID=<id>) renamed to '<name>'"
 *   - Personal: "Breakout room '<name>' (ID=<id>) has been closed"
 *   - Personal: "You joined breakout room '<name>' (ID=<id>, <n> members)"
 *   - Personal: "You have been recalled from breakout '<name>' to <chan>"
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { IRCMessage } from '@/lib/irc/types';

export interface BreakoutRoom {
  id: number;
  name: string;
  channel: string;          // parent channel, lowercased
  creator: string | null;   // best-effort; null when server didn't tell us
  memberCount: number;
  autoCloseAt: number | null; // epoch ms; null = no timer
  createdAt: number;          // epoch ms
}

export interface UseBreakoutResult {
  rooms: BreakoutRoom[];
  /** id of the room the local user is currently inside, if any */
  activeRoomId: number | null;
  /** create a new breakout room in this channel */
  create: (name: string, autoCloseSecs?: number) => void;
  /** join a room by id */
  join: (roomId: number) => void;
  /** leave the room we're currently in */
  leave: () => void;
  /** oper-only: close a single room */
  close: (roomId: number) => void;
  /** oper-only: close every room in this parent channel */
  closeAll: () => void;
  /** oper-only: rename a room */
  rename: (roomId: number, newName: string) => void;
  /** oper-only: forcibly recall all members back to the parent */
  recall: (roomId: number) => void;
  /** whether the local user holds IRC operator privileges */
  isOper: boolean;
}

// ── NOTICE parsing ────────────────────────────────────────────────────────────

interface ParsedEvent {
  kind: 'create' | 'count' | 'rename' | 'close' | 'self-join' | 'self-recall';
  id: number;
  name?: string;
  count?: number;
  channel?: string;
}

const CREATE_RE      = /^Breakout room '([^']{1,64})' created \(ID=(\d+)\)/;
const COUNT_RE       = /^Breakout '([^']{1,64})' \(ID=(\d+)\) now (\d+) member/;
const RENAME_RE      = /^Breakout room \(ID=(\d+)\) renamed to '([^']{1,64})'/;
const CLOSE_RE       = /^Breakout room '([^']{1,64})' \(ID=(\d+)\) has been closed/;
const SELF_JOIN_RE   = /^You joined breakout room '([^']{1,64})' \(ID=(\d+),\s*(\d+) members?\)/;
const SELF_RECALL_RE = /^You have been recalled from breakout '([^']{1,64})' to (\S+)/;

function parseNotice(text: string): ParsedEvent | null {
  // Strip leading ':' the server may prepend when re-encoding.
  const t = text.replace(/^:/, '');
  let m: RegExpMatchArray | null;
  if ((m = t.match(CREATE_RE)))
    return { kind: 'create', name: m[1], id: Number(m[2]) };
  if ((m = t.match(COUNT_RE)))
    return { kind: 'count', name: m[1], id: Number(m[2]), count: Number(m[3]) };
  if ((m = t.match(RENAME_RE)))
    return { kind: 'rename', id: Number(m[1]), name: m[2] };
  if ((m = t.match(CLOSE_RE)))
    return { kind: 'close', name: m[1], id: Number(m[2]) };
  if ((m = t.match(SELF_JOIN_RE)))
    return { kind: 'self-join', name: m[1], id: Number(m[2]), count: Number(m[3]) };
  if ((m = t.match(SELF_RECALL_RE)))
    return { kind: 'self-recall', id: 0, name: m[1], channel: m[2] };
  return null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBreakout(channel: string): UseBreakoutResult {
  const channelKey = channel.toLowerCase();
  const myNick     = useOnyxStore(s => s.ourNick);
  const isOper     = useOnyxStore(s => s.isOper);
  const client     = useOnyxStore(s => s.client);

  const [rooms,        setRooms]        = useState<Map<number, BreakoutRoom>>(new Map());
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null);

  // Track the local user's most recent CREATE so we can attribute creator even
  // though the server's broadcast NOTICE elides it.
  const pendingCreatorRef = useRef<string | null>(null);

  // Subscribe to server events via the IRC client's extraMessageHandlers
  useEffect(() => {
    if (!client) return;

    const onMsg = (msg: IRCMessage) => {
      if (msg.command !== 'NOTICE') return;
      const target = msg.params[0] ?? '';
      const text   = msg.params[1] ?? '';
      const parsed = parseNotice(text);
      if (!parsed) return;

      const targetLower    = target.toLowerCase();
      const targetsChannel = targetLower === channelKey;
      const targetsMe      = myNick && targetLower === myNick.toLowerCase();

      // Channel-scoped events
      if (targetsChannel) {
        if (parsed.kind === 'create' && parsed.name) {
          const creator = pendingCreatorRef.current;
          pendingCreatorRef.current = null;
          setRooms(prev => {
            const next = new Map(prev);
            next.set(parsed.id, {
              id:          parsed.id,
              name:        parsed.name!,
              channel:     channelKey,
              creator,
              memberCount: 0,
              autoCloseAt: null,
              createdAt:   Date.now(),
            });
            return next;
          });
        } else if (parsed.kind === 'count' && parsed.count !== undefined) {
          setRooms(prev => {
            const existing = prev.get(parsed.id);
            const next     = new Map(prev);
            next.set(parsed.id, {
              id:          parsed.id,
              name:        parsed.name ?? existing?.name ?? `room#${parsed.id}`,
              channel:     channelKey,
              creator:     existing?.creator ?? null,
              memberCount: parsed.count!,
              autoCloseAt: existing?.autoCloseAt ?? null,
              createdAt:   existing?.createdAt ?? Date.now(),
            });
            return next;
          });
        } else if (parsed.kind === 'rename' && parsed.name) {
          setRooms(prev => {
            const existing = prev.get(parsed.id);
            if (!existing) return prev;
            const next = new Map(prev);
            next.set(parsed.id, { ...existing, name: parsed.name! });
            return next;
          });
        }
        return;
      }

      // Personal events (target == our nick)
      if (targetsMe) {
        if (parsed.kind === 'close') {
          setRooms(prev => {
            if (!prev.has(parsed.id)) return prev;
            const next = new Map(prev);
            next.delete(parsed.id);
            return next;
          });
          setActiveRoomId(curr => (curr === parsed.id ? null : curr));
        } else if (parsed.kind === 'self-join') {
          setActiveRoomId(parsed.id);
          if (parsed.name) {
            setRooms(prev => {
              const existing = prev.get(parsed.id);
              const next     = new Map(prev);
              next.set(parsed.id, {
                id:          parsed.id,
                name:        parsed.name!,
                channel:     channelKey,
                creator:     existing?.creator ?? null,
                memberCount: parsed.count ?? existing?.memberCount ?? 1,
                autoCloseAt: existing?.autoCloseAt ?? null,
                createdAt:   existing?.createdAt ?? Date.now(),
              });
              return next;
            });
          }
        } else if (parsed.kind === 'self-recall') {
          setActiveRoomId(null);
        }
      }
    };

    client.extraMessageHandlers.add(onMsg);
    return () => { client.extraMessageHandlers.delete(onMsg); };
  }, [client, channelKey, myNick]);

  // Auto-close countdown sweep: drop rooms whose timer has elapsed.
  // Server is authoritative; this is a UI-side fallback that runs every second
  // and removes obviously-expired entries (with 2s grace period).
  useEffect(() => {
    const t = setInterval(() => {
      setRooms(prev => {
        let changed = false;
        const now  = Date.now();
        const next = new Map(prev);
        for (const [id, r] of prev) {
          if (r.autoCloseAt && r.autoCloseAt <= now - 2_000) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // ── Command helpers ──────────────────────────────────────────────────
  const create = useCallback((name: string, autoCloseSecs?: number) => {
    if (!client || !name) return;
    pendingCreatorRef.current = myNick || null;
    const args: string[] = ['CREATE', channel, name];
    if (autoCloseSecs && autoCloseSecs > 0) args.push(String(autoCloseSecs));
    client.sendRaw('BREAKOUT', ...args);
  }, [client, channel, myNick]);

  const join = useCallback((roomId: number) => {
    if (!client) return;
    client.sendRaw('BREAKOUT', 'JOIN', channel, String(roomId));
  }, [client, channel]);

  const leave = useCallback(() => {
    if (!client) return;
    client.sendRaw('BREAKOUT', 'LEAVE', channel);
  }, [client, channel]);

  const close = useCallback((roomId: number) => {
    if (!client) return;
    if (isOper) client.sendRaw('BREAKOUT', 'CLOSE', String(roomId));
    else        client.sendRaw('BREAKOUT', 'CLOSE', channel, String(roomId));
  }, [client, channel, isOper]);

  const closeAll = useCallback(() => {
    if (!client || !isOper) return;
    for (const r of rooms.values()) {
      client.sendRaw('BREAKOUT', 'CLOSE', String(r.id));
    }
  }, [client, isOper, rooms]);

  const rename = useCallback((roomId: number, newName: string) => {
    if (!client || !isOper || !newName) return;
    client.sendRaw('BREAKOUT', 'RENAME', String(roomId), newName);
  }, [client, isOper]);

  const recall = useCallback((roomId: number) => {
    if (!client || !isOper) return;
    client.sendRaw('BREAKOUT', 'RECALL', String(roomId));
  }, [client, isOper]);

  const roomList = useMemo(
    () => [...rooms.values()].sort((a, b) => a.id - b.id),
    [rooms],
  );

  return {
    rooms: roomList,
    activeRoomId,
    create, join, leave, close, closeAll, rename, recall,
    isOper,
  };
}
