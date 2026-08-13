// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * External trust boundary for OGC1 signer keys.
 *
 * The envelope's signer_pub is only a discovery field.  This module resolves
 * it against an authenticated, owner-scoped ODD1 directory and pins the first
 * accepted key in an injectable durable store.  A per-owner promise lane makes
 * first-use pinning linearizable: two simultaneous candidates cannot both be
 * accepted, and a changed/deleted/storage-failed key is always locked.
 */

import { fromB64url, toB64url } from './dmCipher';
import {
  GROUP_DEVICE_DIRECTORY_ALGORITHM,
  decodeGroupDeviceDirectoryEntry,
  deriveGroupDeviceId,
  type GroupDeviceDirectorySnapshot,
} from './groupDeviceDirectory';
import {
  parseGroupControlPayload,
  verifyGroupControlPayload,
  type GroupControlPayloadParts,
  type GroupControlRouting,
} from './groupControlPayload';

export type TrustedGroupSignerPin = {
  account: string;
  deviceId: string;
  signerPub: string;
  /** Tombstone used to distinguish deliberate deletion from first use. */
  deleted?: boolean;
};

export interface TrustedGroupSignerStore {
  get(account: string, deviceId: string): Promise<TrustedGroupSignerPin | null>;
  put(pin: TrustedGroupSignerPin): Promise<void>;
  delete?(account: string, deviceId: string): Promise<void>;
}

export type TrustedGroupDirectoryValue = {
  account: string;
  deviceId: string;
  algorithm?: string;
  publicKey?: string;
  directoryKey?: string | null;
  trusted?: boolean;
  legacy?: boolean;
  entry?: { signerPub: Uint8Array } | null;
  /** Convenience for test/injected directories that carry the raw signer. */
  signerPub?: Uint8Array;
};

export type TrustedGroupSignerDirectory =
  | GroupDeviceDirectorySnapshot
  | ReadonlyMap<string, TrustedGroupDirectoryValue>
  | readonly TrustedGroupDirectoryValue[]
  | ((account: string, deviceId: string, wireSigner: string) =>
      TrustedGroupDirectoryValue | null | Promise<TrustedGroupDirectoryValue | null>);

export type ResolveTrustedGroupControlInput = {
  account: string;
  deviceId: string;
  /** Wire signer_pub, raw bytes or canonical base64url. */
  wireSigner?: Uint8Array | string;
  /** OGC1 v2 payload and exact delivery routing. Required for trust pinning. */
  payload?: string;
  wirePayload?: string;
  routing?: GroupControlRouting;
  delivery?: {
    payload: string;
    routing?: GroupControlRouting;
    /** Parsed inbound records may carry an explicit locked diagnostic state. */
    locked?: boolean;
    lockReason?: 'missing-account' | 'legacy-ogc1' | 'bad-payload';
  } & Partial<GroupControlRouting>;
  directory: TrustedGroupSignerDirectory;
  store: TrustedGroupSignerStore;
};

export type ResolveResult =
  | {
      status: 'verified';
      trust: 'first-use' | 'pinned';
      parts: GroupControlPayloadParts;
      signer: Uint8Array;
      directoryKey: string;
      account: string;
      deviceId: string;
    }
  | {
      status: 'locked';
      reason:
        | 'missing-account'
        | 'incomplete-directory'
        | 'device-absent'
        | 'unsupported-algorithm'
        | 'bad-directory-entry'
        | 'signer-mismatch'
        | 'bad-signature'
        | 'key-changed'
        | 'trust-store-unavailable'
        | 'legacy-ogc1';
      account?: string;
      deviceId?: string;
    };

function canonicalAccount(account: string): string | null {
  if (typeof account !== 'string') return null;
  const normalized = account.trim().toLowerCase();
  return /^[a-z0-9_.@-]{1,64}$/u.test(normalized) ? normalized : null;
}

function validDeviceId(deviceId: string): boolean {
  return /^[A-Za-z0-9_.-]{1,32}$/u.test(deviceId);
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function wireSignerBytes(wireSigner: Uint8Array | string): { raw: Uint8Array; b64: string } | null {
  const raw = typeof wireSigner === 'string'
    ? fromB64url(wireSigner)
    : new Uint8Array(wireSigner);
  if (!raw || raw.byteLength !== 32) return null;
  const b64 = toB64url(raw);
  if (typeof wireSigner === 'string' && b64 !== wireSigner) return null;
  return { raw, b64 };
}

function rowSignerB64(row: TrustedGroupDirectoryValue): string | null {
  if (row.directoryKey) return row.directoryKey;
  if (row.signerPub?.byteLength === 32) return toB64url(row.signerPub);
  if (row.entry?.signerPub.byteLength === 32) return toB64url(row.entry.signerPub);
  return null;
}

type DirectoryLookup = {
  row: TrustedGroupDirectoryValue | null;
  ownerSeen: boolean;
};

async function lookupDirectory(
  directory: TrustedGroupSignerDirectory,
  account: string,
  deviceId: string,
  wireSigner: string,
): Promise<DirectoryLookup> {
  if (typeof directory === 'function') {
    return { row: await directory(account, deviceId, wireSigner), ownerSeen: false };
  }

  let row: TrustedGroupDirectoryValue | undefined;
  let ownerSeen: boolean;
  if ('bySigner' in directory) {
    row = directory.bySigner.get(wireSigner) as TrustedGroupDirectoryValue | undefined;
    ownerSeen = [...directory.bySigner.values()].some((candidate) =>
      canonicalAccount(candidate.account) === account && candidate.deviceId === deviceId,
    );
  } else if (directory instanceof Map) {
    // The key is intentionally the exact wire signer, never device id.
    row = directory.get(wireSigner);
    ownerSeen = [...directory.values()].some((candidate) =>
      canonicalAccount(candidate.account) === account && candidate.deviceId === deviceId,
    );
  } else if (Array.isArray(directory)) {
    row = directory.find((candidate) => rowSignerB64(candidate) === wireSigner);
    ownerSeen = directory.some((candidate) =>
      canonicalAccount(candidate.account) === account && candidate.deviceId === deviceId,
    );
  } else {
    return { row: null, ownerSeen: false };
  }
  if (!row) return { row: null, ownerSeen };
  const rowKey = rowSignerB64(row);
  if (rowKey !== wireSigner) return { row: null, ownerSeen: true };
  if (canonicalAccount(row.account) !== account || row.deviceId !== deviceId) {
    return { row: null, ownerSeen };
  }
  return { row, ownerSeen: true };
}

const pinQueues = new Map<string, Promise<void>>();

function routingFromDelivery(
  delivery: ResolveTrustedGroupControlInput['delivery'],
): GroupControlRouting | null {
  if (!delivery) return null;
  if (delivery.routing) return delivery.routing;
  if (!delivery.channel || !delivery.kind || !delivery.fromAccount || !delivery.fromDevice) return null;
  if (delivery.kind === 'welcome') {
    if (!delivery.toAccount || !delivery.toDevice) return null;
    return {
      channel: delivery.channel,
      kind: delivery.kind,
      fromAccount: delivery.fromAccount,
      fromDevice: delivery.fromDevice,
      toAccount: delivery.toAccount,
      toDevice: delivery.toDevice,
    };
  }
  return {
    channel: delivery.channel,
    kind: delivery.kind,
    fromAccount: delivery.fromAccount,
    fromDevice: delivery.fromDevice,
  };
}

async function withOwnerLane<T>(owner: string, work: () => Promise<T>): Promise<T> {
  const previous = pinQueues.get(owner) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const current = previous.then(() => gate, () => gate);
  pinQueues.set(owner, current);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (pinQueues.get(owner) === current) pinQueues.delete(owner);
  }
}

/** Resolve and first-use-pin one externally trusted group signer. */
export async function resolveTrustedGroupControl(
  input: ResolveTrustedGroupControlInput,
): Promise<ResolveResult> {
  const account = canonicalAccount(input.account);
  const deviceId = input.deviceId;
  if (!account) return { status: 'locked', reason: 'missing-account' };
  if (!validDeviceId(deviceId)) return { status: 'locked', reason: 'device-absent', account, deviceId };

  const payload = input.delivery?.payload ?? input.payload ?? input.wirePayload;
  const routing = input.delivery ? routingFromDelivery(input.delivery) : input.routing;
  if (input.delivery?.locked) {
    const reason = input.delivery.lockReason;
    return {
      status: 'locked',
      reason: reason === 'missing-account'
        ? 'missing-account'
        : reason === 'legacy-ogc1'
          ? 'legacy-ogc1'
          : 'bad-signature',
      account,
      deviceId,
    };
  }
  const parsed = payload ? parseGroupControlPayload(payload) : null;
  if (!parsed) return { status: 'locked', reason: 'bad-signature', account, deviceId };
  if (parsed.diagnosticOnly || parsed.version !== 2) {
    return { status: 'locked', reason: 'legacy-ogc1', account, deviceId };
  }
  if (!routing) return { status: 'locked', reason: 'bad-signature', account, deviceId };
  const route = routing;
  if (canonicalAccount(route.fromAccount) !== account || route.fromDevice !== deviceId) {
    return { status: 'locked', reason: 'signer-mismatch', account, deviceId };
  }
  const wire = wireSignerBytes(input.wireSigner ?? parsed.signerPub);
  if (!wire) return { status: 'locked', reason: 'bad-directory-entry', account, deviceId };
  if (!equalBytes(parsed.signerPub, wire.raw)) {
    return { status: 'locked', reason: 'signer-mismatch', account, deviceId };
  }

  const owner = `${account}\u0000${deviceId}`;
  return withOwnerLane(owner, async () => {
    let lookup: DirectoryLookup;
    try {
      lookup = await lookupDirectory(input.directory, account, deviceId, wire.b64);
    } catch {
      return { status: 'locked', reason: 'trust-store-unavailable', account, deviceId };
    }
    const directoryRow = lookup.row;
    if (!directoryRow) {
      return {
        status: 'locked',
        reason: lookup.ownerSeen ? 'signer-mismatch' : 'device-absent',
        account,
        deviceId,
      };
    }
    if (directoryRow.algorithm !== GROUP_DEVICE_DIRECTORY_ALGORITHM) {
      return { status: 'locked', reason: 'unsupported-algorithm', account, deviceId };
    }
    if (directoryRow.legacy) {
      return { status: 'locked', reason: 'unsupported-algorithm', account, deviceId };
    }
    if (directoryRow.trusted !== true) {
      return { status: 'locked', reason: 'bad-directory-entry', account, deviceId };
    }
    const directoryEntry = directoryRow.publicKey
      ? decodeGroupDeviceDirectoryEntry(directoryRow.publicKey)
      : null;
    if (!directoryEntry || toB64url(directoryEntry.signerPub) !== wire.b64) {
      return { status: 'locked', reason: 'bad-directory-entry', account, deviceId };
    }
    const derivedDeviceId = await deriveGroupDeviceId(directoryEntry);
    if (derivedDeviceId !== deviceId) {
      return { status: 'locked', reason: 'bad-directory-entry', account, deviceId };
    }
    const directoryKey = rowSignerB64(directoryRow);
    if (directoryKey !== wire.b64) return { status: 'locked', reason: 'signer-mismatch', account, deviceId };

    // Signature verification happens before any first-use write. This keeps a
    // malformed or replayed payload from poisoning the local owner pin.
    const verifiedParts = await verifyGroupControlPayload(payload!, route, wire.raw);
    if (!verifiedParts) return { status: 'locked', reason: 'bad-signature', account, deviceId };

    let pin: TrustedGroupSignerPin | null;
    try {
      pin = await input.store.get(account, deviceId);
    } catch {
      return { status: 'locked', reason: 'trust-store-unavailable', account, deviceId };
    }
    if (pin?.deleted) return { status: 'locked', reason: 'device-absent', account, deviceId };
    if (pin) {
      const pinned = fromB64url(pin.signerPub);
      if (!pinned || toB64url(pinned) !== pin.signerPub || !equalBytes(pinned, wire.raw)) {
        return { status: 'locked', reason: 'key-changed', account, deviceId };
      }
      return {
        status: 'verified',
        trust: 'pinned',
        parts: verifiedParts,
        signer: wire.raw,
        directoryKey: wire.b64,
        account,
        deviceId,
      };
    }

    try {
      await input.store.put({ account, deviceId, signerPub: wire.b64 });
    } catch {
      return { status: 'locked', reason: 'trust-store-unavailable', account, deviceId };
    }
    return {
      status: 'verified',
      trust: 'first-use',
      parts: verifiedParts,
      signer: wire.raw,
      directoryKey: wire.b64,
      account,
      deviceId,
    };
  });
}

/** Small in-memory store used by focused tests and embedders with their own IDB seam. */
export function createInMemoryTrustedGroupSignerStore(options: { delayMs?: number } = {}): TrustedGroupSignerStore {
  const pins = new Map<string, TrustedGroupSignerPin>();
  const delay = Math.max(0, Math.floor(options.delayMs ?? 0));
  const wait = async () => {
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
  };
  const key = (account: string, deviceId: string) => `${account}\u0000${deviceId}`;
  return {
    async get(account, deviceId) {
      await wait();
      const pin = pins.get(key(account, deviceId));
      return pin ? { ...pin } : null;
    },
    async put(pin) {
      await wait();
      pins.set(key(pin.account, pin.deviceId), { ...pin });
    },
    async delete(account, deviceId) {
      await wait();
      const current = pins.get(key(account, deviceId));
      pins.set(key(account, deviceId), {
        account,
        deviceId,
        signerPub: current?.signerPub ?? '',
        deleted: true,
      });
    },
  };
}
