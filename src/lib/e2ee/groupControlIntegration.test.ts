// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import { deriveGroupDeviceId, encodeGroupDeviceDirectoryEntry, type GroupDeviceDirectorySnapshot } from './groupDeviceDirectory';
import { prepareGroupCommit } from './groupCommit';
import { prepareGroupWelcome } from './groupWelcome';
import { signGroupControlPayload } from './groupControlPayload';
import { GroupSession } from './groupSession';
import { createInMemoryTrustedGroupSignerStore } from './trustedGroupSigner';
import { toB64url } from './dmCipher';

import {
  createGroupControlIntegration,
  type GroupControlIntegrationClient,
} from './groupControlIntegration';

function fakeClient() {
  const sendRaw = vi.fn(() => true);
  const client: GroupControlIntegrationClient = {
    extraMessageHandlers: new Set(),
    sendRaw,
  };
  return { client, sendRaw };
}

function serverNotice(body: string, target = 'alice') {
  return parseIRCMessage(`:server.example NOTICE ${target} :${body}`);
}

function peerNotice(body: string, target = 'alice') {
  return parseIRCMessage(`:peer!user@example NOTICE ${target} :${body}`);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function integrationFor(
  client: GroupControlIntegrationClient,
  connected = true,
) {
  return createGroupControlIntegration({
    client,
    endpoint: 'wss://node.example/irc?transport=websocket',
    clientId: 'client-a',
    identity: { account: 'Alice', deviceId: 'phone' },
    connected,
  });
}

const testBytes = (value: number, length = 32) => new Uint8Array(length).fill(value);

async function retainedPairFixture() {
  const signer = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
  const sender = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
  const recipient = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
  const signerRaw = new Uint8Array(await crypto.subtle.exportKey('raw', signer.publicKey));
  const senderRaw = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const recipientRaw = new Uint8Array(await crypto.subtle.exportKey('raw', recipient.publicKey));
  const publicKey = encodeGroupDeviceDirectoryEntry({ signerPub: signerRaw, encryptionPub: senderRaw })!;
  const deviceId = (await deriveGroupDeviceId(publicKey))!;
  const row = { account: 'alice', deviceId, algorithm: 'onyx-ogc1-v1', publicKey, directoryKey: toB64url(signerRaw), trusted: true, legacy: false, entry: { signerPub: signerRaw, encryptionPub: senderRaw } };
  const directory: GroupDeviceDirectorySnapshot = { account: 'alice', devices: [row], trusted: [row], bySigner: new Map([[row.directoryKey, row]]) };
  const commit = (await prepareGroupCommit({ room: '#room', fromAccount: 'alice', fromDevice: deviceId, priorEpoch: 0, priorCommitHash: new Uint8Array(32), membershipDigest: testBytes(3), commitId: testBytes(4), newEpochKey: testBytes(5) }))!;
  const welcome = (await prepareGroupWelcome({ room: '#room', fromAccount: 'alice', fromDevice: deviceId, toAccount: 'alice', toDevice: 'phone', epoch: 1, commitId: testBytes(4), membershipDigest: testBytes(3), epochKey: testBytes(5), recipientWrapPublicKey: recipientRaw }))!;
  const cp = (await signGroupControlPayload({ routing: { channel: '#room', kind: 'commit', fromAccount: 'alice', fromDevice: deviceId }, epoch: 1, body: commit.body, signerPub: signerRaw, privateKey: signer.privateKey }))!;
  const wp = (await signGroupControlPayload({ routing: { channel: '#room', kind: 'welcome', fromAccount: 'alice', fromDevice: deviceId, toAccount: 'alice', toDevice: 'phone' }, epoch: 1, body: welcome.bytes, signerPub: signerRaw, privateKey: signer.privateKey }))!;
  return { directory, recipient: recipient.privateKey, deviceId, commit: `:server E2EE.COMMIT #room alice ${deviceId} :${cp}`, welcome: `:server E2EE.WELCOME #room alice ${deviceId} alice phone :${wp}` };
}

type IntegrationProbe = () => {
  mirroredTimeoutGenerations: number;
  directoryWaiterGenerations: number;
};

function probe(integration: ReturnType<typeof integrationFor>): ReturnType<IntegrationProbe> {
  const value = (integration as unknown as { __testProbe?: IntegrationProbe }).__testProbe;
  if (!value) throw new Error('group-control integration test probe unavailable');
  return value();
}

describe('Packet-C group-control integration owner', () => {
  it('attaches one auxiliary handler and fails closed without durable signer pins', async () => {
    const { client } = fakeClient();
    const integration = integrationFor(client);
    await expect(integration.initialization).resolves.toBe(true);
    expect(client.extraMessageHandlers.size).toBe(1);
    expect(integration.state.runtime).toMatchObject({
      lifecycle: 'recovery-required',
      activation: 'hold',
      identity: {
        clientId: 'client-a',
        endpoint: 'wss://node.example/irc?transport=websocket',
        account: 'alice',
        deviceId: 'phone',
      },
    });

    const result = await integration.accept(
      ':server.example E2EE.COMMIT #room alice sender-device :opaque-control',
    );
    expect(result).toMatchObject({ status: 'locked', reason: 'trust-path-unreachable' });
    expect(JSON.stringify(integration.state)).not.toContain('opaque-control');
    await integration.destroy();
  });

  it('routes dotted controls through the raw command hint without retaining payloads', async () => {
    const { client } = fakeClient();
    const outcomes: unknown[] = [];
    const integration = createGroupControlIntegration({
      client,
      endpoint: 'wss://node.example/irc?transport=websocket',
      clientId: 'client-a-dotted',
      identity: { account: 'alice', deviceId: 'phone' },
      connected: true,
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    await integration.initialization;
    const handler = [...client.extraMessageHandlers][0];
    expect(handler).toBeDefined();
    handler!(parseIRCMessage(':server.example E2EE.COMMIT #room alice sender-device :opaque-control'));
    await Promise.resolve();
    expect(outcomes).toHaveLength(1);
    expect(JSON.stringify(integration.state)).not.toContain('opaque-control');
    await integration.destroy();
  });

  it('accepts only authenticated pure-server directory bodies and preserves generation boundaries', async () => {
    const { client, sendRaw } = fakeClient();
    const integration = integrationFor(client);
    await integration.initialization;

    const firstGeneration = integration.directoryGeneration;
    const first = integration.requestDirectory('Alice');
    expect(sendRaw).toHaveBeenCalledWith('E2EEKEY', 'LIST', 'alice');
    expect(integration.observeServerReply(peerNotice('E2EEKEY DEVICE account=alice id=legacy alg=old key=x'))).toBe(false);
    expect(integration.observeServerReply(serverNotice('E2EEKEY DEVICE account=alice id=legacy alg=old key=x'))).toBe(true);
    expect(integration.observeServerReply(serverNotice('E2EEKEY END account=alice devices=1'))).toBe(true);
    await expect(first).resolves.toMatchObject({ ok: true, snapshot: { account: 'alice' } });

    const second = integration.requestDirectory('alice');
    const staleGeneration = integration.directoryGeneration;
    integration.onDisconnected();
    await expect(second).resolves.toEqual({ ok: false, reason: 'stale-generation' });
    expect(integration.directoryGeneration).toBe(staleGeneration + 1);
    expect(integration.observeServerReply(serverNotice('E2EEKEY DEVICE account=alice id=late alg=old key=x'), firstGeneration)).toBe(false);
    expect(integration.observeAuthenticatedDirectoryBody('E2EEKEY END account=alice devices=0', firstGeneration)).toBe(false);
    expect(client.extraMessageHandlers.size).toBe(0);

    await integration.onConnected();
    expect(client.extraMessageHandlers.size).toBe(1);
    await integration.destroy();
  });

  it('resynchronizes after broker timeout before admitting a fresh LIST', async () => {
    vi.useFakeTimers();
    const { client, sendRaw } = fakeClient();
    const integration = integrationFor(client);
    try {
      await integration.initialization;
      const oldGeneration = integration.directoryGeneration;
      const timedOut = integration.requestDirectory('alice');
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(timedOut).resolves.toEqual({ ok: false, reason: 'timeout' });
      expect(integration.directoryGeneration).toBe(oldGeneration + 1);

      const fresh = integration.requestDirectory('alice');
      expect(sendRaw).toHaveBeenCalledTimes(2);
      // The late response belongs to the broker generation that timed out.
      expect(integration.observeAuthenticatedDirectoryBody(
        'E2EEKEY DEVICE account=alice id=old alg=old key=x',
        oldGeneration,
      )).toBe(false);

      expect(integration.observeAuthenticatedDirectoryBody(
        'E2EEKEY DEVICE account=alice id=fresh alg=old key=x',
      )).toBe(true);
      expect(integration.observeAuthenticatedDirectoryBody(
        'E2EEKEY END account=alice devices=1',
      )).toBe(true);
      await expect(fresh).resolves.toMatchObject({ ok: true, snapshot: { account: 'alice' } });
    } finally {
      await integration.destroy();
      vi.useRealTimers();
    }
  });

  it('mirrors one timeout for shared same-account waiters and handles a reset race idempotently', async () => {
    vi.useFakeTimers();
    const { client, sendRaw } = fakeClient();
    const integration = integrationFor(client);
    try {
      await integration.initialization;
      const oldGeneration = integration.directoryGeneration;
      const first = integration.requestDirectory('alice');
      const second = integration.requestDirectory('ALICE');
      expect(sendRaw).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(8_000);
      await expect(first).resolves.toEqual({ ok: false, reason: 'timeout' });
      await expect(second).resolves.toEqual({ ok: false, reason: 'timeout' });
      expect(integration.directoryGeneration).toBe(oldGeneration + 1);

      const fresh = integration.requestDirectory('alice');
      expect(integration.observeAuthenticatedDirectoryBody(
        'E2EEKEY DEVICE account=alice id=old alg=old key=x',
        oldGeneration,
      )).toBe(false);
      expect(integration.observeAuthenticatedDirectoryBody(
        'E2EEKEY DEVICE account=alice id=fresh alg=old key=x',
      )).toBe(true);
      expect(integration.observeAuthenticatedDirectoryBody(
        'E2EEKEY END account=alice devices=1',
      )).toBe(true);
      await expect(fresh).resolves.toMatchObject({ ok: true, snapshot: { account: 'alice' } });
      expect(sendRaw).toHaveBeenCalledTimes(2);
    } finally {
      await integration.destroy();
      vi.useRealTimers();
    }
  });

  it('does not double-advance when timeout continuations race an explicit reset', async () => {
    vi.useFakeTimers();
    const { client } = fakeClient();
    const integration = integrationFor(client);
    try {
      await integration.initialization;
      const before = integration.directoryGeneration;
      const first = integration.requestDirectory('alice');
      const second = integration.requestDirectory('alice');
      vi.advanceTimersByTime(8_000);
      // The broker has already invalidated its slot, but promise continuations
      // have not run yet. This is the lifecycle reset race under test.
      integration.onDisconnected();
      await expect(first).resolves.toMatchObject({ ok: false, reason: 'stale-generation' });
      await expect(second).resolves.toMatchObject({ ok: false, reason: 'stale-generation' });
      expect(integration.directoryGeneration).toBe(before + 2);
    } finally {
      await integration.destroy();
      vi.useRealTimers();
    }
  });

  it('prunes retired timeout metadata across many aligned generations', async () => {
    vi.useFakeTimers();
    const { client } = fakeClient();
    const integration = integrationFor(client);
    try {
      await integration.initialization;
      const iterations = 96;
      const startGeneration = integration.directoryGeneration;
      for (let index = 0; index < iterations; index += 1) {
        const account = `a${index}`;
        const before = integration.directoryGeneration;
        const timedOut = integration.requestDirectory(account);
        await vi.advanceTimersByTimeAsync(8_000);
        await expect(timedOut).resolves.toEqual({ ok: false, reason: 'timeout' });
        expect(integration.directoryGeneration).toBe(before + 1);
        expect(probe(integration)).toEqual({
          mirroredTimeoutGenerations: 0,
          directoryWaiterGenerations: 0,
        });

        const fresh = integration.requestDirectory(account);
        expect(integration.observeAuthenticatedDirectoryBody(
          `E2EEKEY DEVICE account=${account} id=legacy alg=old key=x`,
        )).toBe(true);
        expect(integration.observeAuthenticatedDirectoryBody(
          `E2EEKEY END account=${account} devices=1`,
        )).toBe(true);
        await expect(fresh).resolves.toMatchObject({ ok: true, snapshot: { account } });
      }
      expect(probe(integration)).toEqual({
        mirroredTimeoutGenerations: 0,
        directoryWaiterGenerations: 0,
      });
      expect(integration.directoryGeneration).toBe(startGeneration + iterations);
    } finally {
      await integration.destroy();
      vi.useRealTimers();
    }
  });

  it('recreates the exact tuple on account/device changes and ignores stale handlers', async () => {
    const { client } = fakeClient();
    const integration = integrationFor(client);
    await integration.initialization;
    const oldRuntime = integration.runtime;
    const oldHandler = [...client.extraMessageHandlers][0];
    expect(oldRuntime).not.toBeNull();

    await expect(integration.setIdentity({ account: 'Bob', deviceId: 'tablet' })).resolves.toBe(true);
    expect(integration.runtime).not.toBe(oldRuntime);
    expect(oldRuntime?.isDestroyed).toBe(true);
    expect(integration.state.runtime?.identity).toMatchObject({
      account: 'bob',
      deviceId: 'tablet',
      endpoint: 'wss://node.example/irc?transport=websocket',
      clientId: 'client-a',
    });
    // A stale callback retained by a transport cannot reach the replacement.
    oldHandler?.(parseIRCMessage(':server.example E2EE.COMMIT #room alice sender-device :stale-control'));
    await Promise.resolve();
    expect(JSON.stringify(integration.state)).not.toContain('stale-control');
    await integration.destroy();
  });

  it('projects an omitted trusted-account device through a fail-closed pending identity', async () => {
    const { client } = fakeClient();
    const projection = deferred<{ deviceId: string } | null>();
    const deviceIdentityFor = vi.fn(() => projection.promise);
    const outcomes: unknown[] = [];
    const integration = createGroupControlIntegration({
      client,
      endpoint: 'wss://node.example/irc?transport=websocket',
      clientId: 'client-projected',
      identity: null,
      deviceIdentityFor,
      connected: true,
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    await integration.initialization;
    const generationBefore = integration.state.generation;

    const switching = integration.setIdentity({ account: 'Alice' });
    await vi.waitFor(() => expect(deviceIdentityFor).toHaveBeenCalledTimes(1));
    expect(integration.state.runtime).toMatchObject({
      lifecycle: 'identity-pending',
      identity: { account: 'alice', deviceId: null },
    });
    await expect(integration.accept(
      ':server.example E2EE.COMMIT #room alice sender-device :during-resolution',
    )).resolves.toMatchObject({ status: 'locked', reason: 'identity-pending' });
    const handler = [...client.extraMessageHandlers][0];
    handler?.(parseIRCMessage(
      ':server.example E2EE.COMMIT #room alice sender-device :attached-during-resolution',
    ));
    expect(outcomes).toContainEqual(expect.objectContaining({
      status: 'locked',
      reason: 'identity-pending',
    }));
    expect(client.extraMessageHandlers.size).toBe(1);

    projection.resolve({ deviceId: 'ogc1-projected' });
    await expect(switching).resolves.toBe(true);
    expect(deviceIdentityFor).toHaveBeenCalledTimes(1);
    expect(integration.state.runtime?.identity).toMatchObject({
      account: 'alice',
      deviceId: 'ogc1-projected',
    });
    expect(integration.state.generation).toBe(generationBefore + 2);
    expect(client.extraMessageHandlers.size).toBe(1);
    await integration.destroy();
  });

  it('lets a newer account/device identity win while an older projection is pending', async () => {
    const { client } = fakeClient();
    const projection = deferred<{ deviceId: string } | null>();
    const integration = createGroupControlIntegration({
      client,
      endpoint: 'wss://node.example/irc?transport=websocket',
      clientId: 'client-account-race',
      identity: null,
      deviceIdentityFor: () => projection.promise,
      connected: true,
    });
    await integration.initialization;
    const generationBefore = integration.state.generation;

    const alice = integration.setIdentity({ account: 'Alice' });
    await vi.waitFor(() => expect(integration.state.runtime?.identity).toMatchObject({
      account: 'alice',
      deviceId: null,
    }));
    const bob = integration.setIdentity({ account: 'Bob', deviceId: 'tablet' });
    await expect(bob).resolves.toBe(true);
    projection.resolve({ deviceId: 'alice-phone' });
    await expect(alice).resolves.toBe(false);
    expect(integration.state.runtime?.identity).toMatchObject({ account: 'bob', deviceId: 'tablet' });
    expect(integration.state.generation).toBe(generationBefore + 2);
    expect(client.extraMessageHandlers.size).toBe(1);
    await integration.destroy();
  });

  it('lets authoritative refresh overtake a pending direct projection without latching admission', async () => {
    const { client } = fakeClient();
    const projection = deferred<{ deviceId: string } | null>();
    let refreshedIdentity: { account: string; deviceId: string } | null = null;
    const integration = createGroupControlIntegration({
      client,
      endpoint: 'wss://node.example/irc?transport=websocket',
      clientId: 'client-refresh-overtake',
      identityFor: () => refreshedIdentity,
      deviceIdentityFor: () => projection.promise,
      connected: true,
    });
    await integration.initialization;

    const alice = integration.setIdentity({ account: 'Alice' });
    await vi.waitFor(() => expect(integration.state.runtime?.identity).toMatchObject({
      account: 'alice',
      deviceId: null,
    }));
    refreshedIdentity = { account: 'Bob', deviceId: 'tablet' };
    await expect(integration.refreshIdentity()).resolves.toBe(true);
    expect(integration.state.runtime?.identity).toMatchObject({ account: 'bob', deviceId: 'tablet' });

    // The superseded projection may never settle in production. Admission for
    // the complete refreshed tuple must nevertheless no longer be latched.
    await expect(integration.accept(
      ':server.example E2EE.COMMIT #room bob sender-device :after-refresh',
    )).resolves.not.toMatchObject({ reason: 'identity-pending' });
    expect(client.extraMessageHandlers.size).toBe(1);
    projection.resolve({ deviceId: 'late-alice-phone' });
    await expect(alice).resolves.toBe(false);
    await integration.destroy();
  });

  it('makes an omitted-device refresh pending immediately and prevents it overwriting a newer set', async () => {
    const { client } = fakeClient();
    const projection = deferred<{ deviceId: string } | null>();
    let refreshedIdentity: { account: string; deviceId?: string } | null = {
      account: 'Alice',
      deviceId: 'phone',
    };
    const deviceIdentityFor = vi.fn(() => projection.promise);
    const integration = createGroupControlIntegration({
      client,
      endpoint: 'wss://node.example/irc?transport=websocket',
      clientId: 'client-refresh-race',
      identityFor: () => refreshedIdentity,
      deviceIdentityFor,
      connected: true,
    });
    await integration.initialization;

    refreshedIdentity = { account: 'Bob' };
    const refreshing = integration.refreshIdentity();
    await vi.waitFor(() => expect(deviceIdentityFor).toHaveBeenCalledTimes(1));
    expect(integration.state.runtime).toMatchObject({
      lifecycle: 'identity-pending',
      identity: { account: 'bob', deviceId: null },
    });
    await expect(integration.accept(
      ':server.example E2EE.COMMIT #room bob sender-device :during-refresh',
    )).resolves.toMatchObject({ status: 'locked', reason: 'identity-pending' });

    await expect(integration.setIdentity({ account: 'Carol', deviceId: 'laptop' })).resolves.toBe(true);
    projection.resolve({ deviceId: 'late-bob-phone' });
    await expect(refreshing).resolves.toBe(false);
    expect(integration.state.runtime?.identity).toMatchObject({ account: 'carol', deviceId: 'laptop' });
    expect(client.extraMessageHandlers.size).toBe(1);
    await integration.destroy();
  });

  it('rechecks request ownership after runtime drain before publishing a replacement', async () => {
    const { client } = fakeClient();
    const integration = integrationFor(client);
    await integration.initialization;
    const oldRuntime = integration.runtime;
    expect(oldRuntime).not.toBeNull();
    const releaseDestroy = deferred<void>();
    const originalDestroy = oldRuntime!.destroy.bind(oldRuntime);
    const delayedDestroy = vi.fn(async () => {
      await releaseDestroy.promise;
      await originalDestroy();
    });
    (oldRuntime as unknown as { destroy: () => Promise<void> }).destroy = delayedDestroy;

    const alice = integration.setIdentity({ account: 'Alice', deviceId: 'new-phone' });
    await vi.waitFor(() => expect(delayedDestroy).toHaveBeenCalledTimes(1));
    const bob = integration.setIdentity({ account: 'Bob', deviceId: 'tablet' });
    releaseDestroy.resolve();

    await expect(alice).resolves.toBe(false);
    await expect(bob).resolves.toBe(true);
    expect(integration.state.runtime?.identity).toMatchObject({ account: 'bob', deviceId: 'tablet' });
    expect(client.extraMessageHandlers.size).toBe(1);
    await integration.destroy();
  });

  it('lets logout invalidate a pending projection without resurrecting authenticated identity', async () => {
    const { client } = fakeClient();
    const projection = deferred<{ deviceId: string } | null>();
    const integration = createGroupControlIntegration({
      client,
      endpoint: 'wss://node.example/irc?transport=websocket',
      clientId: 'client-logout-race',
      identity: null,
      deviceIdentityFor: () => projection.promise,
      connected: true,
    });
    await integration.initialization;

    const login = integration.setIdentity({ account: 'Alice' });
    await vi.waitFor(() => expect(integration.state.runtime?.identity).toMatchObject({
      account: 'alice',
      deviceId: null,
    }));
    await expect(integration.setIdentity(null)).resolves.toBe(true);
    projection.resolve({ deviceId: 'late-phone' });
    await expect(login).resolves.toBe(false);
    expect(integration.state.runtime?.identity).toMatchObject({ account: null, deviceId: null });
    expect(integration.state.runtime?.lifecycle).toBe('identity-pending');
    expect(client.extraMessageHandlers.size).toBe(1);
    await integration.destroy();
  });

  it('preserves explicit null/string device semantics and fails closed on projection failure', async () => {
    const { client } = fakeClient();
    const deviceIdentityFor = vi.fn(async () => {
      throw new Error('projection unavailable');
    });
    const integration = createGroupControlIntegration({
      client,
      endpoint: 'wss://node.example/irc?transport=websocket',
      clientId: 'client-explicit-device',
      identity: null,
      deviceIdentityFor,
      connected: true,
    });
    await integration.initialization;

    await expect(integration.setIdentity({ account: 'Alice', deviceId: null })).resolves.toBe(true);
    expect(deviceIdentityFor).not.toHaveBeenCalled();
    expect(integration.state.runtime).toMatchObject({
      lifecycle: 'identity-pending',
      identity: { account: 'alice', deviceId: null },
    });

    await expect(integration.setIdentity({ account: 'Alice', deviceId: 'exact-device' })).resolves.toBe(true);
    expect(deviceIdentityFor).not.toHaveBeenCalled();
    expect(integration.state.runtime?.identity).toMatchObject({ account: 'alice', deviceId: 'exact-device' });

    await expect(integration.setIdentity({ account: 'Bob' })).resolves.toBe(true);
    expect(deviceIdentityFor).toHaveBeenCalledTimes(1);
    expect(integration.state.runtime).toMatchObject({
      lifecycle: 'identity-pending',
      identity: { account: 'bob', deviceId: null },
    });
    expect(client.extraMessageHandlers.size).toBe(1);
    await integration.destroy();
  });

  it('invalidates pending projection results on reconnect and verified vault reset', async () => {
    const { client } = fakeClient();
    const reconnectProjection = deferred<{ deviceId: string } | null>();
    const vaultProjection = deferred<{ deviceId: string } | null>();
    const projections = [reconnectProjection.promise, vaultProjection.promise];
    const deviceIdentityFor = vi.fn(() => projections.shift() ?? null);
    const integration = createGroupControlIntegration({
      client,
      endpoint: 'wss://node.example/irc?transport=websocket',
      clientId: 'client-lifecycle-race',
      identity: null,
      deviceIdentityFor,
      connected: true,
    });
    await integration.initialization;

    const reconnecting = integration.setIdentity({ account: 'Alice' });
    await vi.waitFor(() => expect(deviceIdentityFor).toHaveBeenCalledTimes(1));
    integration.reconnect();
    reconnectProjection.resolve({ deviceId: 'stale-after-reconnect' });
    await expect(reconnecting).resolves.toBe(false);
    expect(integration.state.runtime?.identity).toMatchObject({ account: 'alice', deviceId: null });
    expect(client.extraMessageHandlers.size).toBe(0);

    await integration.onConnected();
    const resetting = integration.setIdentity({ account: 'Alice' });
    await vi.waitFor(() => expect(deviceIdentityFor).toHaveBeenCalledTimes(2));
    const generationBeforeReset = integration.state.generation;
    await integration.onVaultReset();
    vaultProjection.resolve({ deviceId: 'stale-after-reset' });
    await expect(resetting).resolves.toBe(false);
    expect(integration.state.generation).toBe(generationBeforeReset + 1);
    expect(integration.state.runtime?.identity).toMatchObject({ account: 'alice', deviceId: null });
    expect(client.extraMessageHandlers.size).toBe(1);
    await integration.destroy();
  });

  it('keeps destroy terminal when an omitted-device projection completes late', async () => {
    const { client } = fakeClient();
    const projection = deferred<{ deviceId: string } | null>();
    const integration = createGroupControlIntegration({
      client,
      endpoint: 'wss://node.example/irc?transport=websocket',
      clientId: 'client-destroy-race',
      identity: null,
      deviceIdentityFor: () => projection.promise,
      connected: true,
    });
    await integration.initialization;

    const switching = integration.setIdentity({ account: 'Alice' });
    await vi.waitFor(() => expect(integration.state.runtime?.identity).toMatchObject({
      account: 'alice',
      deviceId: null,
    }));
    const destroying = integration.destroy();
    projection.resolve({ deviceId: 'late-device' });
    await expect(switching).resolves.toBe(false);
    await destroying;
    expect(integration.runtime).toBeNull();
    expect(integration.isDestroyed).toBe(true);
    expect(client.extraMessageHandlers.size).toBe(0);
  });

  it('tears down and rebuilds room-control state after verified vault reset', async () => {
    const { client } = fakeClient();
    const integration = integrationFor(client);
    await integration.initialization;
    const oldRuntime = integration.runtime;
    const previousGeneration = integration.state.generation;
    await integration.onVaultReset();
    expect(oldRuntime?.isDestroyed).toBe(true);
    expect(integration.runtime).not.toBe(oldRuntime);
    expect(integration.state.generation).toBeGreaterThan(previousGeneration);
    expect(integration.state.runtime?.activation).toBe('hold');
    expect(client.extraMessageHandlers.size).toBe(1);
    await integration.destroy();
  });

  it('drops a frozen retained pair on vault reset: old runtime cannot replay it and replacement stays HOLD', async () => {
    const { client } = fakeClient();
    const value = await retainedPairFixture();
    const integration = createGroupControlIntegration({
      client, endpoint: 'wss://node.example/irc?transport=websocket', clientId: 'vault-pair',
      identity: { account: 'alice', deviceId: 'phone' }, connected: true,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient,
    });
    await integration.initialization;
    const old = integration.runtime!;
    await integration.accept(value.commit);
    const pending = integration.accept(value.welcome);
    await integration.onVaultReset();
    await expect(pending).resolves.toMatchObject({ status: 'ignored' });
    const late = GroupSession.create({ room: '#room', account: 'alice', deviceId: 'phone', epochKey: testBytes(8), membershipDigest: testBytes(9) })!;
    expect(old.registerProvisionedSession(late)).toMatchObject({ ok: false, reason: 'runtime-inactive' });
    expect(late.epoch).toBe(0n);
    expect(old.isDestroyed).toBe(true);
    expect(integration.runtime).not.toBe(old);
    expect(integration.state.runtime?.activation).toBe('hold');
    expect(JSON.stringify(integration.state)).not.toContain(value.commit.split(':').at(-1)!);
    await integration.destroy();
  });

  it('invalidates directory requests and removes the hook on disconnect/destroy', async () => {
    const { client, sendRaw } = fakeClient();
    const integration = integrationFor(client);
    await integration.initialization;
    const pending = integration.requestDirectory('alice');
    integration.reconnect();
    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'stale-generation' });
    expect(integration.state.runtime?.lifecycle).toBe('recovery-required');
    expect(client.extraMessageHandlers.size).toBe(0);
    await integration.destroy();
    expect(client.extraMessageHandlers.size).toBe(0);
    expect(integration.isDestroyed).toBe(true);
    expect(sendRaw).toHaveBeenCalledTimes(1);
  });
});
