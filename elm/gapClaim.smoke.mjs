/* v3/gap-claim ports smoke — the claim path for history written before
   owner scoping, against the REAL vault code (ports.js) over a fake
   IndexedDB that has real transaction semantics (an aborted transaction
   rolls its writes back).

   Covered: the scan (counts and dates only, never message text), the
   quarantine (legacy rows are invisible to reads, search, export and
   sends), retention protection (neither the per-write trim nor the
   policy-save sweep can take them), attach (atomic per batch,
   idempotent, resumable, never touches rows stamped for any identity,
   owned copy wins on a collision, verified result), delete (same
   guarantees), the history-off refusal, the serial queue, the device
   decision record, and the port bridge answers.

   Run with:
     node --test elm/gapClaim.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function memoryStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}
globalThis.localStorage = memoryStorage();
globalThis.IDBKeyRange = { only: (v) => ({ only: v }), bound: (lower, upper) => ({ lower, upper }) };
require("./ports.js");
const { gapClaim, gapAccount, vaultStore, outboxStore } = globalThis.OnyxPorts;

const KAI = '["onyx","account","kai"]';
const LEE = '["onyx","account","lee"]';
const GUEST = '["onyx","guest"]';
const STATE_KEY = gapClaim.stateKey;

/* ---------- a fake IndexedDB with rollback ---------- */

function fakeIdb(opts) {
  const options = opts || {};
  const data = { messages: new Map(), outbox: new Map(), scheduled: new Map(), vault_meta: new Map() };
  let readwriteCount = 0;
  const db = {
    data,
    options,
    get readwriteCount() { return readwriteCount; },
    transaction(names, mode) {
      const name = Array.isArray(names) ? names[0] : names;
      if (options.deadStore && name === "messages") throw new Error("InvalidStateError");
      const rw = mode === "readwrite";
      const txNo = rw ? ++readwriteCount : 0;
      const journal = [];
      const tx = { pending: 0, done: false, aborted: false, oncomplete: null, onerror: null, onabort: null };
      const finish = () => {
        if (tx.done) return;
        tx.done = true;
        if (rw && options.failTx && options.failTx(txNo)) tx.aborted = true;
        if (tx.aborted) {
          for (let i = journal.length - 1; i >= 0; i -= 1) {
            const [map, key, prev] = journal[i];
            if (prev === undefined) map.delete(key); else map.set(key, prev);
          }
          if (tx.onabort) tx.onabort();
        } else if (tx.oncomplete) {
          tx.oncomplete();
        }
      };
      const settle = () => {
        if (tx.done || tx.pending !== 0) return;
        setImmediate(() => { if (!tx.done && tx.pending === 0) finish(); });
      };
      const request = (compute) => {
        const req = {};
        tx.pending += 1;
        setImmediate(() => {
          try { req.result = compute(); } catch (err) { req.error = err; }
          if (req.error) { if (req.onerror) req.onerror({ target: req }); } else if (req.onsuccess) req.onsuccess({ target: req });
          tx.pending -= 1;
          settle();
        });
        return req;
      };
      const record = (map, key) => journal.push([map, key, map.has(key) ? JSON.parse(JSON.stringify(map.get(key))) : undefined]);
      const makeStore = (storeName) => {
        const map = data[storeName];
        const cursorOver = (entries) => {
          const req = {};
          let i = 0;
          const step = () => {
            tx.pending += 1;
            setImmediate(() => {
              if (i < entries.length) {
                const [key, value] = entries[i];
                req.result = {
                  value: JSON.parse(JSON.stringify(value)),
                  primaryKey: key,
                  continue() { i += 1; step(); },
                  delete() { if (rw) record(map, key); map.delete(key); },
                };
              } else {
                req.result = null;
              }
              if (req.onsuccess) req.onsuccess({ target: req });
              tx.pending -= 1;
              settle();
            });
          };
          step();
          return req;
        };
        const sorted = (filter, dir) => {
          const list = [...map.entries()].filter(([k, v]) => filter(k, v)).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
          return dir === "prev" ? list.reverse() : list;
        };
        return {
          put(row) { record(map, row.id); map.set(row.id, JSON.parse(JSON.stringify(row))); },
          get(key) { return request(() => { const v = map.get(key); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }); },
          delete(key) { record(map, key); map.delete(key); },
          clear() { map.clear(); },
          count() { return request(() => map.size); },
          getAll() { return request(() => [...map.values()].map((v) => JSON.parse(JSON.stringify(v)))); },
          openCursor(range, dir) { return cursorOver(sorted((k) => !range || range.only === undefined || k === range.only, dir)); },
          index() {
            return { openCursor(range, dir) { return cursorOver(sorted((k, v) => !range || v.target === range.only, dir)); } };
          },
        };
      };
      tx.objectStore = (storeName) => makeStore(storeName || name);
      tx.abort = () => { tx.aborted = true; settle(); };
      settle();
      return tx;
    },
  };
  return db;
}

const put = (db, rows, owner) => new Promise((resolve) => vaultStore.put(db, rows, resolve, owner));
const get = (db, target, owner) => new Promise((resolve) => vaultStore.get(db, target, 5000, (rows, status) => resolve({ rows, status }), owner));
const exportAll = (db, owner) => new Promise((resolve) => vaultStore.exportAll(db, resolve, owner));
const search = (db, query, owner) => new Promise((resolve) => vaultStore.searchMode(db, query, "exact", { limit: 50, owner }, (rows) => resolve(rows)));
const scan = (db, opts) => new Promise((resolve) => gapClaim.scan(db, opts || {}, resolve));
const attach = (db, owner, onProgress) => new Promise((resolve) => gapClaim.attach(db, owner, { progress: onProgress }, resolve));
const remove = (db, onProgress) => new Promise((resolve) => gapClaim.remove(db, { progress: onProgress }, resolve));
const row = (id, target, body, at) => ({ id, target, from: "alice", body, at });

/* Rows as the vault held them before scoping: no owner, no rid. */
function legacy(db, id, target, body, at, extra) {
  db.data.messages.set(id, { id, target, from: "alice", body, at, deleted: false, redacted: false, ...(extra || {}) });
}

function seedLegacy(db) {
  legacy(db, "#lounge:1", "#lounge", "SECRET-ONE needle", 1_700_000_000_000);
  legacy(db, "#lounge:2", "#Lounge", "SECRET-TWO", 1_700_100_000_000);
  legacy(db, "alice:1", "alice", "SECRET-DM decrypted", 1_699_000_000_000, { encrypted: true });
  legacy(db, "alice:2", "alice", "SECRET-DM-TWO", 0);
}

/* ---------- scan ---------- */

test("scan counts the unstamped rows, conversations and dates - and never reads message text", async () => {
  const db = fakeIdb();
  seedLegacy(db);
  await put(db, [row("#c:1", "#c", "stamped", 5)], KAI);
  const out = await scan(db, { scope: KAI });
  assert.equal(out.ok, true);
  assert.equal(out.rows, 4);
  assert.equal(out.conversations, 2, "#lounge and #Lounge are one conversation");
  assert.equal(out.oldest, 1_699_000_000_000);
  assert.equal(out.newest, 1_700_100_000_000);
  assert.equal(out.undated, 1, "an at-0 row has no usable time");
  assert.equal(out.otherOwners, 0, "the asking scope's own rows are not 'other'");
  assert.equal(out.truncated, false);
  const flat = JSON.stringify(out);
  for (const secret of ["SECRET", "needle", "alice", "decrypted"]) assert.ok(!flat.includes(secret), `scan result leaks ${secret}`);
});

test("scan counts other identities on the device without naming them", async () => {
  const db = fakeIdb();
  seedLegacy(db);
  await put(db, [row("#c:1", "#c", "a", 5)], KAI);
  await put(db, [row("#c:1", "#c", "b", 5)], LEE);
  await put(db, [row("#c:1", "#c", "c", 5)], GUEST);
  const asKai = await scan(db, { scope: KAI });
  assert.equal(asKai.otherOwners, 2);
  assert.ok(!JSON.stringify(asKai).includes("lee"));
  const asNobody = await scan(db, {});
  assert.equal(asNobody.otherOwners, 3);
});

test("the guest scope is not counted as another identity (everyone starts as a guest)", async () => {
  const db = fakeIdb();
  seedLegacy(db);
  await put(db, [row("#c:1", "#c", "a", 5)], KAI);
  await put(db, [row("#c:1", "#c", "g", 5)], GUEST);
  assert.equal((await scan(db, { scope: KAI })).otherOwners, 1);
  assert.equal((await scan(db, { scope: KAI, guest: GUEST })).otherOwners, 0);
  await put(db, [row("#c:1", "#c", "b", 5)], LEE);
  assert.equal((await scan(db, { scope: KAI, guest: GUEST })).otherOwners, 1);
  assert.equal((await scan(db, { scope: GUEST, guest: GUEST })).otherOwners, 2, "a guest sees the accounts");
});

test("scan of a clean or empty vault finds nothing, and keys are only returned on request", async () => {
  const db = fakeIdb();
  const empty = await scan(db, { scope: KAI });
  assert.deepEqual([empty.ok, empty.rows, empty.conversations, empty.oldest, empty.newest], [true, 0, 0, null, null]);
  await put(db, [row("#c:1", "#c", "x", 5)], KAI);
  assert.equal((await scan(db, { scope: KAI })).rows, 0);
  seedLegacy(db);
  assert.equal("keys" in (await scan(db, { scope: KAI })), false);
  assert.equal((await scan(db, { scope: KAI, keys: true })).keys.length, 4);
});

test("scan: no store is clean only on a host without IndexedDB; a store that cannot be read is not 'clean'", async () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  try {
    delete globalThis.indexedDB;
    assert.equal((await scan(null)).ok, true);
    globalThis.indexedDB = {};
    assert.equal((await scan(null)).ok, false);
  } finally {
    if (had) Object.defineProperty(globalThis, "indexedDB", had); else delete globalThis.indexedDB;
  }
  assert.equal((await scan(fakeIdb({ deadStore: true }))).ok, false);
});

/* ---------- quarantine until claimed ---------- */

test("unclaimed legacy rows are invisible to reads, search, export, and queued-send flushes", async () => {
  const db = fakeIdb();
  seedLegacy(db);
  await put(db, [row("#lounge:9", "#lounge", "kai own", 1_700_200_000_000)], KAI);
  assert.deepEqual((await get(db, "#lounge", KAI)).rows.map((r) => r.body), ["kai own"]);
  assert.deepEqual((await get(db, "#lounge", GUEST)).rows, []);
  assert.deepEqual(await search(db, "SECRET", KAI), []);
  assert.deepEqual(await search(db, "needle", GUEST), []);
  assert.deepEqual((await exportAll(db, KAI)).targets.map((t) => t.messages.map((m) => m.text)), [["kai own"]]);
  assert.deepEqual((await exportAll(db, GUEST)).targets, []);
  // an ownerless queued send is never sent under an identity
  db.data.outbox.set("ob-0", { id: "ob-0", target_key: "#c", target: "#c", text: "old queued", queued_at: Date.now() });
  const sent = [];
  const report = await new Promise((resolve) => outboxStore.flush(db, { isOpen: () => true, send: (l) => sent.push(l) }, resolve, false, KAI));
  assert.deepEqual(sent, []);
  assert.deepEqual(report.sent, []);
  assert.ok(db.data.outbox.has("ob-0"));
});

/* ---------- retention protection ---------- */

test("retention never trims unstamped rows: not by count, not by age, not on write, not on a policy sweep", async () => {
  const db = fakeIdb();
  for (let i = 1; i <= 6; i += 1) legacy(db, `#c:old${i}`, "#c", `legacy ${i}`, 1000 + i); // ancient (1970)
  globalThis.localStorage.setItem("onyx:vault-retention-policy", JSON.stringify({ keep: 2, maxAgeDays: 1 }));
  try {
    // an identity writes into the same conversation: its own bucket is trimmed ...
    await put(db, [row("#c:1", "#c", "k1", Date.now() - 10), row("#c:2", "#c", "k2", Date.now() - 5), row("#c:3", "#c", "k3", Date.now())], KAI);
    assert.deepEqual((await get(db, "#c", KAI)).rows.map((r) => r.body), ["k2", "k3"], "owned rows still honour keep=2");
    // ... the quarantined rows are not
    assert.equal((await scan(db, { scope: KAI })).rows, 6, "per-write trim left the legacy rows alone");
    const deleted = await new Promise((resolve) => gapAccount.pruneAllTargets(db, resolve));
    assert.equal(deleted, 0, "the policy-save sweep skips the legacy bucket (owned rows are already within the policy)");
    assert.equal((await scan(db, { scope: KAI })).rows, 6, "the sweep left the legacy rows alone");
  } finally {
    globalThis.localStorage.removeItem("onyx:vault-retention-policy");
  }
});

test("once attached the rows follow the owner's retention like any other", async () => {
  const db = fakeIdb();
  for (let i = 1; i <= 4; i += 1) legacy(db, `#c:old${i}`, "#c", `legacy ${i}`, 1000 + i);
  await attach(db, KAI);
  globalThis.localStorage.setItem("onyx:vault-retention-policy", JSON.stringify({ keep: 2 }));
  try {
    const deleted = await new Promise((resolve) => gapAccount.pruneAllTargets(db, resolve));
    assert.equal(deleted, 2);
    assert.deepEqual((await get(db, "#c", KAI)).rows.map((r) => r.body), ["legacy 3", "legacy 4"]);
  } finally {
    globalThis.localStorage.removeItem("onyx:vault-retention-policy");
  }
});

/* ---------- attach ---------- */

test("attach re-keys ONLY the unstamped rows under the chosen scope", async () => {
  const db = fakeIdb();
  seedLegacy(db);
  await put(db, [row("#lounge:9", "#lounge", "kai own", 1_700_200_000_000)], KAI);
  await put(db, [row("#lounge:1", "#lounge", "lee own", 1_700_300_000_000)], LEE);
  await put(db, [row("#lounge:1", "#lounge", "guest own", 1_700_400_000_000)], GUEST);
  const stampedBy = (owner) => [...db.data.messages.entries()].filter(([, v]) => v.owner === owner).map(([k, v]) => [k, JSON.stringify(v)]);
  const before = { kai: stampedBy(KAI), lee: stampedBy(LEE), guest: stampedBy(GUEST) };

  const res = await attach(db, KAI);
  assert.deepEqual({ ok: res.ok, total: res.total, attached: res.attached, merged: res.merged, remaining: res.remaining, reason: res.reason }, { ok: true, total: 4, attached: 4, merged: 0, remaining: 0, reason: "" });

  // other identities' physical rows are byte-for-byte unchanged
  assert.deepEqual(stampedBy(LEE), before.lee);
  assert.deepEqual(stampedBy(GUEST), before.guest);
  assert.ok(before.kai.every(([k, v]) => stampedBy(KAI).some(([k2, v2]) => k2 === k && v2 === v)), "the scope's own existing rows are unchanged");

  // the chosen scope now sees the history; nobody else does
  const lounge = (await get(db, "#lounge", KAI)).rows.map((r) => [r.id, r.body]);
  assert.deepEqual(lounge, [["#lounge:1", "SECRET-ONE needle"], ["#lounge:9", "kai own"]]);
  assert.deepEqual((await get(db, "#Lounge", KAI)).rows.map((r) => r.body), ["SECRET-TWO"], "a differently-cased legacy target keeps its own target string");
  assert.deepEqual((await get(db, "alice", KAI)).rows.map((r) => r.body).sort(), ["SECRET-DM decrypted", "SECRET-DM-TWO"]);
  assert.deepEqual((await get(db, "#lounge", LEE)).rows.map((r) => r.body), ["lee own"]);
  assert.deepEqual((await get(db, "#lounge", GUEST)).rows.map((r) => r.body), ["guest own"]);
  assert.equal((await search(db, "needle", KAI)).length, 1);
  assert.deepEqual(await search(db, "needle", LEE), []);
  assert.equal((await exportAll(db, KAI)).targets.reduce((n, t) => n + t.messages.length, 0), 5);
  // nothing is left unstamped
  assert.deepEqual((await get(db, "#lounge", undefined)).rows, []);
  assert.equal((await scan(db, { scope: KAI })).rows, 0);
});

test("attach keeps every field of the row, including the logical id and encrypted/reply/tombstone flags", async () => {
  const db = fakeIdb();
  legacy(db, "alice:7", "alice", "hi", 1_700_000_000_500, { encrypted: true, deleted: false, redacted: true, rowType: "action", replyTo: { id: "alice:3", from: "bob", text: "q" } });
  await attach(db, KAI);
  const physical = [...db.data.messages.values()];
  assert.equal(physical.length, 1);
  const stored = physical[0];
  assert.equal(stored.owner, KAI);
  assert.equal(stored.rid, "alice:7");
  assert.equal(stored.id, `${KAI}\u0000alice:7`);
  assert.equal(stored.encrypted, true);
  assert.equal(stored.redacted, true);
  assert.deepEqual(stored.replyTo, { id: "alice:3", from: "bob", text: "q" });
  assert.equal(stored.at, 1_700_000_000_500, "the original time is kept, not the claim time");
  assert.equal(stored.rowType, "action");
});

test("attach is idempotent: a second run finds nothing and changes nothing", async () => {
  const db = fakeIdb();
  seedLegacy(db);
  const first = await attach(db, KAI);
  const snapshot = JSON.stringify([...db.data.messages.entries()]);
  const second = await attach(db, KAI);
  assert.equal(first.attached, 4);
  assert.deepEqual({ ok: second.ok, total: second.total, attached: second.attached, merged: second.merged, remaining: second.remaining }, { ok: true, total: 0, attached: 0, merged: 0, remaining: 0 });
  assert.equal(JSON.stringify([...db.data.messages.entries()]), snapshot);
  // a different scope attaching afterwards finds nothing either: rows are claimed once
  const late = await attach(db, LEE);
  assert.equal(late.attached, 0);
  assert.deepEqual((await get(db, "alice", LEE)).rows, []);
});

test("a row the scope already holds wins: the legacy duplicate is merged away, never overwriting", async () => {
  const db = fakeIdb();
  legacy(db, "#c:1", "#c", "legacy copy", 1000);
  legacy(db, "#c:2", "#c", "only legacy", 2000);
  await put(db, [row("#c:1", "#c", "owned copy", 1000)], KAI);
  const res = await attach(db, KAI);
  assert.equal(res.attached, 1);
  assert.equal(res.merged, 1);
  assert.equal(res.remaining, 0);
  assert.deepEqual((await get(db, "#c", KAI)).rows.map((r) => r.body), ["owned copy", "only legacy"]);
  assert.equal(db.data.messages.size, 2);
});

test("a large vault attaches in batches, each a transaction, with monotonic progress", async () => {
  const db = fakeIdb();
  const n = gapClaim.batchSize * 2 + 100;
  for (let i = 0; i < n; i += 1) legacy(db, `#big:${i}`, "#big", `m${i}`, 1_700_000_000_000 + i);
  const beforeTx = db.readwriteCount;
  const progress = [];
  const res = await attach(db, KAI, (done, total) => progress.push([done, total]));
  assert.equal(res.ok, true);
  assert.equal(res.attached, n);
  assert.equal(db.readwriteCount - beforeTx, 3, "three batches of <= batchSize");
  assert.deepEqual(progress.map((p) => p[0]), [gapClaim.batchSize, gapClaim.batchSize * 2, n]);
  assert.ok(progress.every(([, total]) => total === n));
  assert.equal((await get(db, "#big", KAI)).rows.length, n);
});

test("an interrupted attach is resumable: finished batches stay attached, the failed batch rolls back whole, a retry completes", async () => {
  const db = fakeIdb({ failTx: (no) => no === 2 }); // the second readwrite transaction aborts
  const n = gapClaim.batchSize * 2 + 50;
  for (let i = 0; i < n; i += 1) legacy(db, `#big:${i}`, "#big", `m${i}`, 1_700_000_000_000 + i);
  const failed = await attach(db, KAI);
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "write");
  assert.equal(failed.attached, gapClaim.batchSize, "only the committed batch is counted");
  assert.equal(failed.remaining, n - gapClaim.batchSize, "the rolled-back batch is whole again, nothing half-moved");
  // no row exists in both forms, none is lost
  const physical = [...db.data.messages.values()];
  assert.equal(physical.length, n);
  assert.equal(physical.filter((r) => r.owner === KAI).length, gapClaim.batchSize);
  assert.equal(new Set(physical.map((r) => r.rid || r.id)).size, n);
  // the device remembers the attach did not finish
  assert.equal(gapClaim.readState(globalThis.localStorage).interrupted, true);

  db.options.failTx = null; // storage recovered
  const resumed = await attach(db, KAI);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.attached, n - gapClaim.batchSize);
  assert.equal(resumed.remaining, 0);
  assert.equal((await get(db, "#big", KAI)).rows.length, n);
  assert.equal(gapClaim.readState(globalThis.localStorage).interrupted, false, "the marker clears once it is verified done");
});

test("attach refuses a bad scope and changes nothing", async () => {
  const db = fakeIdb();
  seedLegacy(db);
  const snapshot = JSON.stringify([...db.data.messages.entries()]);
  for (const bad of ["", null, undefined, 7, "x".repeat(5000)]) {
    const res = await attach(db, bad);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "scope");
  }
  assert.equal(JSON.stringify([...db.data.messages.entries()]), snapshot);
});

test("attach is refused while local history is off (the person opted out); delete is still allowed", async () => {
  const db = fakeIdb();
  seedLegacy(db);
  globalThis.localStorage.setItem("onyx:preferences", JSON.stringify({ localHistory: false }));
  try {
    const refused = await attach(db, KAI);
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "history-off");
    assert.equal((await scan(db, { scope: KAI })).rows, 4);
    const removed = await remove(db);
    assert.equal(removed.ok, true);
    assert.equal(removed.deleted, 4);
  } finally {
    globalThis.localStorage.removeItem("onyx:preferences");
  }
});

test("attach with no store reports it instead of pretending", async () => {
  const res = await attach(null, KAI);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "unavailable");
});

/* ---------- delete ---------- */

test("delete erases ONLY the unstamped rows, verified", async () => {
  const db = fakeIdb();
  seedLegacy(db);
  await put(db, [row("#lounge:9", "#lounge", "kai own", 1_700_200_000_000)], KAI);
  await put(db, [row("#lounge:1", "#lounge", "lee own", 1_700_300_000_000)], LEE);
  const stamped = [...db.data.messages.entries()].filter(([, v]) => v.owner).map(([k, v]) => [k, JSON.stringify(v)]);
  const res = await remove(db);
  assert.deepEqual({ ok: res.ok, total: res.total, deleted: res.deleted, remaining: res.remaining }, { ok: true, total: 4, deleted: 4, remaining: 0 });
  assert.deepEqual([...db.data.messages.entries()].map(([k, v]) => [k, JSON.stringify(v)]), stamped, "every stamped row is untouched");
  assert.deepEqual((await get(db, "#lounge", KAI)).rows.map((r) => r.body), ["kai own"]);
  assert.deepEqual((await get(db, "#lounge", LEE)).rows.map((r) => r.body), ["lee own"]);
  assert.equal((await scan(db, { scope: KAI })).rows, 0);
});

test("delete in batches reports progress; a failed batch rolls back and the result says so", async () => {
  const db = fakeIdb({ failTx: (no) => no === 2 });
  const n = gapClaim.batchSize + 20;
  for (let i = 0; i < n; i += 1) legacy(db, `#big:${i}`, "#big", `m${i}`, 1_700_000_000_000 + i);
  const progress = [];
  const failed = await remove(db, (done, total) => progress.push([done, total]));
  assert.equal(failed.ok, false);
  assert.equal(failed.deleted, gapClaim.batchSize);
  assert.equal(failed.remaining, 20);
  assert.equal(db.data.messages.size, 20);
  db.options.failTx = null;
  const again = await remove(db);
  assert.equal(again.ok, true);
  assert.equal(again.remaining, 0);
  assert.equal(db.data.messages.size, 0);
});

test("delete never erases a row that was stamped between the scan and the batch", async () => {
  const db = fakeIdb();
  seedLegacy(db);
  // a concurrent claim (another tab) stamps one of the scanned rows
  const original = db.transaction.bind(db);
  let raced = false;
  db.transaction = (names, mode) => {
    if (mode === "readwrite" && !raced) {
      raced = true;
      const victim = db.data.messages.get("alice:1");
      db.data.messages.delete("alice:1");
      db.data.messages.set(`${KAI}\u0000alice:1`, { ...victim, rid: "alice:1", owner: KAI, id: `${KAI}\u0000alice:1` });
    }
    return original(names, mode);
  };
  const res = await remove(db);
  assert.equal(res.ok, true);
  assert.deepEqual((await get(db, "alice", KAI)).rows.map((r) => r.body), ["SECRET-DM decrypted"], "the claimed row survived the delete");
});

/* ---------- empty vault ---------- */

test("attach on a vault with nothing to claim ends cleanly in zero work", async () => {
  const db = fakeIdb();
  const res = await attach(db, KAI);
  assert.deepEqual({ ok: res.ok, total: res.total, attached: res.attached, remaining: res.remaining }, { ok: true, total: 0, attached: 0, remaining: 0 });
  assert.ok(gapClaim.scanCap >= 100000);
});

/* ---------- DM proof cache ---------- */

test("attach voids the per-conversation DM privacy proof", async () => {
  const db = fakeIdb();
  legacy(db, "alice:1", "alice", "ONYXDM1 AAAA", 1000, { encrypted: true });
  await put(db, [row("alice:2", "alice", "plain", 2000)], KAI);
  const verdict = () => new Promise((resolve) => vaultStore.classifyDm(db, "alice", resolve, KAI));
  assert.equal(await verdict(), "plain", "the legacy encrypted row is not this scope's yet");
  await attach(db, KAI);
  assert.equal(await verdict(), "encrypted", "the attached encrypted row now counts");
});

/* ---------- serial queue ---------- */

test("claim operations run one at a time", async () => {
  const order = [];
  let releaseFirst;
  gapClaim.enqueue((release) => { order.push("a:start"); releaseFirst = () => { order.push("a:end"); release(); }; });
  gapClaim.enqueue((release) => { order.push("b:start"); release(); order.push("b:end"); });
  assert.deepEqual(order, ["a:start"]);
  releaseFirst();
  assert.deepEqual(order, ["a:start", "a:end", "b:start", "b:end"]);
});

test("a throwing job never wedges the queue", async () => {
  const order = [];
  gapClaim.enqueue(() => { throw new Error("boom"); });
  gapClaim.enqueue((release) => { order.push("next"); release(); });
  assert.deepEqual(order, ["next"]);
});

/* ---------- device decision record ---------- */

test("the decision record: Not now persists, an unfinished attach is remembered, junk reads as undecided", () => {
  const store = memoryStorage();
  assert.deepEqual(gapClaim.readState(store), { dismissed: false, interrupted: false });
  assert.equal(gapClaim.writeState(store, { dismissed: true, dismissedAt: 5 }), true);
  assert.deepEqual(gapClaim.readState(store), { dismissed: true, interrupted: false });
  gapClaim.writeState(store, { attach: { scope: KAI, at: 9 } });
  assert.deepEqual(gapClaim.readState(store), { dismissed: true, interrupted: true });
  gapClaim.writeState(store, { attach: null });
  assert.deepEqual(gapClaim.readState(store), { dismissed: true, interrupted: false });
  assert.deepEqual(JSON.parse(store.getItem(STATE_KEY)), { v: 1, dismissed: true, dismissedAt: 5 });
  for (const junk of ["{nope", "[]", "7", "null", '{"dismissed":"yes","attach":[]}']) {
    store.setItem(STATE_KEY, junk);
    assert.deepEqual(gapClaim.readState(store), { dismissed: false, interrupted: false }, junk);
  }
  assert.equal(gapClaim.writeState(null, { dismissed: true }), false);
  assert.deepEqual(gapClaim.readState(null), { dismissed: false, interrupted: false });
});

/* ---------- the port bridge ---------- */

const stubPort = () => ({ subscribe() {}, send() {} });

async function bridge(db, seed) {
  const answers = [];
  let handler = null;
  const ports = {
    wsConnect: stubPort(), wsSend: stubPort(), wsClose: stubPort(), vaultPut: stubPort(), vaultGet: stubPort(),
    passkeyCreate: stubPort(), passkeyGet: stubPort(), passkeySettleRequest: stubPort(),
    dmSealRequest: stubPort(), dmOpenRequest: stubPort(), dmPublishKey: stubPort(),
    roomSealRequest: stubPort(), roomOpenRequest: stubPort(), groupControlInstall: stubPort(), groupDirectoryDerive: stubPort(),
    guidesProgressRequest: stubPort(), guidesProgressStore: stubPort(), blocklistsSave: stubPort(),
    gapClaimRequest: { subscribe(fn) { handler = fn; } },
    gapClaimAnswer: { send(v) { answers.push(v); } },
  };
  const store = memoryStorage(seed);
  globalThis.window = { addEventListener() {}, localStorage: store };
  globalThis.document = { querySelector: () => null, addEventListener() {} };
  globalThis.localStorage = store;
  globalThis.indexedDB = {
    open() {
      const req = {};
      setTimeout(() => { req.result = db; if (req.onsuccess) req.onsuccess(); }, 0);
      return req;
    },
  };
  globalThis.OnyxPorts.wire({ ports });
  await new Promise((r) => setTimeout(r, 20));
  return { answers, send: (req) => handler(req), store };
}

function cleanupBridge() {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.indexedDB;
  globalThis.localStorage = memoryStorage();
}

const until = async (cond, ms = 4000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

test("bridge: scan answers with counts, the device decision and the scope it is for", async () => {
  const db = fakeIdb();
  seedLegacy(db);
  const h = await bridge(db, { [STATE_KEY]: JSON.stringify({ v: 1, dismissed: true }), "onyx:preferences": JSON.stringify({ localHistory: true }) });
  try {
    h.send({ op: "scan", scope: KAI, guest: GUEST });
    await until(() => h.answers.length >= 1);
    const a = h.answers[0];
    assert.equal(a.kind, "scan");
    assert.equal(a.scope, KAI);
    assert.equal(a.ok, true);
    assert.equal(a.rows, 4);
    assert.equal(a.conversations, 2);
    assert.equal(a.dismissed, true);
    assert.equal(a.interrupted, false);
    assert.equal(a.historyOn, true);
    assert.ok(!JSON.stringify(a).includes("SECRET"));
  } finally {
    cleanupBridge();
  }
});

test("bridge: Not now is remembered on the device; attach answers progress then a verified result", async () => {
  const db = fakeIdb();
  const n = gapClaim.batchSize + 5;
  for (let i = 0; i < n; i += 1) legacy(db, `#big:${i}`, "#big", `m${i}`, 1_700_000_000_000 + i);
  const h = await bridge(db);
  try {
    h.send({ op: "dismiss", scope: KAI });
    assert.equal(gapClaim.readState(h.store).dismissed, true);
    h.send({ op: "attach", scope: KAI });
    await until(() => h.answers.some((a) => a.kind === "done"));
    const kinds = h.answers.map((a) => a.kind);
    assert.deepEqual(kinds, ["progress", "progress", "done"]);
    const done = h.answers[2];
    assert.deepEqual(
      { scope: done.scope, op: done.op, ok: done.ok, total: done.total, attached: done.attached, merged: done.merged, remaining: done.remaining },
      { scope: KAI, op: "attach", ok: true, total: n, attached: n, merged: 0, remaining: 0 },
    );
    assert.ok(h.answers.slice(0, 2).every((a) => a.scope === KAI && a.op === "attach"));
  } finally {
    cleanupBridge();
  }
});

test("bridge: delete answers a verified result; a hostile scope is refused without touching the vault", async () => {
  const db = fakeIdb();
  seedLegacy(db);
  const h = await bridge(db);
  try {
    h.send({ op: "delete", scope: "x".repeat(5000) });
    h.send({ op: "attach", scope: "" });
    assert.equal(db.data.messages.size, 4);
    h.send({ op: "delete", scope: GUEST });
    await until(() => h.answers.some((a) => a.kind === "done" && a.scope === GUEST));
    const done = h.answers.find((a) => a.kind === "done" && a.scope === GUEST);
    assert.deepEqual({ op: done.op, ok: done.ok, deleted: done.deleted, remaining: done.remaining }, { op: "delete", ok: true, deleted: 4, remaining: 0 });
    assert.equal(db.data.messages.size, 0);
  } finally {
    cleanupBridge();
  }
});

test("bridge: a scan requested while an attach is in flight waits for it and sees the finished result", async () => {
  const db = fakeIdb();
  const n = gapClaim.batchSize + 30;
  for (let i = 0; i < n; i += 1) legacy(db, `#big:${i}`, "#big", `m${i}`, 1_700_000_000_000 + i);
  const h = await bridge(db);
  try {
    h.send({ op: "attach", scope: GUEST });
    h.send({ op: "scan", scope: LEE });
    await until(() => h.answers.some((a) => a.kind === "scan"));
    const doneAt = h.answers.findIndex((a) => a.kind === "done");
    const scanAt = h.answers.findIndex((a) => a.kind === "scan");
    assert.ok(doneAt >= 0 && doneAt < scanAt, "the scan answered after the attach finished");
    assert.equal(h.answers[scanAt].rows, 0);
    assert.equal(h.answers[scanAt].otherOwners, 1, "the guest scope now owns the history");
  } finally {
    cleanupBridge();
  }
});

test("bridge: an interrupted attach is reported on the next scan; finishing it clears the marker", async () => {
  const db = fakeIdb();
  seedLegacy(db);
  const h = await bridge(db, { [STATE_KEY]: JSON.stringify({ v: 1, attach: { scope: KAI, at: 1 } }) });
  try {
    h.send({ op: "scan", scope: KAI });
    await until(() => h.answers.length >= 1);
    assert.equal(h.answers[0].interrupted, true);
    h.send({ op: "attach", scope: KAI });
    await until(() => h.answers.some((a) => a.kind === "done"));
    h.send({ op: "scan", scope: KAI });
    await until(() => h.answers.filter((a) => a.kind === "scan").length >= 2);
    const last = h.answers.filter((a) => a.kind === "scan")[1];
    assert.equal(last.rows, 0);
    assert.equal(last.interrupted, false);
    assert.equal(gapClaim.readState(h.store).interrupted, false);
  } finally {
    cleanupBridge();
  }
});
