/* Contact-presence slots smoke — the owner-keyed friends/watch
   persistence bridge mirrors the nick-alias slot: without
   `window.localStorage` (headless node) loads resolve empty and
   saves no-op instead of crashing; with the ports absent, wire()
   stays silent. Run with:
     node --test elm/contactsPresence.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

function stub() {
  return { subscribe() {} };
}

function contactsApp(sent) {
  const handlers = {};
  return {
    handlers,
    app: {
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
        clipboardCopy: stub(),
        clipboardResult: { send() {} },
        friendsRequest: { subscribe(fn) { handlers.friendsRequest = fn; } },
        friendsLoaded: { send(v) { sent.push(["friends", v]); } },
        friendsSave: { subscribe(fn) { handlers.friendsSave = fn; } },
        watchListRequest: { subscribe(fn) { handlers.watchListRequest = fn; } },
        watchListLoaded: { send(v) { sent.push(["watch", v]); } },
        watchListSave: { subscribe(fn) { handlers.watchListSave = fn; } },
      },
    },
  };
}

test("loads resolve empty and saves no-op without storage", () => {
  const sent = [];
  const { app, handlers } = contactsApp(sent);
  wire(app);
  assert.equal(typeof handlers.friendsRequest, "function");
  assert.equal(typeof handlers.watchListRequest, "function");
  handlers.friendsRequest({ serverUrl: "wss://irc.example", identity: "kai" });
  handlers.watchListRequest({ serverUrl: "wss://irc.example", identity: "kai" });
  assert.deepEqual(sent, [["friends", []], ["watch", []]]);
  handlers.friendsSave({ serverUrl: "wss://irc.example", identity: "kai", entries: '[{"nick":"bob"}]' });
  handlers.friendsSave({ serverUrl: "wss://irc.example", identity: "kai", entries: null });
  handlers.watchListSave({ serverUrl: "wss://irc.example", identity: "kai", entries: null });
});

test("wire without the contacts ports does not crash", () => {
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
      clipboardCopy: stub(),
      clipboardResult: { send() {} },
    },
  });
});
