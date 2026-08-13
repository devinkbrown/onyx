// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Packet-B inbound group-control adapter.
 *
 * This is the narrow seam between IRC delivery and the in-memory
 * `GroupSession` state machine.  It intentionally retains only authenticated
 * control bytes while a commit and its target welcome are reordered.  Raw
 * epoch keys are produced by `openGroupWelcome` for one call only and are
 * handed immediately to `GroupSession`; they are never returned or queued.
 */

import type { IRCMessage } from '@/lib/irc/types';

import {
  parseGroupControlDelivery,
  type GroupControlDelivery,
} from './groupControlInbound';
import {
  decodeGroupCommit,
  encodeGroupCommit,
} from './groupCommit';
import {
  consumeOpenedGroupWelcome,
  decodeGroupWelcome,
  openGroupWelcome,
  type OpenedGroupWelcome,
} from './groupWelcome';
import {
  GroupSession,
  type GroupSessionApplyResult,
} from './groupSession';
import {
  resolveTrustedGroupControl,
  type ResolveResult,
  type TrustedGroupSignerDirectory,
  type TrustedGroupSignerStore,
} from './trustedGroupSigner';
import type { GroupControlPayloadParts, GroupControlRouting } from './groupControlPayload';
import {
  collectGroupDeviceDirectorySnapshot,
  type GroupDeviceDirectoryCollector,
  type GroupDeviceDirectorySnapshot,
} from './groupDeviceDirectory';

export const GROUP_CONTROL_ADAPTER_MAX_PENDING = 64;
export const GROUP_CONTROL_ADAPTER_MAX_PENDING_PER_SENDER = 8;

export type GroupControlAdapterStatus = 'ignored' | 'locked' | 'queued' | 'applied' | 'rejected';

/** Reasons deliberately contain no wire/body/key material. */
export type GroupControlAdapterReason =
  | 'malformed-delivery'
  | 'locked-delivery'
  | 'directory-unavailable'
  | 'directory-incomplete'
  | 'trust-failed'
  | 'session-unavailable'
  | 'key-package'
  | 'duplicate'
  | 'equivocation'
  | 'evicted'
  | 'invalid-commit'
  | 'invalid-welcome'
  | 'epoch-gap'
  | 'recipient-key-unavailable'
  | 'welcome-open-failed'
  | 'welcome-stage-failed'
  | 'commit-apply-failed'
  | 'destroyed'
  | 'internal-error';

export type GroupControlAdapterOutcome = {
  status: GroupControlAdapterStatus;
  reason?: GroupControlAdapterReason;
  /** Safe routing metadata only; no payload, key, or plaintext is returned. */
  room?: string;
  fromAccount?: string;
  fromDevice?: string;
  epoch?: number;
};

export type GroupControlSession = Pick<
  GroupSession,
  'room' | 'account' | 'deviceId' | 'stageVerifiedWelcome' | 'applyVerifiedCommit'
> & Partial<Pick<GroupSession, 'applyVerifiedPair'>>;

export type GroupControlDirectory =
  | GroupDeviceDirectorySnapshot
  | TrustedGroupSignerDirectory
  | GroupDeviceDirectoryCollector
  | readonly string[];

export type GroupControlSessionAdapterOptions = {
  /** Resolve the local in-memory room session. */
  sessionForRoom: (room: string) => GroupControlSession | null | undefined | Promise<GroupControlSession | null | undefined>;
  /** Return a complete authenticated ODD1 snapshot for the advertised owner. */
  directoryForAccount: (account: string) => GroupControlDirectory | null | undefined | Promise<GroupControlDirectory | null | undefined>;
  trustedSignerStore: TrustedGroupSignerStore;
  /** Resolve the non-extractable P-256 private key for the local target device. */
  recipientPrivateKeyFor: (account: string, deviceId: string) => CryptoKey | null | undefined | Promise<CryptoKey | null | undefined>;
};

export type GroupControlSessionAdapter = {
  accept(message: IRCMessage | string): Promise<GroupControlAdapterOutcome>;
  destroy(): Promise<void>;
  readonly isDestroyed: boolean;
};

type SafeVerifiedResolution = Extract<ResolveResult, { status: 'verified' }>;

type SafePart = {
  command: GroupControlDelivery['command'];
  routing: GroupControlRouting;
  payload: string;
  parts: GroupControlPayloadParts;
  /** Exact signed body copy. This is control/ciphertext, never a room key. */
  body: Uint8Array;
  resolution: SafeVerifiedResolution;
};

type PendingPair = {
  key: string;
  room: string;
  fromAccount: string;
  fromDevice: string;
  epoch: number;
  sequence: number;
  commit?: SafePart;
  welcome?: SafePart;
};

type CompletedPair = {
  key: string;
  sequence: number;
  commitPayload: string;
  welcomePayload: string;
  outcome: GroupControlAdapterOutcome;
};

type InFlightPair = {
  commitPayload: string;
  welcomePayload: string;
  promise: Promise<GroupControlAdapterOutcome>;
};

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let different = 0;
  for (let index = 0; index < a.byteLength; index += 1) different |= a[index]! ^ b[index]!;
  return different === 0;
}

function canonicalAccount(account: string): string {
  return account.trim().toLowerCase();
}

function safeMetadata(pair: Pick<PendingPair, 'room' | 'fromAccount' | 'fromDevice' | 'epoch'>): Pick<GroupControlAdapterOutcome, 'room' | 'fromAccount' | 'fromDevice' | 'epoch'> {
  return {
    room: pair.room,
    fromAccount: pair.fromAccount,
    fromDevice: pair.fromDevice,
    epoch: pair.epoch,
  };
}

function outcome(
  status: GroupControlAdapterStatus,
  reason?: GroupControlAdapterReason,
  metadata?: Pick<PendingPair, 'room' | 'fromAccount' | 'fromDevice' | 'epoch'>,
): GroupControlAdapterOutcome {
  return {
    status,
    ...(reason ? { reason } : {}),
    ...(metadata ? safeMetadata(metadata) : {}),
  };
}

function zeroResolution(resolution: SafeVerifiedResolution): void {
  resolution.parts.body.fill(0);
  resolution.parts.signerPub.fill(0);
  resolution.parts.signature.fill(0);
  resolution.signer.fill(0);
}

function zeroPart(part: SafePart | undefined): void {
  if (!part) return;
  part.body.fill(0);
  part.parts.body.fill(0);
  part.parts.signerPub.fill(0);
  part.parts.signature.fill(0);
  zeroResolution(part.resolution);
}

function zeroPair(pair: PendingPair | undefined): void {
  if (!pair) return;
  zeroPart(pair.commit);
  zeroPart(pair.welcome);
}

function zeroOpenedWelcome(opened: OpenedGroupWelcome | null): void {
  if (!opened) return;
  opened.commitId.fill(0);
  opened.membershipDigest.fill(0);
  opened.epochKey.fill(0);
  opened.context.fill(0);
  opened.bodyDigest.fill(0);
}

/** Consume any still-live capability and zero both the consumed snapshot and
 * the public frozen object held by the adapter. */
function consumeAndZeroOpenedWelcome(opened: OpenedGroupWelcome | null): void {
  if (!opened) return;
  const consumed = consumeOpenedGroupWelcome(opened);
  zeroOpenedWelcome(consumed);
  zeroOpenedWelcome(opened);
}

function zeroApplyResult(result: GroupSessionApplyResult): void {
  if (!result.ok) return;
  result.commitHash.fill(0);
  result.commitId.fill(0);
}

function copyResolution(resolution: SafeVerifiedResolution): SafeVerifiedResolution {
  return {
    status: 'verified',
    trust: resolution.trust,
    parts: {
      version: resolution.parts.version,
      kind: resolution.parts.kind,
      epoch: resolution.parts.epoch,
      body: copyBytes(resolution.parts.body),
      signerPub: copyBytes(resolution.parts.signerPub),
      signature: copyBytes(resolution.parts.signature),
      ...(resolution.parts.diagnosticOnly ? { diagnosticOnly: true } : {}),
    },
    signer: copyBytes(resolution.signer),
    directoryKey: resolution.directoryKey,
    account: resolution.account,
    deviceId: resolution.deviceId,
  };
}

function isSnapshot(value: unknown): value is GroupDeviceDirectorySnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GroupDeviceDirectorySnapshot>;
  return typeof candidate.account === 'string'
    && Array.isArray(candidate.devices)
    && Array.isArray(candidate.trusted)
    && candidate.bySigner instanceof Map;
}

function isCollector(value: unknown): value is GroupDeviceDirectoryCollector {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GroupDeviceDirectoryCollector>;
  return typeof candidate.complete === 'function' && typeof candidate.finish === 'function';
}

/** A directory callback must return a complete snapshot, never a partial list. */
async function completeDirectory(
  value: GroupControlDirectory | null | undefined,
  account: string,
): Promise<GroupDeviceDirectorySnapshot | TrustedGroupSignerDirectory | null> {
  if (value === null || value === undefined) return null;
  if (isSnapshot(value)) {
    return canonicalAccount(value.account) === account ? value : null;
  }
  if (isCollector(value)) {
    const snapshot = await value.complete();
    return snapshot && canonicalAccount(snapshot.account) === account ? snapshot : null;
  }
  // An array of reply-body lines is accepted only when it contains a complete
  // DEVICE…END collector transcript.  It cannot be mistaken for a directory
  // row list or a partially authenticated snapshot.
  if (Array.isArray(value) && value.every((line) => typeof line === 'string')) {
    const snapshot = await collectGroupDeviceDirectorySnapshot(value);
    return snapshot && canonicalAccount(snapshot.account) === account ? snapshot : null;
  }
  // TrustedGroupSignerDirectory also permits a resolver function or a map. A
  // function is already the complete authenticated lookup seam; maps are
  // accepted as immutable snapshots only by the signer resolver itself.
  return value as TrustedGroupSignerDirectory;
}

function bodyAsText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Decode only canonical OGCMT2 bodies (raw bytes or a canonical b64url body). */
function canonicalCommitBody(body: Uint8Array): boolean {
  const raw = decodeGroupCommit(body);
  if (raw) {
    const encoded = encodeGroupCommit(raw);
    return encoded !== null && equalBytes(encoded, body);
  }
  const text = bodyAsText(body);
  if (!text) return false;
  const decoded = decodeGroupCommit(text);
  return decoded !== null;
}

function canonicalWelcomeWire(body: Uint8Array): string | Uint8Array | null {
  if (decodeGroupWelcome(body)) return copyBytes(body);
  const text = bodyAsText(body);
  return text && decodeGroupWelcome(text) ? text : null;
}

function isCommit(part: SafePart): boolean { return part.command === 'E2EE.COMMIT' && part.routing.kind === 'commit'; }
function isWelcome(part: SafePart): boolean { return part.command === 'E2EE.WELCOME' && part.routing.kind === 'welcome'; }

function pairKey(delivery: GroupControlDelivery): PendingPair {
  const room = delivery.channel;
  const fromAccount = canonicalAccount(delivery.fromAccount);
  const fromDevice = delivery.fromDevice;
  const epoch = delivery.payloadParts?.epoch ?? 0;
  return {
    key: `${room}\u0000${fromAccount}\u0000${fromDevice}\u0000${epoch}`,
    room,
    fromAccount,
    fromDevice,
    epoch,
    sequence: 0,
  };
}

function samePart(existing: SafePart, payload: string): boolean {
  return existing.payload === payload;
}

function controlPart(
  delivery: GroupControlDelivery,
  resolution: SafeVerifiedResolution,
): SafePart {
  return {
    command: delivery.command,
    routing: {
      channel: delivery.channel,
      kind: delivery.kind,
      fromAccount: delivery.fromAccount,
      fromDevice: delivery.fromDevice,
      ...(delivery.kind === 'welcome'
        ? { toAccount: delivery.toAccount, toDevice: delivery.toDevice }
        : {}),
    },
    payload: delivery.payload,
    parts: {
      version: resolution.parts.version,
      kind: resolution.parts.kind,
      epoch: resolution.parts.epoch,
      body: copyBytes(resolution.parts.body),
      signerPub: copyBytes(resolution.parts.signerPub),
      signature: copyBytes(resolution.parts.signature),
      ...(resolution.parts.diagnosticOnly ? { diagnosticOnly: true } : {}),
    },
    body: copyBytes(resolution.parts.body),
    resolution: copyResolution(resolution),
  };
}

/**
 * Build the inbound Packet-B adapter. Every externally visible operation is
 * fail-closed and returns a discriminated outcome instead of throwing.
 */
export function createGroupControlSessionAdapter(
  options: GroupControlSessionAdapterOptions,
): GroupControlSessionAdapter {
  const pending = new Map<string, PendingPair>();
  const completed = new Map<string, CompletedPair>();
  const inFlight = new Map<string, InFlightPair>();
  const activePairs = new Map<string, PendingPair>();
  const lanes = new Map<string, Promise<void>>();
  const abortController = new AbortController();
  let sequence = 0;
  let destroyed = false;
  let destroyPromise: Promise<void> | null = null;

  function removeCompletedOldest(): void {
    while (completed.size > GROUP_CONTROL_ADAPTER_MAX_PENDING) {
      let oldest: CompletedPair | undefined;
      for (const entry of completed.values()) {
        if (!oldest || entry.sequence < oldest.sequence) oldest = entry;
      }
      if (!oldest) break;
      completed.delete(oldest.key);
    }
  }

  function rememberCompleted(
    pair: PendingPair,
    commitPayload: string,
    welcomePayload: string,
    result: GroupControlAdapterOutcome,
  ): void {
    if (destroyed) return;
    completed.set(pair.key, {
      key: pair.key,
      sequence: ++sequence,
      commitPayload,
      welcomePayload,
      outcome: { ...result },
    });
    removeCompletedOldest();
  }

  function zeroPendingEntry(key: string): void {
    const entry = pending.get(key);
    if (!entry) return;
    pending.delete(key);
    zeroPair(entry);
  }

  function allLiveEntries(): Map<string, PendingPair> {
    const entries = new Map<string, PendingPair>();
    for (const entry of pending.values()) entries.set(entry.key, entry);
    for (const entry of activePairs.values()) entries.set(entry.key, entry);
    return entries;
  }

  function senderBucket(pair: Pick<PendingPair, 'fromAccount' | 'fromDevice'>): string {
    return `${pair.fromAccount}\u0000${pair.fromDevice}`;
  }

  function oldestInBucket(bucket: string): PendingPair | undefined {
    let oldest: PendingPair | undefined;
    for (const entry of pending.values()) {
      if (senderBucket(entry) !== bucket) continue;
      if (!oldest || entry.sequence < oldest.sequence) oldest = entry;
    }
    return oldest;
  }

  function oldestPending(): PendingPair | undefined {
    let oldest: PendingPair | undefined;
    for (const entry of pending.values()) {
      if (!oldest || entry.sequence < oldest.sequence) oldest = entry;
    }
    return oldest;
  }

  /**
   * Bound all live pair ownership, not just the reorder map.  Active pairs
   * remain non-evictable while cryptography/session callbacks are running;
   * pending entries are evicted oldest-first, and an admission that cannot fit
   * without evicting an active pair is rejected by the caller.
   */
  function enforceBounds(pair: PendingPair): boolean {
    const bucket = senderBucket(pair);
    while ([...allLiveEntries().values()].filter((entry) => senderBucket(entry) === bucket).length > GROUP_CONTROL_ADAPTER_MAX_PENDING_PER_SENDER) {
      const oldest = oldestInBucket(bucket);
      if (!oldest) return false;
      zeroPendingEntry(oldest.key);
    }
    while (allLiveEntries().size > GROUP_CONTROL_ADAPTER_MAX_PENDING) {
      const oldest = oldestPending();
      if (!oldest) return false;
      zeroPendingEntry(oldest.key);
    }
    return pending.has(pair.key) || activePairs.has(pair.key);
  }

  function appendLane<T>(lane: string, work: () => Promise<T>): Promise<T> {
    const previous = lanes.get(lane) ?? Promise.resolve();
    // Keep only a settled tail promise in the lane map. A gate that waits for
    // the work to release itself would deadlock the first operation; chaining
    // the work directly gives deterministic FIFO admission without a cycle.
    const result = previous.then(work, work);
    const tail = result.then(() => undefined, () => undefined);
    lanes.set(lane, tail);
    void tail.finally(() => {
      if (lanes.get(lane) === tail) lanes.delete(lane);
    });
    return result;
  }

  function mapSessionResult(result: GroupSessionApplyResult, pair: PendingPair): GroupControlAdapterOutcome {
    if (result.ok) return outcome('applied', undefined, pair);
    if (result.reason === 'destroyed' || destroyed) return outcome('ignored', 'destroyed', pair);
    if (result.reason === 'epoch-gap' || result.reason === 'welcome-epoch-mismatch') {
      return outcome('queued', 'epoch-gap', pair);
    }
    if (result.reason === 'invalid-welcome' || result.reason === 'unverified-control'
      || result.reason === 'welcome-target-mismatch' || result.reason === 'welcome-replay'
      || result.reason === 'welcome-mismatch') {
      return outcome('rejected', 'welcome-stage-failed', pair);
    }
    return outcome('rejected', 'commit-apply-failed', pair);
  }

  async function processPair(pair: PendingPair): Promise<GroupControlAdapterOutcome> {
    const metadata = safeMetadata(pair);
    if (destroyed) return outcome('ignored', 'destroyed', pair);
    const commit = pair.commit;
    const welcome = pair.welcome;
    if (!commit || !welcome || !isCommit(commit) || !isWelcome(welcome)) {
      return { status: 'rejected', reason: 'internal-error', ...metadata };
    }
    let session: GroupControlSession | null | undefined;
    try {
      session = await options.sessionForRoom(pair.room);
    } catch {
      return outcome('locked', 'session-unavailable', pair);
    }
    if (!session) return outcome('locked', 'session-unavailable', pair);
    if (destroyed) return outcome('ignored', 'destroyed', pair);
    if (typeof session.account === 'string' && typeof session.deviceId === 'string') {
      const targetAccount = canonicalAccount(welcome.routing.toAccount ?? '');
      if (targetAccount !== canonicalAccount(session.account) || welcome.routing.toDevice !== session.deviceId) {
        return outcome('rejected', 'welcome-stage-failed', pair);
      }
    }

    const welcomeWire = canonicalWelcomeWire(welcome.body);
    if (!welcomeWire) return outcome('rejected', 'invalid-welcome', pair);
    let recipientPrivateKey: CryptoKey | null | undefined;
    try {
      recipientPrivateKey = await options.recipientPrivateKeyFor(
        canonicalAccount(welcome.routing.toAccount ?? ''),
        welcome.routing.toDevice ?? '',
      );
    } catch {
      return outcome('locked', 'recipient-key-unavailable', pair);
    }
    if (!recipientPrivateKey) return outcome('locked', 'recipient-key-unavailable', pair);
    if (destroyed) return outcome('ignored', 'destroyed', pair);

    const commitRecord = decodeCommitRecord(commit.body);
    if (!commitRecord) return outcome('rejected', 'invalid-commit', pair);
    let opened: OpenedGroupWelcome | null;
    try {
      opened = await openGroupWelcome({
        wire: welcomeWire,
        room: pair.room,
        fromAccount: welcome.routing.fromAccount,
        fromDevice: welcome.routing.fromDevice,
        toAccount: welcome.routing.toAccount ?? '',
        toDevice: welcome.routing.toDevice ?? '',
        epoch: pair.epoch,
        commitId: commitRecord.commitId,
        membershipDigest: commitRecord.membershipDigest,
        recipientPrivateKey,
        resolution: welcome.resolution,
      });
    } catch {
      opened = null;
    } finally {
      commitRecord.priorCommitHash.fill(0);
      commitRecord.commitId.fill(0);
      commitRecord.membershipDigest.fill(0);
      commitRecord.newEpochKeyCommitment.fill(0);
      if (welcomeWire instanceof Uint8Array) welcomeWire.fill(0);
    }
    if (!opened) return destroyed
      ? outcome('ignored', 'destroyed', pair)
      : outcome('rejected', 'welcome-open-failed', pair);
    if (destroyed) {
      consumeAndZeroOpenedWelcome(opened);
      return outcome('ignored', 'destroyed', pair);
    }
    try {
      if (session.applyVerifiedPair) {
        const applied = await session.applyVerifiedPair({
          opened,
          welcomeResolution: welcome.resolution,
          welcomeRouting: welcome.routing,
          commitResolution: commit.resolution,
          commitRouting: commit.routing,
          signal: abortController.signal,
        });
        const result = mapSessionResult(applied, pair);
        zeroApplyResult(applied);
        return result;
      }

      // Compatibility seam for narrow test/session doubles. Production
      // GroupSession instances expose applyVerifiedPair above, which makes
      // stage+apply one transaction and removes any pending welcome on error.
      let staged: GroupSessionApplyResult;
      try {
        staged = await session.stageVerifiedWelcome(opened, welcome.resolution, welcome.routing, abortController.signal);
      } catch {
        return destroyed
          ? outcome('ignored', 'destroyed', pair)
          : outcome('rejected', 'welcome-stage-failed', pair);
      }
      if (!staged.ok) {
        const result = staged.reason === 'destroyed' || destroyed
          ? outcome('ignored', 'destroyed', pair)
          : outcome('rejected', 'welcome-stage-failed', pair);
        zeroApplyResult(staged);
        return result;
      }
      zeroApplyResult(staged);
      if (destroyed) return outcome('ignored', 'destroyed', pair);
      const applied = await session.applyVerifiedCommit(commit.resolution, commit.routing, abortController.signal);
      const result = mapSessionResult(applied, pair);
      zeroApplyResult(applied);
      return result;
    } catch {
      return destroyed
        ? outcome('ignored', 'destroyed', pair)
        : outcome('rejected', 'commit-apply-failed', pair);
    } finally {
      consumeAndZeroOpenedWelcome(opened);
    }
  }

  function shouldRetry(result: GroupControlAdapterOutcome): boolean {
    if (destroyed) return false;
    if (result.status === 'locked') {
      return result.reason === 'session-unavailable' || result.reason === 'recipient-key-unavailable';
    }
    if (result.status === 'queued' && result.reason === 'epoch-gap') return true;
    // A session callback can fail after the welcome has opened (for example a
    // transient mutation-lane fault). Do not poison the completed cache; keep
    // the authenticated pair bounded and retry it on the next exact duplicate.
    return result.status === 'rejected'
      && (result.reason === 'welcome-stage-failed' || result.reason === 'commit-apply-failed');
  }

  function memoizeResult(result: GroupControlAdapterOutcome): boolean {
    if (result.status === 'applied') return true;
    if (result.status !== 'rejected') return false;
    return result.reason !== 'welcome-stage-failed' && result.reason !== 'commit-apply-failed';
  }

  function requeuePair(pair: PendingPair): boolean {
    if (destroyed) return false;
    pending.set(pair.key, pair);
    if (!enforceBounds(pair)) {
      if (pending.get(pair.key) === pair) pending.delete(pair.key);
      return false;
    }
    return pending.get(pair.key) === pair;
  }

  async function launchPair(entry: PendingPair): Promise<GroupControlAdapterOutcome> {
    pending.delete(entry.key);
    const readyCommit = entry.commit;
    const readyWelcome = entry.welcome;
    if (!readyCommit || !readyWelcome) {
      zeroPair(entry);
      return outcome('rejected', 'internal-error', entry);
    }
    const pairPromise = appendLane(entry.room, async () => processPair(entry))
      .catch(() => outcome('rejected', 'internal-error', entry));
    inFlight.set(entry.key, {
      commitPayload: readyCommit.payload,
      welcomePayload: readyWelcome.payload,
      promise: pairPromise,
    });
    activePairs.set(entry.key, entry);
    let retained = false;
    try {
      const result = await pairPromise;
      if (destroyed) return outcome('ignored', 'destroyed', entry);
      if (shouldRetry(result)) retained = requeuePair(entry);
      if (!retained && memoizeResult(result)) {
        rememberCompleted(entry, readyCommit.payload, readyWelcome.payload, result);
      }
      return result;
    } finally {
      inFlight.delete(entry.key);
      activePairs.delete(entry.key);
      if (!retained) zeroPair(entry);
    }
  }

  function sameCompletedPart(entry: CompletedPair, part: SafePart): boolean {
    return isCommit(part) ? entry.commitPayload === part.payload : entry.welcomePayload === part.payload;
  }

  async function accept(message: IRCMessage | string): Promise<GroupControlAdapterOutcome> {
    if (destroyed) return outcome('ignored', 'destroyed');
    let delivery: GroupControlDelivery | null;
    try {
      delivery = parseGroupControlDelivery(message);
    } catch {
      return outcome('ignored', 'malformed-delivery');
    }
    if (!delivery) return outcome('ignored', 'malformed-delivery');
    const initial = pairKey(delivery);
    if (delivery.locked || !delivery.payloadParts || delivery.payloadParts.version !== 2) {
      return outcome('locked', 'locked-delivery', initial);
    }

    let directory: GroupControlDirectory | null | undefined;
    try {
      directory = await options.directoryForAccount(delivery.fromAccount);
    } catch {
      return outcome('locked', 'directory-unavailable', initial);
    }
    if (destroyed) return outcome('ignored', 'destroyed', initial);
    let complete: GroupDeviceDirectorySnapshot | TrustedGroupSignerDirectory | null;
    try {
      complete = await completeDirectory(directory, canonicalAccount(delivery.fromAccount));
    } catch {
      return outcome('locked', 'directory-incomplete', initial);
    }
    if (destroyed) return outcome('ignored', 'destroyed', initial);
    if (!complete) return outcome('locked', 'directory-incomplete', initial);

    let resolution: ResolveResult;
    try {
      resolution = await resolveTrustedGroupControl({
        account: delivery.fromAccount,
        deviceId: delivery.fromDevice,
        payload: delivery.payload,
        routing: delivery,
        delivery: {
          payload: delivery.payload,
          routing: delivery,
          locked: delivery.locked,
          lockReason: delivery.lockReason,
        },
        directory: complete,
        store: options.trustedSignerStore,
      });
    } catch {
      return outcome('locked', 'trust-failed', initial);
    }
    if (destroyed) {
      if (resolution.status === 'verified') zeroResolution(resolution);
      return outcome('ignored', 'destroyed', initial);
    }
    if (resolution.status !== 'verified') return outcome('locked', 'trust-failed', initial);
    if (resolution.parts.version !== 2 || resolution.parts.diagnosticOnly) {
      zeroResolution(resolution);
      return outcome('locked', 'locked-delivery', initial);
    }
    if (resolution.parts.kind !== delivery.kind) {
      zeroResolution(resolution);
      return outcome('locked', 'trust-failed', initial);
    }

    // KEYPACKAGE is authenticated for provenance but deliberately does not
    // mutate a room session or enter the reorder queue.
    if (delivery.command === 'E2EE.KEYPACKAGE') {
      zeroResolution(resolution);
      return outcome('ignored', 'key-package', initial);
    }

    if (delivery.command === 'E2EE.COMMIT' && !canonicalCommitBody(resolution.parts.body)) {
      zeroResolution(resolution);
      return outcome('rejected', 'invalid-commit', initial);
    }
    if (delivery.command === 'E2EE.COMMIT') {
      const record = decodeCommitRecord(resolution.parts.body);
      const epochMatches = record !== null && record.nextEpoch === BigInt(resolution.parts.epoch);
      if (record) {
        record.priorCommitHash.fill(0);
        record.commitId.fill(0);
        record.membershipDigest.fill(0);
        record.newEpochKeyCommitment.fill(0);
      }
      if (!epochMatches) {
        zeroResolution(resolution);
        return outcome('rejected', 'invalid-commit', initial);
      }
    }

    const pair = pairKey(delivery);
    const part = controlPart(delivery, resolution);
    zeroResolution(resolution);
    const currentInFlight = inFlight.get(pair.key);
    if (currentInFlight) {
      const expected = isCommit(part) ? currentInFlight.commitPayload : currentInFlight.welcomePayload;
      if (expected !== part.payload) {
        zeroPart(part);
        return outcome('rejected', 'equivocation', pair);
      }
      zeroPart(part);
      await currentInFlight.promise;
      return destroyed ? outcome('ignored', 'destroyed', pair) : outcome('ignored', 'duplicate', pair);
    }
    const completedEntry = completed.get(pair.key);
    if (completedEntry) {
      const matches = sameCompletedPart(completedEntry, part);
      zeroPart(part);
      return matches
        ? outcome('ignored', 'duplicate', pair)
        : outcome('rejected', 'equivocation', pair);
    }
    let entry = pending.get(pair.key);
    if (!entry) {
      entry = { ...pair, sequence: ++sequence };
      pending.set(pair.key, entry);
    }
    const slot = isCommit(part) ? 'commit' : 'welcome';
    const existing = entry[slot];
    if (existing) {
      if (!samePart(existing, part.payload)) {
        zeroPart(part);
        return outcome('rejected', 'equivocation', pair);
      }
      zeroPart(part);
      if (entry.commit && entry.welcome && !inFlight.has(entry.key)) return launchPair(entry);
      return outcome('ignored', 'duplicate', pair);
    }
    entry[slot] = part;
    if (!entry.commit || !entry.welcome) {
      const retained = enforceBounds(entry);
      return retained
        ? outcome('queued', undefined, pair)
        : outcome('ignored', 'evicted', pair);
    }
    if (!enforceBounds(entry) || pending.get(entry.key) !== entry) {
      if (pending.get(entry.key) === entry) zeroPendingEntry(entry.key);
      return outcome('ignored', 'evicted', pair);
    }
    return launchPair(entry);
  }

  async function destroy(): Promise<void> {
    if (destroyPromise) return destroyPromise;
    destroyed = true;
    abortController.abort();
    for (const entry of pending.values()) zeroPair(entry);
    pending.clear();
    const activePromises = [...inFlight.values()].map((entry) => entry.promise);
    const lanePromises = [...lanes.values()];
    destroyPromise = (async () => {
      await Promise.allSettled([...activePromises, ...lanePromises]);
      // No active cryptographic/session callback can still be using these
      // arrays after both the pair promises and lane tails settle.
      for (const entry of activePairs.values()) zeroPair(entry);
      activePairs.clear();
      inFlight.clear();
      completed.clear();
      lanes.clear();
    })();
    return destroyPromise;
  }

  return {
    accept,
    destroy,
    get isDestroyed(): boolean { return destroyed; },
  };
}

function decodeCommitRecord(body: Uint8Array) {
  const raw = decodeGroupCommit(body);
  if (raw) {
    const encoded = encodeGroupCommit(raw);
    return encoded && equalBytes(encoded, body) ? raw : null;
  }
  const text = bodyAsText(body);
  return text ? decodeGroupCommit(text) : null;
}
