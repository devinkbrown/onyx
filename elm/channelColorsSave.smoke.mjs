/* Channel-color smoke test — `onyx:channel-color-labels` slot:
   Elm owns the room-accent fold; the bridge only persists the validated
   `{ [channel]: color }` object (empty map removes the key), exactly
   mirroring `saveChannelColors`. Run with:
     node --test elm/channelColorsSave.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

const KEY = "onyx:channel-color-labels";

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
      starredSave: stub(),
      autoJoinSave: stub(),
      channelColorsSave: { subscribe(fn) { saveHandler = fn; } },
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

test("save writes the channel map as a JSON object", async () => {
  try {
    const store = memStore({});
    const h = harness(store);
    h.saveHandler({ entries: [{ channel: "#c", color: "#aabbcc" }] });
    assert.equal(store.data[KEY], JSON.stringify({ "#c": "#aabbcc" }));
  } finally {
    delete globalThis.window;
  }
});

test("empty entries remove the key", async () => {
  try {
    const store = memStore({ [KEY]: "{\"#c\":\"#aabbcc\"}" });
    const h = harness(store);
    h.saveHandler({ entries: [] });
    assert.equal(KEY in store.data, false);
  } finally {
    delete globalThis.window;
  }
});

test("malformed entries are skipped", async () => {
  try {
    const store = memStore({});
    const h = harness(store);
    h.saveHandler({ entries: [{ channel: "#c" }, { color: "#abc" }, null, { channel: "#ok", color: "#abc" }] });
    assert.equal(store.data[KEY], JSON.stringify({ "#ok": "#abc" }));
  } finally {
    delete globalThis.window;
  }
});

test("non-array entries are ignored", async () => {
  try {
    const store = memStore({ [KEY]: "{\"#c\":\"#aabbcc\"}" });
    const h = harness(store);
    h.saveHandler({ entries: "nope" });
    h.saveHandler(null);
    assert.equal(store.data[KEY], "{\"#c\":\"#aabbcc\"}");
  } finally {
    delete globalThis.window;
  }
});
