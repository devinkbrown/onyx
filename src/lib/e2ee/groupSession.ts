// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pure, in-memory group epoch state machine.
 *
 * This module never touches IRC, stores, IndexedDB, or UI state.  It accepts
 * inbound controls only through a `ResolveResult` whose status is verified;
 * raw signer bytes and KEYTRANS observations are intentionally not accepted.
 */

import {
  buildGroupCommitContext,
  computeGroupEpochKeyCommitment,
  decodeGroupCommit,
  encodeGroupCommit,
  hashGroupCommit,
  prepareGroupCommit,
  type GroupCommit,
  type PreparedGroupCommit,
} from './groupCommit';
import { normalizeGroupRoom } from './groupKeyring';
import {
  buildGroupWelcomeContext,
  consumeOpenedGroupWelcome,
  hashGroupWelcomeBody,
  type OpenedGroupWelcome,
} from './groupWelcome';
import {
  normalizeGroupControlRouting,
  type GroupControlRouting,
} from './groupControlPayload';
import type { ResolveResult } from './trustedGroupSigner';
import { openGroupMessage, sealGroupMessage } from './groupEnvelope';

export const GROUP_SESSION_INITIAL_COMMIT_HASH_BYTES = 32;
export const GROUP_SESSION_KEY_BYTES = 32;
export const GROUP_SESSION_MAX_SEEN = 64;
export const GROUP_SESSION_MAX_PENDING_WELCOMES = 64;

export type GroupSessionConfig = {
  room: string;
  account: string;
  deviceId: string;
  epochKey: Uint8Array;
  membershipDigest: Uint8Array;
  epoch?: bigint | number;
  commitHash?: Uint8Array;
  /** Deprecated compatibility flag; authenticated welcomes are always required. */
  requireWelcome?: boolean;
};

export type GroupSessionApplyFailure =
  | 'destroyed'
  | 'invalid-commit'
  | 'unverified-control'
  | 'legacy-ogc1'
  | 'room-mismatch'
  | 'committer-mismatch'
  | 'stale-epoch'
  | 'epoch-gap'
  | 'prior-hash-mismatch'
  | 'equivocation'
  | 'duplicate-commit'
  | 'welcome-required'
  | 'welcome-mismatch'
  | 'invalid-welcome'
  | 'welcome-replay'
  | 'welcome-target-mismatch'
  | 'welcome-epoch-mismatch';

export type GroupSessionApplyResult =
  | { ok: true; epoch: bigint; commitHash: Uint8Array; commitId: Uint8Array }
  | { ok: false; reason: GroupSessionApplyFailure };

export type GroupSessionMessageFailure = 'destroyed' | 'room-mismatch' | 'epoch-unavailable' | 'seal-failed' | 'open-failed';
export type GroupSessionSealResult =
  | { ok: true; room: string; epoch: number; envelope: string }
  | { ok: false; reason: GroupSessionMessageFailure };
export type GroupSessionOpenResult =
  | { ok: true; room: string; epoch: number; plaintext: string }
  | { ok: false; reason: GroupSessionMessageFailure };

/** Local identity plus the authenticated commit/welcome pair used for genesis. */
export type GroupSessionBootstrapInput = {
  opened: OpenedGroupWelcome;
  welcomeResolution: ResolveResult;
  welcomeRouting: GroupControlRouting;
  commitResolution: ResolveResult;
  commitRouting: GroupControlRouting;
  room: string;
  account: string;
  deviceId: string;
  signal?: AbortSignal;
};

export type GroupSessionBootstrapResult =
  | { ok: true; session: GroupSession; epoch: bigint; commitHash: Uint8Array; commitId: Uint8Array }
  | { ok: false; reason: GroupSessionApplyFailure };

export type VerifiedGroupControl = Extract<ResolveResult, { status: 'verified' }>;

type SeenCommit = { hash: Uint8Array; epoch: bigint };
type PendingWelcome = OpenedGroupWelcome & { fromAccount: string; fromDevice: string };

const U64_MAX = (1n << 64n) - 1n;
const ACCOUNT_RE = /^[A-Za-z0-9_.@-]{1,64}$/u;
const DEVICE_RE = /^[A-Za-z0-9_.-]{1,32}$/u;

function copy(bytes: Uint8Array): Uint8Array { return new Uint8Array(bytes); }

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let index = 0; index < a.byteLength; index += 1) diff |= a[index]! ^ b[index]!;
  return diff === 0;
}

function nonZero(bytes: Uint8Array): boolean {
  let value = 0;
  for (const byte of bytes) value |= byte;
  return value !== 0;
}

function asU64(value: bigint | number): bigint | null {
  if (typeof value === 'bigint') return value >= 0n && value <= U64_MAX ? value : null;
  if (!Number.isSafeInteger(value) || value < 0) return null;
  const result = BigInt(value);
  return result <= U64_MAX ? result : null;
}

function canonicalAccount(value: string): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return ACCOUNT_RE.test(normalized) ? normalized : null;
}

function validDevice(value: string): boolean { return DEVICE_RE.test(value); }

function mapKey(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

function zeroizeSeen(map: Map<string, SeenCommit>): void {
  for (const entry of map.values()) entry.hash.fill(0);
  map.clear();
}

function zeroizePending(map: Map<string, PendingWelcome>): void {
  for (const entry of map.values()) {
    entry.commitId.fill(0);
    entry.membershipDigest.fill(0);
    entry.epochKey.fill(0);
    entry.context.fill(0);
    entry.bodyDigest.fill(0);
  }
  map.clear();
}

/** In-memory group session; no key or membership state is persisted. */
export class GroupSession {
  private readonly roomName: string;
  private readonly accountName: string;
  private readonly deviceName: string;
  private currentEpochValue: bigint;
  private currentKey: Uint8Array;
  private currentMembership: Uint8Array;
  private currentCommitHash: Uint8Array;
  private readonly seenCommits = new Map<string, SeenCommit>();
  private readonly seenEpochs = new Map<string, Uint8Array>();
  private readonly pendingWelcomes = new Map<string, PendingWelcome>();
  private mutationTail: Promise<void> = Promise.resolve();
  private destroyed = false;

  private constructor(config: {
    room: string;
    account: string;
    deviceId: string;
    epoch: bigint;
    epochKey: Uint8Array;
    membershipDigest: Uint8Array;
    commitHash: Uint8Array;
  }) {
    this.roomName = config.room;
    this.accountName = config.account;
    this.deviceName = config.deviceId;
    this.currentEpochValue = config.epoch;
    this.currentKey = copy(config.epochKey);
    this.currentMembership = copy(config.membershipDigest);
    this.currentCommitHash = copy(config.commitHash);
  }

  static create(config: GroupSessionConfig): GroupSession | null {
    const room = normalizeGroupRoom(config.room);
    const account = canonicalAccount(config.account);
    const epoch = asU64(config.epoch ?? 0);
    if (!room || !account || !validDevice(config.deviceId) || epoch === null
      || config.epochKey.byteLength !== GROUP_SESSION_KEY_BYTES || !nonZero(config.epochKey)
      || config.membershipDigest.byteLength !== 32 || !nonZero(config.membershipDigest)) return null;
    const commitHash = config.commitHash ? copy(config.commitHash) : new Uint8Array(32);
    if (commitHash.byteLength !== 32 || (epoch > 0n && !nonZero(commitHash))) return null;
    return new GroupSession({
      room,
      account,
      deviceId: config.deviceId,
      epoch,
      epochKey: config.epochKey,
      membershipDigest: config.membershipDigest,
      commitHash,
    });
  }

  /**
   * Authenticated genesis-only factory. Consumes `opened` exactly once and
   * never constructs a session from an unverified or non-genesis pair.
   * `create()` is intentionally unchanged: a caller still cannot mint an
   * epoch-1 session from a zero/unverified anchor.
   */
  static async bootstrapVerifiedGenesis(
    input: GroupSessionBootstrapInput,
  ): Promise<GroupSessionBootstrapResult> {
    const snapshot = consumeOpenedGroupWelcome(input.opened);
    if (!snapshot) return { ok: false, reason: 'invalid-welcome' };
    let commitContext: Uint8Array | null = null;
    let welcomeContext: Uint8Array | null = null;
    let resolutionBodyDigest: Uint8Array | null = null;
    let expectedCommitment: Uint8Array | null = null;
    let hash: Uint8Array | null = null;
    try {
      if (input.signal?.aborted) return { ok: false, reason: 'destroyed' };
      const room = normalizeGroupRoom(input.room);
      const account = canonicalAccount(input.account);
      if (!room || !account || !validDevice(input.deviceId)) {
        return { ok: false, reason: 'welcome-target-mismatch' };
      }

      const welcomeResolution = input.welcomeResolution;
      if (welcomeResolution.status !== 'verified') {
        return { ok: false, reason: welcomeResolution.reason === 'legacy-ogc1' ? 'legacy-ogc1' : 'unverified-control' };
      }
      if (welcomeResolution.parts.version !== 2 || welcomeResolution.parts.diagnosticOnly
        || welcomeResolution.parts.kind !== 'welcome') {
        return { ok: false, reason: welcomeResolution.parts.version !== 2 || welcomeResolution.parts.diagnosticOnly ? 'legacy-ogc1' : 'unverified-control' };
      }
      const welcomeRoute = normalizeGroupControlRouting(input.welcomeRouting);
      if (!welcomeRoute || welcomeRoute.kind !== 'welcome') return { ok: false, reason: 'invalid-welcome' };
      if (welcomeRoute.channel !== room
        || welcomeRoute.toAccount?.trim().toLowerCase() !== account
        || welcomeRoute.toDevice !== input.deviceId) {
        return { ok: false, reason: 'welcome-target-mismatch' };
      }
      if (welcomeResolution.account !== welcomeRoute.fromAccount
        || welcomeResolution.deviceId !== welcomeRoute.fromDevice) {
        return { ok: false, reason: 'committer-mismatch' };
      }
      if (snapshot.epoch < 0n || snapshot.commitId.byteLength !== 32 || !nonZero(snapshot.commitId)
        || snapshot.membershipDigest.byteLength !== 32 || !nonZero(snapshot.membershipDigest)
        || snapshot.epochKey.byteLength !== GROUP_SESSION_KEY_BYTES || !nonZero(snapshot.epochKey)
        || snapshot.bodyDigest.byteLength !== 32 || !nonZero(snapshot.bodyDigest)) {
        return { ok: false, reason: 'welcome-target-mismatch' };
      }
      resolutionBodyDigest = await hashGroupWelcomeBody(welcomeResolution.parts.body);
      if (!resolutionBodyDigest || !equalBytes(snapshot.bodyDigest, resolutionBodyDigest)) {
        return { ok: false, reason: 'welcome-target-mismatch' };
      }
      if (input.signal?.aborted) return { ok: false, reason: 'destroyed' };
      welcomeContext = buildGroupWelcomeContext({
        room,
        fromAccount: welcomeRoute.fromAccount,
        fromDevice: welcomeRoute.fromDevice,
        toAccount: welcomeRoute.toAccount!,
        toDevice: welcomeRoute.toDevice!,
        epoch: snapshot.epoch,
        commitId: snapshot.commitId,
      });
      if (!welcomeContext || !equalBytes(welcomeContext, snapshot.context)) {
        return { ok: false, reason: 'welcome-target-mismatch' };
      }
      if (BigInt(welcomeResolution.parts.epoch) !== snapshot.epoch || snapshot.epoch !== 1n) {
        return { ok: false, reason: 'welcome-epoch-mismatch' };
      }

      const commitResolution = input.commitResolution;
      if (commitResolution.status !== 'verified') {
        return { ok: false, reason: commitResolution.reason === 'legacy-ogc1' ? 'legacy-ogc1' : 'unverified-control' };
      }
      if (commitResolution.parts.version !== 2 || commitResolution.parts.diagnosticOnly
        || commitResolution.parts.kind !== 'commit') {
        return { ok: false, reason: commitResolution.parts.version !== 2 || commitResolution.parts.diagnosticOnly ? 'legacy-ogc1' : 'unverified-control' };
      }
      const commitRoute = normalizeGroupControlRouting(input.commitRouting);
      if (!commitRoute || commitRoute.kind !== 'commit') return { ok: false, reason: 'invalid-commit' };
      if (commitRoute.channel !== room) return { ok: false, reason: 'room-mismatch' };
      if (commitResolution.account !== commitRoute.fromAccount
        || commitResolution.deviceId !== commitRoute.fromDevice) {
        return { ok: false, reason: 'committer-mismatch' };
      }
      if (commitRoute.fromAccount !== welcomeRoute.fromAccount
        || commitRoute.fromDevice !== welcomeRoute.fromDevice) {
        return { ok: false, reason: 'welcome-target-mismatch' };
      }

      const rawBody = commitResolution.parts.body;
      const record = decodeGroupCommit(rawBody) ?? decodeGroupCommit(new TextDecoder().decode(rawBody));
      if (!record) return { ok: false, reason: 'invalid-commit' };
      if (BigInt(commitResolution.parts.epoch) !== record.nextEpoch) return { ok: false, reason: 'invalid-commit' };
      if (record.nextEpoch !== 1n || snapshot.epoch !== 1n) return { ok: false, reason: 'epoch-gap' };
      if (record.priorEpoch !== 0n) return { ok: false, reason: 'epoch-gap' };
      if (nonZero(record.priorCommitHash)) return { ok: false, reason: 'prior-hash-mismatch' };
      if (record.nextEpoch !== snapshot.epoch || !equalBytes(record.commitId, snapshot.commitId)
        || !equalBytes(record.membershipDigest, snapshot.membershipDigest)) {
        return { ok: false, reason: 'welcome-mismatch' };
      }

      commitContext = buildGroupCommitContext({
        room,
        fromAccount: commitRoute.fromAccount,
        fromDevice: commitRoute.fromDevice,
        priorEpoch: record.priorEpoch,
        nextEpoch: record.nextEpoch,
        commitId: record.commitId,
      });
      if (!commitContext) return { ok: false, reason: 'invalid-commit' };
      hash = await hashGroupCommit(record, commitContext);
      if (!hash) return { ok: false, reason: 'invalid-commit' };
      if (input.signal?.aborted) return { ok: false, reason: 'destroyed' };

      expectedCommitment = await computeGroupEpochKeyCommitment({
        room,
        nextEpoch: record.nextEpoch,
        commitId: record.commitId,
        membershipDigest: record.membershipDigest,
        epochKey: snapshot.epochKey,
      });
      if (!expectedCommitment || !equalBytes(expectedCommitment, record.newEpochKeyCommitment)) {
        return { ok: false, reason: 'welcome-mismatch' };
      }
      if (input.signal?.aborted) return { ok: false, reason: 'destroyed' };

      const session = new GroupSession({
        room,
        account,
        deviceId: input.deviceId,
        epoch: 1n,
        epochKey: snapshot.epochKey,
        membershipDigest: record.membershipDigest,
        commitHash: hash,
      });
      session.rememberCommit(record, hash);
      return {
        ok: true,
        session,
        epoch: 1n,
        commitHash: copy(hash),
        commitId: copy(record.commitId),
      };
    } finally {
      commitContext?.fill(0);
      welcomeContext?.fill(0);
      resolutionBodyDigest?.fill(0);
      expectedCommitment?.fill(0);
      hash?.fill(0);
      snapshot.commitId.fill(0);
      snapshot.membershipDigest.fill(0);
      snapshot.epochKey.fill(0);
      snapshot.context.fill(0);
      snapshot.bodyDigest.fill(0);
    }
  }

  get room(): string { return this.roomName; }
  get account(): string { return this.accountName; }
  get deviceId(): string { return this.deviceName; }
  get epoch(): bigint { return this.currentEpochValue; }
  /** Always true after the Packet A key-leak repair; no welcome override exists. */
  get requireWelcome(): boolean { return true; }
  get isDestroyed(): boolean { return this.destroyed; }

  membershipDigest(): Uint8Array | null {
    return this.destroyed ? null : copy(this.currentMembership);
  }

  commitHash(): Uint8Array | null {
    return this.destroyed ? null : copy(this.currentCommitHash);
  }

  private messageRoom(room: string): string | null {
    const normalized = normalizeGroupRoom(room);
    return normalized === this.roomName ? normalized : null;
  }

  private async messageKey(): Promise<{ key: CryptoKey; epoch: number; raw: Uint8Array } | null> {
    if (this.destroyed || this.currentEpochValue > BigInt(0xffffffff)) return null;
    const raw = copy(this.currentKey);
    const importBytes = new Uint8Array(raw).buffer as ArrayBuffer;
    try {
      const key = await crypto.subtle.importKey('raw', importBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      new Uint8Array(importBytes).fill(0);
      return { key, epoch: Number(this.currentEpochValue), raw };
    } catch {
      new Uint8Array(importBytes).fill(0);
      raw.fill(0);
      return null;
    }
  }

  /** Seal only with this live session's current private epoch key. */
  async sealRoomMessage(room: string, plaintext: string): Promise<GroupSessionSealResult> {
    return this.withMutation(async () => {
      const normalized = this.messageRoom(room);
      if (!normalized) return { ok: false, reason: 'room-mismatch' };
      if (this.destroyed) return { ok: false, reason: 'destroyed' };
      const material = await this.messageKey();
      if (!material) return { ok: false, reason: this.destroyed ? 'destroyed' : 'epoch-unavailable' };
      try {
        const envelope = await sealGroupMessage(material.key, normalized, material.epoch, plaintext);
        if (this.destroyed) return { ok: false, reason: 'destroyed' };
        if (this.currentEpochValue !== BigInt(material.epoch)) return { ok: false, reason: 'epoch-unavailable' };
        return envelope ? { ok: true, room: normalized, epoch: material.epoch, envelope } : { ok: false, reason: 'seal-failed' };
      } finally { material.raw.fill(0); }
    });
  }

  /** Open only with this live session's current private epoch key. */
  async openRoomMessage(room: string, envelope: string): Promise<GroupSessionOpenResult> {
    return this.withMutation(async () => {
      const normalized = this.messageRoom(room);
      if (!normalized) return { ok: false, reason: 'room-mismatch' };
      if (this.destroyed) return { ok: false, reason: 'destroyed' };
      const material = await this.messageKey();
      if (!material) return { ok: false, reason: this.destroyed ? 'destroyed' : 'epoch-unavailable' };
      try {
        const plaintext = await openGroupMessage(material.key, normalized, envelope, material.epoch);
        if (this.destroyed) return { ok: false, reason: 'destroyed' };
        if (this.currentEpochValue !== BigInt(material.epoch)) return { ok: false, reason: 'epoch-unavailable' };
        return plaintext === null ? { ok: false, reason: 'open-failed' } : { ok: true, room: normalized, epoch: material.epoch, plaintext };
      } finally { material.raw.fill(0); }
    });
  }

  /** Serialize state-changing operations so concurrent commits have one
   * deterministic admission order and cannot partially install two epochs. */
  private async withMutation<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const current = previous.then(() => gate, () => gate);
    this.mutationTail = current;
    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (this.mutationTail === current) this.mutationTail = Promise.resolve();
    }
  }

  async prepareCommit(input: {
    membershipDigest: Uint8Array;
    commitId?: Uint8Array;
    /** Explicit local key used only to calculate the OGCMT2 commitment. */
    newEpochKey?: Uint8Array;
    /** Alternatively, supply a commitment computed in the welcome path. */
    newEpochKeyCommitment?: Uint8Array;
  }): Promise<PreparedGroupCommit | null> {
    if (this.destroyed || input.membershipDigest.byteLength !== 32 || !nonZero(input.membershipDigest)
      || (!input.newEpochKey && !input.newEpochKeyCommitment)
      || (input.newEpochKey !== undefined && (input.newEpochKey.byteLength !== GROUP_SESSION_KEY_BYTES || !nonZero(input.newEpochKey)))
      || (input.newEpochKeyCommitment !== undefined && (input.newEpochKeyCommitment.byteLength !== 32 || !nonZero(input.newEpochKeyCommitment)))) return null;
    try {
      const prepared = await prepareGroupCommit({
        room: this.roomName,
        fromAccount: this.accountName,
        fromDevice: this.deviceName,
        priorEpoch: this.currentEpochValue,
        priorCommitHash: this.currentCommitHash,
        membershipDigest: input.membershipDigest,
        commitId: input.commitId,
        newEpochKey: input.newEpochKey,
      });
      if (this.destroyed) {
        prepared?.destroy();
        return null;
      }
      return prepared;
    } catch {
      return null;
    }
  }

  private rememberCommit(record: GroupCommit, hash: Uint8Array): void {
    const id = mapKey(record.commitId);
    this.seenCommits.set(id, { hash: copy(hash), epoch: record.nextEpoch });
    while (this.seenCommits.size > GROUP_SESSION_MAX_SEEN) {
      const oldest = this.seenCommits.keys().next().value;
      if (oldest === undefined) break;
      const entry = this.seenCommits.get(oldest);
      entry?.hash.fill(0);
      this.seenCommits.delete(oldest);
    }
    const epochKey = record.nextEpoch.toString();
    this.seenEpochs.set(epochKey, copy(hash));
    while (this.seenEpochs.size > GROUP_SESSION_MAX_SEEN) {
      const oldest = this.seenEpochs.keys().next().value;
      if (oldest === undefined) break;
      this.seenEpochs.get(oldest)?.fill(0);
      this.seenEpochs.delete(oldest);
    }
  }

  private validatePrepared(record: GroupCommit, hash: Uint8Array): GroupSessionApplyFailure | null {
    if (this.destroyed) return 'destroyed';
    if (this.currentEpochValue > 0n && !nonZero(this.currentCommitHash)) return 'invalid-commit';
    const id = mapKey(record.commitId);
    const seen = this.seenCommits.get(id);
    if (seen) return equalBytes(seen.hash, hash) ? 'duplicate-commit' : 'equivocation';
    const epochSeen = this.seenEpochs.get(record.nextEpoch.toString());
    if (epochSeen) return equalBytes(epochSeen, hash) ? 'duplicate-commit' : 'equivocation';
    if (record.priorEpoch < this.currentEpochValue || record.nextEpoch <= this.currentEpochValue) return 'stale-epoch';
    if (record.priorEpoch > this.currentEpochValue) return 'epoch-gap';
    if (record.nextEpoch !== this.currentEpochValue + 1n) return 'epoch-gap';
    if (!equalBytes(record.priorCommitHash, this.currentCommitHash)) return 'prior-hash-mismatch';
    return null;
  }

  private discardPendingWelcome(key: string): void {
    const pending = this.pendingWelcomes.get(key);
    if (!pending) return;
    pending.commitId.fill(0);
    pending.membershipDigest.fill(0);
    pending.epochKey.fill(0);
    pending.context.fill(0);
    pending.bodyDigest.fill(0);
    this.pendingWelcomes.delete(key);
  }

  private async applyRecord(
    record: GroupCommit,
    route: GroupControlRouting,
    expectedHash?: Uint8Array,
    suppliedEpochKey?: Uint8Array,
    signal?: AbortSignal,
  ): Promise<GroupSessionApplyResult> {
    if (this.destroyed || signal?.aborted) return { ok: false, reason: 'destroyed' };
    const context = buildGroupCommitContext({ room: this.roomName, fromAccount: route.fromAccount, fromDevice: route.fromDevice, priorEpoch: record.priorEpoch, nextEpoch: record.nextEpoch, commitId: record.commitId });
    if (!context) return { ok: false, reason: 'invalid-commit' };
    const hash = await hashGroupCommit(record, context);
    context.fill(0);
    if (!hash) return { ok: false, reason: 'invalid-commit' };
    if (this.destroyed || signal?.aborted) { hash.fill(0); return { ok: false, reason: 'destroyed' }; }
    if (expectedHash && !equalBytes(expectedHash, hash)) { hash.fill(0); return { ok: false, reason: 'invalid-commit' }; }
    const failure = this.validatePrepared(record, hash);
    if (failure) { hash.fill(0); return { ok: false, reason: failure }; }
    if (!suppliedEpochKey) {
      hash.fill(0);
      return { ok: false, reason: 'welcome-required' };
    }
    const expectedCommitment = await computeGroupEpochKeyCommitment({
      room: this.roomName,
      nextEpoch: record.nextEpoch,
      commitId: record.commitId,
      membershipDigest: record.membershipDigest,
      epochKey: suppliedEpochKey,
    });
    if (!expectedCommitment || !equalBytes(expectedCommitment, record.newEpochKeyCommitment)) {
      expectedCommitment?.fill(0);
      hash.fill(0);
      return { ok: false, reason: 'welcome-mismatch' };
    }
    if (this.destroyed || signal?.aborted) { expectedCommitment.fill(0); hash.fill(0); return { ok: false, reason: 'destroyed' }; }
    expectedCommitment.fill(0);
    // Every validation completes before the state swap. This is the commit
    // point: no partially installed epoch can escape on a failure path.
    const nextKey = copy(suppliedEpochKey);
    const oldKey = this.currentKey;
    this.currentKey = nextKey;
    this.currentEpochValue = record.nextEpoch;
    this.currentMembership.fill(0);
    this.currentMembership = copy(record.membershipDigest);
    this.currentCommitHash.fill(0);
    this.currentCommitHash = copy(hash);
    oldKey.fill(0);
    this.rememberCommit(record, hash);
    const consumedWelcome = this.pendingWelcomes.get(mapKey(record.commitId));
    if (consumedWelcome) {
      consumedWelcome.commitId.fill(0);
      consumedWelcome.membershipDigest.fill(0);
      consumedWelcome.epochKey.fill(0);
      consumedWelcome.context.fill(0);
      consumedWelcome.bodyDigest.fill(0);
      this.pendingWelcomes.delete(mapKey(record.commitId));
    }
    return { ok: true, epoch: this.currentEpochValue, commitHash: copy(hash), commitId: copy(record.commitId) };
  }

  async applyPrepared(prepared: PreparedGroupCommit): Promise<GroupSessionApplyResult> {
    return this.withMutation(async () => {
      if (this.destroyed) return { ok: false, reason: 'destroyed' };
      const record = decodeGroupCommit(prepared.body);
      const encoded = record ? encodeGroupCommit(record) : null;
      if (!record || !encoded || !equalBytes(prepared.body, encoded)) return { ok: false, reason: 'invalid-commit' };
      const pending = this.pendingWelcomes.get(mapKey(record.commitId));
      if (!pending) return { ok: false, reason: 'welcome-required' };
      return this.applyRecord(record, {
        channel: this.roomName,
        kind: 'commit',
        fromAccount: this.accountName,
        fromDevice: this.deviceName,
      }, prepared.commitHash, pending.epochKey);
    });
  }

  /**
   * Apply a locally-authored commit with an explicitly injected raw key.
   * This is intentionally separate from wire/inbound apply and the key is
   * never copied into the prepared body or retained by the session until the
   * validated state swap.
   */
  async applyPreparedLocal(prepared: PreparedGroupCommit, epochKey: Uint8Array): Promise<GroupSessionApplyResult> {
    // Clone before entering the mutation lane: callers may mutate their
    // buffer immediately after invocation while an earlier apply is queued.
    const stableEpochKey = copy(epochKey);
    try {
      return await this.withMutation(async () => {
        if (this.destroyed) return { ok: false, reason: 'destroyed' };
        if (stableEpochKey.byteLength !== GROUP_SESSION_KEY_BYTES || !nonZero(stableEpochKey)) return { ok: false, reason: 'welcome-mismatch' };
        const record = decodeGroupCommit(prepared.body);
        const encoded = record ? encodeGroupCommit(record) : null;
        if (!record || !encoded || !equalBytes(prepared.body, encoded)) return { ok: false, reason: 'invalid-commit' };
        return this.applyRecord(record, {
          channel: this.roomName,
          kind: 'commit',
          fromAccount: this.accountName,
          fromDevice: this.deviceName,
        }, prepared.commitHash, stableEpochKey);
      });
    } finally {
      stableEpochKey.fill(0);
    }
  }

  /** Apply only a verified OGC1-v2 commit; raw payloads are not accepted. */
  async applyVerifiedCommit(resolution: ResolveResult, routing: GroupControlRouting, signal?: AbortSignal): Promise<GroupSessionApplyResult> {
    return this.withMutation(async () => {
      if (this.destroyed || signal?.aborted) return { ok: false, reason: 'destroyed' };
      if (resolution.status !== 'verified') return { ok: false, reason: resolution.reason === 'legacy-ogc1' ? 'legacy-ogc1' : 'unverified-control' };
      if (resolution.parts.version !== 2 || resolution.parts.diagnosticOnly) return { ok: false, reason: 'legacy-ogc1' };
      const route = normalizeGroupControlRouting(routing);
      if (!route || route.kind !== 'commit') return { ok: false, reason: 'invalid-commit' };
      if (route.channel !== this.roomName) return { ok: false, reason: 'room-mismatch' };
      if (resolution.account !== route.fromAccount || resolution.deviceId !== route.fromDevice) return { ok: false, reason: 'committer-mismatch' };
      if (resolution.parts.kind !== 'commit') return { ok: false, reason: 'invalid-commit' };
      const rawBody = resolution.parts.body;
      const record = decodeGroupCommit(rawBody) ?? decodeGroupCommit(new TextDecoder().decode(rawBody));
      if (!record) return { ok: false, reason: 'invalid-commit' };
      if (BigInt(resolution.parts.epoch) !== record.nextEpoch) return { ok: false, reason: 'invalid-commit' };
      const pending = this.pendingWelcomes.get(mapKey(record.commitId));
      if (!pending) return { ok: false, reason: 'welcome-required' };
      if (pending.fromAccount !== route.fromAccount || pending.fromDevice !== route.fromDevice) return { ok: false, reason: 'welcome-target-mismatch' };
      if (pending.epoch !== record.nextEpoch || !equalBytes(pending.membershipDigest, record.membershipDigest)) return { ok: false, reason: 'welcome-mismatch' };
      return this.applyRecord(record, route, undefined, pending.epochKey, signal);
    });
  }

  /**
   * Atomically authenticate and apply one recipient welcome/commit pair.
   *
   * Unlike the compatibility stage/apply methods, this path never leaves the
   * opened epoch key in `pendingWelcomes` when validation or commit admission
   * fails.  The capability is consumed once, a temporary pending entry is
   * installed only inside this mutation lane, and every failure path removes
   * and zeroes that entry before returning.
   */
  async applyVerifiedPair(input: {
    opened: OpenedGroupWelcome;
    welcomeResolution: ResolveResult;
    welcomeRouting: GroupControlRouting;
    commitResolution: ResolveResult;
    commitRouting: GroupControlRouting;
    signal?: AbortSignal;
  }): Promise<GroupSessionApplyResult> {
    return this.withMutation(async () => {
      if (this.destroyed || input.signal?.aborted) return { ok: false, reason: 'destroyed' };
      const snapshot = consumeOpenedGroupWelcome(input.opened);
      if (!snapshot) return { ok: false, reason: 'invalid-welcome' };
      let pendingKey: string | undefined;
      let insertedPending = false;
      try {
        const welcomeResolution = input.welcomeResolution;
        if (welcomeResolution.status !== 'verified' || welcomeResolution.parts.version !== 2
          || welcomeResolution.parts.diagnosticOnly || welcomeResolution.parts.kind !== 'welcome') {
          return { ok: false, reason: 'unverified-control' };
        }
        const welcomeRoute = normalizeGroupControlRouting(input.welcomeRouting);
        if (!welcomeRoute || welcomeRoute.kind !== 'welcome') return { ok: false, reason: 'invalid-commit' };
        if (welcomeRoute.channel !== this.roomName
          || welcomeRoute.toAccount?.trim().toLowerCase() !== this.accountName
          || welcomeRoute.toDevice !== this.deviceName) return { ok: false, reason: 'welcome-target-mismatch' };
        if (welcomeResolution.account !== welcomeRoute.fromAccount || welcomeResolution.deviceId !== welcomeRoute.fromDevice) {
          return { ok: false, reason: 'committer-mismatch' };
        }
        if (snapshot.epoch < 0n || snapshot.commitId.byteLength !== 32 || !nonZero(snapshot.commitId)
          || snapshot.membershipDigest.byteLength !== 32 || !nonZero(snapshot.membershipDigest)
          || snapshot.epochKey.byteLength !== GROUP_SESSION_KEY_BYTES || !nonZero(snapshot.epochKey)
          || snapshot.bodyDigest.byteLength !== 32 || !nonZero(snapshot.bodyDigest)) {
          return { ok: false, reason: 'welcome-target-mismatch' };
        }
        const resolutionBodyDigest = await hashGroupWelcomeBody(welcomeResolution.parts.body);
        if (!resolutionBodyDigest || !equalBytes(snapshot.bodyDigest, resolutionBodyDigest)) {
          resolutionBodyDigest?.fill(0);
          return { ok: false, reason: 'welcome-target-mismatch' };
        }
        resolutionBodyDigest.fill(0);
        if (this.destroyed || input.signal?.aborted) return { ok: false, reason: 'destroyed' };
        const context = buildGroupWelcomeContext({
          room: this.roomName,
          fromAccount: welcomeRoute.fromAccount,
          fromDevice: welcomeRoute.fromDevice,
          toAccount: welcomeRoute.toAccount!,
          toDevice: welcomeRoute.toDevice!,
          epoch: snapshot.epoch,
          commitId: snapshot.commitId,
        });
        if (!context) return { ok: false, reason: 'welcome-target-mismatch' };
        const contextMatches = equalBytes(context, snapshot.context);
        context.fill(0);
        if (!contextMatches) return { ok: false, reason: 'welcome-target-mismatch' };
        if (BigInt(welcomeResolution.parts.epoch) !== snapshot.epoch) return { ok: false, reason: 'welcome-epoch-mismatch' };
        if (snapshot.epoch !== this.currentEpochValue + 1n) return { ok: false, reason: 'welcome-epoch-mismatch' };

        const commitResolution = input.commitResolution;
        if (commitResolution.status !== 'verified' || commitResolution.parts.version !== 2
          || commitResolution.parts.diagnosticOnly || commitResolution.parts.kind !== 'commit') {
          return { ok: false, reason: 'unverified-control' };
        }
        const commitRoute = normalizeGroupControlRouting(input.commitRouting);
        if (!commitRoute || commitRoute.kind !== 'commit' || commitRoute.channel !== this.roomName) {
          return { ok: false, reason: 'invalid-commit' };
        }
        if (commitResolution.account !== commitRoute.fromAccount || commitResolution.deviceId !== commitRoute.fromDevice) {
          return { ok: false, reason: 'committer-mismatch' };
        }
        if (commitRoute.fromAccount !== welcomeRoute.fromAccount || commitRoute.fromDevice !== welcomeRoute.fromDevice) {
          return { ok: false, reason: 'welcome-target-mismatch' };
        }
        const rawBody = commitResolution.parts.body;
        const record = decodeGroupCommit(rawBody) ?? decodeGroupCommit(new TextDecoder().decode(rawBody));
        if (!record || BigInt(commitResolution.parts.epoch) !== record.nextEpoch
          || record.nextEpoch !== snapshot.epoch || !equalBytes(record.commitId, snapshot.commitId)
          || !equalBytes(record.membershipDigest, snapshot.membershipDigest)) {
          return { ok: false, reason: 'welcome-mismatch' };
        }
        const candidatePendingKey = mapKey(record.commitId);
        if (this.pendingWelcomes.has(candidatePendingKey)) return { ok: false, reason: 'welcome-replay' };
        if (this.destroyed || input.signal?.aborted) return { ok: false, reason: 'destroyed' };
        pendingKey = candidatePendingKey;
        this.pendingWelcomes.set(pendingKey, {
          epoch: snapshot.epoch,
          commitId: copy(snapshot.commitId),
          membershipDigest: copy(snapshot.membershipDigest),
          epochKey: copy(snapshot.epochKey),
          context: copy(snapshot.context),
          bodyDigest: copy(snapshot.bodyDigest),
          fromAccount: commitRoute.fromAccount,
          fromDevice: commitRoute.fromDevice,
        });
        insertedPending = true;
        while (this.pendingWelcomes.size > GROUP_SESSION_MAX_PENDING_WELCOMES) {
          const oldest = this.pendingWelcomes.keys().next().value;
          if (oldest === undefined) break;
          this.discardPendingWelcome(oldest);
        }
        return await this.applyRecord(record, commitRoute, undefined, this.pendingWelcomes.get(pendingKey)?.epochKey, input.signal);
      } finally {
        if (insertedPending && pendingKey && this.pendingWelcomes.has(pendingKey)) this.discardPendingWelcome(pendingKey);
        snapshot.commitId.fill(0);
        snapshot.membershipDigest.fill(0);
        snapshot.epochKey.fill(0);
        snapshot.context.fill(0);
        snapshot.bodyDigest.fill(0);
      }
    });
  }

  /** Stage one recipient-targeted welcome; it never advances the epoch. */
  async stageVerifiedWelcome(opened: OpenedGroupWelcome, resolution: ResolveResult, routing: GroupControlRouting, signal?: AbortSignal): Promise<GroupSessionApplyResult> {
    return this.withMutation(async () => {
      if (this.destroyed || signal?.aborted) return { ok: false, reason: 'destroyed' };
      const snapshot = consumeOpenedGroupWelcome(opened);
      if (!snapshot) return { ok: false, reason: 'invalid-welcome' };
      try {
      if (resolution.status !== 'verified' || resolution.parts.version !== 2 || resolution.parts.diagnosticOnly || resolution.parts.kind !== 'welcome') return { ok: false, reason: 'unverified-control' };
      const route = normalizeGroupControlRouting(routing);
      if (!route || route.kind !== 'welcome') return { ok: false, reason: 'invalid-commit' };
      if (route.channel !== this.roomName || route.toAccount?.trim().toLowerCase() !== this.accountName || route.toDevice !== this.deviceName) return { ok: false, reason: 'welcome-target-mismatch' };
      if (resolution.account !== route.fromAccount || resolution.deviceId !== route.fromDevice) return { ok: false, reason: 'committer-mismatch' };
      if (snapshot.epoch < 0n || snapshot.commitId.byteLength !== 32 || !nonZero(snapshot.commitId)
        || snapshot.membershipDigest.byteLength !== 32 || !nonZero(snapshot.membershipDigest)
        || snapshot.epochKey.byteLength !== GROUP_SESSION_KEY_BYTES || !nonZero(snapshot.epochKey)
        || snapshot.bodyDigest.byteLength !== 32 || !nonZero(snapshot.bodyDigest)) return { ok: false, reason: 'welcome-target-mismatch' };
      const resolutionBodyDigest = await hashGroupWelcomeBody(resolution.parts.body);
      if (!resolutionBodyDigest || !equalBytes(snapshot.bodyDigest, resolutionBodyDigest)) {
        resolutionBodyDigest?.fill(0);
        return { ok: false, reason: 'welcome-target-mismatch' };
      }
      resolutionBodyDigest.fill(0);
      if (this.destroyed || signal?.aborted) return { ok: false, reason: 'destroyed' };
      const context = buildGroupWelcomeContext({ room: this.roomName, fromAccount: route.fromAccount, fromDevice: route.fromDevice, toAccount: route.toAccount!, toDevice: route.toDevice!, epoch: snapshot.epoch, commitId: snapshot.commitId });
      if (!context || !equalBytes(context, snapshot.context)) return { ok: false, reason: 'welcome-target-mismatch' };
      if (BigInt(resolution.parts.epoch) !== snapshot.epoch) return { ok: false, reason: 'welcome-epoch-mismatch' };
      if (snapshot.epoch !== this.currentEpochValue + 1n) return { ok: false, reason: 'welcome-epoch-mismatch' };
      const key = mapKey(snapshot.commitId);
      if (this.pendingWelcomes.has(key)) return { ok: false, reason: 'welcome-replay' };
      if (this.destroyed || signal?.aborted) return { ok: false, reason: 'destroyed' };
      this.pendingWelcomes.set(key, {
      epoch: snapshot.epoch,
      commitId: copy(snapshot.commitId),
      membershipDigest: copy(snapshot.membershipDigest),
      epochKey: copy(snapshot.epochKey),
      context: copy(snapshot.context),
      bodyDigest: copy(snapshot.bodyDigest),
      fromAccount: route.fromAccount,
      fromDevice: route.fromDevice,
      });
      while (this.pendingWelcomes.size > GROUP_SESSION_MAX_PENDING_WELCOMES) {
        const oldest = this.pendingWelcomes.keys().next().value;
        if (oldest === undefined) break;
        const entry = this.pendingWelcomes.get(oldest);
        if (entry) {
          entry.commitId.fill(0);
          entry.membershipDigest.fill(0);
          entry.epochKey.fill(0);
          entry.context.fill(0);
          entry.bodyDigest.fill(0);
        }
        this.pendingWelcomes.delete(oldest);
      }
      return { ok: true, epoch: snapshot.epoch, commitHash: copy(this.currentCommitHash), commitId: copy(snapshot.commitId) };
      } finally {
        snapshot.commitId.fill(0);
        snapshot.membershipDigest.fill(0);
        snapshot.epochKey.fill(0);
        snapshot.context.fill(0);
        snapshot.bodyDigest.fill(0);
      }
    });
  }

  /** Destroy state and zero all raw key/digest material. */
  destroy(): void {
    if (this.destroyed) return;
    this.currentKey.fill(0);
    this.currentMembership.fill(0);
    this.currentCommitHash.fill(0);
    zeroizeSeen(this.seenCommits);
    for (const hash of this.seenEpochs.values()) hash.fill(0);
    this.seenEpochs.clear();
    zeroizePending(this.pendingWelcomes);
    this.destroyed = true;
  }
}
