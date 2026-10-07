/* DND-axes smoke test — `onyx:dnd-enabled` / `onyx:dnd-until` slots:
   Elm owns the snooze/DND fold; the bridge only persists the validated
   pair (`enabled` boolean, `until` ms or removed when null), mirroring
   `setDndEnabled` / `setDndUntil`. Run with:
     node --test elm/dndSave.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

const ENABLED_KEY = "onyx:dnd-enabled";
const UNTIL_KEY = "onyx:dnd-until";

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
      highlightWordsSave: stub(),
      dndSave: { subscribe(fn) { saveHandler = fn; } },
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

test("save writes both axes under their namespaced keys", async () => {
  try {
    const store = memStore({});
    const h = harness(store);
    h.saveHandler({ enabled: false, until: 1900000 });
    assert.equal(store.data[ENABLED_KEY], "false");
    assert.equal(store.data[UNTIL_KEY], "1900000");
  } finally {
    delete globalThis.window;
  }
});

test("null until removes the until key but keeps enabled", async () => {
  try {
    const store = memStore({ [UNTIL_KEY]: "1234" });
    const h = harness(store);
    h.saveHandler({ enabled: true, until: null });
    assert.equal(store.data[ENABLED_KEY], "true");
    assert.equal(UNTIL_KEY in store.data, false);
  } finally {
    delete globalThis.window;
  }
});

test("non-boolean enabled is skipped without clearing", async () => {
  try {
    const store = memStore({ [ENABLED_KEY]: "true" });
    const h = harness(store);
    h.saveHandler({ enabled: "yes", until: 5 });
    assert.equal(store.data[ENABLED_KEY], "true");
    assert.equal(UNTIL_KEY in store.data, false);
  } finally {
    delete globalThis.window;
  }
});

test("null request is ignored", async () => {
  try {
    const store = memStore({});
    const h = harness(store);
    h.saveHandler(null);
    assert.equal(ENABLED_KEY in store.data, false);
  } finally {
    delete globalThis.window;
  }
});
