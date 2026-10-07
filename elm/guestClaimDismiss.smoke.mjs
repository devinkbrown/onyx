/* Guest-claim dismissal smoke — the `guestClaimDismissSave/Request`
   bridge mirrors `GuestClaimPrompt.tsx`: per-owner
   `onyx:guest-claim-dismissed` slots with legacy bare-key purge, `"1"`
   markers, boolean loads, and latest-owner-wins so a stale request
   never dismisses the new owner's chip. Elm owns the visibility
   decision. Run with:
     node --test elm/guestClaimDismiss.smoke.mjs
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
  "onyx:guest-claim-dismissed:owner:" + encodeURIComponent(JSON.stringify(["wss://irc.example", "kai"]));

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
        guestClaimDismissSave: save.port,
        guestClaimDismissRequest: request.port,
        guestClaimDismissLoaded: { send(payload) { loaded.push(payload); } },
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

test("save writes the owner marker and purges the legacy key", () => {
  withBridge(null, ({ save, store }) => {
    store.setItem("onyx:guest-claim-dismissed", "1");
    save.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.ok(!store.has("onyx:guest-claim-dismissed"), "legacy key purged");
    assert.equal(store.getItem(OWNER_KEY), "1");
  });
});

test("request loads true once dismissed, false otherwise", () => {
  withBridge(null, ({ request, loaded, store }) => {
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.deepEqual(loaded, [false]);
    store.setItem(OWNER_KEY, "1");
    request.fire({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.deepEqual(loaded, [false, true]);
  });
});

test("ownerless payloads never touch storage", () => {
  withBridge(null, ({ save, request, loaded, store }) => {
    save.fire({ serverUrl: "", identity: "kai" });
    save.fire(null);
    request.fire({ serverUrl: "wss://irc.example", identity: "" });
    request.fire(null);
    assert.deepEqual(loaded, []);
    assert.ok(!store.has(OWNER_KEY), "no slot created");
  });
});
