/* Nick-aliases persistence smoke — the `nickAliasesRequest` bridge
   mirrors `nickAliases.ts`: owner-suffixed keys, the bare legacy key
   purged instead of claimed, the 8 KiB read cap, verbatim array
   passthrough (Elm normalizes on load), and latest-owner-wins so a
   stale request never resolves. Writes stay with the Solid client —
   Elm has no alias management UI — so there is no save port here.
   Run with:
     node --test elm/nickAliases.smoke.mjs
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
  "onyx:nick-aliases:owner:" + encodeURIComponent(JSON.stringify(["wss://irc.example", "kai"]));

function withBridge(t, run) {
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
        nickAliasesRequest: request.port,
        nickAliasesLoaded: { send(payload) { loaded.push(payload); } },
      },
    };
    wire(full);
    assert.ok(request.wired, "bridge subscribes");
    globalThis.window = { localStorage: store };
    run({ request, loaded, store });
  } finally {
    if (realWindow === undefined) delete globalThis.window;
    else globalThis.window = realWindow;
  }
}

test("request reads the owner slot verbatim for Elm to normalize", () => {
  withBridge(null, ({ request, loaded, store }) => {
    store.setItem(OWNER_KEY, JSON.stringify(["kai", "zed", 7, null, "bad nick"]));
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0], ["kai", "zed", 7, null, "bad nick"]);
  });
});

test("legacy bare key is purged and missing slots read empty", () => {
  withBridge(null, ({ request, loaded, store }) => {
    store.setItem("onyx:nick-aliases", JSON.stringify(["legacy"]));
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.ok(!store.has("onyx:nick-aliases"), "legacy key purged");
    assert.deepEqual(loaded[0], []);
  });
});

test("over-cap slots and corrupt JSON read empty", () => {
  withBridge(null, ({ request, loaded, store }) => {
    store.setItem(OWNER_KEY, "[" + "x".repeat(8 * 1024 + 1));
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.deepEqual(loaded[0], []);
    store.setItem(OWNER_KEY, "{not json");
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.deepEqual(loaded[1], []);
    store.setItem(OWNER_KEY, JSON.stringify({ not: "an array" }));
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.deepEqual(loaded[2], []);
  });
});

test("ownerless requests never touch storage", () => {
  withBridge(null, ({ request, loaded, store }) => {
    request.fire({ serverUrl: "", identity: "kai" });
    request.fire({ serverUrl: "wss://irc.example", identity: "" });
    request.fire(null);
    assert.equal(loaded.length, 0);
    assert.ok(!store.has(OWNER_KEY), "no slot created");
  });
});
