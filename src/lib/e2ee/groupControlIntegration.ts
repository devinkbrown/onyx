// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Packet-C client owner for the OGC control plane.
 *
 * This module deliberately owns transport/lifecycle plumbing only. It does
 * not modify the store or IRC client, create GroupSession instances, persist
 * room keys, decrypt messages, or turn a verified control into message
 * encryption. A caller must provide the durable trusted-signer store; when it
 * is absent the runtime remains fail-closed in `recovery-required`.
 */

import type { IRCEventHandler } from '@/lib/irc/client';
import type { IRCMessage } from '@/lib/irc/types';
import { subscribeVerifiedDeviceHistoryClear } from '@/lib/vault/historyVault';

import {
  GroupDirectoryBroker,
  groupDirectoryListParameters,
  type GroupDirectoryBrokerResult,
} from './groupDirectoryBroker';
import {
  createGroupControlRuntime,
  type GroupControlRuntime,
  type GroupControlRuntimeIdentity,
  type GroupControlRuntimeOutcome,
  type GroupControlRuntimeState,
} from './groupControlRuntime';
import { deviceKeys } from './dmCipher';
import {
  projectGroupDeviceIdentity,
  type GroupDeviceIdentity,
} from './groupDeviceIdentity';
import type { TrustedGroupSignerStore } from './trustedGroupSigner';

/** The small public portion of IRCClient needed by this lifecycle owner. */
export type GroupControlIntegrationClient = {
  extraMessageHandlers: Set<IRCEventHandler>;
  sendRaw: (command: string, ...params: string[]) => boolean;
  sendCurrentEpochWelcomeRequest?: (
    room: string,
    epoch: number,
    account: string,
    deviceId: string,
    payload: string,
  ) => boolean;
};

export type GroupControlIntegrationIdentity = Readonly<{
  /** Authenticated account from the store/server; never inferred from nick. */
  account?: string | null;
  /** Existing ODD1 projection's device id. */
  deviceId?: string | null;
}>;

export type GroupControlIntegrationOptions = Readonly<{
  client: GroupControlIntegrationClient;
  /** Exact WebSocket URL, including any path/query used by the client. */
  endpoint: string;
  /** Optional deterministic test/client identifier. Production uses a nonce. */
  clientId?: string;
  identity?: GroupControlIntegrationIdentity | null;
  /** Returns current authoritative account/device ownership. */
  identityFor?: () => GroupControlIntegrationIdentity | null | Promise<GroupControlIntegrationIdentity | null>;
  /** Optional projection source; default uses the existing ODD1 identities. */
  deviceIdentityFor?: () => Pick<GroupDeviceIdentity, 'deviceId'> | null | Promise<Pick<GroupDeviceIdentity, 'deviceId'> | null>;
  /** Required in production: endpoint/local-owner-scoped durable signer pins. */
  trustedSignerStore?: TrustedGroupSignerStore | (() => TrustedGroupSignerStore | null | undefined);
  /** Optional local P-256 recipient-key resolver. */
  recipientPrivateKeyFor?: (
    account: string,
    deviceId: string,
  ) => CryptoKey | null | undefined | Promise<CryptoKey | null | undefined>;
  /** Transport truth supplied by the store/client owner. */
  isConnected?: () => boolean;
  connected?: boolean;
  now?: () => number;
  /** Attach the feature hook immediately (the default). */
  autoAttach?: boolean;
  /** Safe outcome observer; receives routing/status metadata only. */
  onOutcome?: (outcome: GroupControlRuntimeOutcome) => void;
}>;

export type GroupControlIntegrationState = Readonly<{
  /** Monotonic owner transition token; no wire payloads are included. */
  generation: number;
  /** Monotonic broker generation paired with resetGeneration(). */
  directoryGeneration: number;
  clientId: string;
  endpoint: string;
  connected: boolean;
  attached: boolean;
  trustedSignerConfigured: boolean;
  runtime: GroupControlRuntimeState | null;
}>;

export type GroupControlIntegration = {
  readonly client: GroupControlIntegrationClient;
  readonly clientId: string;
  readonly endpoint: string;
  readonly runtime: GroupControlRuntime | null;
  readonly state: GroupControlIntegrationState;
  readonly initialization: Promise<boolean>;
  readonly directoryGeneration: number;
  readonly isDestroyed: boolean;
  getState(): GroupControlIntegrationState;
  subscribe(listener: (state: GroupControlIntegrationState) => void): () => void;
  attach(): Promise<void>;
  detach(): Promise<void>;
  refreshIdentity(): Promise<boolean>;
  setIdentity(identity: GroupControlIntegrationIdentity | null): Promise<boolean>;
  onConnected(): Promise<boolean>;
  onDisconnected(): void;
  reconnect(): void;
  markRecovered(): boolean;
  requestCurrentEpochWelcome(room: string, payload: string): Promise<{ ok: true; room: string; epoch: number } | { ok: false; reason: string }>;
  accept(message: IRCMessage | string): Promise<GroupControlRuntimeOutcome>;
  acceptControl(message: IRCMessage | string): Promise<GroupControlRuntimeOutcome>;
  ingest(message: IRCMessage | string): Promise<GroupControlRuntimeOutcome>;
  requestDirectory(account: string, signal?: AbortSignal): Promise<GroupDirectoryBrokerResult>;
  /** Observe a body only after the caller has authenticated a pure-server reply. */
  observeAuthenticatedDirectoryBody(body: string, generation?: number): boolean;
  /** Strict pure-server NOTICE dispatcher used by the attached IRC hook. */
  observeServerReply(message: IRCMessage, generation?: number): boolean;
  onRoomPart(room: string): void;
  onRoomKick(room: string): void;
  onVaultReset(): Promise<void>;
  destroy(): Promise<void>;
};

const OGC_COMMANDS = new Set(['E2EE.KEYPACKAGE', 'E2EE.COMMIT', 'E2EE.WELCOME']);
const ACCOUNT_RE = /^[a-z0-9_.@-]{1,64}$/u;
const TEST_MODE = import.meta.env.MODE === 'test';
let fallbackClientSequence = 0;

function canonicalAccount(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return ACCOUNT_RE.test(normalized) ? normalized : null;
}

function canonicalEndpoint(value: string): string {
  return value.trim();
}

function createClientId(): string {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Fall through to a process-local nonce when Web Crypto UUID is absent.
  }
  fallbackClientSequence += 1;
  return `ogc-client-${fallbackClientSequence.toString(36)}`;
}

function isChannelTarget(value: string | undefined): boolean {
  return typeof value === 'string' && /^[#&]/u.test(value);
}

function isCanonicalPayload(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,8192}$/u.test(value);
}

function isPureServerDirectoryNotice(message: IRCMessage): boolean {
  if (message.command.toUpperCase() !== 'NOTICE') return false;
  if (message.nick !== null || message.prefix === null) return false;
  const target = message.params[0];
  const body = message.params[1];
  if (!target || isChannelTarget(target) || typeof body !== 'string' || body.startsWith('\x01')) return false;
  return true;
}

function rawCommand(message: IRCMessage): string {
  const parsed = message.command.trim().toUpperCase();
  if (parsed) return parsed;
  // Dotted verbs intentionally arrive with command="" from parseIRCMessage.
  // This scanner is only an admission hint; payload parsing remains in the
  // runtime and inbound parser, so no raw body is copied into state.
  const line = message.raw.replace(/\r?\n$/u, '');
  const withoutTags = line.startsWith('@') ? line.slice(line.indexOf(' ') + 1) : line;
  const withoutPrefix = withoutTags.startsWith(':') ? withoutTags.slice(withoutTags.indexOf(' ') + 1) : withoutTags;
  return (withoutPrefix.split(/\s+/u, 1)[0] ?? '').toUpperCase();
}

function isGroupControlMessage(message: IRCMessage): boolean {
  return OGC_COMMANDS.has(rawCommand(message));
}

function sameIdentity(
  left: GroupControlRuntimeState['identity'] | null,
  right: GroupControlRuntimeIdentity | null,
  clientId: string,
  endpoint: string,
): boolean {
  if (!left || !right) return false;
  return left.clientId === clientId
    && left.endpoint === endpoint
    && left.account === canonicalAccount(right.account)
    && left.deviceId === (right.deviceId ?? null);
}

/**
 * Construct a client-bound OGC lifecycle owner. Construction is side-effect
 * limited to attaching the auxiliary message handler and subscribing to the
 * verified-vault-clear notification; all state is held in safe snapshots.
 */
export function createGroupControlIntegration(
  options: GroupControlIntegrationOptions,
): GroupControlIntegration {
  const client = options.client;
  const endpoint = canonicalEndpoint(options.endpoint);
  const clientId = options.clientId?.trim() || createClientId();
  const listeners = new Set<(state: GroupControlIntegrationState) => void>();

  let destroyed = false;
  let attached = false;
  let wantsAttached = options.autoAttach !== false;
  let connected = options.connected ?? false;
  if (options.isConnected) {
    try { connected = options.isConnected(); } catch { connected = false; }
  }
  let generation = 0;
  let directoryGeneration = 0;
  let handlerToken = 0;
  let identityRequestToken = 0;
  let resolvingIdentityRequestToken: number | null = null;
  let transition: Promise<void> = Promise.resolve();
  let runtimeValue: GroupControlRuntime | null = null;
  let runtimeUnsubscribe: (() => void) | null = null;
  let destroyPromise: Promise<void> | null = null;
  let deviceProjectionPromise: Promise<Pick<GroupDeviceIdentity, 'deviceId'> | null> | null = null;
  let vaultUnsubscribe: (() => void) | null = null;
  /** Number of integration-owned broker waiters by the broker generation they captured. */
  const directoryWaiters = new Map<number, number>();
  /** A shared broker slot can resolve many waiter promises with one timeout. */
  const mirroredTimeoutGenerations = new Map<number, { generationAfter: number; wasCurrent: boolean }>();

  const runtimeIdentity = (input: GroupControlIntegrationIdentity | null): GroupControlRuntimeIdentity => ({
    clientId,
    endpoint,
    account: canonicalAccount(input?.account),
    deviceId: input?.deviceId ?? null,
  });

  const projectDevice = async (): Promise<Pick<GroupDeviceIdentity, 'deviceId'> | null> => {
    if (!deviceProjectionPromise) {
      deviceProjectionPromise = (async () => {
        try {
          const value = options.deviceIdentityFor
            ? await options.deviceIdentityFor()
            : await projectGroupDeviceIdentity();
          if (!value) return null;
          // A custom projection intentionally exposes only the id. The rest of
          // the identity is never needed by this owner.
          return { deviceId: value.deviceId };
        } catch {
          return null;
        }
      })();
    }
    return deviceProjectionPromise;
  };

  const identitySource = async (
    supplied?: GroupControlIntegrationIdentity | null,
  ): Promise<GroupControlIntegrationIdentity | null> => {
    let source: GroupControlIntegrationIdentity | null | undefined = supplied;
    if (supplied === undefined) {
      if (options.identityFor) {
        try {
          source = await options.identityFor();
        } catch {
          return null;
        }
      } else {
        source = options.identity ?? null;
      }
    }
    return source ?? null;
  };

  const resolveIdentity = async (
    supplied?: GroupControlIntegrationIdentity | null,
  ): Promise<GroupControlIntegrationIdentity | null> => {
    const source = await identitySource(supplied);
    if (source === null) return null;
    const account = source?.account ?? null;
    let deviceId = source?.deviceId;
    if (account && deviceId === undefined) {
      const projection = await projectDevice();
      deviceId = projection?.deviceId ?? null;
    }
    return { account, deviceId: deviceId ?? null };
  };

  const localRecipientPrivateKeyFor = async (
    _account: string,
    deviceId: string,
  ): Promise<CryptoKey | null> => {
    if (options.recipientPrivateKeyFor) {
      try {
        return (await options.recipientPrivateKeyFor(_account, deviceId)) ?? null;
      } catch {
        return null;
      }
    }
    // The default resolver may only return the already-existing DM key when
    // its public projection yields the requested ODD1 id. It never creates a
    // second key or exports a private key as bytes.
    try {
      const projection = await projectDevice();
      if (!projection || projection.deviceId !== deviceId) return null;
      const keys = await deviceKeys();
      return keys?.keyPair.privateKey ?? null;
    } catch {
      return null;
    }
  };

  const broker = new GroupDirectoryBroker({
    now: options.now,
    sendList: (account) => {
      const params = groupDirectoryListParameters(account);
      if (!params) return false;
      try {
        return client.sendRaw('E2EEKEY', ...params);
      } catch {
        return false;
      }
    },
  });

  function resetDirectoryGeneration(): void {
    broker.resetGeneration();
    directoryGeneration += 1;
  }

  function retainDirectoryWaiter(generationAtRequest: number): void {
    directoryWaiters.set(generationAtRequest, (directoryWaiters.get(generationAtRequest) ?? 0) + 1);
  }

  function releaseDirectoryWaiter(generationAtRequest: number): void {
    const remaining = (directoryWaiters.get(generationAtRequest) ?? 1) - 1;
    if (remaining > 0) directoryWaiters.set(generationAtRequest, remaining);
    else directoryWaiters.delete(generationAtRequest);
  }

  /**
   * GroupDirectoryBroker owns its generation and increments it internally on
   * an active timeout. The timeout result is the authenticated signal that its
   * private generation advanced; mirror exactly one increment, without adding
   * a permanent offset or issuing a second reset.
   */
  function mirrorBrokerTimeout(generationAtRequest: number): boolean {
    const prior = mirroredTimeoutGenerations.get(generationAtRequest);
    const timeoutIsCurrent = prior
      ? prior.wasCurrent && directoryGeneration === prior.generationAfter
      : generationAtRequest === directoryGeneration;
    if (!prior) {
      directoryGeneration += 1;
      mirroredTimeoutGenerations.set(generationAtRequest, {
        generationAfter: directoryGeneration,
        wasCurrent: timeoutIsCurrent,
      });
    }
    // A shared broker slot can resolve many continuations. The final
    // continuation has already released its waiter count before reaching this
    // function, so it is safe to retire the idempotence marker now. This keeps
    // long-lived clients bounded without allowing the preceding continuation
    // to trigger a second increment.
    if ((directoryWaiters.get(generationAtRequest) ?? 0) === 0) {
      mirroredTimeoutGenerations.delete(generationAtRequest);
    }
    return timeoutIsCurrent;
  }

  function currentConnected(): boolean {
    if (options.isConnected) {
      try { return options.isConnected(); } catch { return false; }
    }
    return connected;
  }

  function directoryRequest(account: string, signal: AbortSignal): Promise<GroupDirectoryBrokerResult> {
    const requestedGeneration = directoryGeneration;
    retainDirectoryWaiter(requestedGeneration);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseDirectoryWaiter(requestedGeneration);
    };
    const onAbort = () => {
      release();
      // If every integration-owned waiter for this generation has aborted,
      // retire the broker's physical slot now. Otherwise another caller still
      // owns the serialized LIST and must be allowed to receive its END.
      if (
        requestedGeneration === directoryGeneration
        && (directoryWaiters.get(requestedGeneration) ?? 0) === 0
      ) resetDirectoryGeneration();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    return broker.request(account, signal).then((result) => {
      signal.removeEventListener('abort', onAbort);
      release();
      if (destroyed) return { ok: false, reason: 'stale-generation' };
      const timeout = !result.ok && result.reason === 'timeout';
      const timeoutIsCurrent = timeout ? mirrorBrokerTimeout(requestedGeneration) : false;
      if (timeout && timeoutIsCurrent) return result;
      if (requestedGeneration !== directoryGeneration) return { ok: false, reason: 'stale-generation' };
      return result;
    });
  }

  function makeRuntime(identity: GroupControlIntegrationIdentity | null): GroupControlRuntime {
    const runtime = createGroupControlRuntime({
      identity: runtimeIdentity(identity),
      trustedSignerStore: options.trustedSignerStore,
      recipientPrivateKeyFor: localRecipientPrivateKeyFor,
      now: options.now,
      transport: {
        isConnected: currentConnected,
        requestDirectory: async (account, signal) => {
          const result = await directoryRequest(account, signal);
          return result.ok ? result.snapshot : null;
        },
        requestCurrentEpochWelcome: async (room, epoch, account, deviceId, payload) => {
          if (!isCanonicalPayload(payload)) return false;
          if (typeof client.sendCurrentEpochWelcomeRequest === 'function') {
            try {
              return client.sendCurrentEpochWelcomeRequest(room, epoch, account, deviceId, payload) === true;
            } catch {
              return false;
            }
          }
          try {
            return client.sendRaw('E2EEGROUP', room, 'key-package', deviceId, payload) === true;
          } catch {
            return false;
          }
        },
      },
    });
    runtimeUnsubscribe?.();
    runtimeUnsubscribe = runtime.subscribe(() => emit());
    runtimeValue = runtime;
    return runtime;
  }

  function runtimeSnapshot(): GroupControlRuntimeState | null {
    return runtimeValue?.getState() ?? null;
  }

  function snapshot(): GroupControlIntegrationState {
    return {
      generation,
      directoryGeneration,
      clientId,
      endpoint,
      connected: currentConnected(),
      attached,
      trustedSignerConfigured: Boolean(options.trustedSignerStore),
      runtime: runtimeSnapshot(),
    };
  }

  function emit(): void {
    if (destroyed) return;
    const next = snapshot();
    for (const listener of [...listeners]) {
      try { listener(next); } catch { listeners.delete(listener); }
    }
  }

  function notifyOutcome(outcome: GroupControlRuntimeOutcome): void {
    try { options.onOutcome?.(outcome); } catch { /* observers cannot alter lifecycle */ }
  }

  function attachHandler(): void {
    if (destroyed || attached || !wantsAttached) return;
    const token = ++handlerToken;
    const handler: IRCEventHandler = (message) => {
      if (destroyed || !attached || token !== handlerToken) return;
      if (isPureServerDirectoryNotice(message)) void observeServerReply(message, directoryGeneration);
      if (isGroupControlMessage(message)) {
        const runtimeAtDispatch = runtimeValue;
        const ownerToken = generation;
        if (!runtimeAtDispatch) return;
        if (resolvingIdentityRequestToken !== null) {
          notifyOutcome({
            status: 'locked',
            reason: 'identity-pending',
            generation: runtimeAtDispatch.generation,
          });
          emit();
          return;
        }
        void runtimeAtDispatch.accept(message).then((result) => {
          if (destroyed || ownerToken !== generation || runtimeValue !== runtimeAtDispatch) return;
          notifyOutcome(result);
          emit();
        }).catch(() => undefined);
      }
    };
    // Keep the exact function for removal; no client monkey-patching is used.
    activeHandler = handler;
    client.extraMessageHandlers.add(handler);
    attached = true;
    emit();
  }

  function removeHandler(): void {
    handlerToken += 1;
    if (activeHandler) client.extraMessageHandlers.delete(activeHandler);
    activeHandler = null;
    attached = false;
    emit();
  }

  async function waitForRuntimeRevive(runtime: GroupControlRuntime, token: number): Promise<boolean> {
    if (!runtime.isDetached) return runtimeValue === runtime && token === generation;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let unsubscribe: () => void = () => undefined;
      const timer = setTimeout(() => finish(false), 5_000);
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(value);
      };
      unsubscribe = runtime.subscribe(() => {
        if (!runtime.isDetached) finish(runtimeValue === runtime && token === generation);
      });
      if (!runtime.isDetached) finish(runtimeValue === runtime && token === generation);
    });
  }

  async function switchRuntime(
    nextIdentity: GroupControlIntegrationIdentity | null,
    force = false,
    identityToken?: number,
  ): Promise<boolean> {
    if (destroyed) return false;
    const current = runtimeValue;
    if (
      !force
      && current
      && !current.isDestroyed
      && sameIdentity(current.getState().identity, runtimeIdentity(nextIdentity), clientId, endpoint)
    ) return true;
    generation += 1;
    const token = generation;
    resetDirectoryGeneration();
    removeHandler();
    if (current) await current.destroy();
    if (
      destroyed
      || token !== generation
      || (identityToken !== undefined && identityToken !== identityRequestToken)
    ) return false;
    runtimeUnsubscribe?.();
    runtimeUnsubscribe = null;
    runtimeValue = makeRuntime(nextIdentity);
    if (wantsAttached && currentConnected()) attachHandler();
    emit();
    return true;
  }

  function queueTransition(work: () => Promise<void>): Promise<void> {
    const next = transition.then(work, work);
    transition = next.catch(() => undefined);
    return next;
  }

  let activeHandler: IRCEventHandler | null = null;

  // Start with the caller's exact tuple (or an intentionally pending tuple),
  // then resolve account/device asynchronously without exposing key material.
  runtimeValue = makeRuntime(options.identity ?? null);
  if (wantsAttached) attachHandler();
  vaultUnsubscribe = subscribeVerifiedDeviceHistoryClear(() => {
    void onVaultReset();
  });

  async function applyIdentitySource(
    source: GroupControlIntegrationIdentity | null,
    requestToken: number,
  ): Promise<boolean> {
    const account = canonicalAccount(source?.account);
    const requiresProjection = Boolean(account) && source?.deviceId === undefined;
    let result = false;

    // A trusted account change whose local device still needs projection must
    // stop using the previous complete tuple immediately. The pending tuple
    // keeps both direct and attached control admission fail-closed while the
    // asynchronous ODD1 projection runs outside the serialized transition
    // queue. A newer identity command can therefore overtake this lookup.
    if (requiresProjection) {
      await queueTransition(async () => {
        if (destroyed || requestToken !== identityRequestToken) return;
        result = await switchRuntime({ account, deviceId: null }, false, requestToken);
      });
      if (destroyed || requestToken !== identityRequestToken) {
        if (resolvingIdentityRequestToken === requestToken) resolvingIdentityRequestToken = null;
        return false;
      }
    }

    const resolved = requiresProjection ? await resolveIdentity(source) : source;
    if (destroyed || requestToken !== identityRequestToken) {
      if (resolvingIdentityRequestToken === requestToken) resolvingIdentityRequestToken = null;
      return false;
    }
    await queueTransition(async () => {
      if (destroyed || requestToken !== identityRequestToken) return;
      result = await switchRuntime(resolved, false, requestToken);
    });
    if (resolvingIdentityRequestToken === requestToken) resolvingIdentityRequestToken = null;
    return result;
  }

  async function refreshIdentity(): Promise<boolean> {
    const requestToken = ++identityRequestToken;
    resolvingIdentityRequestToken = requestToken;
    deviceProjectionPromise = null;
    const source = await identitySource();
    if (destroyed || requestToken !== identityRequestToken) {
      if (resolvingIdentityRequestToken === requestToken) resolvingIdentityRequestToken = null;
      return false;
    }
    return applyIdentitySource(source, requestToken);
  }

  async function setIdentity(next: GroupControlIntegrationIdentity | null): Promise<boolean> {
    const requestToken = ++identityRequestToken;
    resolvingIdentityRequestToken = requestToken;
    deviceProjectionPromise = null;
    return applyIdentitySource(next, requestToken);
  }

  async function attach(): Promise<void> {
    if (destroyed) return;
    wantsAttached = true;
    attachHandler();
    const runtime = runtimeValue;
    if (runtime?.isDetached) {
      runtime.reconnect();
      await waitForRuntimeRevive(runtime, generation);
      if (runtimeValue === runtime && connected) runtime.markRecovered();
    }
    emit();
  }

  async function detach(): Promise<void> {
    if (destroyed) return;
    wantsAttached = false;
    removeHandler();
    resetDirectoryGeneration();
    const runtime = runtimeValue;
    if (runtime) await runtime.detach();
    emit();
  }

  async function onConnected(): Promise<boolean> {
    if (destroyed) return false;
    connected = true;
    if (wantsAttached) attachHandler();
    const runtime = runtimeValue;
    if (!runtime) return false;
    if (runtime.isDetached) {
      runtime.reconnect();
      await waitForRuntimeRevive(runtime, generation);
    }
    const recovered = runtimeValue === runtime && runtime.markRecovered();
    emit();
    return recovered || runtime.state.lifecycle === 'ready';
  }

  function onDisconnected(): void {
    if (destroyed) return;
    identityRequestToken += 1;
    resolvingIdentityRequestToken = null;
    deviceProjectionPromise = null;
    connected = false;
    resetDirectoryGeneration();
    removeHandler();
    runtimeValue?.reconnect();
    emit();
  }

  function reconnect(): void {
    onDisconnected();
  }

  function markRecovered(): boolean {
    if (destroyed || !runtimeValue) return false;
    const result = runtimeValue.markRecovered();
    emit();
    return result;
  }

  async function requestCurrentEpochWelcome(
    room: string,
    payload: string,
  ): Promise<{ ok: true; room: string; epoch: number } | { ok: false; reason: string }> {
    if (destroyed || !runtimeValue) return { ok: false, reason: 'runtime-inactive' };
    if (!isCanonicalPayload(payload)) return { ok: false, reason: 'payload-invalid' };
    const result = await runtimeValue.requestCurrentEpochWelcome(room, payload);
    emit();
    return result;
  }

  async function accept(message: IRCMessage | string): Promise<GroupControlRuntimeOutcome> {
    const runtime = runtimeValue;
    const token = generation;
    if (destroyed || !runtime) return { status: 'ignored', reason: 'runtime-inactive', generation: token };
    if (resolvingIdentityRequestToken !== null) {
      return { status: 'locked', reason: 'identity-pending', generation: runtime.generation };
    }
    const result = await runtime.accept(message);
    if (destroyed || token !== generation || runtimeValue !== runtime) {
      return { status: 'ignored', reason: 'runtime-inactive', generation: runtimeValue?.generation ?? result.generation };
    }
    emit();
    notifyOutcome(result);
    return result;
  }

  function requestDirectory(account: string, signal?: AbortSignal): Promise<GroupDirectoryBrokerResult> {
    if (destroyed) return Promise.resolve({ ok: false, reason: 'stale-generation' });
    return directoryRequest(account, signal ?? new AbortController().signal);
  }

  function observeAuthenticatedDirectoryBody(body: string, replyGeneration = directoryGeneration): boolean {
    if (destroyed || replyGeneration !== directoryGeneration) return false;
    return broker.observeServerReply(replyGeneration, body);
  }

  function observeServerReply(message: IRCMessage, replyGeneration = directoryGeneration): boolean {
    if (destroyed || replyGeneration !== directoryGeneration || !isPureServerDirectoryNotice(message)) return false;
    const body = message.params[1];
    return typeof body === 'string' ? observeAuthenticatedDirectoryBody(body, replyGeneration) : false;
  }

  function onRoomPart(room: string): void {
    runtimeValue?.onRoomPart(room);
  }

  function onRoomKick(room: string): void {
    runtimeValue?.onRoomKick(room);
  }

  async function onVaultReset(): Promise<void> {
    if (destroyed) return;
    identityRequestToken += 1;
    resolvingIdentityRequestToken = null;
    deviceProjectionPromise = null;
    await queueTransition(async () => {
      if (destroyed) return;
      const currentIdentity = runtimeValue?.getState().identity;
      const next: GroupControlIntegrationIdentity | null = currentIdentity
        ? { account: currentIdentity.account, deviceId: currentIdentity.deviceId }
        : null;
      await switchRuntime(next, true);
    });
  }

  async function destroy(): Promise<void> {
    if (destroyPromise) return destroyPromise;
    destroyed = true;
    identityRequestToken += 1;
    resolvingIdentityRequestToken = null;
    wantsAttached = false;
    removeHandler();
    resetDirectoryGeneration();
    vaultUnsubscribe?.();
    vaultUnsubscribe = null;
    runtimeUnsubscribe?.();
    runtimeUnsubscribe = null;
    const pendingTransition = transition;
    destroyPromise = (async () => {
      await pendingTransition.catch(() => undefined);
      const runtime = runtimeValue;
      if (runtime) await runtime.destroy();
      runtimeValue = null;
      mirroredTimeoutGenerations.clear();
      listeners.clear();
    })();
    return destroyPromise;
  }

  const initialization = refreshIdentity();
  const integration: GroupControlIntegration = {
    client,
    clientId,
    endpoint,
    get runtime(): GroupControlRuntime | null { return runtimeValue; },
    get state(): GroupControlIntegrationState { return snapshot(); },
    initialization,
    get directoryGeneration(): number { return directoryGeneration; },
    get isDestroyed(): boolean { return destroyed; },
    getState: snapshot,
    subscribe(listener) {
      if (destroyed) return () => undefined;
      listeners.add(listener);
      try { listener(snapshot()); } catch { listeners.delete(listener); }
      return () => listeners.delete(listener);
    },
    attach,
    detach,
    refreshIdentity,
    setIdentity,
    onConnected,
    onDisconnected,
    reconnect,
    markRecovered,
    requestCurrentEpochWelcome,
    accept,
    acceptControl: accept,
    ingest: accept,
    requestDirectory,
    observeAuthenticatedDirectoryBody,
    observeServerReply,
    onRoomPart,
    onRoomKick,
    onVaultReset,
    destroy,
  };

  // Vitest-only, non-enumerable hygiene probe. Vite replaces MODE for builds,
  // so production integrations have no introspection property at runtime.
  if (TEST_MODE) {
    Object.defineProperty(integration, '__testProbe', {
      configurable: false,
      enumerable: false,
      value: () => ({
        mirroredTimeoutGenerations: mirroredTimeoutGenerations.size,
        directoryWaiterGenerations: directoryWaiters.size,
      }),
    });
  }
  return integration;
}

export const attachGroupControlIntegration = createGroupControlIntegration;
