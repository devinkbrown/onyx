/* Legacy storage smoke test — the `ocean-*` -> `onyx:*` localStorage copy that
   ports.js runs at load (ported from the removed SolidJS client's
   src/lib/migrateStorage.ts). Run with:
     node --test elm/legacyStorage.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const portsPath = new URL("./ports.js", import.meta.url).pathname;
const portsSource = readFileSync(portsPath, "utf8");

/* A fresh global per load: ports.js runs its legacy-storage migration as an
   import-time side effect, so each case needs its own execution. */
function loadPorts(globals) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(portsSource, context, { filename: portsPath });
  return context.OnyxPorts;
}

function memStore(initial, opts) {
  const data = { ...initial };
  const failOn = (opts && opts.failSet) || [];
  return {
    get length() { return Object.keys(data).length; },
    key: (i) => Object.keys(data)[i] ?? null,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      if (failOn.includes(k)) throw new Error("QuotaExceededError");
      data[k] = String(v);
    },
    removeItem: (k) => { delete data[k]; },
    data,
  };
}

test("copies ocean-prefixed keys to onyx-prefixed keys and leaves the rest alone", () => {
  const { migrateLegacyStorage } = loadPorts({});
  const store = memStore({
    "ocean-token": "sst_live",
    "ocean-preferences": '{"density":"compact"}',
    "other-key": "untouched",
    "onyx:existing": "kept",
  });
  assert.equal(migrateLegacyStorage(store), 2);
  assert.equal(store.data["onyx:token"], "sst_live");
  assert.equal(store.data["onyx:preferences"], '{"density":"compact"}');
  assert.equal(store.data["other-key"], "untouched");
  assert.equal(store.data["onyx:existing"], "kept");
});

test("never deletes the legacy keys (a rollback build still finds them)", () => {
  const { migrateLegacyStorage } = loadPorts({});
  const store = memStore({ "ocean-saved-nick": "Alice" });
  migrateLegacyStorage(store);
  assert.equal(store.data["ocean-saved-nick"], "Alice");
  assert.equal(store.data["onyx:saved-nick"], "Alice");
});

test("never clobbers existing onyx data, even an empty string", () => {
  const { migrateLegacyStorage } = loadPorts({});
  const store = memStore({
    "ocean-preferences": "legacy",
    "onyx:preferences": "current",
    "ocean-blank": "legacy",
    "onyx:blank": "",
  });
  assert.equal(migrateLegacyStorage(store), 0);
  assert.equal(store.data["onyx:preferences"], "current");
  assert.equal(store.data["onyx:blank"], "");
});

test("snapshots keys before writing so every legacy key migrates in one pass", () => {
  const { migrateLegacyStorage } = loadPorts({});
  const initial = {};
  for (let i = 0; i < 25; i++) initial["ocean-k" + i] = String(i);
  const store = memStore(initial);
  assert.equal(migrateLegacyStorage(store), 25);
  for (let i = 0; i < 25; i++) assert.equal(store.data["onyx:k" + i], String(i));
});

test("one failing key (quota/security) does not stop the rest", () => {
  const { migrateLegacyStorage } = loadPorts({});
  const store = memStore(
    { "ocean-a": "1", "ocean-b": "2", "ocean-c": "3" },
    { failSet: ["onyx:b"] },
  );
  assert.equal(migrateLegacyStorage(store), 2);
  assert.equal(store.data["onyx:a"], "1");
  assert.equal(store.data["onyx:b"], undefined);
  assert.equal(store.data["onyx:c"], "3");
});

test("unavailable or throwing storage is a silent no-op", () => {
  const { migrateLegacyStorage } = loadPorts({});
  assert.equal(migrateLegacyStorage(null), 0);
  assert.equal(migrateLegacyStorage(undefined), 0);
  const hostile = {
    get length() { throw new Error("SecurityError"); },
    key() { throw new Error("SecurityError"); },
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("SecurityError"); },
  };
  assert.equal(migrateLegacyStorage(hostile), 0);
});

test("ports.js runs the migration itself at load, before anything reads onyx: keys", () => {
  const store = memStore({ "ocean-sound": "false", "ocean-vault-search-mode": "exact" });
  loadPorts({ localStorage: store });
  assert.equal(store.data["onyx:sound"], "false");
  assert.equal(store.data["onyx:vault-search-mode"], "exact");
  assert.equal(store.data["ocean-sound"], "false");
});

test("loading ports.js with no localStorage at all does not throw", () => {
  assert.doesNotThrow(() => loadPorts({}));
  const hostile = {};
  Object.defineProperty(hostile, "localStorage", { get() { throw new Error("SecurityError"); } });
  assert.doesNotThrow(() => loadPorts(hostile));
});

test("index.html loads ports.js before the inline boot script that reads onyx: keys", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const portsAt = html.indexOf('<script src="ports.js"></script>');
  const bootAt = html.indexOf("Elm.Main.init");
  assert.ok(portsAt > 0, "ports.js script tag present");
  assert.ok(bootAt > portsAt, "Elm.Main.init (flag reads) comes after ports.js");
});
