// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Connection/account-owned publication of the canonical ODD1 public record.
 *
 * This owner never creates a group session, exports private key material, or
 * treats a successful write as message-encryption activation. Its public state
 * deliberately omits the canonical directory bytes carried on the wire.
 */

import {
  projectGroupDeviceIdentity,
  type GroupDeviceIdentity,
} from './groupDeviceIdentity';
import {
  decodeGroupDeviceDirectoryEntry,
  deriveGroupDeviceId,
  GROUP_DEVICE_DIRECTORY_ALGORITHM,
} from './groupDeviceDirectory';

const ACCOUNT_RE = /^[a-z0-9_.@-]{1,64}$/u;
const CONFIRM_RE = /^E2EEKEY ADDED id=([A-Za-z0-9_.-]{1,32}) alg=([A-Za-z0-9_.-]{1,64})$/u;
const TRANSIENT_FAILURES = new Set([
  'DURABLE_UNAVAILABLE',
  'STORE_FAILED',
  'TEMPORARILY_UNAVAILABLE',
]);

export type GroupDevicePublicationStatus = 'inactive' | 'projecting' | 'sent' | 'server-ack-observed';
export type GroupDevicePublicationFailure =
  | 'projection-unavailable'
  | 'send-failed'
  | 'server-transient'
  | 'server-rejected';

export type GroupDevicePublicationState = Readonly<{
  status: GroupDevicePublicationStatus;
  generation: number;
  connectionGeneration: number;
  endpoint: string;
  clientId: string;
  account: string | null;
  deviceId: string | null;
  attempts: 0 | 1 | 2;
  failure: GroupDevicePublicationFailure | null;
}>;

export type GroupDevicePublisherSender = Readonly<{
  sendRaw(command: string, ...params: string[]): boolean;
}>;

export type GroupDevicePublisherOptions = Readonly<{
  sender: GroupDevicePublisherSender;
  endpoint: string;
  clientId: string;
  account?: string | null;
  projectIdentity?: () => Promise<GroupDeviceIdentity | null>;
  retryDelayMs?: number;
}>;

export type GroupDevicePublisher = Readonly<{
  state: GroupDevicePublicationState;
  getState(): GroupDevicePublicationState;
  setAuthenticatedAccount(account: string | null): Promise<boolean>;
  onConnected(): Promise<boolean>;
  onRegistered(): Promise<boolean>;
  onDisconnected(): void;
  onVaultReset(): Promise<boolean>;
  observeTrustedServerBody(body: string): boolean;
  observeTrustedFailure(code: string): boolean;
  destroy(): void;
}>;

type PrivatePublication = Readonly<{
  generation: number;
  connectionGeneration: number;
  endpoint: string;
  clientId: string;
  account: string;
  deviceId: string;
  directory: string;
}>;

function canonicalAccount(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return ACCOUNT_RE.test(normalized) ? normalized : null;
}

function clampRetryDelay(value: number | undefined): number {
  if (value === undefined) return 2_000;
  return Number.isFinite(value) ? Math.max(0, Math.min(30_000, Math.trunc(value))) : 2_000;
}

export function createGroupDevicePublisher(options: GroupDevicePublisherOptions): GroupDevicePublisher {
  const endpoint = options.endpoint.trim();
  const clientId = options.clientId.trim();
  const projectIdentity = options.projectIdentity ?? (() => projectGroupDeviceIdentity());
  const retryDelayMs = clampRetryDelay(options.retryDelayMs);

  let generation = 0;
  let connectionGeneration = 0;
  let account = canonicalAccount(options.account);
  let connected = false;
  let registered = false;
  let destroyed = false;
  let work: { generation: number; promise: Promise<boolean> } | null = null;
  let pending: PrivatePublication | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stateValue: GroupDevicePublicationState = {
    status: 'inactive',
    generation,
    connectionGeneration,
    endpoint,
    clientId,
    account,
    deviceId: null,
    attempts: 0,
    failure: null,
  };

  const setState = (next: Partial<GroupDevicePublicationState>): void => {
    stateValue = Object.freeze({ ...stateValue, ...next });
  };

  const clearRetry = (): void => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const invalidate = (): void => {
    generation += 1;
    clearRetry();
    work = null;
    pending = null;
    setState({
      status: 'inactive',
      generation,
      connectionGeneration,
      account,
      deviceId: null,
      attempts: 0,
      failure: null,
    });
  };

  const owns = (publication: PrivatePublication): boolean => Boolean(
    !destroyed
    && connected
    && registered
    && publication.generation === generation
    && publication.connectionGeneration === connectionGeneration
    && publication.endpoint === endpoint
    && publication.clientId === clientId
    && publication.account === account,
  );

  const scheduleRetry = (publication: PrivatePublication): void => {
    if (!owns(publication) || stateValue.attempts >= 2 || retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void attemptSend(publication);
    }, retryDelayMs);
  };

  const attemptSend = async (publication: PrivatePublication): Promise<boolean> => {
    if (!owns(publication) || pending !== publication || stateValue.attempts >= 2) return false;
    const attempts = (stateValue.attempts + 1) as 1 | 2;
    const sent = (() => {
      try {
        return options.sender.sendRaw(
          'E2EEKEY',
          'ADD',
          publication.deviceId,
          GROUP_DEVICE_DIRECTORY_ALGORITHM,
          publication.directory,
        );
      } catch {
        return false;
      }
    })();
    if (!owns(publication) || pending !== publication) return false;
    setState({
      status: sent ? 'sent' : 'inactive',
      deviceId: publication.deviceId,
      attempts,
      failure: sent ? null : 'send-failed',
    });
    if (attempts < 2) scheduleRetry(publication);
    return sent;
  };

  const start = (): Promise<boolean> => {
    if (destroyed || !connected || !registered || !account) return Promise.resolve(false);
    if (pending && owns(pending)) {
      return Promise.resolve(
        stateValue.status === 'sent' || stateValue.status === 'server-ack-observed',
      );
    }
    if (stateValue.failure === 'server-rejected') {
      return Promise.resolve(false);
    }
    if (stateValue.status === 'sent' || stateValue.status === 'server-ack-observed') return Promise.resolve(true);
    if (work?.generation === generation) return work.promise;
    const ownerGeneration = generation;
    setState({ status: 'projecting', deviceId: null, attempts: 0, failure: null });
    const promise = (async () => {
      const identity = await (async () => {
        try {
          return await projectIdentity();
        } catch {
          return null;
        }
      })();
      if (destroyed || ownerGeneration !== generation || !connected || !registered || !account) return false;
      const entry = identity ? decodeGroupDeviceDirectoryEntry(identity.directory) : null;
      const derivedId = entry ? await deriveGroupDeviceId(entry) : null;
      if (
        !identity
        || !entry
        || !derivedId
        || derivedId !== identity.deviceId
        || ownerGeneration !== generation
      ) {
        if (ownerGeneration === generation) {
          setState({ status: 'inactive', deviceId: null, attempts: 0, failure: 'projection-unavailable' });
        }
        return false;
      }
      const publication: PrivatePublication = {
        generation: ownerGeneration,
        connectionGeneration,
        endpoint,
        clientId,
        account,
        deviceId: identity.deviceId,
        directory: identity.directory,
      };
      if (!owns(publication)) return false;
      pending = publication;
      return attemptSend(publication);
    })();
    work = { generation: ownerGeneration, promise };
    void promise.finally(() => {
      if (work?.generation === ownerGeneration) work = null;
    });
    return promise;
  };

  const publisher: GroupDevicePublisher = {
    get state() { return stateValue; },
    getState: () => stateValue,
    setAuthenticatedAccount(nextAccount) {
      if (destroyed) return Promise.resolve(false);
      const next = canonicalAccount(nextAccount);
      if (next !== account) {
        account = next;
        invalidate();
      }
      return start();
    },
    onConnected() {
      if (destroyed) return Promise.resolve(false);
      if (!connected) {
        connected = true;
        registered = false;
        connectionGeneration += 1;
        invalidate();
      }
      return start();
    },
    onRegistered() {
      if (destroyed || !connected) return Promise.resolve(false);
      registered = true;
      return start();
    },
    onDisconnected() {
      if (destroyed || (!connected && !registered)) return;
      connected = false;
      registered = false;
      connectionGeneration += 1;
      invalidate();
    },
    onVaultReset() {
      if (destroyed) return Promise.resolve(false);
      invalidate();
      return start();
    },
    observeTrustedServerBody(body) {
      if (destroyed || !pending || stateValue.status !== 'sent' || !owns(pending)) return false;
      const match = CONFIRM_RE.exec(body.trim());
      if (
        !match
        || match[1] !== pending.deviceId
        || match[2] !== GROUP_DEVICE_DIRECTORY_ALGORITHM
      ) return false;
      // ADDED has no response correlation, account, connection generation, or
      // directory digest. It proves only that the trusted server emitted an
      // acknowledgement for this device id and algorithm at some point; never
      // present it as confirmation of this publication owner/generation.
      clearRetry();
      setState({ status: 'server-ack-observed', failure: null });
      return true;
    },
    observeTrustedFailure(code) {
      if (destroyed || !pending || stateValue.status !== 'sent' || !owns(pending)) return false;
      const normalized = code.trim().toUpperCase();
      clearRetry();
      if (TRANSIENT_FAILURES.has(normalized) && stateValue.attempts < 2) {
        setState({ status: 'inactive', failure: 'server-transient' });
        scheduleRetry(pending);
      } else {
        pending = null;
        setState({ status: 'inactive', failure: 'server-rejected' });
      }
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      connected = false;
      registered = false;
      invalidate();
    },
  };
  return publisher;
}
