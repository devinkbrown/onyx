/* Topic-history persistence smoke — the `topicHistorySave` /
   `topicHistoryRequest` bridge mirrors `topicHistory.ts`:
   owner-suffixed keys, the bare legacy key purged instead of
   claimed, the 1 MiB read cap, and bounded re-parsing (128 rooms,
   10 topics each, re-normalized keys and bodies, last-wins on
   duplicate keys) on every read and write.
   Run with:
     node --test elm/topicHistory.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

function stubPort() {
  return { subscribe() {} };
}

function capturePort() {
  let handler = null;
  return {
    port: { subscribe(fn) { handler = fn; } },
    fire(payload) { handler(payload); },
    get wired() { return handler !== null; },
  };
}

function fakeStorage() {
  const slots = new Map();
  return {
    getItem(key) { return slots.has(key) ? slots.get(key) : null; },
    setItem(key, value) { slots.set(key, String(value)); },
    removeItem(key) { slots.delete(key); },
    has(key) { return slots.has(key); },
  };
}

const OWNER_KEY =
  "onyx:topic-history:owner:" + encodeURIComponent(JSON.stringify(["wss://irc.example", "kai"]));

function withBridge(t, run) {
  const save = capturePort();
  const request = capturePort();
  const loaded = [];
  const store = fakeStorage();
  const realWindow = globalThis.window;
  try {
    const stub = () => stubPort();
    const full = {
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
        followedSave: stub(),
        offlineMemoNotice: stub(),
        topicHistorySave: save.port,
        topicHistoryRequest: request.port,
        topicHistoryLoaded: { send(payload) { loaded.push(payload); } },
      },
    };
    wire(full);
    assert.ok(save.wired && request.wired, "bridge subscribes");
    globalThis.window = { localStorage: store };
    run({ save, request, loaded, store });
  } finally {
    if (realWindow === undefined) delete globalThis.window;
    else globalThis.window = realWindow;
  }
}

test("save writes the owner slot and loads it back bounded", () => {
  withBridge(null, ({ save, request, loaded, store }) => {
    save.fire({
      serverUrl: "wss://irc.example",
      identity: "kai",
      history: { "#c": ["second", "first", "second"], "#other": ["x"] },
    });
    assert.ok(store.has(OWNER_KEY), "owner slot written");
    const raw = JSON.parse(store.getItem(OWNER_KEY));
    assert.deepEqual(raw["#c"], ["second", "first"], "dupes drop on write");
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0], { "#c": ["second", "first"], "#other": ["x"] });
  });
});

test("empty history removes the slot and legacy keys are purged", () => {
  withBridge(null, ({ save, request, loaded, store }) => {
    store.setItem("onyx:topic-history", JSON.stringify({ "#c": ["legacy"] }));
    store.setItem(OWNER_KEY, JSON.stringify({ "#c": ["old"] }));
    save.fire({ serverUrl: "wss://irc.example", identity: "kai", history: {} });
    assert.ok(!store.has("onyx:topic-history"), "legacy key purged");
    assert.ok(!store.has(OWNER_KEY), "empty history removes the slot");
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.deepEqual(loaded[0], {});
  });
});

test("over-cap slots and corrupt JSON read empty", () => {
  withBridge(null, ({ request, loaded, store }) => {
    store.setItem(OWNER_KEY, "{" + "x".repeat(1024 * 1024 + 1));
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.deepEqual(loaded[0], {});
    store.setItem(OWNER_KEY, "{not json");
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.deepEqual(loaded[1], {});
    // Malformed rows drop; duplicate normalized keys keep the last.
    store.setItem(
      OWNER_KEY,
      JSON.stringify({ "notachan": ["x"], "#C": ["old"], "#c": ["new", "", 5], "#e": [] }),
    );
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.deepEqual(loaded[2], { "#c": ["new"] });
  });
});

test("ownerless requests never touch storage", () => {
  withBridge(null, ({ save, request, loaded, store }) => {
    save.fire({ serverUrl: "", identity: "kai", history: { "#c": ["x"] } });
    save.fire(null);
    request.fire({ serverUrl: "wss://irc.example", identity: "" });
    request.fire(null);
    assert.equal(loaded.length, 0);
    assert.ok(!store.has(OWNER_KEY));
  });
});
