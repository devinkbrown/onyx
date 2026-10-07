/* Highlight-words smoke test — `onyx:highlight-words` slot:
   Elm normalizes fail-closed; the bridge only persists the validated
   array (removing the key when emptied, like `saveHighlightWords`),
   and quota failures degrade silently. Run with:
     node --test elm/highlightWords.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

const KEY = "onyx:highlight-words";

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
      blocklistsSave: stub(),
      highlightWordsSave: { subscribe(fn) { saveHandler = fn; } },
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
    removeItem: (k) => { delete data[k]; },
    data,
  };
}

test("save writes the validated list under the namespaced key", async () => {
  try {
    const store = memStore({});
    const h = harness(store);
    h.saveHandler({ words: ["release", "incident response"] });
    assert.equal(store.data[KEY], JSON.stringify(["release", "incident response"]));
  } finally {
    delete globalThis.window;
  }
});

test("emptied list removes the key", async () => {
  try {
    const store = memStore({ [KEY]: JSON.stringify(["stale"]) });
    const h = harness(store);
    h.saveHandler({ words: [] });
    assert.equal(KEY in store.data, false);
  } finally {
    delete globalThis.window;
  }
});

test("non-array payload is skipped without clearing", async () => {
  try {
    const store = memStore({ [KEY]: JSON.stringify(["kept"]) });
    const h = harness(store);
    h.saveHandler({ words: "kept" });
    assert.equal(store.data[KEY], JSON.stringify(["kept"]));
  } finally {
    delete globalThis.window;
  }
});

test("null request is ignored", async () => {
  try {
    const store = memStore({});
    const h = harness(store);
    h.saveHandler(null);
    assert.equal(KEY in store.data, false);
  } finally {
    delete globalThis.window;
  }
});

test("quota failure degrades silently", async () => {
  try {
    const store = memStore({});
    store.setItem = () => { throw new Error("quota"); };
    const h = harness(store);
    h.saveHandler({ words: ["release"] });
    assert.equal(KEY in store.data, false);
  } finally {
    delete globalThis.window;
  }
});
