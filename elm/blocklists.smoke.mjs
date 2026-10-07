/* Blocklists smoke test — `onyx:ignored-users` / `onyx:muted-dms` slots:
   Elm normalizes fail-closed; the bridge only persists validated arrays,
   and quota failures degrade silently. Run with:
     node --test elm/blocklists.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

const IGNORED_KEY = "onyx:ignored-users";
const MUTED_KEY = "onyx:muted-dms";

function harness(store) {
  let saveHandler = null;
  const stub = () => ({ subscribe() {} });
  const app = {
    ports: {
      wsConnect: stub(),
      wsSend: stub(),
      wsClose: stub(),
      vaultPut: stub(),
      vaultGet: stub(),
      passkeyCreate: stub(),
      passkeyGet: stub(),
      passkeySettleRequest: stub(),
      dmSealRequest: stub(),
      dmOpenRequest: stub(),
      dmPublishKey: stub(),
      roomSealRequest: stub(),
      roomOpenRequest: stub(),
      groupControlInstall: stub(),
      groupDirectoryDerive: stub(),
      guidesProgressRequest: stub(),
      guidesProgressStore: stub(),
      blocklistsSave: { subscribe(fn) { saveHandler = fn; } },
    },
  };
  globalThis.window = { localStorage: store };
  wire(app);
  return { saveHandler };
}

function memStore(initial) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

test("saves write both lists under their namespaced keys", async () => {
  try {
    const store = memStore({});
    const h = harness(store);
    h.saveHandler({ ignored: ["bob"], muted: ["mallory"] });
    assert.equal(store.data[IGNORED_KEY], JSON.stringify(["bob"]));
    assert.equal(store.data[MUTED_KEY], JSON.stringify(["mallory"]));
  } finally {
    delete globalThis.window;
  }
});

test("non-array payloads are skipped without clearing", async () => {
  try {
    const store = memStore({ [IGNORED_KEY]: JSON.stringify(["bob"]) });
    const h = harness(store);
    h.saveHandler({ ignored: "bob", muted: null });
    assert.equal(store.data[IGNORED_KEY], JSON.stringify(["bob"]));
    assert.equal(MUTED_KEY in store.data, false);
  } finally {
    delete globalThis.window;
  }
});

test("null request is ignored", async () => {
  try {
    const store = memStore({});
    const h = harness(store);
    h.saveHandler(null);
    assert.equal(IGNORED_KEY in store.data, false);
    assert.equal(MUTED_KEY in store.data, false);
  } finally {
    delete globalThis.window;
  }
});

test("quota failure degrades silently", async () => {
  try {
    const store = memStore({});
    store.setItem = () => { throw new Error("quota"); };
    const h = harness(store);
    h.saveHandler({ ignored: ["bob"], muted: [] });
    assert.equal(IGNORED_KEY in store.data, false);
  } finally {
    delete globalThis.window;
  }
});
