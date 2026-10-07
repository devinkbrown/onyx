/* Guides-progress smoke test — the `onyx:guides-progress-v1` slot:
   missing/corrupt storage reads as [], writes store the Elm-filtered
   list, and quota failures degrade silently. Run with:
     node --test elm/guidesProgress.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

const KEY = "onyx:guides-progress-v1";

function harness(store) {
  let requestHandler = null;
  let storeHandler = null;
  const sent = [];
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
      guidesProgressRequest: { subscribe(fn) { requestHandler = fn; } },
      guidesProgressStore: { subscribe(fn) { storeHandler = fn; } },
      guidesProgressLoaded: { send(v) { sent.push(v); } },
    },
  };
  globalThis.window = { localStorage: store };
  wire(app);
  return { requestHandler, storeHandler, sent };
}

function memStore(initial) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("missing slot reads as []", async () => {
  try {
    const h = harness(memStore({}));
    h.requestHandler();
    await wait(10);
    assert.deepEqual(h.sent, [[]]);
  } finally {
    delete globalThis.window;
  }
});

test("stored array (even with junk) reads raw for Elm to allowlist", async () => {
  try {
    const h = harness(memStore({ [KEY]: JSON.stringify(["join", "unknown", 7]) }));
    h.requestHandler();
    await wait(10);
    assert.deepEqual(h.sent[0], ["join", "unknown", 7]);
  } finally {
    delete globalThis.window;
  }
});

test("corrupt JSON reads as []", async () => {
  try {
    const h = harness(memStore({ [KEY]: "{not json" }));
    h.requestHandler();
    await wait(10);
    assert.deepEqual(h.sent, [[]]);
  } finally {
    delete globalThis.window;
  }
});

test("writes store the filtered list under the namespaced key", async () => {
  try {
    const store = memStore({});
    const h = harness(store);
    h.storeHandler(["join", "messages"]);
    assert.equal(store.data[KEY], JSON.stringify(["join", "messages"]));
  } finally {
    delete globalThis.window;
  }
});

test("quota failure degrades silently", async () => {
  try {
    const store = memStore({});
    store.setItem = () => { throw new Error("quota"); };
    const h = harness(store);
    h.storeHandler(["join"]);
    assert.equal(KEY in store.data, false);
  } finally {
    delete globalThis.window;
  }
});
