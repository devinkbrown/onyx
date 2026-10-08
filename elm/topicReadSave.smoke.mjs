/* Topic-read-cursor smoke test — `onyx:topic-read-ledger:owner:<owner>` slots:
   Elm owns normalization (TopicRead); the bridge shape-checks rows, drops
   extras, purges the bare legacy key, removes the key on an emptied ledger,
   caps reads at 512 KiB without parsing, and re-sends the latest requested
   owner's cross-tab writes through `topicReadLoaded`. Run with:
     node --test elm/topicReadSave.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

const BASE = "onyx:topic-read-ledger";
const OWNER = ["wss://topics.example/ws", "alice"];
const KEY = `${BASE}:owner:${encodeURIComponent(JSON.stringify(OWNER))}`;

const row = (channel, topic, id, at, extra) => ({
  channel,
  topic,
  lastReadMessageId: id,
  lastReadAt: at,
  ...extra,
});

function harness(store) {
  let saveHandler = null;
  let requestHandler = null;
  const sent = [];
  let storageListener = null;
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
      topicReadSave: { subscribe(fn) { saveHandler = fn; } },
      topicReadRequest: { subscribe(fn) { requestHandler = fn; } },
      topicReadLoaded: { send(rows) { sent.push(rows); } },
    },
  };
  globalThis.window = {
    localStorage: store,
    addEventListener(type, fn) { if (type === "storage") storageListener = fn; },
  };
  wire(app);
  return {
    save: (req) => saveHandler(req),
    request: (req) => requestHandler(req),
    sent,
    storage: (event) => storageListener(event),
  };
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

const ownerReq = (markers) => ({ serverUrl: OWNER[0], identity: OWNER[1], markers });

test("save writes validated rows to the owner slot and purges legacy", async () => {
  const store = memStore({ [BASE]: JSON.stringify([row("#old", "t", "m", 1)]) });
  const h = harness(store);
  try {
    h.save(ownerReq([row("#Room", "Alpha", "m1", 10, { text: "drop me" }), null, "junk"]));
    assert.deepEqual(JSON.parse(store.data[KEY]), [row("#Room", "Alpha", "m1", 10)]);
    assert.equal(BASE in store.data, false);
  } finally {
    delete globalThis.window;
  }
});

test("empty markers remove the key; ownerless and rowless saves are ignored", async () => {
  const store = memStore({ [KEY]: JSON.stringify([row("#room", "a", "m1", 1)]) });
  const h = harness(store);
  try {
    h.save(ownerReq([]));
    assert.equal(KEY in store.data, false);
    h.save({ serverUrl: OWNER[0], identity: OWNER[1], markers: "nope" });
    h.save({ serverUrl: "", identity: "", markers: [row("#r", "a", "m", 1)] });
    h.save(null);
    assert.equal(KEY in store.data, false);
  } finally {
    delete globalThis.window;
  }
});

test("request loads stored rows through the loaded port", async () => {
  const rows = [row("#room", "alpha", "m1", 1767261600000)];
  const store = memStore({ [KEY]: JSON.stringify(rows) });
  const h = harness(store);
  try {
    h.request({ serverUrl: OWNER[0], identity: OWNER[1] });
    assert.deepEqual(h.sent, [rows]);
  } finally {
    delete globalThis.window;
  }
});

test("oversized slots read empty without parsing", async () => {
  const store = memStore({ [KEY]: `[${"x".repeat(512 * 1024)}]` });
  const h = harness(store);
  try {
    let parsed = false;
    const origParse = JSON.parse;
    JSON.parse = (...args) => { parsed = true; return origParse(...args); };
    try {
      h.request({ serverUrl: OWNER[0], identity: OWNER[1] });
    } finally {
      JSON.parse = origParse;
    }
    assert.equal(parsed, false);
    assert.deepEqual(h.sent, [[]]);
  } finally {
    delete globalThis.window;
  }
});

test("cross-tab writes for the pending owner re-send; others are ignored", async () => {
  const store = memStore({});
  const h = harness(store);
  try {
    const area = globalThis.window.localStorage;
    h.storage({ storageArea: area, key: KEY });
    assert.deepEqual(h.sent, []);
    h.request({ serverUrl: OWNER[0], identity: OWNER[1] });
    assert.deepEqual(h.sent, [[]]);
    store.data[KEY] = JSON.stringify([row("#room", "alpha", "m9", 99)]);
    h.storage({ storageArea: area, key: KEY });
    assert.deepEqual(h.sent, [[], [row("#room", "alpha", "m9", 99)]]);
    h.storage({ storageArea: area, key: `${BASE}:owner:other` });
    h.storage({ storageArea: area, key: "onyx:preferences" });
    assert.equal(h.sent.length, 2);
  } finally {
    delete globalThis.window;
  }
});
