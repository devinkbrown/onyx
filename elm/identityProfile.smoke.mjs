/* Identity-profile persistence smoke — the `identityProfileSave` /
   `identityProfileRequest` bridge mirrors `identityProfileMemory.ts`:
   owner-suffixed keys, sibling-field merges, legacy-key purges, the
   16 KiB read cap, ISO-expiry parsing, and stale-load drops.
   Run with:
     node --test elm/identityProfile.smoke.mjs
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
  "onyx:identity-profile:owner:" + encodeURIComponent(JSON.stringify(["wss://irc.example", "kai"]));

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
        identityProfileSave: save.port,
        identityProfileRequest: request.port,
        identityProfileLoaded: { send(payload) { loaded.push(payload); } },
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

test("save merges status keys and loads them back with an ISO expiry", () => {
  withBridge(null, ({ save, request, loaded, store }) => {
    save.fire({ serverUrl: "wss://irc.example", identity: "kai", status: "playing chess", expiryIso: "2024-05-01T00:00:00.000Z" });
    assert.ok(store.has(OWNER_KEY), "owner slot written");
    const raw = JSON.parse(store.getItem(OWNER_KEY));
    assert.equal(raw.customStatus, "playing chess");
    assert.equal(raw.customStatusExpiry, "2024-05-01T00:00:00.000Z");
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].status, "playing chess");
    assert.equal(loaded[0].expiryMs, Date.parse("2024-05-01T00:00:00.000Z"));
  });
});

test("save preserves sibling fields, clears on empty, and removes empty slots", () => {
  withBridge(null, ({ save, request, loaded, store }) => {
    store.setItem(OWNER_KEY, JSON.stringify({ selfDisplayName: "Kai", customStatus: "old" }));
    save.fire({ serverUrl: "wss://irc.example", identity: "kai", status: "", expiryIso: null });
    const raw = JSON.parse(store.getItem(OWNER_KEY));
    assert.equal(raw.selfDisplayName, "Kai", "sibling field preserved");
    assert.ok(!("customStatus" in raw), "empty status deleted");
    save.fire({ serverUrl: "wss://irc.example", identity: "new", status: "", expiryIso: null });
    const newKey = "onyx:identity-profile:owner:" + encodeURIComponent(JSON.stringify(["wss://irc.example", "new"]));
    assert.ok(!store.has(newKey), "empty profile removes the slot");
    request.fire({ serverUrl: "wss://irc.example", identity: "nobody" });
    assert.deepEqual(loaded[0], { status: "", expiryMs: null });
  });
});

test("legacy ownerless keys are purged and over-cap slots read empty", () => {
  withBridge(null, ({ save, request, loaded, store }) => {
    store.setItem("onyx:custom-status", "legacy");
    store.setItem("ocean-selfBio", "legacy");
    save.fire({ serverUrl: "wss://irc.example", identity: "kai", status: "x", expiryIso: null });
    assert.ok(!store.has("onyx:custom-status"), "legacy key purged");
    assert.ok(!store.has("ocean-selfBio"), "legacy key purged");
    store.setItem(OWNER_KEY, "{" + "x".repeat(16 * 1024 + 1));
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.deepEqual(loaded[0], { status: "", expiryMs: null });
    // Corrupt JSON also reads empty instead of throwing.
    store.setItem(OWNER_KEY, "{not json");
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.deepEqual(loaded[1], { status: "", expiryMs: null });
    // Invalid expiry strings fail closed to null.
    store.setItem(OWNER_KEY, JSON.stringify({ customStatus: "ok", customStatusExpiry: "not-a-date" }));
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.deepEqual(loaded[2], { status: "ok", expiryMs: null });
  });
});

test("ownerless requests never touch storage", () => {
  withBridge(null, ({ save, request, loaded, store }) => {
    save.fire({ serverUrl: "", identity: "kai", status: "x", expiryIso: null });
    save.fire(null);
    request.fire({ serverUrl: "wss://irc.example", identity: "" });
    request.fire(null);
    assert.equal(loaded.length, 0);
    assert.ok(!store.has(OWNER_KEY));
  });
});
