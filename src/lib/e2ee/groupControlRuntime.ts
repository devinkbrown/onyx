// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Packet-B group-control runtime.
 *
 * This is a control-plane lifecycle/orchestration seam. It never mints a
 * placeholder GroupSession, persists room keys, encrypts messages, or exposes
 * control payloads. Authenticated genesis bootstrap may privately register a
 * session created from a verified commit+welcome pair; activation becomes
 * `active` once lifecycle is `ready` and a room is control-applied + provisioned.
 */

import type { IRCMessage } from '@/lib/irc/types';

import {
  parseGroupControlDelivery,
  type GroupControlDelivery,
} from './groupControlInbound';
import {
  createGroupControlSessionAdapter,
  type GroupControlAdapterOutcome,
  type GroupControlDirectory,
  type GroupControlSessionAdapter,
} from './groupControlSessionAdapter';
import { normalizeGroupRoom } from './groupKeyring';
import { GroupSession } from './groupSession';
import type { TrustedGroupSignerStore } from './trustedGroupSigner';

export const GROUP_CONTROL_RUNTIME_MAX_QUEUE = 128;
export const GROUP_CONTROL_RUNTIME_MAX_SESSIONS = 64;
export const GROUP_CONTROL_RUNTIME_MAX_ROOMS = 64;
export const GROUP_CONTROL_RUNTIME_MAX_HALF_PAIRS = 128;
/** Hard bound for globally registered identity-tuple owners. */
export const GROUP_CONTROL_RUNTIME_MAX_REGISTRY = 128;
export const GROUP_CONTROL_RUNTIME_DEFAULT_HALF_PAIR_TTL_MS = 30_000;

export type GroupControlRuntimeIdentity = {
  clientId: string;
  endpoint: string;
  account?: string | null;
  deviceId?: string | null;
  localAccount?: string | null;
  localDeviceId?: string | null;
};

export type GroupControlRuntimeLifecycle =
  | 'inactive'
  | 'identity-pending'
  | 'ready'
  | 'recovery-required';

export type GroupControlRoomStatus =
  | 'locked'
  | 'directory-pending'
  | 'pair-pending'
  | 'control-applied'
  | 'recovery-required'
  | 'rejected';

export type GroupControlRuntimeReason =
  | 'runtime-inactive'
  | 'runtime-capacity'
  | 'identity-pending'
  | 'trust-path-unreachable'
  | 'recovery-required'
  | 'queue-full'
  | 'coalesced'
  | 'expired'
  | 'room-removed'
  | 'equivocation'
  | 'foreign-recipient'
  | 'session-not-provisioned'
  | 'session-capacity'
  | 'invalid-session'
  | 'identity-mismatch'
  | 'duplicate-session'
  | 'activation-held'
  | 'transport-unavailable'
  | 'epoch-unavailable'
  | 'stale';

export type GroupControlRuntimeOutcome = {
  status: GroupControlAdapterOutcome['status'];
  reason?: GroupControlRuntimeReason | GroupControlAdapterOutcome['reason'];
  /** Safe routing metadata only. No payload, key, hash, or commit id. */
  room?: string;
  fromAccount?: string;
  fromDevice?: string;
  epoch?: number;
  generation: number;
};

export type GroupControlRoomProjection = {
  room: string;
  status: GroupControlRoomStatus;
  epoch?: number;
  provisioned: boolean;
};

export type GroupControlRuntimeCounters = {
  accepted: number;
  processed: number;
  queued: number;
  applied: number;
  locked: number;
  rejected: number;
  ignored: number;
  coalesced: number;
  evicted: number;
  expired: number;
};

export type GroupControlRuntimeState = {
  generation: number;
  lifecycle: GroupControlRuntimeLifecycle;
  /** Message protection is active only when at least one live room session is
   * provisioned and control-applied in the ready lifecycle. */
  activation: 'hold' | 'active';
  identity: {
    clientId: string | null;
    endpoint: string | null;
    account: string | null;
    deviceId: string | null;
  };
  rooms: readonly GroupControlRoomProjection[];
  counters: GroupControlRuntimeCounters;
  queueDepth: number;
  sessionCount: number;
};

export type GroupControlRuntimeTransport = {
  isConnected?: () => boolean;
  requestDirectory?: (
    account: string,
    signal: AbortSignal,
  ) => GroupControlDirectory | null | undefined | Promise<GroupControlDirectory | null | undefined>;
  requestCurrentEpochWelcome?: (
    room: string,
    epoch: number,
    account: string,
    deviceId: string,
    payload: string,
    signal: AbortSignal,
  ) => boolean | Promise<boolean>;
};

export type GroupControlRuntimeOptions = {
  identity?: GroupControlRuntimeIdentity | null;
  identityFor?: () => GroupControlRuntimeIdentity | null | Promise<GroupControlRuntimeIdentity | null>;
  directoryForAccount?: (
    account: string,
  ) => GroupControlDirectory | null | undefined | Promise<GroupControlDirectory | null | undefined>;
  trustedSignerStore?: TrustedGroupSignerStore | (() => TrustedGroupSignerStore | null | undefined);
  recipientPrivateKeyFor?: (
    account: string,
    deviceId: string,
  ) => CryptoKey | null | undefined | Promise<CryptoKey | null | undefined>;
  transport?: GroupControlRuntimeTransport;
  now?: () => number;
  halfPairTtlMs?: number;
  maxQueue?: number;
};

export type GroupControlRuntimeProvisionResult =
  | { ok: true; room: string; replaced: boolean }
  | { ok: false; reason: GroupControlRuntimeReason };

export type GroupControlRuntimeSealResult =
  | { ok: true; status: 'sealed'; room: string; epoch: number; envelope: string }
  | { ok: false; status: 'locked'; reason: GroupControlRuntimeReason | 'destroyed' | 'room-mismatch' | 'epoch-unavailable' | 'seal-failed' | 'open-failed' };
export type GroupControlRuntimeOpenResult =
  | { ok: true; status: 'opened'; room: string; epoch: number; plaintext: string }
  | { ok: false; status: 'locked'; reason: GroupControlRuntimeReason | 'destroyed' | 'room-mismatch' | 'epoch-unavailable' | 'seal-failed' | 'open-failed' };

export type GroupControlRuntime = {
  readonly generation: number;
  readonly isDetached: boolean;
  readonly isDestroyed: boolean;
  readonly isDestroySettled: boolean;
  readonly state: GroupControlRuntimeState;
  getState(): GroupControlRuntimeState;
  subscribe(listener: (state: GroupControlRuntimeState) => void): () => void;
  accept(message: IRCMessage | string): Promise<GroupControlRuntimeOutcome>;
  acceptControl(message: IRCMessage | string): Promise<GroupControlRuntimeOutcome>;
  ingest(message: IRCMessage | string): Promise<GroupControlRuntimeOutcome>;
  registerProvisionedSession(session: GroupSession): GroupControlRuntimeProvisionResult;
  sealRoomMessage(room: string, plaintext: string): Promise<GroupControlRuntimeSealResult>;
  openRoomMessage(room: string, envelope: string): Promise<GroupControlRuntimeOpenResult>;
  removeRoom(room: string, reason?: 'part' | 'kick'): void;
  onRoomPart(room: string): void;
  onRoomKick(room: string): void;
  setIdentity(identity: GroupControlRuntimeIdentity | null): Promise<boolean>;
  switchIdentity(identity: GroupControlRuntimeIdentity | null): Promise<boolean>;
  refreshIdentity(): Promise<boolean>;
  expire(): void;
  reconnect(): void;
  onReconnect(): void;
  requestCurrentEpochWelcome(room: string, payload: string): Promise<{
    ok: true;
    room: string;
    epoch: number;
  } | {
    ok: false;
    reason: GroupControlRuntimeReason;
  }>;
  markRecovered(): boolean;
  detach(): Promise<void>;
  destroy(): Promise<void>;
  readonly activationHeld: boolean;
};

type NormalizedIdentity = {
  clientId: string;
  endpoint: string;
  account: string | null;
  deviceId: string | null;
};

type Deferred = { resolve: (outcome: GroupControlRuntimeOutcome) => void };

type BootstrapTicket = {
  generation: number;
  room: string;
  roomIncarnation: number;
  account: string;
  deviceId: string;
  expectedEpoch: number;
};

type QueuedJob = {
  generation: number;
  room: string | null;
  roomIncarnation: number;
  boundSession: GroupSession | null;
  bootstrapTicket?: BootstrapTicket;
  messages: readonly (IRCMessage | string)[];
  adapter: GroupControlSessionAdapter;
  deferred: Deferred;
  completed?: CompletedFingerprint;
  retrySequence?: number;
};

type CompletedFingerprint = {
  key: string;
  room: string;
  commitFingerprint: string;
  welcomeFingerprint: string;
  seenAt: number;
  generation: number;
  epoch: number;
};

/** Per-room/generation reservation while a pair is queued or executing. */
type InFlightReservation = {
  key: string;
  room: string;
  commitFingerprint: string;
  welcomeFingerprint: string;
  generation: number;
  epoch: number;
  roomIncarnation: number;
};

type HalfPair = {
  key: string;
  room: string;
  seenAt: number;
  commit?: IRCMessage | string;
  welcome?: IRCMessage | string;
  commitFingerprint?: string;
  welcomeFingerprint?: string;
  /** Pair key stays pinned after equivocation; payloads must already be gone. */
  quarantined?: boolean;
};

const RUNTIME_REGISTRY = new Map<string, GroupControlRuntime>();
const RUNTIME_GENERATIONS = new Map<string, number>();
type RuntimeSwitchReservation = { runtime: GroupControlRuntime; token: number };
/** Target reservations are internal only; they are never published as aliases. */
const RUNTIME_SWITCH_RESERVATIONS = new Map<string, RuntimeSwitchReservation>();
const MAX_COUNTER = Number.MAX_SAFE_INTEGER;

/**
 * Keep tuple-generation tombstones bounded. Live registry keys are never
 * evicted; an unowned key may be evicted and will restart at generation 1 if
 * it is acquired after the tombstone is gone.
 */
function rememberRuntimeGeneration(key: string, generation: number): void {
  if (!key) return;
  const prior = RUNTIME_GENERATIONS.get(key) ?? 0;
  RUNTIME_GENERATIONS.delete(key);
  RUNTIME_GENERATIONS.set(key, Math.max(prior, generation));
  while (RUNTIME_GENERATIONS.size > GROUP_CONTROL_RUNTIME_MAX_REGISTRY) {
    const evictable = [...RUNTIME_GENERATIONS.keys()].find((candidate) => !RUNTIME_REGISTRY.has(candidate));
    if (!evictable) break;
    RUNTIME_GENERATIONS.delete(evictable);
  }
}

let capacityRuntime: GroupControlRuntime | null = null;

function canonicalAccount(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_.@-]{1,64}$/u.test(normalized) ? normalized : null;
}

function canonicalIdentity(input: GroupControlRuntimeIdentity | null | undefined): NormalizedIdentity | null {
  if (!input || typeof input.clientId !== 'string' || typeof input.endpoint !== 'string') return null;
  const clientId = input.clientId.trim();
  const endpoint = input.endpoint.trim();
  if (!clientId || !endpoint || /[\u0000\r\n]/u.test(clientId) || /[\u0000\r\n]/u.test(endpoint)) return null;
  const account = canonicalAccount(input.account ?? input.localAccount);
  const rawDevice = input.deviceId ?? input.localDeviceId;
  const deviceId = typeof rawDevice === 'string' && /^[A-Za-z0-9_.-]{1,32}$/u.test(rawDevice) ? rawDevice : null;
  return { clientId, endpoint, account, deviceId };
}

function isCompleteIdentity(identity: NormalizedIdentity | null): boolean {
  return Boolean(identity?.account && identity.deviceId);
}

function identityKey(identity: NormalizedIdentity): string {
  return `${identity.clientId}\u0000${identity.endpoint}\u0000${identity.account ?? ''}\u0000${identity.deviceId ?? ''}`;
}

function roomKey(room: string): string | null { return normalizeGroupRoom(room); }

function saturatingIncrement(value: number): number {
  return value >= MAX_COUNTER ? MAX_COUNTER : value + 1;
}

function emptyCounters(): GroupControlRuntimeCounters {
  return {
    accepted: 0,
    processed: 0,
    queued: 0,
    applied: 0,
    locked: 0,
    rejected: 0,
    ignored: 0,
    coalesced: 0,
    evicted: 0,
    expired: 0,
  };
}

function runtimeOutcome(
  status: GroupControlAdapterOutcome['status'],
  generation: number,
  reason: GroupControlRuntimeReason,
  room?: string,
): GroupControlRuntimeOutcome {
  return {
    status,
    reason,
    ...(room ? { room } : {}),
    generation,
  };
}

function adapterOutcome(result: GroupControlAdapterOutcome, generation: number): GroupControlRuntimeOutcome {
  return {
    status: result.status,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.room ? { room: result.room } : {}),
    ...(result.fromAccount ? { fromAccount: result.fromAccount } : {}),
    ...(result.fromDevice ? { fromDevice: result.fromDevice } : {}),
    ...(typeof result.epoch === 'number' ? { epoch: result.epoch } : {}),
    generation,
  };
}

function hasDirectorySubstrate(options: GroupControlRuntimeOptions): boolean {
  return typeof options.directoryForAccount === 'function'
    || typeof options.transport?.requestDirectory === 'function';
}

function hasTrustSubstrate(options: GroupControlRuntimeOptions): boolean {
  return Boolean(options.trustedSignerStore) && typeof options.recipientPrivateKeyFor === 'function';
}

function abortError(): Error { return new Error('group-control-runtime-aborted'); }

/** Race an un-cancellable callback against this generation's abort signal. */
function abortable<T>(work: () => T | Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = () => { signal.removeEventListener('abort', onAbort); };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      finish();
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(work).then((value) => {
      if (settled) return;
      settled = true;
      finish();
      resolve(value);
    }, (error: unknown) => {
      if (settled) return;
      settled = true;
      finish();
      reject(error);
    });
  });
}

/** Acquire one tuple owner. Transitional (detached) owners remain canonical. */
export function createGroupControlRuntime(options: GroupControlRuntimeOptions = {}): GroupControlRuntime {
  const identity = canonicalIdentity(options.identity);
  const registryIdentity = isCompleteIdentity(identity) ? identity : null;
  // Pending identities are intentionally not inserted into either global map:
  // callers may create as many local pending controllers as needed without
  // turning an unresolved identity into unbounded global metadata.
  const key = registryIdentity ? identityKey(registryIdentity) : '';
  const existing = registryIdentity ? RUNTIME_REGISTRY.get(key) : undefined;
  if (existing && !existing.isDestroyed) return existing;
  if (existing?.isDestroyed && RUNTIME_REGISTRY.get(key) === existing) {
    RUNTIME_REGISTRY.delete(key);
    rememberRuntimeGeneration(key, existing.generation);
  }
  const reservation = registryIdentity ? RUNTIME_SWITCH_RESERVATIONS.get(key) : undefined;
  if (reservation && !reservation.runtime.isDestroyed) {
    if (!capacityRuntime || capacityRuntime.isDestroyed) {
      capacityRuntime = buildRuntime({}, null, '', 0, true);
    }
    return capacityRuntime;
  }
  if (reservation) RUNTIME_SWITCH_RESERVATIONS.delete(key);
  if (registryIdentity && !existing && RUNTIME_REGISTRY.size >= GROUP_CONTROL_RUNTIME_MAX_REGISTRY) {
    if (!capacityRuntime || capacityRuntime.isDestroyed) {
      capacityRuntime = buildRuntime({}, null, '', 0, true);
    }
    return capacityRuntime;
  }
  const generation = registryIdentity ? (RUNTIME_GENERATIONS.get(key) ?? 0) + 1 : 1;
  const runtime = buildRuntime(options, identity, key, generation);
  if (registryIdentity) {
    RUNTIME_REGISTRY.set(key, runtime);
    rememberRuntimeGeneration(key, generation);
  }
  return runtime;
}

export const acquireGroupControlRuntime = createGroupControlRuntime;
export const createGroupControlRuntimeController = createGroupControlRuntime;

function buildRuntime(
  options: GroupControlRuntimeOptions,
  initialIdentity: NormalizedIdentity | null,
  initialRegistryKey: string,
  initialGeneration: number,
  capacityRejected = false,
): GroupControlRuntime {
  const now = options.now ?? (() => Date.now());
  const ttl = Number.isFinite(options.halfPairTtlMs)
    ? Math.max(1, Math.floor(options.halfPairTtlMs!))
    : GROUP_CONTROL_RUNTIME_DEFAULT_HALF_PAIR_TTL_MS;
  const queueLimit = Number.isFinite(options.maxQueue)
    ? Math.min(GROUP_CONTROL_RUNTIME_MAX_QUEUE, Math.max(1, Math.floor(options.maxQueue!)))
    : GROUP_CONTROL_RUNTIME_MAX_QUEUE;

  let identity = initialIdentity;
  let generation = initialGeneration;
  let lifecycle: GroupControlRuntimeLifecycle = capacityRejected
    ? 'inactive'
    : initialIdentity?.account && initialIdentity.deviceId
    ? hasDirectorySubstrate(options) && hasTrustSubstrate(options) ? 'ready' : 'recovery-required'
    : 'identity-pending';
  let detached = capacityRejected;
  let destroyedForever = false;
  let destroySettled = false;
  let transitionSerial = 0;
  let transitionPromise: Promise<void> | null = null;
  let generationAbortController = new AbortController();
  let pumpActive = false;
  let activeJobs = 0;
  const activeJobPromises = new Set<Promise<void>>();
  let runtimeAdapter: GroupControlSessionAdapter | null = null;
  let runtimeAdapterDestroy: Promise<void> | null = null;
  const ownedRegistryKeys = new Set<string>(initialRegistryKey ? [initialRegistryKey] : []);

  const queue: QueuedJob[] = [];
  /** Retained adapter state is replayed only by safe lifecycle triggers. */
  const retries: QueuedJob[] = [];
  const pairs = new Map<string, HalfPair>();
  const completed = new Map<string, CompletedFingerprint>();
  const inFlightReservations = new Map<string, InFlightReservation>();
  let retrySequence = 0;
  const sessions = new Map<string, GroupSession>();
  const rooms = new Map<string, GroupControlRoomProjection>();
  const reanchorRequests = new Map<string, number>();
  const roomIncarnations = new Map<string, number>();
  const activeRoomJobs = new Map<string, number>();
  const activeRoomDeferreds = new Map<string, Set<Deferred>>();
  const listeners = new Set<(state: GroupControlRuntimeState) => void>();
  const allAdapters = new Set<GroupControlSessionAdapter>();
  // A completed adapter must not remain strongly reachable just because its
  // destroy promise was once deduplicated. The live adapter set is the only
  // strong owner; this weak memo only spans overlapping destroy calls.
  const adapterDestroyPromises = new WeakMap<GroupControlSessionAdapter, Promise<void>>();
  const counters = emptyCounters();

  function roomIncarnation(room: string): number { return roomIncarnations.get(room) ?? 0; }

  function advanceRoomIncarnation(room: string): number {
    const next = roomIncarnation(room) + 1;
    roomIncarnations.set(room, next);
    return next;
  }

  function snapshot(): GroupControlRuntimeState {
    const roomList = [...rooms.values()].map((entry) => ({ ...entry }));
    roomList.sort((a, b) => a.room.localeCompare(b.room));
    const activation = lifecycle === 'ready' && roomList.some((entry) => (
      entry.status === 'control-applied' && entry.provisioned
    )) ? 'active' : 'hold';
    return {
      generation,
      lifecycle,
      activation,
      identity: {
        clientId: identity?.clientId ?? null,
        endpoint: identity?.endpoint ?? null,
        account: identity?.account ?? null,
        deviceId: identity?.deviceId ?? null,
      },
      rooms: roomList,
      counters: { ...counters },
      queueDepth: queue.length + retries.length + activeJobs,
      sessionCount: sessions.size,
    };
  }

  function notify(): void {
    if (destroyedForever) return;
    for (const listener of [...listeners]) {
      try {
        listener(snapshot());
      } catch {
        listeners.delete(listener);
      }
    }
  }

  function bump(name: keyof GroupControlRuntimeCounters): void {
    counters[name] = saturatingIncrement(counters[name]);
  }

  function roomKnown(room: string): boolean {
    if (rooms.has(room) || sessions.has(room) || [...pairs.values()].some((pair) => pair.room === room)) return true;
    if ([...inFlightReservations.values()].some((entry) => entry.room === room)) return true;
    return queue.some((job) => job.room === room) || retries.some((job) => job.room === room) || (activeRoomJobs.get(room) ?? 0) > 0;
  }

  function admitRoom(room: string, epoch?: number): boolean {
    if (rooms.has(room)) return true;
    if (rooms.size >= GROUP_CONTROL_RUNTIME_MAX_ROOMS) return false;
    rooms.set(room, {
      room,
      status: 'locked',
      provisioned: sessions.has(room),
      ...(typeof epoch === 'number' && Number.isSafeInteger(epoch) && epoch >= 0 ? { epoch } : {}),
    });
    notify();
    return true;
  }

  function setRoom(room: string, status: GroupControlRoomStatus, epoch?: number): void {
    if (!rooms.has(room) && !admitRoom(room, epoch)) return;
    const prior = rooms.get(room);
    if (!prior) return;
    rooms.set(room, {
      room,
      status,
      provisioned: sessions.has(room),
      ...(typeof epoch === 'number' && Number.isSafeInteger(epoch) && epoch >= 0
        ? { epoch }
        : prior.epoch !== undefined ? { epoch: prior.epoch } : {}),
    });
    notify();
  }

  function armReanchor(room: string, epoch: number): void {
    reanchorRequests.delete(room);
    reanchorRequests.set(room, epoch);
    while (reanchorRequests.size > GROUP_CONTROL_RUNTIME_MAX_ROOMS) {
      const oldest = reanchorRequests.keys().next().value;
      if (oldest === undefined) break;
      reanchorRequests.delete(oldest);
    }
  }

  function cleanupRoomMetadata(room: string): void {
    if (rooms.has(room) || sessions.has(room) || (activeRoomJobs.get(room) ?? 0) > 0) return;
    if ([...pairs.values()].some((pair) => pair.room === room)) return;
    if ([...inFlightReservations.values()].some((entry) => entry.room === room)) return;
    if (queue.some((job) => job.room === room) || retries.some((job) => job.room === room)) return;
    roomIncarnations.delete(room);
  }

  function resolveDeferred(deferred: Deferred, result: GroupControlRuntimeOutcome): void {
    try { deferred.resolve({ ...result }); } catch { /* Promise resolver is isolated. */ }
  }

  function safeDestroyAdapter(adapter: GroupControlSessionAdapter | null | undefined): Promise<void> {
    if (!adapter) return Promise.resolve();
    const existing = adapterDestroyPromises.get(adapter);
    if (existing) return existing;
    try {
      const promise = Promise.resolve(adapter.destroy()).then(() => undefined, () => undefined);
      adapterDestroyPromises.set(adapter, promise);
      void promise.finally(() => { allAdapters.delete(adapter); });
      return promise;
    } catch {
      allAdapters.delete(adapter);
      return Promise.resolve();
    }
  }

  function releaseHalfPairRefs(pair: HalfPair): void {
    pair.commit = undefined;
    pair.welcome = undefined;
    // Fingerprints include the control payload and must be dropped with it.
    pair.commitFingerprint = undefined;
    pair.welcomeFingerprint = undefined;
  }

  function quarantineHalfPair(pair: HalfPair): void {
    releaseHalfPairRefs(pair);
    pair.quarantined = true;
    pair.seenAt = now();
  }

  function clearHalfPair(pair: HalfPair): void {
    pairs.delete(pair.key);
    releaseHalfPairRefs(pair);
    pair.quarantined = undefined;
    cleanupRoomMetadata(pair.room);
  }

  function releaseAllPairs(): void {
    for (const pair of pairs.values()) releaseHalfPairRefs(pair);
    pairs.clear();
    completed.clear();
    inFlightReservations.clear();
  }

  function releaseRoomPairs(room: string): void {
    for (const pair of [...pairs.values()]) if (pair.room === room) clearHalfPair(pair);
    for (const [key, entry] of completed) if (entry.room === room) completed.delete(key);
    for (const [key, entry] of inFlightReservations) if (entry.room === room) inFlightReservations.delete(key);
  }

  function tryReserveInFlight(entry: InFlightReservation): boolean {
    const existing = inFlightReservations.get(entry.key);
    // Occupied identity/epoch: never replace, even with an exact match.
    // Exact retransmissions must coalesce in accept() instead of enqueueing.
    if (existing) return false;
    if (inFlightReservations.size >= GROUP_CONTROL_RUNTIME_MAX_HALF_PAIRS) return false;
    inFlightReservations.set(entry.key, entry);
    return true;
  }

  function releaseInFlightReservation(job: QueuedJob): void {
    const fingerprint = job.completed;
    if (!fingerprint) return;
    const reserved = inFlightReservations.get(fingerprint.key);
    if (!reserved) return;
    if (reserved.generation !== job.generation) return;
    if (reserved.roomIncarnation !== job.roomIncarnation) return;
    if (reserved.commitFingerprint !== fingerprint.commitFingerprint) return;
    if (reserved.welcomeFingerprint !== fingerprint.welcomeFingerprint) return;
    inFlightReservations.delete(fingerprint.key);
  }

  function dropQueuedRoomJobs(room: string): void {
    const retained: QueuedJob[] = [];
    for (const job of queue) {
      if (job.room === room) {
        resolveDeferred(job.deferred, runtimeOutcome('ignored', generation, 'room-removed', room));
        void safeDestroyAdapter(job.adapter);
      } else retained.push(job);
    }
    queue.splice(0, queue.length, ...retained);
    for (const job of retries.splice(0, retries.length)) {
      if (job.room === room) void safeDestroyAdapter(job.adapter);
      else retries.push(job);
    }
  }

  function expireHalfPairs(): void {
    const current = now();
    for (const pair of [...pairs.values()]) {
      if (current - pair.seenAt < ttl) continue;
      bump('expired');
      const room = pair.room;
      clearHalfPair(pair);
      if (rooms.has(room)) setRoom(room, sessions.has(room) ? 'recovery-required' : 'locked');
    }
    for (const [key, entry] of completed) {
      if (entry.generation !== generation || current - entry.seenAt >= ttl) completed.delete(key);
    }
    for (const [key, entry] of inFlightReservations) {
      // Live jobs must keep their reservation; only drop generation-stale rows.
      if (entry.generation !== generation) inFlightReservations.delete(key);
    }
    for (const job of [...retries]) {
      const entry = job.completed;
      if (entry && entry.generation === generation && current - entry.seenAt < ttl) continue;
      retries.splice(retries.indexOf(job), 1);
      void safeDestroyAdapter(job.adapter);
      bump('expired');
    }
  }

  function staleOutcome(room?: string): GroupControlRuntimeOutcome {
    return runtimeOutcome('ignored', generation, room ? 'room-removed' : 'runtime-inactive', room);
  }

  function resolveStore(): TrustedGroupSignerStore | null {
    try {
      const store = typeof options.trustedSignerStore === 'function'
        ? options.trustedSignerStore()
        : options.trustedSignerStore;
      return store ?? null;
    } catch {
      return null;
    }
  }

  function directoryRequest(account: string, signal: AbortSignal): Promise<GroupControlDirectory | null | undefined> {
    const source = options.transport?.requestDirectory
      ? () => options.transport!.requestDirectory!(account, signal)
      : options.directoryForAccount
        ? () => options.directoryForAccount!(account)
        : null;
    return source ? abortable(source, signal) : Promise.reject(new Error('directory-unavailable'));
  }

  function adoptBootstrappedSession(session: GroupSession, ticket: BootstrapTicket): boolean {
    if (destroyedForever || detached || lifecycle === 'inactive') {
      session.destroy();
      return false;
    }
    if (generation !== ticket.generation) {
      session.destroy();
      return false;
    }
    if (!identity?.account || !identity.deviceId
      || identity.account !== ticket.account || identity.deviceId !== ticket.deviceId) {
      session.destroy();
      return false;
    }
    if (session.account !== identity.account || session.deviceId !== identity.deviceId) {
      session.destroy();
      return false;
    }
    if (session.epoch !== BigInt(ticket.expectedEpoch)) {
      session.destroy();
      return false;
    }
    const room = roomKey(session.room);
    if (!room || room !== ticket.room || roomIncarnation(room) !== ticket.roomIncarnation) {
      session.destroy();
      return false;
    }
    if (liveSessionForRoom(room)) {
      session.destroy();
      return false;
    }
    if (session.isDestroyed) return false;
    if (!rooms.has(room) && rooms.size >= GROUP_CONTROL_RUNTIME_MAX_ROOMS) {
      session.destroy();
      return false;
    }
    if (sessions.size >= GROUP_CONTROL_RUNTIME_MAX_SESSIONS) {
      session.destroy();
      return false;
    }
    sessions.set(room, session);
    reanchorRequests.delete(room);
    setRoom(room, 'control-applied', Number(session.epoch));
    if (lifecycle === 'recovery-required') {
      lifecycle = 'ready';
      replayRetries();
      notify();
    }
    return true;
  }

  function roomAwaitingRecovery(): boolean {
    return [...rooms.values()].some((entry) => (
      !(entry.status === 'control-applied' && entry.provisioned)
    ));
  }

  function createAdapter(boundSession: GroupSession | null, ticket?: BootstrapTicket): GroupControlSessionAdapter | null {
    if (!identity?.account || !identity.deviceId || !hasDirectorySubstrate(options) || !hasTrustSubstrate(options)) return null;
    const store = resolveStore();
    if (!store || !options.recipientPrivateKeyFor) return null;
    const signal = generationAbortController.signal;
    try {
      const adapter = createGroupControlSessionAdapter({
        sessionForRoom: () => boundSession,
        directoryForAccount: (account) => directoryRequest(account, signal),
        trustedSignerStore: store,
        recipientPrivateKeyFor: options.recipientPrivateKeyFor,
        localIdentity: { account: identity.account, deviceId: identity.deviceId },
        adoptBootstrappedSession: ticket
          ? (session) => adoptBootstrappedSession(session, ticket)
          : undefined,
      });
      allAdapters.add(adapter);
      return adapter;
    } catch {
      return null;
    }
  }

  function initializeAdapter(forceRecovery: boolean): void {
    if (destroyedForever) return;
    if (!identity?.account || !identity.deviceId) {
      lifecycle = 'identity-pending';
      runtimeAdapter = null;
      return;
    }
    runtimeAdapter = createAdapter(null);
    lifecycle = runtimeAdapter
      ? forceRecovery ? 'recovery-required' : 'ready'
      : 'recovery-required';
  }

  function ensureUsable(): GroupControlRuntimeOutcome | null {
    if (capacityRejected) return runtimeOutcome('ignored', generation, 'runtime-capacity');
    if (destroyedForever || detached || lifecycle === 'inactive') return runtimeOutcome('ignored', generation, 'runtime-inactive');
    if (!identity?.account || !identity.deviceId) return runtimeOutcome('locked', generation, 'identity-pending');
    if (!runtimeAdapter) return runtimeOutcome('locked', generation, 'trust-path-unreachable');
    if (lifecycle === 'recovery-required') return runtimeOutcome('locked', generation, 'recovery-required');
    if (options.transport?.isConnected && !options.transport.isConnected()) {
      lifecycle = 'recovery-required';
      notify();
      return runtimeOutcome('locked', generation, 'transport-unavailable');
    }
    return null;
  }

  function routeFor(message: IRCMessage | string): GroupControlDelivery | null {
    try { return parseGroupControlDelivery(message); } catch { return null; }
  }

  function targetMatches(delivery: GroupControlDelivery): boolean {
    if (delivery.kind !== 'welcome') return true;
    return canonicalAccount(delivery.toAccount) === identity?.account
      && delivery.toDevice === identity?.deviceId;
  }

  function canonicalFingerprint(delivery: GroupControlDelivery): string {
    const room = roomKey(delivery.channel) ?? delivery.channel.trim().toLowerCase();
    const sender = canonicalAccount(delivery.fromAccount) ?? delivery.fromAccount.trim().toLowerCase();
    const target = delivery.kind === 'welcome'
      ? `${canonicalAccount(delivery.toAccount) ?? ''}\u0000${delivery.toDevice ?? ''}`
      : '';
    // Non-reversible, fixed-width routing fingerprint for bounded duplicate
    // coalescing. It is not a cryptographic authenticator; authenticity was
    // already verified by the adapter before an applied tombstone is created.
    let a = 0x811c9dc5;
    let b = 0x9e3779b9;
    const feed = (value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        a = Math.imul(a ^ code, 0x01000193) >>> 0;
        b = Math.imul((b + code) ^ (a >>> 16), 0x85ebca6b) >>> 0;
      }
      a = Math.imul(a ^ 0, 0x01000193) >>> 0;
      b = Math.imul(b ^ (a >>> 16), 0x85ebca6b) >>> 0;
    };
    feed(delivery.command); feed(room); feed(delivery.kind); feed(sender); feed(delivery.fromDevice); feed(target); feed(delivery.payload);
    return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
  }

  /** Do not retain caller-owned IRC objects: middleware may mutate them later. */
  function immutableControl(message: IRCMessage | string): string {
    return typeof message === 'string' ? message : String(message.raw);
  }

  function pairKey(delivery: GroupControlDelivery): string {
    const room = roomKey(delivery.channel) ?? delivery.channel;
    const sender = canonicalAccount(delivery.fromAccount) ?? delivery.fromAccount.trim().toLowerCase();
    const epoch = delivery.payloadParts?.epoch ?? 0;
    // Commit has no target fields; bind it to this local recipient so it can
    // only pair with the welcome whose exact local target passed the filter.
    const target = delivery.kind === 'welcome'
      ? `\u0000${canonicalAccount(delivery.toAccount) ?? ''}\u0000${delivery.toDevice ?? ''}`
      : `\u0000${identity?.account ?? ''}\u0000${identity?.deviceId ?? ''}`;
    return `${room}\u0000${sender}\u0000${delivery.fromDevice}\u0000${epoch}${target}`;
  }

  function recordAdapterResult(result: GroupControlRuntimeOutcome, room: string | null, incarnation: number): void {
    if (room && roomIncarnation(room) !== incarnation) return;
    bump('processed');
    if (result.status === 'applied') bump('applied');
    else if (result.status === 'locked') bump('locked');
    else if (result.status === 'rejected') bump('rejected');
    else if (result.status === 'ignored') bump('ignored');
    if (!room || !rooms.has(room)) return;
    if (result.status === 'applied') setRoom(room, 'control-applied', result.epoch);
    else if (result.status === 'queued') setRoom(room, 'pair-pending', result.epoch);
    else if (result.status === 'locked') {
      const directory = result.reason === 'directory-unavailable'
        || result.reason === 'directory-incomplete'
        || result.reason === 'trust-failed';
      setRoom(room, directory ? 'directory-pending' : 'locked', result.epoch);
    } else if (result.status === 'rejected') setRoom(room, 'rejected', result.epoch);
  }

  async function processJob(job: QueuedJob): Promise<void> {
    const oldGeneration = job.generation;
    const activeAdapter = job.adapter;
    const room = job.room;
    const incarnation = job.roomIncarnation;
    activeJobs += 1;
    if (room) activeRoomJobs.set(room, (activeRoomJobs.get(room) ?? 0) + 1);
    if (room) (activeRoomDeferreds.get(room) ?? activeRoomDeferreds.set(room, new Set()).get(room)!).add(job.deferred);
    let final: GroupControlRuntimeOutcome = runtimeOutcome('rejected', generation, 'trust-path-unreachable', room ?? undefined);
    let applied: GroupControlRuntimeOutcome | null = null;
    let replayRoom: string | null = null;
    try {
      if (oldGeneration !== generation || destroyedForever || detached || (room && roomIncarnation(room) !== incarnation)) {
        final = room && roomIncarnation(room) !== incarnation ? staleOutcome(room) : runtimeOutcome('ignored', generation, 'runtime-inactive');
      } else {
        for (const message of job.messages) {
          if (oldGeneration !== generation || destroyedForever || detached || (room && roomIncarnation(room) !== incarnation)) {
            final = room && roomIncarnation(room) !== incarnation ? staleOutcome(room) : runtimeOutcome('ignored', generation, 'runtime-inactive');
            break;
          }
          try {
            final = adapterOutcome(await activeAdapter.accept(message), generation);
            if (final.status === 'applied') applied = final;
          } catch {
            final = runtimeOutcome('rejected', generation, 'trust-path-unreachable', room ?? undefined);
          }
          recordAdapterResult(final, room, incarnation);
        }
      }
      if (room && roomIncarnation(room) !== incarnation) final = staleOutcome(room);
      else if (oldGeneration !== generation || destroyedForever || detached) final = runtimeOutcome('ignored', generation, 'runtime-inactive');
      // A replayed pair can apply on commit, then report the already-consumed
      // welcome as a harmless duplicate. Preserve the successful transition
      // for tombstoning; never hide a later locked/rejected failure.
      else if (applied && final.status === 'ignored' && final.reason === 'duplicate') final = applied;
      const sessionMatches = !room
        || sessions.get(room) === job.boundSession
        || (job.boundSession === null && Boolean(job.bootstrapTicket) && sessions.has(room));
      const stillCurrent = oldGeneration === generation && !destroyedForever && !detached
        && (!room || roomIncarnation(room) === incarnation) && sessionMatches;
      if (final.status === 'applied' && job.completed && stillCurrent) {
        completed.set(job.completed.key, { ...job.completed, seenAt: now(), generation });
        while (completed.size > GROUP_CONTROL_RUNTIME_MAX_HALF_PAIRS) completed.delete(completed.keys().next().value!);
      }
      const retryable = (final.status === 'queued' && final.reason === 'epoch-gap')
        || (final.status === 'locked' && final.reason === 'recipient-key-unavailable');
      if (retryable && stillCurrent) {
        retainRetry(job);
      }
      resolveDeferred(job.deferred, final);
      if (final.status === 'applied' && stillCurrent && room) replayRoom = room;
    } finally {
      releaseInFlightReservation(job);
      if (!retries.some((job) => job.adapter === activeAdapter)) await safeDestroyAdapter(activeAdapter);
      activeJobs = Math.max(0, activeJobs - 1);
      if (room) {
        activeRoomDeferreds.get(room)?.delete(job.deferred);
        if (activeRoomDeferreds.get(room)?.size === 0) activeRoomDeferreds.delete(room);
        const count = Math.max(0, (activeRoomJobs.get(room) ?? 1) - 1);
        if (count === 0) activeRoomJobs.delete(room);
        else activeRoomJobs.set(room, count);
        cleanupRoomMetadata(room);
      }
      // An applied lower epoch releases the only active slot; replay after the
      // decrement so a retained successor is actually admitted under cap=1.
      if (replayRoom) {
        const live = liveSessionForRoom(replayRoom);
        if (live) {
          const hasReady = [...pairs.values()].some((pair) => (
            pair.room === replayRoom
            && !pair.quarantined
            && pair.commit !== undefined
            && pair.welcome !== undefined
          ));
          if (hasReady) replayCompletePairsForRoom(replayRoom, live);
        }
        replayRetries(replayRoom);
      }
      notify();
    }
  }

  function pump(): void {
    if (pumpActive) return;
    pumpActive = true;
    void (async () => {
      try {
        while (queue.length > 0) {
          const job = queue.shift()!;
          const running = processJob(job);
          activeJobPromises.add(running);
          try {
            await running;
          } finally {
            activeJobPromises.delete(running);
          }
        }
      } finally {
        pumpActive = false;
        if (queue.length > 0 && !destroyedForever) pump();
        notify();
      }
    })();
  }

  function enqueue(
    messages: readonly (IRCMessage | string)[],
    room: string | null,
    boundSession: GroupSession | null,
    incarnation: number,
    deferred: Deferred,
    completedFingerprint?: CompletedFingerprint,
    bootstrapTicket?: BootstrapTicket,
  ): boolean {
    // `maxQueue` bounds waiting work (queued + retained), not the one job
    // currently executing. This permits exactly one retained successor while
    // its predecessor is active, which is necessary to close an epoch gap.
    const lowerThanRetained = retries.some((job) => (job.completed?.epoch ?? 0) > (completedFingerprint?.epoch ?? Number.MAX_SAFE_INTEGER));
    if (queue.length + retries.length >= queueLimit && !(queue.length === 0 && activeJobs === 0 && lowerThanRetained)) return false;
    const adapter = createAdapter(boundSession, bootstrapTicket);
    if (!adapter) return false;
    if (completedFingerprint && !tryReserveInFlight({
      key: completedFingerprint.key,
      room: completedFingerprint.room,
      commitFingerprint: completedFingerprint.commitFingerprint,
      welcomeFingerprint: completedFingerprint.welcomeFingerprint,
      generation,
      epoch: completedFingerprint.epoch,
      roomIncarnation: incarnation,
    })) {
      void safeDestroyAdapter(adapter);
      return false;
    }
    queue.push({
      generation,
      room,
      roomIncarnation: incarnation,
      boundSession,
      bootstrapTicket,
      messages,
      adapter,
      deferred,
      completed: completedFingerprint,
    });
    bump('accepted');
    bump('queued');
    notify();
    pump();
    return true;
  }

  function replayRetries(room?: string): void {
    expireHalfPairs();
    const eligible = retries.filter((job) => !room || job.room === room);
    if (eligible.length === 0 || destroyedForever || detached || lifecycle !== 'ready') return;
    for (const job of eligible.sort((a, b) => (a.completed?.epoch ?? 0) - (b.completed?.epoch ?? 0) || (a.retrySequence ?? 0) - (b.retrySequence ?? 0))) {
      retries.splice(retries.indexOf(job), 1);
      if (queue.length + retries.length >= queueLimit) {
        retries.push(job);
        break;
      }
      queue.push(job);
    }
    notify();
    pump();
  }

  function retainRetry(job: QueuedJob): void {
    const retained = { ...job, deferred: { resolve: () => undefined }, retrySequence: ++retrySequence };
    retries.push(retained);
    while (queue.length + retries.length > queueLimit) {
      const oldest = retries.reduce((prior, candidate) => (candidate.retrySequence ?? 0) < (prior.retrySequence ?? 0) ? candidate : prior);
      retries.splice(retries.indexOf(oldest), 1);
      void safeDestroyAdapter(oldest.adapter);
      bump('evicted');
    }
  }

  function queuedOutcome(
    delivery: GroupControlDelivery,
    reason?: GroupControlRuntimeReason,
  ): GroupControlRuntimeOutcome {
    return {
      status: 'queued',
      ...(reason ? { reason } : {}),
      room: roomKey(delivery.channel) ?? delivery.channel,
      fromAccount: canonicalAccount(delivery.fromAccount) ?? delivery.fromAccount,
      fromDevice: delivery.fromDevice,
      ...(delivery.payloadParts ? { epoch: delivery.payloadParts.epoch } : {}),
      generation,
    };
  }

  function liveSessionForRoom(room: string): GroupSession | null {
    const session = sessions.get(room) ?? null;
    if (!session) return null;
    if (!session.isDestroyed) return session;
    sessions.delete(room);
    return null;
  }

  function replayCompletePairsForRoom(room: string, session: GroupSession): void {
    if (session.isDestroyed) {
      setRoom(room, lifecycle === 'recovery-required' ? 'recovery-required' : 'locked');
      return;
    }
    const ready = [...pairs.values()].filter((pair) => (
      pair.room === room
      && !pair.quarantined
      && pair.commit !== undefined
      && pair.welcome !== undefined
    ));
    if (ready.length === 0) {
      const prior = rooms.get(room)?.status;
      setRoom(
        room,
        prior === 'rejected' ? 'rejected'
          : lifecycle === 'recovery-required' ? 'recovery-required'
          : 'locked',
      );
      return;
    }
    const incarnation = roomIncarnation(room);
    let admitted = false;
    for (const pair of ready) {
      const commitMessage = pair.commit;
      const welcomeMessage = pair.welcome;
      clearHalfPair(pair);
      if (!commitMessage || !welcomeMessage) continue;
      if (!enqueue(
        [commitMessage, welcomeMessage],
        room,
        session,
        incarnation,
        { resolve: () => undefined },
      )) {
        bump('evicted');
        setRoom(room, 'rejected');
        continue;
      }
      admitted = true;
    }
    if (!rooms.has(room)) return;
    if (rooms.get(room)?.status === 'rejected') return;
    setRoom(
      room,
      admitted && lifecycle !== 'recovery-required' ? 'pair-pending'
        : lifecycle === 'recovery-required' ? 'recovery-required' : 'locked',
    );
  }

  async function accept(message: IRCMessage | string): Promise<GroupControlRuntimeOutcome> {
    expireHalfPairs();
    const blocked = ensureUsable();
    // The public object form is caller-owned and can disagree with `.raw`.
    // Reparse only the immutable wire snapshot so routing/fingerprints/replay
    // are one canonical byte sequence.
    const canonicalMessage = immutableControl(message);
    const parsed = routeFor(canonicalMessage);
    const parsedRoom = parsed ? roomKey(parsed.channel) : null;
    if (blocked && blocked.reason !== 'recovery-required') {
      if (parsedRoom && rooms.has(parsedRoom)) setRoom(parsedRoom, 'locked');
      return { ...blocked, ...(parsedRoom ? { room: parsedRoom } : {}) };
    }
    if (!parsed) {
      bump('ignored');
      return runtimeOutcome('ignored', generation, 'runtime-inactive');
    }
    if (!targetMatches(parsed)) {
      bump('ignored');
      return runtimeOutcome('ignored', generation, 'foreign-recipient', parsedRoom ?? undefined);
    }
    if (!parsedRoom) {
      bump('ignored');
      return runtimeOutcome('ignored', generation, 'room-removed');
    }
    if (!rooms.has(parsedRoom) && !admitRoom(parsedRoom, parsed.payloadParts?.epoch)) {
      bump('evicted');
      return runtimeOutcome('ignored', generation, 'queue-full', parsedRoom);
    }
    if (parsed.command === 'E2EE.KEYPACKAGE') {
      let resolve!: (result: GroupControlRuntimeOutcome) => void;
      const promise = new Promise<GroupControlRuntimeOutcome>((r) => { resolve = r; });
      if (!enqueue([canonicalMessage], parsedRoom, sessions.get(parsedRoom) ?? null, roomIncarnation(parsedRoom), { resolve })) {
        bump('evicted');
        return runtimeOutcome('ignored', generation, 'queue-full', parsedRoom);
      }
      return promise;
    }
    const field = parsed.kind === 'commit' && parsed.command === 'E2EE.COMMIT'
      ? 'commit'
      : parsed.kind === 'welcome' && parsed.command === 'E2EE.WELCOME' ? 'welcome' : null;
    if (!field) {
      bump('ignored');
      return runtimeOutcome('ignored', generation, 'activation-held', parsedRoom);
    }
    const key = pairKey(parsed);
    const fingerprint = canonicalFingerprint(parsed);
    const priorCompleted = completed.get(key);
    if (priorCompleted) {
      const expected = field === 'commit' ? priorCompleted.commitFingerprint : priorCompleted.welcomeFingerprint;
      if (expected === fingerprint) {
        bump('coalesced');
        return runtimeOutcome('ignored', generation, 'coalesced', parsedRoom);
      }
      bump('rejected');
      setRoom(parsedRoom, 'rejected', parsed.payloadParts?.epoch);
      return runtimeOutcome('rejected', generation, 'equivocation', parsedRoom);
    }
    const retained = retries.find((job) => job.completed?.key === key);
    if (retained?.completed) {
      const expected = field === 'commit' ? retained.completed.commitFingerprint : retained.completed.welcomeFingerprint;
      if (expected !== fingerprint) {
        bump('rejected');
        setRoom(parsedRoom, 'rejected', parsed.payloadParts?.epoch);
        return runtimeOutcome('rejected', generation, 'equivocation', parsedRoom);
      }
      // Exact retransmission is a safe signal to retry the already-authenticated
      // pair; never admit a second mutable copy beside it.
      replayRetries(parsedRoom);
      bump('coalesced');
      return runtimeOutcome('ignored', generation, 'coalesced', parsedRoom);
    }
    const reserved = inFlightReservations.get(key);
    if (reserved && (reserved.generation !== generation || reserved.roomIncarnation !== roomIncarnation(parsedRoom))) {
      inFlightReservations.delete(key);
    } else if (reserved) {
      const expected = field === 'commit' ? reserved.commitFingerprint : reserved.welcomeFingerprint;
      if (expected === fingerprint) {
        bump('coalesced');
        return runtimeOutcome('ignored', generation, 'coalesced', parsedRoom);
      }
      bump('rejected');
      setRoom(parsedRoom, 'rejected', parsed.payloadParts?.epoch);
      return runtimeOutcome('rejected', generation, 'equivocation', parsedRoom);
    }
    let pair = pairs.get(key);
    if (!pair) {
      if (pairs.size >= GROUP_CONTROL_RUNTIME_MAX_HALF_PAIRS) {
        bump('evicted');
        return runtimeOutcome('ignored', generation, 'queue-full', parsedRoom);
      }
      pair = { key, room: parsedRoom, seenAt: now() };
      pairs.set(key, pair);
    }
    if (pair.quarantined) {
      bump('rejected');
      setRoom(parsedRoom, 'rejected', parsed.payloadParts?.epoch);
      return runtimeOutcome('rejected', generation, 'equivocation', parsedRoom);
    }
    const existingFingerprint = field === 'commit' ? pair.commitFingerprint : pair.welcomeFingerprint;
    if (existingFingerprint !== undefined) {
      if (existingFingerprint !== fingerprint) {
        bump('rejected');
        setRoom(parsedRoom, 'rejected', parsed.payloadParts?.epoch);
        quarantineHalfPair(pair);
        return runtimeOutcome('rejected', generation, 'equivocation', parsedRoom);
      }
      bump('coalesced');
      return runtimeOutcome('ignored', generation, 'coalesced', parsedRoom);
    }
    if (field === 'commit') {
      pair.commit = canonicalMessage;
      pair.commitFingerprint = fingerprint;
    } else {
      pair.welcome = canonicalMessage;
      pair.welcomeFingerprint = fingerprint;
    }
    if (!pair.commit || !pair.welcome) {
      bump('accepted');
      bump('queued');
      setRoom(parsedRoom, 'pair-pending', parsed.payloadParts?.epoch);
      return queuedOutcome(parsed);
    }
    const boundSession = liveSessionForRoom(parsedRoom);
    if (!boundSession) {
      const epoch = parsed.payloadParts?.epoch ?? 0;
      if (epoch !== 1) {
        const armedEpoch = reanchorRequests.get(parsedRoom);
        if (armedEpoch !== epoch) {
          bump('accepted');
          bump('queued');
          setRoom(parsedRoom, 'recovery-required', epoch);
          return {
            status: 'locked',
            reason: 'recovery-required',
            room: parsedRoom,
            fromAccount: canonicalAccount(parsed.fromAccount) ?? parsed.fromAccount,
            fromDevice: parsed.fromDevice,
            epoch,
            generation,
          };
        }
        bump('accepted');
        bump('queued');
        reanchorRequests.delete(parsedRoom);
        if (!identity?.account || !identity.deviceId) {
          setRoom(parsedRoom, 'recovery-required', epoch);
          return runtimeOutcome('locked', generation, 'identity-pending', parsedRoom);
        }
        const ticket: BootstrapTicket = {
          generation,
          room: parsedRoom,
          roomIncarnation: roomIncarnation(parsedRoom),
          account: identity.account,
          deviceId: identity.deviceId,
          expectedEpoch: epoch,
        };
        const commitMessage = pair.commit;
        const welcomeMessage = pair.welcome;
        const bootstrapFingerprint: CompletedFingerprint = {
          key,
          room: parsedRoom,
          commitFingerprint: pair.commitFingerprint!,
          welcomeFingerprint: pair.welcomeFingerprint!,
          seenAt: now(),
          generation,
          epoch,
        };
        clearHalfPair(pair);
        let resolveBootstrap!: (result: GroupControlRuntimeOutcome) => void;
        const bootstrapPromise = new Promise<GroupControlRuntimeOutcome>((r) => { resolveBootstrap = r; });
        if (!enqueue(
          [commitMessage!, welcomeMessage!],
          parsedRoom,
          null,
          ticket.roomIncarnation,
          { resolve: resolveBootstrap },
          bootstrapFingerprint,
          ticket,
        )) {
          bump('evicted');
          setRoom(parsedRoom, 'rejected', epoch);
          return runtimeOutcome('ignored', generation, 'queue-full', parsedRoom);
        }
        return bootstrapPromise;
      }
      if (!identity?.account || !identity.deviceId) {
        bump('accepted');
        bump('queued');
        setRoom(parsedRoom, 'pair-pending', epoch);
        return queuedOutcome(parsed, 'session-not-provisioned');
      }
      const ticket: BootstrapTicket = {
        generation,
        room: parsedRoom,
        roomIncarnation: roomIncarnation(parsedRoom),
        account: identity.account,
        deviceId: identity.deviceId,
        expectedEpoch: 1,
      };
      const commitMessage = pair.commit;
      const welcomeMessage = pair.welcome;
      const genesisFingerprint: CompletedFingerprint = {
        key,
        room: parsedRoom,
        commitFingerprint: pair.commitFingerprint!,
        welcomeFingerprint: pair.welcomeFingerprint!,
        seenAt: now(),
        generation,
        epoch,
      };
      clearHalfPair(pair);
      let resolveGenesis!: (result: GroupControlRuntimeOutcome) => void;
      const genesisPromise = new Promise<GroupControlRuntimeOutcome>((r) => { resolveGenesis = r; });
      if (!enqueue(
        [commitMessage!, welcomeMessage!],
        parsedRoom,
        null,
        ticket.roomIncarnation,
        { resolve: resolveGenesis },
        genesisFingerprint,
        ticket,
      )) {
        bump('evicted');
        setRoom(parsedRoom, 'rejected', epoch);
        return runtimeOutcome('ignored', generation, 'queue-full', parsedRoom);
      }
      return genesisPromise;
    }
    const commitMessage = pair.commit;
    const welcomeMessage = pair.welcome;
    const completedFingerprint: CompletedFingerprint = {
      key,
      room: parsedRoom,
      commitFingerprint: pair.commitFingerprint!,
      welcomeFingerprint: pair.welcomeFingerprint!,
      seenAt: now(),
      generation,
      epoch: parsed.payloadParts!.epoch,
    };
    clearHalfPair(pair);
    let resolve!: (result: GroupControlRuntimeOutcome) => void;
    const promise = new Promise<GroupControlRuntimeOutcome>((r) => { resolve = r; });
    if (!enqueue(
      [commitMessage, welcomeMessage],
      parsedRoom,
      boundSession,
      roomIncarnation(parsedRoom),
      { resolve },
      completedFingerprint,
    )) {
      bump('evicted');
      setRoom(parsedRoom, 'rejected', parsed.payloadParts?.epoch);
      return runtimeOutcome('ignored', generation, 'queue-full', parsedRoom);
    }
    return promise;
  }

  function registerProvisionedSession(session: GroupSession): GroupControlRuntimeProvisionResult {
    expireHalfPairs();
    if (capacityRejected) return { ok: false, reason: 'runtime-capacity' };
    if (destroyedForever || detached || lifecycle === 'inactive') return { ok: false, reason: 'runtime-inactive' };
    if (!identity?.account || !identity.deviceId) return { ok: false, reason: 'identity-pending' };
    if (!(session instanceof GroupSession) || session.isDestroyed) return { ok: false, reason: 'invalid-session' };
    if (session.account !== identity.account || session.deviceId !== identity.deviceId) return { ok: false, reason: 'identity-mismatch' };
    const room = roomKey(session.room);
    if (!room) return { ok: false, reason: 'invalid-session' };
    if (!rooms.has(room) && rooms.size >= GROUP_CONTROL_RUNTIME_MAX_ROOMS) return { ok: false, reason: 'session-capacity' };
    let existing = sessions.get(room);
    if (existing === session) return { ok: true, room, replaced: false };
    if (existing?.isDestroyed) {
      sessions.delete(room);
      existing = undefined;
    }
    if (existing) {
      advanceRoomIncarnation(room);
      for (const deferred of activeRoomDeferreds.get(room) ?? []) {
        resolveDeferred(deferred, staleOutcome(room));
      }
      existing.destroy();
      releaseRoomPairs(room);
      dropQueuedRoomJobs(room);
      sessions.set(room, session);
      reanchorRequests.delete(room);
      setRoom(room, lifecycle === 'recovery-required' ? 'recovery-required' : 'locked');
      return { ok: true, room, replaced: true };
    }
    sessions.set(room, session);
    reanchorRequests.delete(room);
    replayCompletePairsForRoom(room, session);
    replayRetries(room);
    return { ok: true, room, replaced: false };
  }

  function activeSession(room: string): { room: string; session: GroupSession } | null {
    const normalized = roomKey(room);
    if (!normalized || destroyedForever || detached || lifecycle !== 'ready' || !identity?.account || !identity.deviceId) return null;
    const projection = rooms.get(normalized);
    const session = sessions.get(normalized);
    if (!projection || projection.status !== 'control-applied' || !projection.provisioned || !session || session.isDestroyed
      || session.account !== identity.account || session.deviceId !== identity.deviceId) return null;
    return { room: normalized, session };
  }

  async function sealRoomMessage(room: string, plaintext: string): Promise<GroupControlRuntimeSealResult> {
    const active = activeSession(room);
    if (!active) return { ok: false, status: 'locked', reason: destroyedForever || detached || lifecycle === 'inactive' ? 'runtime-inactive' : 'session-not-provisioned' };
    const incarnation = roomIncarnation(active.room);
    const result = await active.session.sealRoomMessage(active.room, plaintext);
    if (!result.ok) return { ok: false, status: 'locked', reason: result.reason };
    if (activeSession(active.room)?.session !== active.session || roomIncarnation(active.room) !== incarnation) return { ok: false, status: 'locked', reason: 'stale' };
    return { ok: true, status: 'sealed', room: result.room, epoch: result.epoch, envelope: result.envelope };
  }

  async function openRoomMessage(room: string, envelope: string): Promise<GroupControlRuntimeOpenResult> {
    const active = activeSession(room);
    if (!active) return { ok: false, status: 'locked', reason: destroyedForever || detached || lifecycle === 'inactive' ? 'runtime-inactive' : 'session-not-provisioned' };
    const incarnation = roomIncarnation(active.room);
    const result = await active.session.openRoomMessage(active.room, envelope);
    if (!result.ok) return { ok: false, status: 'locked', reason: result.reason };
    if (activeSession(active.room)?.session !== active.session || roomIncarnation(active.room) !== incarnation) return { ok: false, status: 'locked', reason: 'stale' };
    return { ok: true, status: 'opened', room: result.room, epoch: result.epoch, plaintext: result.plaintext };
  }

  function removeRoom(room: string, _reason?: 'part' | 'kick'): void {
    const normalized = roomKey(room);
    if (!normalized || !roomKnown(normalized)) return;
    advanceRoomIncarnation(normalized);
    releaseRoomPairs(normalized);
    dropQueuedRoomJobs(normalized);
    sessions.get(normalized)?.destroy();
    sessions.delete(normalized);
    reanchorRequests.delete(normalized);
    rooms.delete(normalized);
    cleanupRoomMetadata(normalized);
    notify();
  }

  function onRoomPart(room: string): void { removeRoom(room, 'part'); }
  function onRoomKick(room: string): void { removeRoom(room, 'kick'); }

  function beginTransition(nextLifecycle: GroupControlRuntimeLifecycle, terminal: boolean): Promise<void> {
    if (terminal) destroyedForever = true;
    detached = true;
    lifecycle = nextLifecycle;
    generation += 1;
    generationAbortController.abort();
    for (const key of ownedRegistryKeys) {
      rememberRuntimeGeneration(key, generation);
    }
    // Retried adapters own authenticated controls internally. A generation
    // boundary is terminal for those controls just like the active queue.
    for (const job of retries.splice(0, retries.length)) {
      void safeDestroyAdapter(job.adapter);
    }

    if (terminal) {
      for (const job of queue.splice(0, queue.length)) {
        resolveDeferred(job.deferred, runtimeOutcome('ignored', generation, 'runtime-inactive'));
        void safeDestroyAdapter(job.adapter);
      }
      for (const session of sessions.values()) session.destroy();
      sessions.clear();
      reanchorRequests.clear();
      releaseAllPairs();
      rooms.clear();
      roomIncarnations.clear();
      activeRoomJobs.clear();
    } else if (!transitionPromise) {
      for (const job of queue.splice(0, queue.length)) {
        resolveDeferred(job.deferred, runtimeOutcome('ignored', generation, 'runtime-inactive'));
        void safeDestroyAdapter(job.adapter);
      }
      releaseAllPairs();
      for (const session of sessions.values()) session.destroy();
      sessions.clear();
      reanchorRequests.clear();
      for (const projection of rooms.values()) {
        projection.status = nextLifecycle === 'recovery-required' ? 'recovery-required' : 'locked';
        projection.provisioned = false;
      }
    }
    const adapters = new Set(allAdapters);
    if (runtimeAdapter) adapters.add(runtimeAdapter);
    const destroys = [...adapters].map((adapter) => safeDestroyAdapter(adapter));
    const active = [...activeJobPromises];
    runtimeAdapter = null;
    const prior = transitionPromise ?? Promise.resolve();
    runtimeAdapterDestroy = Promise.allSettled(destroys).then(() => undefined);
    transitionPromise = Promise.allSettled([prior, runtimeAdapterDestroy, ...active]).then(() => undefined);
    notify();
    return transitionPromise;
  }

  function reviveIfCurrent(token: number, forceRecovery: boolean): boolean {
    if (destroyedForever || token !== transitionSerial) return false;
    detached = false;
    generationAbortController = new AbortController();
    transitionPromise = null;
    runtimeAdapterDestroy = null;
    initializeAdapter(forceRecovery);
    notify();
    return true;
  }

  function reconnect(): void {
    if (destroyedForever || capacityRejected) return;
    const token = ++transitionSerial;
    const wait = beginTransition('recovery-required', false);
    void wait.then(() => { reviveIfCurrent(token, true); });
  }

  function detach(): Promise<void> {
    if (destroyedForever || capacityRejected) return Promise.resolve();
    ++transitionSerial;
    return beginTransition('inactive', false);
  }

  function destroy(): Promise<void> {
    if (destroyedForever) return transitionPromise ?? Promise.resolve();
    ++transitionSerial;
    const wait = beginTransition('inactive', true);
    const cleanup = wait.then(() => {
      if (!destroyedForever) return;
      for (const [key, held] of RUNTIME_SWITCH_RESERVATIONS) {
        if (held.runtime === runtimeObject) RUNTIME_SWITCH_RESERVATIONS.delete(key);
      }
      for (const key of ownedRegistryKeys) {
        if (RUNTIME_REGISTRY.get(key) === runtimeObject) RUNTIME_REGISTRY.delete(key);
        // Keep this tuple's final generation as an LRU tombstone after the
        // live owner is removed, so a later reacquire cannot rewind it.
        rememberRuntimeGeneration(key, generation);
      }
      ownedRegistryKeys.clear();
      listeners.clear();
      destroySettled = true;
    });
    // Publish the cleanup-inclusive promise so every caller awaiting destroy
    // observes alias removal and tombstone retention, not only adapter drain.
    transitionPromise = cleanup;
    return cleanup;
  }

  function setIdentity(next: GroupControlRuntimeIdentity | null): Promise<boolean> {
    if (destroyedForever || capacityRejected) return Promise.resolve(false);
    const normalized = canonicalIdentity(next);
    const targetKey = isCompleteIdentity(normalized) ? identityKey(normalized!) : null;
    const currentKeys = [...ownedRegistryKeys].filter((key) => RUNTIME_REGISTRY.get(key) === runtimeObject);
    const currentKey = currentKeys[0] ?? null;
    const collision = targetKey ? RUNTIME_REGISTRY.get(targetKey) : undefined;
    const reservation = targetKey ? RUNTIME_SWITCH_RESERVATIONS.get(targetKey) : undefined;
    const hadTransition = detached || transitionPromise !== null;
    const token = ++transitionSerial;
    for (const [key, held] of RUNTIME_SWITCH_RESERVATIONS) {
      if (held.runtime === runtimeObject) RUNTIME_SWITCH_RESERVATIONS.delete(key);
    }

    const restoreAfterFailedSwitch = (): Promise<boolean> => {
      const wait = transitionPromise ?? Promise.resolve();
      if (!hadTransition) return Promise.resolve(false);
      return wait.then(() => {
        if (destroyedForever || token !== transitionSerial) return false;
        reviveIfCurrent(token, true);
        return false;
      });
    };

    if (collision && collision !== runtimeObject && !collision.isDestroyed) {
      return restoreAfterFailedSwitch();
    }
    if (reservation && reservation.runtime !== runtimeObject && !reservation.runtime.isDestroyed) {
      return restoreAfterFailedSwitch();
    }
    const hasCurrentSlot = Boolean(currentKey);
    if (targetKey && !collision && !hasCurrentSlot && RUNTIME_REGISTRY.size >= GROUP_CONTROL_RUNTIME_MAX_REGISTRY) {
      return restoreAfterFailedSwitch();
    }
    const wait = beginTransition('inactive', false);
    if (targetKey) RUNTIME_SWITCH_RESERVATIONS.set(targetKey, { runtime: runtimeObject, token });
    return wait.then(() => {
      const held = targetKey ? RUNTIME_SWITCH_RESERVATIONS.get(targetKey) : undefined;
      if (destroyedForever || token !== transitionSerial) {
        if (targetKey && held?.runtime === runtimeObject && held.token === token) RUNTIME_SWITCH_RESERVATIONS.delete(targetKey);
        return false;
      }
      const occupant = targetKey ? RUNTIME_REGISTRY.get(targetKey) : undefined;
      if ((targetKey && held?.runtime !== runtimeObject)
        || (occupant && occupant !== runtimeObject && !occupant.isDestroyed)) {
        if (targetKey && held?.runtime === runtimeObject && held.token === token) RUNTIME_SWITCH_RESERVATIONS.delete(targetKey);
        reviveIfCurrent(token, true);
        return false;
      }

      // Commit the tuple swap atomically: remove the old aliases first, retain
      // their generation tombstones, then publish exactly one final target.
      for (const key of [...ownedRegistryKeys]) {
        if (key === targetKey) continue;
        if (RUNTIME_REGISTRY.get(key) === runtimeObject) RUNTIME_REGISTRY.delete(key);
        rememberRuntimeGeneration(key, generation);
      }
      if (targetKey) {
        if (occupant?.isDestroyed && RUNTIME_REGISTRY.get(targetKey) === occupant) RUNTIME_REGISTRY.delete(targetKey);
        generation = Math.max(generation, (RUNTIME_GENERATIONS.get(targetKey) ?? 0) + 1);
        RUNTIME_REGISTRY.set(targetKey, runtimeObject);
        rememberRuntimeGeneration(targetKey, generation);
        RUNTIME_SWITCH_RESERVATIONS.delete(targetKey);
      }
      identity = normalized;
      ownedRegistryKeys.clear();
      if (targetKey) ownedRegistryKeys.add(targetKey);
      return reviveIfCurrent(token, true);
    });
  }

  async function refreshIdentity(): Promise<boolean> {
    if (typeof options.identityFor !== 'function') return Boolean(identity);
    let next: GroupControlRuntimeIdentity | null;
    try { next = await options.identityFor(); } catch { next = null; }
    return setIdentity(next);
  }

  async function requestCurrentEpochWelcome(
    room: string,
    payload: string,
  ): Promise<{ ok: true; room: string; epoch: number } | { ok: false; reason: GroupControlRuntimeReason }> {
    const normalized = roomKey(room);
    if (!normalized) return { ok: false, reason: 'room-removed' };
    if (destroyedForever || detached || lifecycle === 'inactive') return { ok: false, reason: 'runtime-inactive' };
    if (!identity?.account || !identity.deviceId) return { ok: false, reason: 'identity-pending' };
    const account = identity.account;
    const deviceId = identity.deviceId;
    if (!runtimeAdapter) return { ok: false, reason: 'trust-path-unreachable' };
    const epoch = rooms.get(normalized)?.epoch;
    if (!Number.isSafeInteger(epoch) || epoch === undefined || epoch < 1) {
      return { ok: false, reason: 'epoch-unavailable' };
    }
    const send = options.transport?.requestCurrentEpochWelcome;
    if (!send) return { ok: false, reason: 'transport-unavailable' };
    armReanchor(normalized, epoch);
    let delivered: boolean;
    try {
      delivered = await Promise.resolve(
        send(normalized, epoch, account, deviceId, payload, generationAbortController.signal),
      ) === true;
    } catch {
      delivered = false;
    }
    if (!delivered) {
      reanchorRequests.delete(normalized);
      return { ok: false, reason: 'transport-unavailable' };
    }
    setRoom(normalized, 'recovery-required', epoch);
    return { ok: true, room: normalized, epoch };
  }

  function markRecovered(): boolean {
    if (destroyedForever || detached || !runtimeAdapter || !identity?.account || !identity.deviceId) return false;
    if (options.transport?.isConnected && !options.transport.isConnected()) {
      lifecycle = 'recovery-required';
      notify();
      return false;
    }
    const hasAppliedSession = [...rooms.values()].some((entry) => (
      entry.status === 'control-applied' && entry.provisioned
    ));
    if (!hasAppliedSession) {
      if (roomAwaitingRecovery()) {
        lifecycle = 'recovery-required';
        notify();
        return false;
      }
      lifecycle = 'ready';
      notify();
      return true;
    }
    lifecycle = 'ready';
    replayRetries();
    notify();
    return true;
  }

  const runtimeObject: GroupControlRuntime = {
    get generation() { return generation; },
    get isDetached() { return detached; },
    get isDestroyed() { return destroyedForever; },
    get isDestroySettled() { return destroySettled; },
    get state() { return snapshot(); },
    getState: snapshot,
    subscribe(listener) {
      if (destroyedForever) return () => undefined;
      listeners.add(listener);
      try { listener(snapshot()); } catch { listeners.delete(listener); }
      return () => { listeners.delete(listener); };
    },
    accept,
    acceptControl: accept,
    ingest: accept,
    registerProvisionedSession,
    sealRoomMessage,
    openRoomMessage,
    removeRoom,
    onRoomPart,
    onRoomKick,
    setIdentity,
    switchIdentity: setIdentity,
    refreshIdentity,
    expire: expireHalfPairs,
    reconnect,
    onReconnect: reconnect,
    requestCurrentEpochWelcome,
    markRecovered,
    detach,
    destroy,
    get activationHeld() { return snapshot().activation !== 'active'; },
  };

  runtimeAdapter = createAdapter(null);
  if (!runtimeAdapter && identity?.account && identity.deviceId) lifecycle = 'recovery-required';
  notify();
  return runtimeObject;
}
