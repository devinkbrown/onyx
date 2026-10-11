/* v3/gap-usermodes smoke — the `userModesSave/Request/Loaded` bridge: a
   per-owner `onyx:usermodes:owner:<owner>` slot holding the verbatim JSON
   Elm hands back (privacy modes this browser re-applies, the server-ignore
   opt-in, the real name, server-held sends). Elm validates on load, so the
   bridge only has to be owner-scoped, size-capped, fail-closed on bad
   storage, and latest-owner-wins. Run with:
     node --test elm/userModes.smoke.mjs
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

const ownerKey = (identity) =>
  "onyx:usermodes:owner:" + encodeURIComponent(JSON.stringify(["wss://irc.example", identity]));

function withBridge(run) {
  const save = capturePort();
  const request = capturePort();
  const loaded = [];
  const store = fakeStorage();
  const realWindow = globalThis.window;
  try {
    const stub = () => stubPort();
    wire({
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
        userModesSave: save.port,
        userModesRequest: request.port,
        userModesLoaded: { send(payload) { loaded.push(payload); } },
      },
    });
    assert.ok(save.wired && request.wired, "bridge subscribes");
    globalThis.window = { localStorage: store };
    run({ save, request, loaded, store });
  } finally {
    if (realWindow === undefined) delete globalThis.window;
    else globalThis.window = realWindow;
  }
}

const OWNER = { serverUrl: "wss://irc.example", identity: "kai" };

test("save stores the verbatim JSON under the owner slot", () => {
  withBridge(({ save, store }) => {
    save.fire({ ...OWNER, json: '{"v":1,"wanted":"Rg"}' });
    assert.equal(store.getItem(ownerKey("kai")), '{"v":1,"wanted":"Rg"}');
  });
});

test("request loads the parsed object, null when nothing is stored", () => {
  withBridge(({ save, request, loaded }) => {
    request.fire(OWNER);
    assert.deepEqual(loaded, [null]);
    save.fire({ ...OWNER, json: '{"v":1,"serverIgnore":true}' });
    request.fire(OWNER);
    assert.deepEqual(loaded, [null, { v: 1, serverIgnore: true }]);
  });
});

test("owners never see each other's slot", () => {
  withBridge(({ save, request, loaded }) => {
    save.fire({ ...OWNER, json: '{"v":1,"wanted":"R"}' });
    request.fire({ serverUrl: "wss://irc.example", identity: "someone-else" });
    assert.deepEqual(loaded, [null]);
  });
});

test("unparsable or oversize storage resolves to null (fail closed)", () => {
  withBridge(({ request, loaded, store }) => {
    store.setItem(ownerKey("kai"), "{not json");
    request.fire(OWNER);
    store.setItem(ownerKey("kai"), JSON.stringify({ pad: "x".repeat(70 * 1024) }));
    request.fire(OWNER);
    assert.deepEqual(loaded, [null, null]);
  });
});

test("an oversize save is dropped, not truncated", () => {
  withBridge(({ save, store }) => {
    save.fire({ ...OWNER, json: JSON.stringify({ pad: "x".repeat(70 * 1024) }) });
    assert.ok(!store.has(ownerKey("kai")), "nothing written");
  });
});

test("ownerless or malformed payloads never touch storage", () => {
  withBridge(({ save, request, loaded, store }) => {
    save.fire({ serverUrl: "", identity: "kai", json: "{}" });
    save.fire({ serverUrl: "wss://irc.example", identity: "", json: "{}" });
    save.fire({ ...OWNER, json: 42 });
    save.fire(null);
    request.fire({ serverUrl: "wss://irc.example", identity: "" });
    request.fire(null);
    assert.deepEqual(loaded, []);
    assert.ok(!store.has(ownerKey("kai")), "no slot created");
  });
});

test("storage that throws never breaks the bridge", () => {
  withBridge(({ save, request, loaded }) => {
    globalThis.window = {
      localStorage: {
        getItem() { throw new Error("blocked"); },
        setItem() { throw new Error("full"); },
        removeItem() {},
      },
    };
    save.fire({ ...OWNER, json: "{}" });
    request.fire(OWNER);
    assert.deepEqual(loaded, [null]);
  });
});
