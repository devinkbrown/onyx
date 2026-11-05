import { afterEach, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const originalCrypto = globalThis.crypto;
const originalIndexedDB = globalThis.indexedDB;
const originalIDBKeyRange = globalThis.IDBKeyRange;

beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: IDBKeyRange });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: originalIndexedDB });
  Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: originalIDBKeyRange });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
});
