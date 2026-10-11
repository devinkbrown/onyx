/* v3/gap-organize storage-bridge smoke test — `organizeStore` /
   `organizeLoad` / `organizeLoaded`: Elm owns every shape, bound and key
   name; the bridge only reads and writes whole localStorage values for an
   allow-listed set of keys. Pins the allow-list (owner-scoped organize
   memory + device-wide quiet hours / calm; never a foreign key, never a
   write to the oracle's read-only record), null-removes, the read answer
   shape (`null` for a missing key), size bounds and hostile input. Run
   with:
     node --test elm/organizeStore.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wireOrganize } = globalThis.OnyxPorts;

const OWNER = "%5B%22wss%3A%2F%2Firc.eshmaki.me%2Fws%22%2C%22kn%22%5D";
const owned = (base) => `onyx:${base}:owner:${OWNER}`;

function memStore(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    data,
  };
}

function harness(store) {
  let storeHandler = null;
  let loadHandler = null;
  const answers = [];
  const app = {
    ports: {
      organizeStore: { subscribe(fn) { storeHandler = fn; } },
      organizeLoad: { subscribe(fn) { loadHandler = fn; } },
      organizeLoaded: { send(v) { answers.push(v); } },
    },
  };
  wireOrganize(app, { storage: store });
  return { write: (req) => storeHandler(req), read: (req) => loadHandler(req), answers };
}

test("every owner-scoped organize key and the device keys are writable", () => {
  const store = memStore();
  const h = harness(store);
  const keys = [
    owned("room-folders"),
    owned("hidden-rooms"),
    owned("closed-conversations"),
    owned("bookmarks"),
    owned("user-notes"),
    owned("smart-mute"),
    "onyx:dnd-quiet-start",
    "onyx:dnd-quiet-end",
    "onyx:dnd-quiet-enabled",
    "onyx:calm",
  ];
  for (const key of keys) h.write({ key, value: "x" });
  assert.deepEqual(Object.keys(store.data).sort(), [...keys].sort());
});

test("a null value removes the key", () => {
  const key = owned("hidden-rooms");
  const store = memStore({ [key]: '["#a"]' });
  harness(store).write({ key, value: null });
  assert.equal(key in store.data, false);
});

test("keys outside the allow-list are refused (no foreign writes)", () => {
  const store = memStore();
  const h = harness(store);
  for (const key of [
    "onyx:preferences",
    "onyx:vault",
    "onyx:starred-channels",
    "onyx:hidden-rooms", // ownerless: never written
    "onyx:bookmarks",
    "onyx:calm:extra",
    "onyx:dnd-quiet-start:owner:x",
    `ruri:calm`,
    `${owned("hidden-rooms")}/../x`,
    `onyx:hidden-rooms:owner:`,
    `onyx:hidden-rooms:owner:${"a".repeat(8193)}`,
    "",
    null,
    42,
  ]) {
    h.write({ key, value: "x" });
  }
  assert.deepEqual(store.data, {});
});

test("the oracle's channel-navigation record is read-only", () => {
  const key = owned("channel-navigation");
  const store = memStore({ [key]: '{"channelFolders":[]}' });
  const h = harness(store);
  h.write({ key, value: "overwritten" });
  h.write({ key, value: null });
  assert.equal(store.data[key], '{"channelFolders":[]}');
  h.read({ tag: "t", keys: [key] });
  assert.equal(h.answers[0].values[key], '{"channelFolders":[]}');
});

test("hostile or oversize values are not stored", () => {
  const key = owned("user-notes");
  const store = memStore();
  const h = harness(store);
  h.write({ key, value: "x".repeat(2 * 1024 * 1024 + 1) });
  h.write({ key, value: { not: "a string" } });
  h.write({ key, value: 7 });
  h.write(null);
  h.write("nope");
  h.write({});
  assert.deepEqual(store.data, {});
});

test("a read answers with the tag and every asked key, null when missing", () => {
  const present = owned("room-folders");
  const missing = owned("bookmarks");
  const store = memStore({ [present]: "[]" });
  const h = harness(store);
  h.read({ tag: "owner:abc", keys: [present, missing, "onyx:calm"] });
  assert.equal(h.answers.length, 1);
  assert.equal(h.answers[0].tag, "owner:abc");
  assert.deepEqual(h.answers[0].values, { [present]: "[]", [missing]: null, "onyx:calm": null });
});

test("a read never answers for keys outside the allow-list", () => {
  const store = memStore({ "onyx:vault": "secret", "onyx:preferences": "{}" });
  const h = harness(store);
  h.read({ tag: "t", keys: ["onyx:vault", "onyx:preferences", "onyx:calm"] });
  assert.deepEqual(Object.keys(h.answers[0].values), ["onyx:calm"]);
});

test("a read caps the key count and drops oversize stored values", () => {
  const key = owned("closed-conversations");
  const store = memStore({ [key]: "x".repeat(2 * 1024 * 1024 + 1) });
  const h = harness(store);
  const many = [key];
  for (let i = 0; i < 50; i += 1) many.push(`onyx:${"calm"}`);
  h.read({ tag: "t", keys: many });
  assert.equal(h.answers[0].values[key], null);
});

test("malformed read requests are ignored", () => {
  const h = harness(memStore());
  h.read(null);
  h.read({ tag: 5, keys: [] });
  h.read({ tag: "t", keys: "nope" });
  assert.equal(h.answers.length, 0);
});

test("unavailable storage fails quiet (no throw, empty answers)", () => {
  const broken = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("quota"); },
    removeItem() { throw new Error("blocked"); },
  };
  const h = harness(broken);
  assert.doesNotThrow(() => h.write({ key: "onyx:calm", value: "calm" }));
  assert.doesNotThrow(() => h.write({ key: "onyx:calm", value: null }));
  h.read({ tag: "t", keys: ["onyx:calm"] });
  assert.deepEqual(h.answers[0].values, { "onyx:calm": null });
});
