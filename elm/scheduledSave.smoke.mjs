/* Scheduled-queue smoke test — `onyx:scheduled` slot:
   Elm owns validation, owner scoping, and encoding; the bridge writes
   the rows array (always writing, even empty, mirroring
   `_persistScheduledMessages`) and reports the write back so Elm can
   mark `scheduledProjectionDegraded`. Run with:
     node --test elm/scheduledSave.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

const KEY = "onyx:scheduled";

function harness(store, sent) {
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
      passkeySettleRequest: stub(),
      scheduledSave: { subscribe(fn) { saveHandler = fn; } },
      scheduledPersisted: { send(payload) { sent.push(payload); } },
    },
  };
  globalThis.window = { localStorage: store };
  wire(app);
  return { saveHandler };
}

function memStore(initial, failing) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      if (failing) throw new Error("quota");
      data[k] = String(v);
    },
    removeItem: (k) => { delete data[k]; },
    data,
  };
}

const rows = [
  { id: "s1", channel: "#c", text: "later", sendAt: 5000, owner: { serverUrl: "wss://x.test", identity: "kai" } },
];

test("save writes rows and acks ok", async () => {
  const sent = [];
  try {
    const store = memStore({});
    const h = harness(store, sent);
    h.saveHandler({ rows });
    assert.equal(store.data[KEY], JSON.stringify(rows));
    assert.deepEqual(sent, [{ ok: true }]);
  } finally {
    delete globalThis.window;
  }
});

test("empty rows still write the key and ack ok", async () => {
  const sent = [];
  try {
    const store = memStore({});
    const h = harness(store, sent);
    h.saveHandler({ rows: [] });
    assert.equal(store.data[KEY], "[]");
    assert.deepEqual(sent, [{ ok: true }]);
  } finally {
    delete globalThis.window;
  }
});

test("quota failure acks not-ok", async () => {
  const sent = [];
  try {
    const store = memStore({}, true);
    const h = harness(store, sent);
    h.saveHandler({ rows });
    assert.deepEqual(sent, [{ ok: false }]);
  } finally {
    delete globalThis.window;
  }
});

test("malformed requests write nothing and ack not-ok", async () => {
  const sent = [];
  try {
    const store = memStore({ [KEY]: "[]" });
    const h = harness(store, sent);
    h.saveHandler({ rows: undefined });
    h.saveHandler(null);
    assert.equal(store.data[KEY], "[]");
    assert.deepEqual(sent, [{ ok: false }, { ok: false }]);
  } finally {
    delete globalThis.window;
  }
});
