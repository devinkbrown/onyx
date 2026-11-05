/* Owner-scoped device slots: an announced owner loads the oracle
   documents and later saves mirror them beside the plain keys.
   Run with: node --test elm/deviceSlots.smoke.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

function stub() {
  return { subscribe() {} };
}

function memory() {
  const store = new Map();
  return {
    store,
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
    },
  };
}

test("an owner announce loads slots and later saves mirror them", () => {
  const { store, localStorage } = memory();
  globalThis.window = { localStorage };
  const ownerKey = encodeURIComponent(JSON.stringify(["wss://irc.example", "kai"]));
  store.set("onyx:ignored-users", JSON.stringify(["guest"]));
  store.set("onyx:autojoin-channels", JSON.stringify(["#keep"]));
  store.set("onyx:ignored-users:owner:" + ownerKey, JSON.stringify(["Kai"]));
  store.set("onyx:autojoin:owner:" + ownerKey, JSON.stringify(["#lounge"]));
  store.set("onyx:channel-colors:owner:" + ownerKey, JSON.stringify({ "#lounge": "#abc" }));
  store.set("onyx:channel-notify:owner:" + ownerKey, JSON.stringify({ "#lounge": "none" }));
  const sent = [];
  const handlers = {};
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
      highlightWordsSave: stub(),
      dndSave: stub(),
      blocklistsSave: { subscribe(fn) { handlers.blocklistsSave = fn; } },
      autoJoinSave: { subscribe(fn) { handlers.autoJoinSave = fn; } },
      friendsRequest: { subscribe(fn) { handlers.friendsRequest = fn; } },
      friendsLoaded: { send() {} },
      deviceSlotsLoaded: { send(value) { sent.push(value); } },
    },
  };
  wire(app);
  handlers.friendsRequest({ serverUrl: "wss://irc.example", identity: "Kai" });
  assert.equal(store.has("onyx:ignored-users"), false);
  assert.equal(store.get("onyx:autojoin-channels"), JSON.stringify(["#keep"]));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].ignored, ["Kai"]);
  assert.deepEqual(sent[0].autoJoin, ["#lounge"]);
  assert.deepEqual(sent[0].colors, { "#lounge": "#abc" });
  assert.deepEqual(sent[0].notify, { "#lounge": "none" });
  handlers.blocklistsSave({ ignored: ["bob"], muted: [] });
  assert.equal(store.get("onyx:ignored-users"), JSON.stringify(["bob"]));
  assert.equal(store.get("onyx:ignored-users:owner:" + ownerKey), JSON.stringify(["bob"]));
  assert.equal(store.has("onyx:muted-dms:owner:" + ownerKey), false);
  handlers.autoJoinSave({ channels: ["#lounge"] });
  assert.equal(store.get("onyx:autojoin-channels"), JSON.stringify(["#lounge"]));
  assert.equal(store.get("onyx:autojoin:owner:" + ownerKey), JSON.stringify(["#lounge"]));
});
