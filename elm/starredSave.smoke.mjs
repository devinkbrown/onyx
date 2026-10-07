/* Starred-rooms smoke test — `onyx:starred-channels` slot:
   Elm owns the star toggle fold; the bridge only persists the validated
   array (empty set removes the key), mirroring the per-action saves
   around the oracle's navigation bundle. Run with:
     node --test elm/starredSave.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

const KEY = "onyx:starred-channels";

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
      dndSave: stub(),
      channelNotifySave: stub(),
      starredSave: { subscribe(fn) { saveHandler = fn; } },
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

test("save writes the starred array", async () => {
  try {
    const store = memStore({});
    const h = harness(store);
    h.saveHandler({ channels: ["#c", "&ops"] });
    assert.equal(store.data[KEY], JSON.stringify(["#c", "&ops"]));
  } finally {
    delete globalThis.window;
  }
});

test("empty channels remove the key", async () => {
  try {
    const store = memStore({ [KEY]: "[\"#c\"]" });
    const h = harness(store);
    h.saveHandler({ channels: [] });
    assert.equal(KEY in store.data, false);
  } finally {
    delete globalThis.window;
  }
});

test("non-array channels are ignored", async () => {
  try {
    const store = memStore({ [KEY]: "[\"#c\"]" });
    const h = harness(store);
    h.saveHandler({ channels: "nope" });
    h.saveHandler(null);
    assert.equal(store.data[KEY], "[\"#c\"]");
  } finally {
    delete globalThis.window;
  }
});
