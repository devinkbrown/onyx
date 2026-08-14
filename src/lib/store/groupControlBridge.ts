// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Store-owned lifecycle bridge for inbound group-control observation.
 *
 * The mutable integration never enters Zustand.  This owner publishes only the
 * runtime's safe metadata snapshot and deliberately keeps activation held.
 */

import type { IRCMessage } from '@/lib/irc/types';
import {
  createGroupControlIntegration,
  type GroupControlIntegration,
  type GroupControlIntegrationClient,
  type GroupControlIntegrationOptions,
} from '@/lib/e2ee/groupControlIntegration';
import type { GroupControlRuntimeOpenResult, GroupControlRuntimeSealResult, GroupControlRuntimeState } from '@/lib/e2ee/groupControlRuntime';
import {
  createGroupDevicePublisher,
  type GroupDevicePublisher,
  type GroupDevicePublisherOptions,
} from '@/lib/e2ee/groupDevicePublisher';
import {
  createTrustedGroupSignerStore,
  type TrustedGroupSignerStoreScope,
} from '@/lib/e2ee/trustedGroupSignerStore';
import type { TrustedGroupSignerStore } from '@/lib/e2ee/trustedGroupSigner';
import { subscribeVerifiedDeviceHistoryClear } from '@/lib/vault/historyVault';

const ACCOUNT = /^[a-z0-9_.@-]{1,64}$/u;
const GROUP_CONTROL_COMMANDS = new Set([
  'E2EE.KEYPACKAGE',
  'E2EE.COMMIT',
  'E2EE.WELCOME',
]);

type IntegrationFactory = (options: GroupControlIntegrationOptions) => GroupControlIntegration;
type SignerStoreFactory = (scope: TrustedGroupSignerStoreScope) => TrustedGroupSignerStore;
type PublisherFactory = (options: GroupDevicePublisherOptions) => GroupDevicePublisher;
type VaultResetSubscribe = (listener: () => void) => () => void;

export type GroupControlBridgeOptions = Readonly<{
  client: GroupControlIntegrationClient;
  endpoint: string;
  /** Current authenticated account proof. Nicknames are never accepted here. */
  authenticatedAccount: () => string | null;
  isConnected: () => boolean;
  /** Exact owner-token/client check supplied by the store. */
  isCurrent: () => boolean;
  publish: (runtime: GroupControlRuntimeState | null) => void;
  /** Focused-test seams; production always uses the accepted implementations. */
  integrationFactory?: IntegrationFactory;
  signerStoreFactory?: SignerStoreFactory;
  publisherFactory?: PublisherFactory;
  vaultResetSubscribe?: VaultResetSubscribe;
}>;

export type GroupControlBridge = Readonly<{
  client: GroupControlIntegrationClient;
  endpoint: string;
  start(): void;
  onConnected(): void;
  onDisconnected(): void;
  onRegistered(message: IRCMessage): boolean;
  refreshAuthenticatedAccount(): Promise<boolean>;
  setAuthenticatedAccount(account: string | null): Promise<boolean>;
  onRoomPart(room: string): void;
  onRoomKick(room: string): void;
  sealRoomMessage(room: string, plaintext: string): Promise<GroupControlRuntimeSealResult>;
  openRoomMessage(room: string, envelope: string): Promise<GroupControlRuntimeOpenResult>;
  destroy(): Promise<void>;
}>;

function canonicalAccount(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return ACCOUNT.test(normalized) ? normalized : null;
}

function rawCommand(message: IRCMessage): string {
  if (message.command) return message.command.toUpperCase();
  const line = message.raw.replaceAll('\0', '').replace(/\r?\n$/u, '');
  let cursor = line;
  if (cursor.startsWith('@')) {
    const end = cursor.indexOf(' ');
    if (end < 0) return '';
    cursor = cursor.slice(end + 1).trimStart();
  }
  if (cursor.startsWith(':')) {
    const end = cursor.indexOf(' ');
    if (end < 0) return '';
    cursor = cursor.slice(end + 1).trimStart();
  }
  return (cursor.split(/\s+/u, 1)[0] ?? '').toUpperCase();
}

function validServerPrefix(value: string | null): value is string {
  return Boolean(
    value
    && value.length <= 512
    && !/[!@,\s\u0000-\u001f\u007f]/u.test(value),
  );
}

function e2eeKeyBodyFromTrustedServer(message: IRCMessage, trustedPrefix: string | null): string | null {
  if (!trustedPrefix || message.command.toUpperCase() !== 'NOTICE' || message.prefix !== trustedPrefix) return null;
  const target = message.params[0];
  const body = message.params[1];
  if (!target || /^[#&]/u.test(target) || typeof body !== 'string' || body.startsWith('\x01')) return null;
  return /^E2EEKEY(?:\s|$)/u.test(body) ? body : null;
}

function e2eeKeyFailureFromTrustedServer(message: IRCMessage, trustedPrefix: string | null): string | null {
  if (
    !trustedPrefix
    || message.command.toUpperCase() !== 'FAIL'
    || message.prefix !== trustedPrefix
    || message.params[0]?.toUpperCase() !== 'E2EEKEY'
  ) return null;
  const code = message.params[1]?.trim().toUpperCase() ?? '';
  return /^[A-Z0-9_]{1,64}$/u.test(code) ? code : null;
}

export function createGroupControlBridge(options: GroupControlBridgeOptions): GroupControlBridge {
  const integrationFactory = options.integrationFactory ?? createGroupControlIntegration;
  const signerStoreFactory = options.signerStoreFactory ?? createTrustedGroupSignerStore;
  const publisherFactory = options.publisherFactory ?? createGroupDevicePublisher;
  const vaultResetSubscribe = options.vaultResetSubscribe ?? subscribeVerifiedDeviceHistoryClear;
  const signerStores = new Map<string, TrustedGroupSignerStore>();

  let currentAccount = canonicalAccount(options.authenticatedAccount());
  let trustedServerPrefix: string | null = null;
  let started = false;
  let connected = false;
  let destroyed = false;
  let handlerAttached = false;
  let unsubscribe: (() => void) | null = null;
  let vaultUnsubscribe: (() => void) | null = null;
  let destroyPromise: Promise<void> | null = null;

  const trustedSignerStore = (): TrustedGroupSignerStore | null => {
    if (!currentAccount) return null;
    const existing = signerStores.get(currentAccount);
    if (existing) return existing;
    try {
      const store = signerStoreFactory({ endpoint: options.endpoint, localAccount: currentAccount });
      signerStores.set(currentAccount, store);
      return store;
    } catch {
      return null;
    }
  };

  const integration = integrationFactory({
    client: options.client,
    endpoint: options.endpoint,
    identity: currentAccount ? { account: currentAccount } : null,
    identityFor: () => currentAccount ? { account: currentAccount } : null,
    trustedSignerStore,
    isConnected: options.isConnected,
    // The bridge authenticates directory replies against the exact prefix
    // learned from 001. Do not install the integration's pure-server heuristic.
    autoAttach: false,
  });
  const publisher = publisherFactory({
    sender: options.client,
    endpoint: integration.endpoint,
    clientId: integration.clientId,
    account: currentAccount,
  });
  vaultUnsubscribe = vaultResetSubscribe(() => {
    if (destroyed || !options.isCurrent()) return;
    void publisher.onVaultReset().catch(() => undefined);
  });

  const handler = (message: IRCMessage): void => {
    if (destroyed || !connected || !options.isCurrent()) return;
    const e2eeKeyBody = e2eeKeyBodyFromTrustedServer(message, trustedServerPrefix);
    if (e2eeKeyBody) {
      publisher.observeTrustedServerBody(e2eeKeyBody);
      // ADDED/STATUS are publisher/account-service replies, not directory rows;
      // never let them poison an in-flight DEVICE...END collector.
      if (/^E2EEKEY\s+(?:DEVICE|END)\s/u.test(e2eeKeyBody)) {
        integration.observeAuthenticatedDirectoryBody(e2eeKeyBody);
      }
      return;
    }
    const failureCode = e2eeKeyFailureFromTrustedServer(message, trustedServerPrefix);
    if (failureCode) {
      publisher.observeTrustedFailure(failureCode);
      return;
    }
    if (GROUP_CONTROL_COMMANDS.has(rawCommand(message))) {
      void integration.accept(message).catch(() => undefined);
    }
  };

  const addHandler = (): void => {
    if (handlerAttached || destroyed || !options.isCurrent()) return;
    options.client.extraMessageHandlers.add(handler);
    handlerAttached = true;
  };

  const removeHandler = (): void => {
    if (!handlerAttached) return;
    options.client.extraMessageHandlers.delete(handler);
    handlerAttached = false;
  };

  const bridge: GroupControlBridge = {
    client: options.client,
    endpoint: integration.endpoint,
    start() {
      if (started || destroyed || !options.isCurrent()) return;
      started = true;
      unsubscribe = integration.subscribe((state) => {
        if (destroyed || !options.isCurrent()) return;
        options.publish(state.runtime);
      });
    },
    onConnected() {
      if (destroyed || !options.isCurrent()) return;
      connected = true;
      addHandler();
      void publisher.onConnected().catch(() => undefined);
      void integration.onConnected().catch(() => undefined);
    },
    onDisconnected() {
      if (destroyed || !options.isCurrent()) return;
      connected = false;
      trustedServerPrefix = null;
      removeHandler();
      publisher.onDisconnected();
      integration.onDisconnected();
    },
    onRegistered(message) {
      if (destroyed || !connected || !options.isCurrent() || message.command.toUpperCase() !== '001') return false;
      const prefix = message.prefix;
      if (!validServerPrefix(prefix)) return false;
      // First registration fixes the directory authority for this socket.
      // A duplicate/forged 001 cannot retarget trusted directory dispatch.
      if (trustedServerPrefix && trustedServerPrefix !== prefix) return false;
      trustedServerPrefix = prefix;
      void publisher.onRegistered().catch(() => undefined);
      return true;
    },
    refreshAuthenticatedAccount() {
      return bridge.setAuthenticatedAccount(options.authenticatedAccount());
    },
    async setAuthenticatedAccount(account) {
      if (destroyed || !options.isCurrent()) return false;
      currentAccount = canonicalAccount(account);
      void publisher.setAuthenticatedAccount(currentAccount).catch(() => undefined);
      return await integration.setIdentity(
        currentAccount
          ? { account: currentAccount }
          : { account: null, deviceId: null },
      );
    },
    onRoomPart(room) {
      if (!destroyed && options.isCurrent()) integration.onRoomPart(room);
    },
    onRoomKick(room) {
      if (!destroyed && options.isCurrent()) integration.onRoomKick(room);
    },
    async sealRoomMessage(room, plaintext) {
      if (destroyed || !options.isCurrent()) return { ok: false, status: 'locked', reason: 'runtime-inactive' };
      const runtime = integration.runtime;
      return runtime ? runtime.sealRoomMessage(room, plaintext) : { ok: false, status: 'locked', reason: 'session-not-provisioned' };
    },
    async openRoomMessage(room, envelope) {
      if (destroyed || !options.isCurrent()) return { ok: false, status: 'locked', reason: 'runtime-inactive' };
      const runtime = integration.runtime;
      return runtime ? runtime.openRoomMessage(room, envelope) : { ok: false, status: 'locked', reason: 'session-not-provisioned' };
    },
    destroy() {
      if (destroyPromise) return destroyPromise;
      destroyed = true;
      connected = false;
      trustedServerPrefix = null;
      removeHandler();
      publisher.destroy();
      vaultUnsubscribe?.();
      vaultUnsubscribe = null;
      unsubscribe?.();
      unsubscribe = null;
      signerStores.clear();
      if (options.isCurrent()) options.publish(null);
      // integration.destroy() performs its ownership invalidation, handler and
      // vault-listener removal synchronously before its first await.
      destroyPromise = integration.destroy();
      return destroyPromise;
    },
  };

  return bridge;
}
