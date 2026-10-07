/* Saved-searches ports smoke test — CRUD, cap prune, import merge, and
   cross-tab sync validation against the real ports driver, backed by a
   minimal Map-backed fake IndexedDB/BroadcastChannel (the shim is dumb
   storage; all policy under test lives in ports.js).
   Run with:
     node --test elm/savedSearches.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

/* ── Minimal fake IndexedDB (Map-backed, async callbacks like the real one). */
const databases = new Map();

function flush(requests, tx) {
  for (const req of requests) {
    try {
      req.result = req.op();
    } catch (err) {
      req.error = err;
      if (req.onerror) req.onerror();
      if (tx) {
        if (tx.onerror) tx.onerror();
        return;
      }
      continue;
    }
    if (req.onsuccess) req.onsuccess();
  }
  if (tx && tx.oncomplete) tx.oncomplete();
}

function fakeObjectStore(map) {
  const ops = [];
  const txHolder = { list: ops };
  const request = (op) => {
    const req = { op, result: undefined, onsuccess: null, onerror: null };
    ops.push(req);
    return req;
  };
  return {
    _flushInto(tx) {
      txHolder.tx = tx;
      setTimeout(() => flush(ops, tx), 0);
    },
    getAll(_query, limit) {
      return request(() => {
        const values = [...map.values()];
        return limit === undefined ? values : values.slice(0, limit);
      });
    },
    getAllKeys(_query, limit) {
      return request(() => {
        const keys = [...map.keys()];
        return limit === undefined ? keys : keys.slice(0, limit);
      });
    },
    count() {
      return request(() => map.size);
    },
    get(id) {
      return request(() => map.get(id));
    },
    getKey(id) {
      return request(() => (map.has(id) ? id : undefined));
    },
    put(record) {
      return request(() => {
        map.set(record.id, JSON.parse(JSON.stringify(record)));
        return record.id;
      });
    },
    delete(key) {
      return request(() => {
        map.delete(key);
        return undefined;
      });
    },
    clear() {
      return request(() => {
        map.clear();
        return undefined;
      });
    },
  };
}

globalThis.indexedDB = {
  open(name, _version) {
    const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
    setTimeout(() => {
      let db = databases.get(name);
      if (!db) {
        db = {
          stores: new Map(),
          objectStoreNames: { contains: (s) => db.stores.has(s) },
          createObjectStore(store) {
            db.stores.set(store, new Map());
          },
          transaction(storeName, _mode) {
            const store = fakeObjectStore(db.stores.get(storeName));
            const tx = {
              objectStore: () => store,
              oncomplete: null,
              onerror: null,
              onabort: null,
            };
            store._flushInto(tx);
            return tx;
          },
        };
        databases.set(name, db);
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded();
      } else {
        req.result = db;
      }
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  },
};

/* ── Fake BroadcastChannel: same-name peers, async delivery, no self-echo. */
const channels = new Map();
globalThis.BroadcastChannel = class {
  constructor(name) {
    this.name = name;
    this.listeners = new Set();
    this.closed = false;
    if (!channels.has(name)) channels.set(name, new Set());
    channels.get(name).add(this);
  }
  addEventListener(type, fn) {
    if (type === "message") this.listeners.add(fn);
  }
  removeEventListener(type, fn) {
    if (type === "message") this.listeners.delete(fn);
  }
  postMessage(message) {
    for (const peer of channels.get(this.name) || []) {
      if (peer === this || peer.closed) continue;
      setTimeout(() => {
        for (const fn of peer.listeners) fn({ data: message });
      }, 0);
    }
  }
  close() {
    this.closed = true;
    const set = channels.get(this.name);
    if (set) set.delete(this);
  }
};

const require = createRequire(import.meta.url);
require("./ports.js");
const { savedSearches } = globalThis.OnyxPorts;

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

test("bounds mirror the oracle", () => {
  assert.equal(savedSearches.cap, 50);
  assert.equal(savedSearches.maxLabelLength, 120);
  assert.equal(savedSearches.maxQueryLength, 512);
  assert.equal(savedSearches.maxIdLength, 128);
  assert.equal(savedSearches.scanLimit, 200);
  assert.equal(savedSearches.futureSkewMs, 24 * 60 * 60 * 1000);
  assert.equal(savedSearches.syncChannel, "onyx:saved-searches:v1");
  assert.equal(savedSearches.syncStorageKey, "onyx:saved-searches:sync:v1");
});

test("save validates, upserts by label, and lists newest-first", async () => {
  await savedSearches.clear();
  assert.equal(await savedSearches.save({ label: "", query: "q", mode: "exact" }), null);
  assert.equal(await savedSearches.save({ label: "L", query: "", mode: "exact" }), null);
  assert.equal(await savedSearches.save({ label: "L", query: "q", mode: "fuzzy" }), null);

  const first = await savedSearches.save({ label: "Morning", query: "hello", mode: "exact" });
  assert.ok(first && typeof first.id === "string");
  const second = await savedSearches.save({ label: "Evening", query: "bye", mode: "hybrid" });
  assert.ok(second && second.id !== first.id);
  const relabeled = await savedSearches.save({ label: "morning ", query: "changed", mode: "semantic" });
  assert.equal(relabeled.id, first.id, "upsert-by-label reuses the id");

  const rows = await savedSearches.list();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].query, "changed", "newest first after upsert");
  assert.ok(!("seq" in rows[0]), "public rows carry no ordering metadata");
});

test("delete verifies and clear empties", async () => {
  await savedSearches.clear();
  const row = await savedSearches.save({ label: "Temp", query: "q", mode: "exact" });
  assert.equal(await savedSearches.remove(row.id), true);
  assert.deepEqual(await savedSearches.list(), []);
  assert.equal(await savedSearches.remove("ss-nope"), true);
  // Spaces are legal in ids (only control bytes are rejected), so this
  // proceeds against a missing row and verifies gone.
  assert.equal(await savedSearches.remove("has space"), true);

  await savedSearches.save({ label: "A", query: "q", mode: "exact" });
  assert.equal(await savedSearches.clear(), true);
  assert.deepEqual(await savedSearches.list(), []);
});

test("cap prunes oldest first", async () => {
  await savedSearches.clear();
  for (let i = 1; i <= 52; i++) {
    const saved = await savedSearches.save({ label: `L${i}`, query: `q${i}`, mode: "exact" });
    assert.ok(saved, `row ${i} saves`);
  }
  const rows = await savedSearches.list();
  assert.equal(rows.length, 50);
  const labels = new Set(rows.map((r) => r.label));
  assert.equal(labels.has("L1"), false);
  assert.equal(labels.has("L2"), false);
  assert.equal(labels.has("L52"), true);
});

test("export shape and import merge are idempotent", async () => {
  await savedSearches.clear();
  await savedSearches.save({ label: "Keep", query: "q1", mode: "exact" });
  const snapshot = await savedSearches.exportAll();
  assert.equal(snapshot.kind, "onyx-saved-searches");
  assert.equal(snapshot.version, 1);
  assert.ok(typeof snapshot.exportedAt === "string");
  assert.equal(snapshot.searches.length, 1);

  const hostile = {
    kind: "onyx-saved-searches",
    version: 1,
    exportedAt: new Date().toISOString(),
    searches: [
      { id: "ss-evil space", label: "Evil", query: "x", mode: "exact", createdAt: Date.now() },
      { id: "ss-good", label: "Fresh", query: "y", mode: "nope", createdAt: Date.now() },
      { id: "ss-keep-claim", label: "keep", query: "q2", mode: "hybrid", createdAt: 1234 },
      { id: "ss-new", label: "Brand", query: "z", mode: "semantic", createdAt: 2345 },
    ],
  };
  const first = await savedSearches.importRows(hostile);
  assert.equal(first.imported, 3, "label match reuses id; bad mode dropped; spaced id is legal");

  const rows = await savedSearches.list();
  const keep = rows.find((r) => r.label === "keep");
  assert.equal(keep.query, "q2", "import overwrites the matched label");
  assert.equal(keep.createdAt, 1234, "import preserves createdAt");
  const brand = rows.find((r) => r.label === "Brand");
  assert.equal(brand.id, "ss-new", "unclaimed incoming id survives");
  assert.ok(rows.some((r) => r.label === "Evil"), "space-bearing id imports");

  const again = await savedSearches.importRows(hostile);
  assert.equal(again.imported, 3, "re-import rewrites the same rows");
  assert.equal((await savedSearches.list()).length, 3, "no duplicates accumulate");

  assert.deepEqual(await savedSearches.importRows({ kind: "wrong" }), { imported: 0 });
  assert.deepEqual(await savedSearches.importRows(null), { imported: 0 });
});

test("imported id claimed by another label is re-keyed, never clobbered", async () => {
  await savedSearches.clear();
  const victim = await savedSearches.save({ label: "Victim", query: "v", mode: "exact" });
  const result = await savedSearches.importRows({
    kind: "onyx-saved-searches",
    version: 1,
    exportedAt: new Date().toISOString(),
    searches: [{ id: victim.id, label: "Intruder", query: "i", mode: "exact", createdAt: 999 }],
  });
  assert.equal(result.imported, 1);
  const rows = await savedSearches.list();
  const kept = rows.find((r) => r.label === "Victim");
  assert.equal(kept.query, "v", "unrelated row survives the id collision");
  const intruder = rows.find((r) => r.label === "Intruder");
  assert.ok(intruder && intruder.id !== victim.id, "collision gets a fresh id");
});

test("sync messages are metadata-only and echo-safe", async () => {
  const seenA = [];
  const seenB = [];
  const a = savedSearches.createSync((change) => seenA.push(change), "source-AAAAAAAA");
  const b = savedSearches.createSync((change) => seenB.push(change), "source-BBBBBBBB");

  assert.equal(savedSearches.parseSyncMessage(null), null);
  assert.equal(savedSearches.parseSyncMessage({ version: 1, source: "source-AAAAAAAA", revision: 1, reason: "save", count: 1, extra: 0 }), null);
  assert.equal(savedSearches.parseSyncMessage({ version: 2, source: "source-AAAAAAAA", revision: 1, reason: "save", count: 1 }), null);
  assert.equal(savedSearches.parseSyncMessage({ version: 1, source: "short", revision: 1, reason: "save", count: 1 }), null);
  assert.equal(savedSearches.parseSyncMessage({ version: 1, source: "source-AAAAAAAA", revision: 0, reason: "save", count: 1 }), null);
  assert.equal(savedSearches.parseSyncMessage({ version: 1, source: "source-AAAAAAAA", revision: 1, reason: "drop", count: 1 }), null);
  assert.equal(savedSearches.parseSyncMessage({ version: 1, source: "source-AAAAAAAA", revision: 1, reason: "save", count: 51 }), null);

  a.publish({ revision: 1, reason: "save", count: 1 });
  await tick(20);
  assert.equal(seenA.length, 0, "no self echo");
  assert.deepEqual(seenB, [{ revision: 1, reason: "save", count: 1 }]);

  a.publish({ revision: 1, reason: "save", count: 1 });
  await tick(20);
  assert.equal(seenB.length, 1, "stale revision ignored");

  b.publish({ revision: 7, reason: "clear", count: 0 });
  await tick(20);
  assert.deepEqual(seenA, [{ revision: 7, reason: "clear", count: 0 }]);

  a.close();
  b.close();
});
