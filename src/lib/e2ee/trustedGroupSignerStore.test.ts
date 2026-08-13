// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toB64url } from './dmCipher';
import {
  createTrustedGroupSignerStore,
  TRUSTED_GROUP_SIGNER_DB,
  TRUSTED_GROUP_SIGNER_MAX_RECORDS,
} from './trustedGroupSignerStore';

const signer = (fill: number) => toB64url(new Uint8Array(32).fill(fill));

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}

async function openRaw(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(TRUSTED_GROUP_SIGNER_DB, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe('durable trusted group signer store', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('persists across adapters while isolating exact endpoint path, query, and local owner', async () => {
    const base = { endpoint: 'wss://chat.example/irc?realm=one', localAccount: 'Alice' };
    const first = createTrustedGroupSignerStore(base);
    await first.put({ account: 'Bob', deviceId: 'phone', signerPub: signer(1) });

    expect(await createTrustedGroupSignerStore(base).get('bob', 'phone')).toMatchObject({
      account: 'bob', deviceId: 'phone', signerPub: signer(1),
    });
    expect(await createTrustedGroupSignerStore({ ...base, endpoint: 'wss://chat.example/other?realm=one' }).get('bob', 'phone')).toBeNull();
    expect(await createTrustedGroupSignerStore({ ...base, endpoint: 'wss://chat.example/irc?realm=two' }).get('bob', 'phone')).toBeNull();
    expect(await createTrustedGroupSignerStore({ ...base, localAccount: 'Carol' }).get('bob', 'phone')).toBeNull();

    const db = await openRaw();
    const tx = db.transaction('pins', 'readonly');
    const request = tx.objectStore('pins').getAll();
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await transactionDone(tx);
    db.close();
    expect(JSON.stringify(rows)).not.toContain('realm=one');
  });

  it('is idempotent for the same key and linearizes conflicting first use', async () => {
    const scope = { endpoint: 'wss://chat.example/irc', localAccount: 'alice' };
    const a = createTrustedGroupSignerStore(scope);
    const b = createTrustedGroupSignerStore(scope);
    await expect(a.put({ account: 'bob', deviceId: 'phone', signerPub: signer(2) })).resolves.toBeUndefined();
    await expect(b.put({ account: 'BOB', deviceId: 'phone', signerPub: signer(2) })).resolves.toBeUndefined();

    const raceScope = { endpoint: 'wss://chat.example/race', localAccount: 'alice' };
    const settled = await Promise.allSettled([
      createTrustedGroupSignerStore(raceScope).put({ account: 'bob', deviceId: 'phone', signerPub: signer(3) }),
      createTrustedGroupSignerStore(raceScope).put({ account: 'bob', deviceId: 'phone', signerPub: signer(4) }),
    ]);
    expect(settled.map((entry) => entry.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('writes permanent tombstones and never silently permits re-TOFU', async () => {
    const store = createTrustedGroupSignerStore({ endpoint: 'wss://chat.example/irc', localAccount: 'alice' });
    await store.put({ account: 'bob', deviceId: 'phone', signerPub: signer(5) });
    await store.delete?.('bob', 'phone');
    expect(await store.get('bob', 'phone')).toEqual({
      account: 'bob', deviceId: 'phone', signerPub: signer(5), deleted: true,
    });
    await expect(store.put({ account: 'bob', deviceId: 'phone', signerPub: signer(5) })).rejects.toThrow();
  });

  it('fails closed for invalid scope, invalid owners, invalid signers, corruption, and unavailable IDB', async () => {
    expect(() => createTrustedGroupSignerStore({ endpoint: 'https://chat.example', localAccount: 'alice' })).toThrow();
    expect(() => createTrustedGroupSignerStore({ endpoint: 'wss://user:pass@chat.example', localAccount: 'alice' })).toThrow();
    expect(() => createTrustedGroupSignerStore({ endpoint: 'wss://chat.example/#secret', localAccount: 'alice' })).toThrow();
    const store = createTrustedGroupSignerStore({ endpoint: 'wss://chat.example/irc', localAccount: 'alice' });
    await expect(store.put({ account: 'bad account', deviceId: 'phone', signerPub: signer(1) })).rejects.toThrow();
    await expect(store.put({ account: 'bob', deviceId: 'phone', signerPub: 'not-a-key' })).rejects.toThrow();
    await store.put({ account: 'bob', deviceId: 'phone', signerPub: signer(6) });

    const db = await openRaw();
    const tx = db.transaction('pins', 'readwrite');
    const all = tx.objectStore('pins').getAll();
    const rows = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      all.onsuccess = () => resolve(all.result);
      all.onerror = () => reject(all.error);
    });
    tx.objectStore('pins').put({ ...rows[0], signerPub: 'corrupt' });
    await transactionDone(tx);
    db.close();
    await expect(store.get('bob', 'phone')).rejects.toThrow(/corrupt/u);

    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    await expect(store.get('carol', 'tablet')).rejects.toThrow(/unavailable/u);
  });

  it('rejects a version-compatible database with the wrong keyPath', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(TRUSTED_GROUP_SIGNER_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('pins');
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
    const store = createTrustedGroupSignerStore({ endpoint: 'wss://chat.example/schema', localAccount: 'alice' });
    await expect(store.get('bob', 'phone')).rejects.toThrow(/schema is corrupt/u);
  });

  it('closes a late database handle after a blocked open has failed', async () => {
    const close = vi.fn();
    const request = { result: { close }, onblocked: null, onsuccess: null } as unknown as IDBOpenDBRequest;
    vi.stubGlobal('indexedDB', {
      open: () => {
        queueMicrotask(() => {
          request.onblocked?.call(request, new Event('blocked') as IDBVersionChangeEvent);
          queueMicrotask(() => request.onsuccess?.call(request, new Event('success')));
        });
        return request;
      },
    });
    const store = createTrustedGroupSignerStore({ endpoint: 'wss://chat.example/blocked', localAccount: 'alice' });
    await expect(store.get('bob', 'phone')).rejects.toThrow(/blocked/u);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails closed when Web Crypto is missing or a write transaction aborts', async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', undefined);
    const noCrypto = createTrustedGroupSignerStore({ endpoint: 'wss://chat.example/no-crypto', localAccount: 'alice' });
    await expect(noCrypto.get('bob', 'phone')).rejects.toThrow(/Web Crypto/u);
    vi.stubGlobal('crypto', originalCrypto);

    const originalAdd = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
      const result = originalAdd.call(this, value, key);
      this.transaction.abort();
      return result;
    });
    const aborting = createTrustedGroupSignerStore({ endpoint: 'wss://chat.example/abort', localAccount: 'alice' });
    await expect(aborting.put({ account: 'bob', deviceId: 'phone', signerPub: signer(9) })).rejects.toThrow();
  });

  it('enforces the global 1024-row bound without eviction', async () => {
    const seed = createTrustedGroupSignerStore({ endpoint: 'wss://chat.example/seed', localAccount: 'alice' });
    expect(await seed.get('bob', 'phone')).toBeNull();
    const db = await openRaw();
    const tx = db.transaction('pins', 'readwrite');
    const store = tx.objectStore('pins');
    for (let i = 0; i < TRUSTED_GROUP_SIGNER_MAX_RECORDS; i += 1) {
      store.put({ key: `fill-${i}`, v: 1, scope: 'fill', localAccount: 'fill', remoteAccount: 'fill', remoteDeviceId: 'fill', signerPub: signer(7), deleted: false });
    }
    await transactionDone(tx);
    db.close();
    await expect(seed.put({ account: 'bob', deviceId: 'phone', signerPub: signer(8) })).rejects.toThrow(/full/u);
  });
});
