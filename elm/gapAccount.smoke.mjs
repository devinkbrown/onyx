/* v3/gap-account ports smoke — per-account isolation of the device
   lists and the local history vault, the verified vault erase, the
   local-history opt-out re-check, and the app badge.
   Run with:
     node --test elm/gapAccount.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/* A Map-backed localStorage (the retention policy and the history
   opt-out re-check read it) and the IDBKeyRange the vault code names. */
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
globalThis.IDBKeyRange = { only: (v) => ({ only: v }) };
require("./ports.js");
const { gapAccount, vaultStore, outboxStore } = globalThis.OnyxPorts;

const GUEST = '["onyx","guest"]';
const KAI = '["onyx","account","kai"]';
const LEE = '["onyx","account","lee"]';
const solid = (endpoint, name) => JSON.stringify([endpoint, name]);
const MESH_A = "wss://ircx.us:8080";
const MESH_B = "wss://eshmaki.me:8080";

/* ---------- scoped device lists ---------- */

test("a guest scope seeds from the old device-global keys only", () => {
  const store = memoryStorage({
    "onyx:ignored-users": JSON.stringify(["Spam"]),
    "onyx:muted-dms": JSON.stringify(["bot"]),
    "onyx:highlight-words": JSON.stringify(["deploy"]),
    "onyx:channel-notify": JSON.stringify({ "#lounge": "none" }),
    // a Solid slot for a nick-named owner is never a guest source
    [gapAccount.solidOwnerListKey("onyx:ignored-users", solid(MESH_A, "kai"))]: JSON.stringify(["private-to-kai"]),
  });
  const out = gapAccount.loadScopedLists(store, { scope: GUEST, solidOwners: [] });
  assert.equal(out.scope, GUEST);
  assert.deepEqual(out.ignored, ["Spam"]);
  assert.deepEqual(out.muted, ["bot"]);
  assert.deepEqual(out.highlights, ["deploy"]);
  assert.deepEqual(out.notify, [{ channel: "#lounge", level: "none" }]);
});

test("an account scope seeds from the plain keys AND every Solid owner slot, deduplicated, nothing lost", () => {
  const store = memoryStorage({
    "onyx:ignored-users": JSON.stringify(["elm-era"]),
    [gapAccount.solidOwnerListKey("onyx:ignored-users", solid(MESH_A, "kai"))]: JSON.stringify(["solid-a", "ELM-ERA"]),
    [gapAccount.solidOwnerListKey("onyx:ignored-users", solid(MESH_B, "kai"))]: JSON.stringify(["solid-b"]),
    // another account's Solid slot must never be read
    [gapAccount.solidOwnerListKey("onyx:ignored-users", solid(MESH_A, "lee"))]: JSON.stringify(["lees-secret"]),
    [gapAccount.solidOwnerListKey("onyx:channel-notify", solid(MESH_A, "kai"))]: JSON.stringify({ "#a": "mentions" }),
    "onyx:channel-notify": JSON.stringify({ "#a": "none", "#b": "all" }),
  });
  const owners = [solid(MESH_A, "kai"), solid(MESH_B, "kai")];
  const out = gapAccount.loadScopedLists(store, { scope: KAI, solidOwners: owners });
  assert.deepEqual(out.ignored, ["elm-era", "solid-a", "solid-b"]);
  assert.ok(!out.ignored.includes("lees-secret"));
  // maps: the account-specific Solid slot wins over the device-global value
  const notify = Object.fromEntries(out.notify.map((e) => [e.channel, e.level]));
  assert.deepEqual(notify, { "#a": "mentions", "#b": "all" });
});

test("migration copies and never deletes its sources", () => {
  const key = gapAccount.solidOwnerListKey("onyx:ignored-users", solid(MESH_A, "kai"));
  const store = memoryStorage({
    "onyx:ignored-users": JSON.stringify(["a"]),
    [key]: JSON.stringify(["b"]),
  });
  gapAccount.loadScopedLists(store, { scope: KAI, solidOwners: [solid(MESH_A, "kai")] });
  assert.equal(store.getItem("onyx:ignored-users"), JSON.stringify(["a"]));
  assert.equal(store.getItem(key), JSON.stringify(["b"]));
  assert.ok(store.getItem(gapAccount.scopedListKey("onyx:ignored-users", KAI)));
});

test("a scope that seeded keeps its own list: an emptied list never re-seeds", () => {
  const store = memoryStorage({ "onyx:ignored-users": JSON.stringify(["old"]) });
  const first = gapAccount.loadScopedLists(store, { scope: KAI, solidOwners: [] });
  assert.deepEqual(first.ignored, ["old"]);
  // the user unblocks everyone: Elm writes the emptied list
  assert.equal(gapAccount.saveScopedLists(store, { scope: KAI, lists: { ignored: [] } }), true);
  const second = gapAccount.loadScopedLists(store, { scope: KAI, solidOwners: [] });
  assert.deepEqual(second.ignored, [], "the legacy list must not come back");
});

test("two accounts and the guest never share saved lists", () => {
  const store = memoryStorage();
  gapAccount.saveScopedLists(store, { scope: KAI, lists: { ignored: ["kai-block"], highlights: ["kai-word"], muted: ["kai-dm"], notify: [{ channel: "#k", level: "none" }] } });
  gapAccount.saveScopedLists(store, { scope: LEE, lists: { ignored: ["lee-block"] } });
  const kai = gapAccount.loadScopedLists(store, { scope: KAI, solidOwners: [] });
  const lee = gapAccount.loadScopedLists(store, { scope: LEE, solidOwners: [] });
  const guest = gapAccount.loadScopedLists(store, { scope: GUEST, solidOwners: [] });
  assert.deepEqual(kai.ignored, ["kai-block"]);
  assert.deepEqual(kai.highlights, ["kai-word"]);
  assert.deepEqual(lee.ignored, ["lee-block"]);
  assert.deepEqual(lee.highlights, []);
  assert.deepEqual(guest.ignored, []);
  assert.deepEqual(guest.muted, []);
  assert.deepEqual(guest.notify, []);
});

test("save writes only the lists it is given", () => {
  const store = memoryStorage();
  gapAccount.saveScopedLists(store, { scope: KAI, lists: { ignored: ["a"], muted: ["m"] } });
  gapAccount.saveScopedLists(store, { scope: KAI, lists: { ignored: ["a", "b"] } });
  const out = gapAccount.loadScopedLists(store, { scope: KAI, solidOwners: [] });
  assert.deepEqual(out.ignored, ["a", "b"]);
  assert.deepEqual(out.muted, ["m"]);
});

test("hostile scopes and payloads fail closed", () => {
  const store = memoryStorage();
  assert.equal(gapAccount.loadScopedLists(store, { scope: "" }), null);
  assert.equal(gapAccount.loadScopedLists(store, { scope: "x".repeat(5000) }), null);
  assert.equal(gapAccount.loadScopedLists(store, null), null);
  assert.equal(gapAccount.saveScopedLists(store, { scope: "", lists: { ignored: ["a"] } }), false);
  assert.equal(gapAccount.saveScopedLists(null, { scope: KAI, lists: { ignored: ["a"] } }), false);
  assert.equal(gapAccount.saveScopedLists(store, { scope: KAI, lists: null }), false);
  // non-string members are dropped, never stored
  gapAccount.saveScopedLists(store, { scope: KAI, lists: { ignored: ["ok", 7, null, { x: 1 }] } });
  assert.deepEqual(gapAccount.loadScopedLists(store, { scope: KAI, solidOwners: [] }).ignored, ["ok"]);
});

test("corrupt stored JSON never throws and re-seeds from the legacy keys", () => {
  const store = memoryStorage({
    "onyx:ignored-users": JSON.stringify(["legacy"]),
    [gapAccount.scopedListKey("onyx:ignored-users", KAI)]: "{not json",
  });
  const out = gapAccount.loadScopedLists(store, { scope: KAI, solidOwners: [] });
  assert.deepEqual(out.ignored, ["legacy"]);
});

test("no storage answers empty lists without throwing", () => {
  const out = gapAccount.loadScopedLists(null, { scope: KAI, solidOwners: [] });
  assert.deepEqual([out.ignored, out.muted, out.highlights, out.notify], [[], [], [], []]);
});

test("a scope key with hostile characters stays one storage key", () => {
  const key = gapAccount.scopedListKey("onyx:ignored-users", '["onyx","account","a:b/c"]');
  assert.ok(key.startsWith("onyx:ignored-users:scope:"));
  assert.ok(!key.slice("onyx:ignored-users:scope:".length).includes(":"));
});

/* ---------- owner scoping of the vault ---------- */

function fakeIdb(opts) {
  const options = opts || {};
  const data = { messages: new Map(), outbox: new Map(), scheduled: new Map(), vault_meta: new Map() };
  const db = {
    data,
    options,
    transaction(names) {
      const name = Array.isArray(names) ? names[0] : names;
      const map = data[name];
      const tx = { pending: 0, done: false, aborted: false, oncomplete: null, onerror: null, onabort: null };
      const settle = () => {
        if (tx.done || tx.pending !== 0) return;
        setTimeout(() => {
          if (tx.done || tx.pending !== 0) return;
          tx.done = true;
          if (tx.aborted) { if (tx.onabort) tx.onabort(); } else if (tx.oncomplete) tx.oncomplete();
        }, 0);
      };
      const request = (compute) => {
        const req = {};
        tx.pending += 1;
        setTimeout(() => {
          try { req.result = compute(); } catch (err) { req.error = err; }
          const evt = { target: req };
          if (req.error) { if (req.onerror) req.onerror(evt); } else if (req.onsuccess) req.onsuccess(evt);
          tx.pending -= 1;
          settle();
        }, 0);
        return req;
      };
      const cursor = (entries) => {
        const req = {};
        let i = 0;
        const step = () => {
          tx.pending += 1;
          setTimeout(() => {
            if (i < entries.length) {
              const [key, value] = entries[i];
              req.result = {
                value,
                primaryKey: key,
                continue() { i += 1; step(); },
                delete() { map.delete(key); },
              };
            } else {
              req.result = null;
            }
            if (req.onsuccess) req.onsuccess({ target: req });
            tx.pending -= 1;
            settle();
          }, 0);
        };
        step();
        return req;
      };
      const sortedEntries = (filter, dir) => {
        const list = [...map.entries()].filter(([, v]) => filter(v)).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
        return dir === "prev" ? list.reverse() : list;
      };
      const store = {
        put(row) { map.set(row.id, JSON.parse(JSON.stringify(row))); },
        add(row) {
          if (map.has(row.id)) throw new Error("ConstraintError");
          return request(() => { map.set(row.id, JSON.parse(JSON.stringify(row))); return row.id; });
        },
        delete(key) { map.delete(key); },
        clear() {
          if (options.failClear) { tx.aborted = true; settle(); return; }
          map.clear();
        },
        count() { return request(() => (options.stuckRows ? options.stuckRows : map.size)); },
        getAll() { return request(() => [...map.values()].map((v) => JSON.parse(JSON.stringify(v)))); },
        openCursor(range, dir) { return cursor(sortedEntries(() => true, dir)); },
        index() {
          return { openCursor(range, dir) { return cursor(sortedEntries((v) => !range || v.target === range.only, dir)); } };
        },
      };
      tx.objectStore = () => store;
      settle();
      return tx;
    },
  };
  return db;
}

const put = (db, rows, owner) => new Promise((resolve) => vaultStore.put(db, rows, resolve, owner));
const get = (db, target, owner) => new Promise((resolve) => vaultStore.get(db, target, 50, (rows, status) => resolve({ rows, status }), owner));
const exportAll = (db, owner) => new Promise((resolve) => vaultStore.exportAll(db, resolve, owner));
const row = (id, target, body, at) => ({ id, target, from: "alice", body, at });

test("two identities on one device never see each other's history", async () => {
  const db = fakeIdb();
  await put(db, [row("#c:1", "#c", "kai only", 1000)], KAI);
  await put(db, [row("#c:1", "#c", "lee only", 2000)], LEE);
  const kai = await get(db, "#c", KAI);
  const lee = await get(db, "#c", LEE);
  assert.deepEqual(kai.rows.map((r) => [r.id, r.body]), [["#c:1", "kai only"]]);
  assert.deepEqual(lee.rows.map((r) => [r.id, r.body]), [["#c:1", "lee only"]]);
  assert.equal(db.data.messages.size, 2, "same logical id, two physical rows");
});

test("no scope reads nothing and writes nothing", async () => {
  const db = fakeIdb();
  await put(db, [row("#c:1", "#c", "kai", 1000)], KAI);
  assert.deepEqual(await get(db, "#c", null), { rows: [], status: "ok" });
  assert.equal(await put(db, [row("#c:2", "#c", "nope", 2000)], null), 0);
  assert.equal(db.data.messages.size, 1);
});

test("rows from before scoping stay quarantined: no identity reads, searches, exports or claims them", async () => {
  const db = fakeIdb();
  db.data.messages.set("#c:legacy", { id: "#c:legacy", target: "#c", from: "x", body: "legacy secret", at: 500, deleted: false, redacted: false });
  await put(db, [row("#c:1", "#c", "kai msg", 1000)], KAI);
  const kai = await get(db, "#c", KAI);
  assert.deepEqual(kai.rows.map((r) => r.body), ["kai msg"]);
  const search = await new Promise((resolve) => vaultStore.searchMode(db, "legacy", "exact", { limit: 10, owner: KAI }, (rows, status) => resolve({ rows, status })));
  assert.deepEqual(search.rows, []);
  const snap = await exportAll(db, KAI);
  assert.deepEqual(snap.targets.map((t) => t.messages.map((m) => m.text)), [["kai msg"]]);
  // a direct call with no owner argument addresses ONLY the legacy rows
  const legacy = await get(db, "#c", undefined);
  assert.deepEqual(legacy.rows.map((r) => r.body), ["legacy secret"]);
});

test("search and export are per owner", async () => {
  const db = fakeIdb();
  await put(db, [row("#c:1", "#c", "needle one", 1000)], KAI);
  await put(db, [row("#c:2", "#c", "needle two", 2000)], LEE);
  const kai = await new Promise((resolve) => vaultStore.searchMode(db, "needle", "exact", { limit: 10, owner: KAI }, (rows) => resolve(rows)));
  assert.deepEqual(kai.map((r) => r.body), ["needle one"]);
  const none = await new Promise((resolve) => vaultStore.searchMode(db, "needle", "exact", { limit: 10, owner: null }, (rows) => resolve(rows)));
  assert.deepEqual(none, []);
  const lee = await exportAll(db, LEE);
  assert.deepEqual(lee.targets.map((t) => t.messages.map((m) => m.text)), [["needle two"]]);
  const nobody = await exportAll(db, null);
  assert.deepEqual(nobody.targets, []);
});

test("retention trims per owner, so one identity cannot evict another's rows", async () => {
  const db = fakeIdb();
  globalThis.localStorage.setItem("onyx:vault-retention-policy", JSON.stringify({ keep: 2 }));
  try {
    await put(db, [row("#c:1", "#c", "k1", 1), row("#c:2", "#c", "k2", 2), row("#c:3", "#c", "k3", 3)], KAI);
    await put(db, [row("#c:1", "#c", "l1", 4)], LEE);
    const kai = await get(db, "#c", KAI);
    const lee = await get(db, "#c", LEE);
    assert.deepEqual(kai.rows.map((r) => r.body), ["k2", "k3"]);
    assert.deepEqual(lee.rows.map((r) => r.body), ["l1"]);
  } finally {
    globalThis.localStorage.removeItem("onyx:vault-retention-policy");
  }
});

test("a DM privacy verdict earned by one identity never answers for another", async () => {
  const db = fakeIdb();
  await put(db, [row("alice:1", "alice", "plain hello", 1000)], KAI);
  await put(db, [{ ...row("alice:1", "alice", "ONYXDM1 AAAA", 2000), encrypted: true }], LEE);
  const verdict = (owner) => new Promise((resolve) => vaultStore.classifyDm(db, "alice", resolve, owner));
  assert.equal(await verdict(KAI), "plain");
  assert.equal(await verdict(LEE), "encrypted");
  assert.equal(await verdict(null), "unknown");
});

test("history opt-out is re-checked at the bridge: a stale write never lands", async () => {
  const db = fakeIdb();
  globalThis.localStorage.setItem("onyx:preferences", JSON.stringify({ localHistory: false }));
  try {
    assert.equal(gapAccount.localHistoryEnabled(), false);
    assert.equal(await put(db, [row("#c:1", "#c", "late write", 1000)], KAI), 0);
    assert.equal(db.data.messages.size, 0);
  } finally {
    globalThis.localStorage.setItem("onyx:preferences", JSON.stringify({ localHistory: true }));
  }
  assert.equal(gapAccount.localHistoryEnabled(), true);
  assert.equal(await put(db, [row("#c:1", "#c", "ok", 1000)], KAI), 1);
});

test("unreadable preferences leave history enabled (the pref is Elm's to decide)", () => {
  globalThis.localStorage.setItem("onyx:preferences", "{broken");
  assert.equal(gapAccount.localHistoryEnabled(), true);
  globalThis.localStorage.removeItem("onyx:preferences");
});

/* ---------- verified erase ---------- */

test("clear erases every scope and reports ok only for a proven-empty store", async () => {
  const db = fakeIdb();
  await put(db, [row("#c:1", "#c", "kai", 1000)], KAI);
  await put(db, [row("#c:1", "#c", "lee", 1000)], LEE);
  db.data.messages.set("legacy", { id: "legacy", target: "#c", from: "x", body: "old", at: 1 });
  db.data.outbox.set("ob-1", { id: "ob-1", target: "#c", text: "unsent", queued_at: Date.now() });
  const ok = await new Promise((resolve) => gapAccount.clearVaultMessages(db, resolve));
  assert.equal(ok, true);
  assert.equal(db.data.messages.size, 0);
  assert.equal(db.data.outbox.size, 1, "queued sends are pending sends, not history");
});

test("a failed clear reports not-ok and leaves the rows", async () => {
  const db = fakeIdb({ failClear: true });
  await put(db, [row("#c:1", "#c", "kai", 1000)], KAI);
  const ok = await new Promise((resolve) => gapAccount.clearVaultMessages(db, resolve));
  assert.equal(ok, false);
  assert.equal(db.data.messages.size, 1);
});

test("an erase that cannot be verified is not reported as done", async () => {
  const db = fakeIdb({ stuckRows: 3 });
  const ok = await new Promise((resolve) => gapAccount.clearVaultMessages(db, resolve));
  assert.equal(ok, false);
});

test("no store: ok only on a host without IndexedDB", async () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  try {
    delete globalThis.indexedDB;
    assert.equal(await new Promise((r) => gapAccount.clearVaultMessages(null, r)), true);
    globalThis.indexedDB = {};
    assert.equal(await new Promise((r) => gapAccount.clearVaultMessages(null, r)), false);
  } finally {
    if (had) Object.defineProperty(globalThis, "indexedDB", had); else delete globalThis.indexedDB;
  }
});

/* ---------- outbox ownership ---------- */

test("a queued send belongs to the identity that queued it", async () => {
  const db = fakeIdb();
  const queue = (owner, text) => new Promise((resolve, reject) => outboxStore.queue(db, { target: "#c", text, owner }, resolve, () => reject(new Error("queue failed"))));
  await queue(KAI, "kai draft");
  await queue(LEE, "lee draft");
  const review = (owner) => new Promise((resolve) => outboxStore.review(db, { discard: [], tag: "t", owner }, resolve));
  const kai = await review(KAI);
  const lee = await review(LEE);
  const nobody = await review(null);
  assert.deepEqual(kai.rows.map((r) => r.text), ["kai draft"]);
  assert.deepEqual(lee.rows.map((r) => r.text), ["lee draft"]);
  assert.deepEqual(nobody.rows, []);
  // discarding from one scope cannot touch another's rows
  const kaiId = kai.rows[0].id;
  const leeTry = await new Promise((resolve) => outboxStore.review(db, { discard: [kaiId], tag: "t", owner: LEE }, resolve));
  assert.deepEqual(leeTry.removed, []);
  assert.equal(db.data.outbox.size, 2);
});

test("flush sends only the signed-in scope's rows and leaves everyone else's untouched", async () => {
  const db = fakeIdb();
  const now = Date.now();
  db.data.outbox.set("ob-k", { id: "ob-k", target_key: "#c", target: "#c", text: "from kai", queued_at: now, owner: KAI });
  db.data.outbox.set("ob-l", { id: "ob-l", target_key: "#c", target: "#c", text: "from lee", queued_at: now, owner: LEE });
  db.data.outbox.set("ob-0", { id: "ob-0", target_key: "#c", target: "#c", text: "legacy", queued_at: now });
  const sent = [];
  const sock = { isOpen: () => true, send: (line) => sent.push(line) };
  const report = await new Promise((resolve) => outboxStore.flush(db, sock, resolve, false, KAI));
  assert.deepEqual(sent, ["PRIVMSG #c :from kai"]);
  assert.deepEqual(report.sent, ["ob-k"]);
  assert.ok(db.data.outbox.has("ob-l"), "another identity's send stays queued");
  assert.ok(db.data.outbox.has("ob-0"), "an ownerless legacy send is never sent under an identity");
  assert.ok(!db.data.outbox.has("ob-k"));
});

test("no owner scope flushes nothing", async () => {
  const db = fakeIdb();
  db.data.outbox.set("ob-k", { id: "ob-k", target_key: "#c", target: "#c", text: "from kai", queued_at: Date.now(), owner: KAI });
  const sent = [];
  const report = await new Promise((resolve) => outboxStore.flush(db, { isOpen: () => true, send: (l) => sent.push(l) }, resolve, false, null));
  assert.deepEqual(sent, []);
  assert.deepEqual(report.sent, []);
  assert.ok(db.data.outbox.has("ob-k"));
});

/* ---------- port argument parsing ---------- */

test("ownerArg: missing is undefined, a string is the scope, anything else is null (fail closed)", () => {
  assert.equal(gapAccount.ownerArg({}), undefined);
  assert.equal(gapAccount.ownerArg({ owner: KAI }), KAI);
  assert.equal(gapAccount.ownerArg({ owner: null }), null);
  assert.equal(gapAccount.ownerArg({ owner: "" }), null);
  assert.equal(gapAccount.ownerArg({ owner: 7 }), null);
  assert.equal(gapAccount.ownerArg({ owner: "x".repeat(5000) }), null);
  assert.equal(gapAccount.ownerArg(null), undefined);
});

test("import size guard is the oracle's 64 MiB", () => {
  assert.equal(gapAccount.importMaxBytes, 64 * 1024 * 1024);
});

/* ---------- app badge ---------- */

const tick = () => new Promise((r) => setTimeout(r, 5));

test("badge shows the count and clears at zero", async () => {
  const calls = [];
  const nav = { setAppBadge: (n) => { calls.push(["set", n]); return Promise.resolve(); }, clearAppBadge: () => { calls.push(["clear"]); return Promise.resolve(); } };
  const badge = gapAccount.createAppBadge(nav);
  badge.set(3);
  await tick();
  badge.set(0);
  await tick();
  assert.deepEqual(calls, [["set", 3], ["clear"]]);
});

test("badge writes serialize: a slow platform call never overwrites a newer count", async () => {
  const calls = [];
  const releases = [];
  const nav = {
    setAppBadge: (n) => new Promise((resolve) => { calls.push(n); releases.push(resolve); }),
    clearAppBadge: () => { calls.push(0); return Promise.resolve(); },
  };
  const badge = gapAccount.createAppBadge(nav);
  badge.set(1);
  badge.set(2);
  badge.set(5);
  assert.deepEqual(calls, [1], "only one call in flight");
  releases[0]();
  await tick();
  assert.deepEqual(calls, [1, 5], "the intermediate count is skipped, the newest wins");
  releases[1]();
  await tick();
  assert.equal(badge.state().applied, 5);
});

test("badge copes with unsupported platforms and rejecting calls", async () => {
  const none = gapAccount.createAppBadge(null);
  none.set(4);
  const bare = gapAccount.createAppBadge({});
  bare.set(4);
  const rejecting = gapAccount.createAppBadge({ setAppBadge: () => Promise.reject(new Error("denied")), clearAppBadge: () => { throw new Error("boom"); } });
  rejecting.set(2);
  await tick();
  rejecting.set(0);
  await tick();
  assert.equal(rejecting.state().applied, 0);
});

test("badge clamps junk counts", async () => {
  const calls = [];
  const badge = gapAccount.createAppBadge({ setAppBadge: (n) => { calls.push(n); return Promise.resolve(); }, clearAppBadge: () => { calls.push(0); return Promise.resolve(); } });
  badge.set(-3);
  await tick();
  badge.set(NaN);
  badge.set(1e9);
  await tick();
  assert.deepEqual(calls.filter((n) => n > 0), [99999]);
});

/* ---------- opening the vault beside the old client's database ---------- */

function fakeIndexedDbOpen(behaviour) {
  const opened = [];
  const had = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  globalThis.indexedDB = {
    open(name, version) {
      opened.push([name, version]);
      const req = { result: { name, fake: true }, error: null };
      setTimeout(() => {
        const outcome = behaviour(name);
        if (outcome === "ok") { if (req.onsuccess) req.onsuccess({ target: req }); }
        else {
          req.error = { name: outcome };
          if (req.onerror) req.onerror({ target: req, preventDefault() {} });
        }
      }, 0);
      return req;
    },
  };
  const restore = () => { if (had) Object.defineProperty(globalThis, "indexedDB", had); else delete globalThis.indexedDB; };
  return { opened, restore };
}

test("a vault the old client created at a newer schema opens a separate Elm database instead of failing", async () => {
  const fake = fakeIndexedDbOpen((name) => (name === "onyx-vault" ? "VersionError" : "ok"));
  try {
    const db = await new Promise((resolve) => gapAccount.openVault(resolve));
    assert.equal(db.name, "onyx-elm-vault");
    assert.deepEqual(fake.opened.map((o) => o[0]), ["onyx-vault", "onyx-elm-vault"]);
  } finally { fake.restore(); }
});

test("other open errors, and a failing fallback, report no store (no retry loop)", async () => {
  const other = fakeIndexedDbOpen(() => "UnknownError");
  try {
    assert.equal(await new Promise((resolve) => gapAccount.openVault(resolve)), null);
    assert.equal(other.opened.length, 1);
  } finally { other.restore(); }
  const both = fakeIndexedDbOpen(() => "VersionError");
  try {
    assert.equal(await new Promise((resolve) => gapAccount.openVault(resolve)), null);
    assert.equal(both.opened.length, 2);
  } finally { both.restore(); }
});

test("a healthy open uses the primary database", async () => {
  const fake = fakeIndexedDbOpen(() => "ok");
  try {
    const db = await new Promise((resolve) => gapAccount.openVault(resolve));
    assert.equal(db.name, "onyx-vault");
    assert.equal(fake.opened.length, 1);
  } finally { fake.restore(); }
});
