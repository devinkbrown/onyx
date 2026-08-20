// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deriveGroupDeviceId,
  encodeGroupDeviceDirectoryEntry,
  GROUP_DEVICE_DIRECTORY_ALGORITHM,
} from './groupDeviceDirectory';
import { createGroupDevicePublisher } from './groupDevicePublisher';
import type { GroupDeviceIdentity } from './groupDeviceIdentity';

async function identity(): Promise<GroupDeviceIdentity> {
  const signing = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) as CryptoKeyPair;
  const encryption = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  ) as CryptoKeyPair;
  const entry = {
    signerPub: new Uint8Array(await crypto.subtle.exportKey('raw', signing.publicKey)),
    encryptionPub: new Uint8Array(await crypto.subtle.exportKey('raw', encryption.publicKey)),
  };
  const directory = encodeGroupDeviceDirectoryEntry(entry);
  const deviceId = await deriveGroupDeviceId(entry);
  if (!directory || !deviceId) throw new Error('ODD1 fixture unavailable');
  return { entry, directory, deviceId };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(projectIdentity: () => Promise<GroupDeviceIdentity | null>, retryDelayMs = 10) {
  const sendRaw = vi.fn(() => true);
  const publisher = createGroupDevicePublisher({
    sender: { sendRaw },
    endpoint: 'wss://node.example/irc?realm=one',
    clientId: 'client-one',
    projectIdentity,
    retryDelayMs,
  });
  return { publisher, sendRaw };
}

async function ready(h: ReturnType<typeof harness>, account = 'Alice'): Promise<boolean> {
  await h.publisher.onConnected();
  await h.publisher.setAuthenticatedAccount(account);
  return h.publisher.onRegistered();
}

describe('canonical ODD1 publisher', () => {
  beforeEach(() => vi.useRealTimers());

  it('publishes one canonical owner-scoped ADD and records only an uncorrelated server ack', async () => {
    vi.useFakeTimers();
    const value = await identity();
    const h = harness(async () => value);
    await expect(ready(h)).resolves.toBe(true);
    expect(h.sendRaw).toHaveBeenCalledOnce();
    expect(h.sendRaw).toHaveBeenCalledWith(
      'E2EEKEY',
      'ADD',
      value.deviceId,
      GROUP_DEVICE_DIRECTORY_ALGORITHM,
      value.directory,
    );
    expect(h.publisher.state).toMatchObject({
      status: 'sent',
      endpoint: 'wss://node.example/irc?realm=one',
      clientId: 'client-one',
      account: 'alice',
      deviceId: value.deviceId,
      attempts: 1,
    });
    expect(JSON.stringify(h.publisher.state)).not.toContain(value.directory);

    expect(h.publisher.observeTrustedServerBody(
      `E2EEKEY ADDED id=wrong alg=${GROUP_DEVICE_DIRECTORY_ALGORITHM}`,
    )).toBe(false);
    expect(h.publisher.observeTrustedServerBody(
      `E2EEKEY ADDED id=${value.deviceId} alg=onyx-p256`,
    )).toBe(false);
    expect(h.publisher.observeTrustedServerBody(
      `E2EEKEY ADDED id=${value.deviceId} alg=${GROUP_DEVICE_DIRECTORY_ALGORITHM}`,
    )).toBe(true);
    expect(h.publisher.state.status).toBe('server-ack-observed');
    expect(JSON.stringify(h.publisher.state)).not.toContain('confirmed');
    await expect(h.publisher.onRegistered()).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.sendRaw).toHaveBeenCalledOnce();
  });

  it('waits for connection, authenticated account, and registration without duplicate work', async () => {
    const value = await identity();
    const project = vi.fn(async () => value);
    const h = harness(project);
    await h.publisher.setAuthenticatedAccount(' Alice ');
    await h.publisher.onConnected();
    expect(project).not.toHaveBeenCalled();
    await Promise.all([h.publisher.onRegistered(), h.publisher.onRegistered()]);
    expect(project).toHaveBeenCalledOnce();
    expect(h.sendRaw).toHaveBeenCalledOnce();
    await h.publisher.setAuthenticatedAccount('ALICE');
    expect(h.sendRaw).toHaveBeenCalledOnce();
  });

  it('fails closed for absent, thrown, malformed, and mismatched projections without disclosure', async () => {
    const value = await identity();
    const cases: Array<() => Promise<GroupDeviceIdentity | null>> = [
      async () => null,
      async () => { throw new Error(`secret-${value.directory}`); },
      async () => ({ ...value, directory: `sentinel-${value.directory}` }),
      async () => ({ ...value, deviceId: 'ogc1-wrong' }),
    ];
    for (const project of cases) {
      const h = harness(project);
      await expect(ready(h)).resolves.toBe(false);
      expect(h.sendRaw).not.toHaveBeenCalled();
      expect(h.publisher.state).toMatchObject({
        status: 'inactive',
        failure: 'projection-unavailable',
        deviceId: null,
      });
      const publicState = JSON.stringify(h.publisher.state);
      expect(publicState).not.toContain(value.directory);
      expect(publicState).not.toContain('sentinel');
      expect(publicState).not.toContain('secret');
    }
  });

  it('invalidates stale projection on account switch, logout, disconnect, reset, and destroy', async () => {
    const stale = deferred<GroupDeviceIdentity | null>();
    const current = await identity();
    const projections = [stale.promise, Promise.resolve(current), Promise.resolve(current)];
    const h = harness(() => projections.shift() ?? Promise.resolve(null));
    await h.publisher.onConnected();
    await h.publisher.setAuthenticatedAccount('Alice');
    const alice = h.publisher.onRegistered();
    await vi.waitFor(() => expect(h.publisher.state.status).toBe('projecting'));
    await h.publisher.setAuthenticatedAccount('Bob');
    await vi.waitFor(() => expect(h.sendRaw).toHaveBeenCalledOnce());
    stale.resolve(current);
    await expect(alice).resolves.toBe(false);
    expect(h.publisher.state.account).toBe('bob');

    await h.publisher.setAuthenticatedAccount(null);
    expect(h.publisher.state).toMatchObject({ status: 'inactive', account: null, deviceId: null });
    h.publisher.onDisconnected();
    expect(h.publisher.state.status).toBe('inactive');

    await h.publisher.onConnected();
    await h.publisher.setAuthenticatedAccount('Carol');
    await h.publisher.onRegistered();
    const beforeReset = h.publisher.state.generation;
    await h.publisher.onVaultReset();
    expect(h.publisher.state.generation).toBe(beforeReset + 1);
    h.publisher.destroy();
    expect(h.publisher.state).toMatchObject({ status: 'inactive', deviceId: null });
    expect(await h.publisher.setAuthenticatedAccount('Dave')).toBe(false);
  });

  it('resends once per reconnect and rejects an ack while disconnected', async () => {
    vi.useFakeTimers();
    const value = await identity();
    const h = harness(async () => value, 1_000);
    await ready(h);
    h.publisher.onDisconnected();
    expect(h.publisher.observeTrustedServerBody(
      `E2EEKEY ADDED id=${value.deviceId} alg=${GROUP_DEVICE_DIRECTORY_ALGORITHM}`,
    )).toBe(false);
    await h.publisher.onConnected();
    await h.publisher.onRegistered();
    expect(h.sendRaw).toHaveBeenCalledTimes(2);
  });

  it('never presents same-device acks after owner changes or resets as confirmation', async () => {
    vi.useFakeTimers();
    const value = await identity();
    const h = harness(async () => value, 25);
    await ready(h, 'Alice');

    await h.publisher.setAuthenticatedAccount('Bob');
    expect(h.sendRaw).toHaveBeenCalledTimes(2);
    // ADDED has no account, connection generation, or request correlation. It
    // is visible only as an ambiguous observation, never as confirmation.
    expect(h.publisher.observeTrustedServerBody(
      `E2EEKEY ADDED id=${value.deviceId} alg=${GROUP_DEVICE_DIRECTORY_ALGORITHM}`,
    )).toBe(true);
    expect(h.publisher.state).toMatchObject({
      status: 'server-ack-observed',
      account: 'bob',
      attempts: 1,
    });
    expect(JSON.stringify(h.publisher.state)).not.toContain('confirmed');

    const resetting = h.publisher.onVaultReset();
    await expect(resetting).resolves.toBe(true);
    expect(h.sendRaw).toHaveBeenCalledTimes(3);
    expect(h.publisher.observeTrustedServerBody(
      `E2EEKEY ADDED id=${value.deviceId} alg=${GROUP_DEVICE_DIRECTORY_ALGORITHM}`,
    )).toBe(true);
    expect(h.publisher.state.status).toBe('server-ack-observed');
    await vi.advanceTimersByTimeAsync(100);
    expect(h.sendRaw).toHaveBeenCalledTimes(3);
  });

  it('reprojects for repeated account owners without ever claiming confirmation', async () => {
    vi.useFakeTimers();
    const value = await identity();
    const h = harness(async () => value, 25);
    await ready(h, 'Alice');
    await h.publisher.setAuthenticatedAccount('Bob');
    await expect(h.publisher.setAuthenticatedAccount('Carol')).resolves.toBe(true);
    expect(h.publisher.state).toMatchObject({
      status: 'sent',
      account: 'carol',
      deviceId: value.deviceId,
    });
    expect(h.sendRaw).toHaveBeenCalledTimes(3);
    expect(h.publisher.observeTrustedServerBody(
      `E2EEKEY ADDED id=${value.deviceId} alg=${GROUP_DEVICE_DIRECTORY_ALGORITHM}`,
    )).toBe(true);
    expect(h.publisher.state.status).toBe('server-ack-observed');
    expect(JSON.stringify(h.publisher.state)).not.toContain('confirmed');
  });

  it('suppresses deferred projection across disconnect/reconnect, vault reset, and destroy generations', async () => {
    const value = await identity();

    const disconnectProjection = deferred<GroupDeviceIdentity | null>();
    const afterReconnect = vi.fn(async () => value);
    const reconnectProjects = [disconnectProjection.promise, afterReconnect()];
    const reconnecting = harness(() => reconnectProjects.shift() ?? Promise.resolve(null));
    await reconnecting.publisher.onConnected();
    await reconnecting.publisher.setAuthenticatedAccount('Alice');
    const staleConnection = reconnecting.publisher.onRegistered();
    await vi.waitFor(() => expect(reconnecting.publisher.state.status).toBe('projecting'));
    reconnecting.publisher.onDisconnected();
    await reconnecting.publisher.onConnected();
    const freshConnection = reconnecting.publisher.onRegistered();
    disconnectProjection.resolve(value);
    await expect(staleConnection).resolves.toBe(false);
    await expect(freshConnection).resolves.toBe(true);
    expect(reconnecting.sendRaw).toHaveBeenCalledOnce();

    const resetProjection = deferred<GroupDeviceIdentity | null>();
    const resetProjects = [resetProjection.promise, Promise.resolve(value)];
    const resetting = harness(() => resetProjects.shift() ?? Promise.resolve(null));
    await resetting.publisher.onConnected();
    await resetting.publisher.setAuthenticatedAccount('Alice');
    const staleReset = resetting.publisher.onRegistered();
    await vi.waitFor(() => expect(resetting.publisher.state.status).toBe('projecting'));
    const freshReset = resetting.publisher.onVaultReset();
    resetProjection.resolve(value);
    await expect(staleReset).resolves.toBe(false);
    await expect(freshReset).resolves.toBe(true);
    expect(resetting.sendRaw).toHaveBeenCalledOnce();

    const destroyProjection = deferred<GroupDeviceIdentity | null>();
    const destroying = harness(() => destroyProjection.promise);
    await destroying.publisher.onConnected();
    await destroying.publisher.setAuthenticatedAccount('Alice');
    const staleDestroy = destroying.publisher.onRegistered();
    await vi.waitFor(() => expect(destroying.publisher.state.status).toBe('projecting'));
    destroying.publisher.destroy();
    destroyProjection.resolve(value);
    await expect(staleDestroy).resolves.toBe(false);
    expect(destroying.sendRaw).not.toHaveBeenCalled();
    expect(JSON.stringify(destroying.publisher.state)).not.toContain(value.directory);
  });

  it('bounds delayed retry to one attempt for a missing ack, send failure, and transient failure', async () => {
    vi.useFakeTimers();
    const value = await identity();
    const h = harness(async () => value, 25);
    await ready(h);
    await vi.advanceTimersByTimeAsync(25);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.sendRaw).toHaveBeenCalledTimes(2);
    expect(h.publisher.state.attempts).toBe(2);

    const failed = harness(async () => value, 25);
    failed.sendRaw.mockReturnValue(false);
    await ready(failed);
    await vi.advanceTimersByTimeAsync(25);
    await vi.advanceTimersByTimeAsync(100);
    expect(failed.sendRaw).toHaveBeenCalledTimes(2);
    expect(failed.publisher.state).toMatchObject({ status: 'inactive', failure: 'send-failed', attempts: 2 });

    const transient = harness(async () => value, 25);
    await ready(transient);
    expect(transient.publisher.observeTrustedFailure('TEMPORARILY_UNAVAILABLE')).toBe(true);
    await vi.advanceTimersByTimeAsync(25);
    expect(transient.sendRaw).toHaveBeenCalledTimes(2);
    expect(transient.publisher.observeTrustedFailure('BAD_KEY')).toBe(true);
    expect(transient.publisher.state).toMatchObject({ status: 'inactive', failure: 'server-rejected' });
    await vi.advanceTimersByTimeAsync(100);
    expect(transient.sendRaw).toHaveBeenCalledTimes(2);
  });
});
