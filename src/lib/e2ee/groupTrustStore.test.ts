import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { GroupTrustStore, GROUP_TRUST_MAX_PINS } from './groupTrustStore';
import { type GroupDeviceDirectoryEntry } from './groupDeviceDirectory';

const entry = (n: number): GroupDeviceDirectoryEntry => ({ signerPub: new Uint8Array(32).fill(n), encryptionPub: new Uint8Array([4, 107,23,209,242,225,44,66,71,248,188,230,229,99,164,64,242,119,3,125,129,45,235,51,160,244,161,57,69,216,152,194,150,79,227,66,226,254,26,127,155,142,231,235,74,124,15,158,22,43,206,51,87,107,49,94,206,203,182,64,104,55,191,81,245]) });
const scope = { endpoint: 'wss://EXAMPLE.test:443/path', localAccount: 'Alice', remoteAccount: 'Bob', remoteDevice: 'dev' };
async function rawPut(key: string, value: unknown): Promise<void> { await new Promise<void>((resolve, reject) => { const open = indexedDB.open('onyx-group-trust', 1); open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('pins')) open.result.createObjectStore('pins'); }; open.onsuccess = () => { try { const db = open.result; const tx = db.transaction('pins', 'readwrite'); tx.objectStore('pins').put(value, key); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); } catch (error) { reject(error); } }; open.onerror = () => reject(open.error); }); }
afterEach(async () => { await new Promise<void>((resolve) => { const req = indexedDB.deleteDatabase('onyx-group-trust'); req.onsuccess = req.onerror = req.onblocked = () => resolve(); }); });
describe('group trust store', () => {
  it('scopes TOFU pins by endpoint and local account, then refuses a changed key', async () => { const store = new GroupTrustStore(); expect(await store.verify(scope, entry(1))).toEqual({ status: 'pinned' }); expect(await store.verify({ ...scope, endpoint: 'https://example.test/' }, entry(1))).toEqual({ status: 'pinned' }); expect(await store.verify(scope, entry(1))).toEqual({ status: 'known' }); expect(await store.verify(scope, entry(2))).toEqual({ status: 'changed' }); });
  it('uses explicit durable tombstones instead of silently replacing a forgotten pin', async () => { const store = new GroupTrustStore(); await store.verify(scope, entry(1)); expect(await store.forget(scope)).toEqual({ status: 'forgotten' }); expect(await store.verify(scope, entry(2))).toEqual({ status: 'forgotten' }); });
  it('refuses new pins at the explicit capacity boundary', async () => { const store = new GroupTrustStore(); for (let i = 0; i < GROUP_TRUST_MAX_PINS; i++) expect((await store.verify({ ...scope, remoteDevice: `d${i}` }, entry(1))).status).toBe('pinned'); expect(await store.verify({ ...scope, remoteDevice: 'overflow' }, entry(1))).toEqual({ status: 'full' }); });
  it('counts a new tombstone toward the same global 1024 record cap', async () => {
    const store = new GroupTrustStore();
    for (let i = 0; i < GROUP_TRUST_MAX_PINS - 1; i += 1) expect((await store.verify({ ...scope, remoteDevice: `p${i}` }, entry(1))).status).toBe('pinned');
    expect(await store.forget({ ...scope, remoteDevice: 'tombstone' })).toEqual({ status: 'forgotten' });
    expect(await store.forget({ ...scope, remoteDevice: 'overflow' })).toEqual({ status: 'full' });
    // Replacing the existing tombstone stays within the cap.
    expect(await store.forget({ ...scope, remoteDevice: 'tombstone' })).toEqual({ status: 'forgotten' });
  });
  it('rejects opaque and unsupported endpoint origins rather than colliding them', async () => { const store = new GroupTrustStore(); for (const endpoint of ['file:///tmp/x', 'data:text/plain,x', 'ftp://example.test/x']) expect(await store.verify({ ...scope, endpoint }, entry(1))).toEqual({ status: 'invalid' }); });
  it('fails closed on corrupt stored rows', async () => {
    const store = new GroupTrustStore(); const key = JSON.stringify(['wss://example.test', 'alice', 'bob', 'dev']); await rawPut(key, { nope: true });
    expect(await store.verify(scope, entry(1))).toEqual({ status: 'unavailable' }); expect(await store.forget(scope)).toEqual({ status: 'unavailable' });
  });
  it('fails closed when pin and forget writes abort', async () => {
    const store = new GroupTrustStore();
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<typeof original>) { const tx = original.apply(this, args); if (args[1] === 'readwrite') queueMicrotask(() => tx.abort()); return tx; } as typeof original;
    try { expect(await store.verify(scope, entry(1))).toEqual({ status: 'unavailable' }); expect(await store.forget(scope)).toEqual({ status: 'unavailable' }); } finally { IDBDatabase.prototype.transaction = original; }
  });
  it('serializes simultaneous cross-instance first use without two competing pins', async () => {
    const [left, right] = await Promise.all([new GroupTrustStore().verify(scope, entry(1)), new GroupTrustStore().verify(scope, entry(2))]);
    expect([left.status, right.status].sort()).toEqual(['changed', 'pinned']);
  });
});
