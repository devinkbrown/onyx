// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * formationMemory.ts — owner-scoped 3-in-48h Home memory.
 *
 * Remembers rooms we founded or joined via invite so Home can nag with real
 * names. Fail-closed: malformed / oversize storage is ignored.
 */
import { parseJoinParam } from '@/lib/deeplink';
import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
import {
  FORMATION_WINDOW_MS,
  channelKey,
  emptyFormationMemory,
  isFounderMember,
  isUsableNick,
  nickKey,
  type FormationChannel,
  type FormationMemorySnapshot,
  type FormationRole,
  type FormationRoomMemory,
} from './formationLoop';

export const FORMATION_MEMORY_KEY = 'onyx:home-formation';
export const FORMATION_MEMORY_LIMIT = 8;
const MAX_STORAGE_CHARS = 32 * 1024;
const MAX_EXPECTED = 4;

export type FormationMemoryListener = (snapshot: FormationMemorySnapshot) => void;

const listeners = new Map<string, Set<FormationMemoryListener>>();

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function storageKey(owner?: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(FORMATION_MEMORY_KEY, owner);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeExpected(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, MAX_EXPECTED * 2)) {
    if (typeof item !== 'string' || !isUsableNick(item)) continue;
    const key = nickKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(item.trim());
    if (names.length >= MAX_EXPECTED) break;
  }
  return names;
}

function sanitizeRoom(value: unknown, nowMs: number): FormationRoomMemory | null {
  if (!isRecord(value)) return null;
  const firstSeenAt = value.firstSeenAt;
  if (typeof firstSeenAt !== 'number' || !Number.isFinite(firstSeenAt) || firstSeenAt <= 0) return null;
  if (nowMs - firstSeenAt > FORMATION_WINDOW_MS) return null;
  const role: FormationRole = value.role === 'joiner' ? 'joiner' : value.role === 'founder' ? 'founder' : null;
  if (!role) return null;
  const firstJoiner = typeof value.firstJoiner === 'string' && isUsableNick(value.firstJoiner)
    ? value.firstJoiner.trim()
    : null;
  return {
    firstSeenAt,
    role,
    firstJoiner,
    expectedNicks: sanitizeExpected(value.expectedNicks),
  };
}

function sanitizeSnapshot(value: unknown, nowMs: number): FormationMemorySnapshot {
  if (!isRecord(value)) return emptyFormationMemory();
  const rooms: Record<string, FormationRoomMemory> = {};
  if (isRecord(value.rooms)) {
    for (const [rawKey, room] of Object.entries(value.rooms)) {
      if (typeof rawKey !== 'string') continue;
      const key = channelKey(rawKey);
      if (!(key.startsWith('#') || key.startsWith('&')) || key.length > 128) continue;
      const clean = sanitizeRoom(room, nowMs);
      if (clean) rooms[key] = clean;
    }
  }
  const invite = typeof value.inviteChannel === 'string' ? parseJoinParam(value.inviteChannel) : null;
  return { rooms, inviteChannel: invite };
}

function snapshotEqual(a: FormationMemorySnapshot, b: FormationMemorySnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function notify(ownerKey: string, snapshot: FormationMemorySnapshot): void {
  const set = listeners.get(ownerKey);
  if (!set) return;
  for (const listener of set) listener(snapshot);
}

export function readFormationMemory(owner: DeviceMemoryOwner, nowMs = Date.now()): FormationMemorySnapshot {
  const key = storageKey(owner);
  const store = storage();
  if (!key || !store) return emptyFormationMemory();
  try {
    const raw = store.getItem(key);
    if (!raw || raw.length > MAX_STORAGE_CHARS) return emptyFormationMemory();
    return sanitizeSnapshot(JSON.parse(raw) as unknown, nowMs);
  } catch {
    return emptyFormationMemory();
  }
}

export function writeFormationMemory(
  snapshot: FormationMemorySnapshot,
  owner: DeviceMemoryOwner,
  nowMs = Date.now(),
): FormationMemorySnapshot {
  const key = storageKey(owner);
  const store = storage();
  const clean = sanitizeSnapshot(snapshot, nowMs);
  if (!key || !store) return clean;
  try {
    const serialized = JSON.stringify(clean);
    if (serialized.length > MAX_STORAGE_CHARS) return readFormationMemory(owner, nowMs);
    store.setItem(key, serialized);
    notify(key, clean);
  } catch {
    /* session-only */
  }
  return clean;
}

export function subscribeFormationMemory(
  listener: FormationMemoryListener,
  owner: DeviceMemoryOwner,
): () => void {
  const key = storageKey(owner);
  if (!key) return () => undefined;
  const set = listeners.get(key) ?? new Set<FormationMemoryListener>();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

export function inviteChannelFromSearch(search: string): string | null {
  try {
    return parseJoinParam(new URLSearchParams(search).get('join'));
  } catch {
    return null;
  }
}

export type FormationFoldInput = {
  nowMs: number;
  ourNick: string;
  channels: readonly FormationChannel[];
  pendingJoin: string | null;
  locationSearch?: string;
  memory: FormationMemorySnapshot;
};

/**
 * Observe live roster + invite context. Records founder/joiner roles and the
 * first other person who actually appears. Does not invent nicks.
 */
export function foldFormationMemory(input: FormationFoldInput): FormationMemorySnapshot {
  const rooms: Record<string, FormationRoomMemory> = {};
  const ourNick = input.ourNick.trim();
  const pending = parseJoinParam(input.pendingJoin)
    ?? inviteChannelFromSearch(input.locationSearch ?? '')
    ?? parseJoinParam(input.memory.inviteChannel);

  for (const [key, room] of Object.entries(input.memory.rooms)) {
    const clean = sanitizeRoom(room, input.nowMs);
    if (clean) rooms[key] = clean;
  }

  if (isUsableNick(ourNick)) {
    for (const channel of input.channels) {
      const name = channel.name.trim();
      if (!(name.startsWith('#') || name.startsWith('&'))) continue;
      const key = channelKey(name);
      const self = channel.members.find((member) => nickKey(member.nick) === nickKey(ourNick));
      const present = channel.members.filter((member) => isUsableNick(member.nick)).length;
      const previous = rooms[key];
      const founderNow = isFounderMember(self, present);
      const invitedHere = pending != null && channelKey(pending) === key;
      let role: FormationRole | null = previous?.role ?? null;
      if (founderNow && (channel.createdAtMs != null || previous)) role = 'founder';
      else if (invitedHere && self) role = role ?? 'joiner';
      if (!role) continue;

      const createdAge = channel.createdAtMs != null
        ? Math.max(0, input.nowMs - channel.createdAtMs)
        : null;
      if (createdAge != null && createdAge > FORMATION_WINDOW_MS) {
        delete rooms[key];
        continue;
      }
      if (role === 'founder' && createdAge == null && !previous) continue;

      const others = channel.members.filter((member) =>
        nickKey(member.nick) !== nickKey(ourNick) && isUsableNick(member.nick),
      );
      const firstJoiner = previous?.firstJoiner && others.some((member) => nickKey(member.nick) === nickKey(previous.firstJoiner!))
        ? previous.firstJoiner
        : (others[0]?.nick.trim() ?? null);

      rooms[key] = {
        firstSeenAt: previous?.firstSeenAt ?? channel.createdAtMs ?? input.nowMs,
        role,
        firstJoiner: role === 'founder' ? firstJoiner : previous?.firstJoiner ?? null,
        expectedNicks: previous?.expectedNicks ?? [],
      };
    }
  }

  const ranked = Object.entries(rooms)
    .sort(([, a], [, b]) => b.firstSeenAt - a.firstSeenAt)
    .slice(0, FORMATION_MEMORY_LIMIT);
  return {
    rooms: Object.fromEntries(ranked),
    inviteChannel: pending,
  };
}

export function rememberExpectedNicks(
  snapshot: FormationMemorySnapshot,
  channel: string,
  nicks: readonly string[],
  nowMs: number,
): FormationMemorySnapshot {
  const key = channelKey(channel);
  const room = snapshot.rooms[key];
  if (!room) return snapshot;
  return {
    ...snapshot,
    rooms: {
      ...snapshot.rooms,
      [key]: {
        ...room,
        expectedNicks: sanitizeExpected([...room.expectedNicks, ...nicks]),
        firstSeenAt: room.firstSeenAt || nowMs,
      },
    },
  };
}

/** Test / boundary reset. */
export function resetFormationMemoryForTests(): void {
  listeners.clear();
  const store = storage();
  if (!store) return;
  const doomed: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key?.startsWith(FORMATION_MEMORY_KEY)) doomed.push(key);
  }
  for (const key of doomed) store.removeItem(key);
}
