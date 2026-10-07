/* VHOST refresh-timer smoke — a wear/claim confirmation asks ports-side
   for a re-list, and the bridge answers through `vhostRefresh` 300ms
   later (mirroring the oracle's `setTimeout(..., 300)` confirmation
   refresh). Run with:
     node --test elm/vhostRefresh.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setTimeout } from "node:timers/promises";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

function stub() {
  return { subscribe() {} };
}

function vhostApp(sent) {
  let handler = null;
  return {
    handler() {
      return handler;
    },
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
        vhostRefreshRequest: { subscribe(fn) { handler = fn; } },
        vhostRefresh: { send(v) { sent.push(v); } },
      },
    },
  };
}

test("refresh request fires the refresh send after ~300ms", async () => {
  const sent = [];
  const { app, handler } = vhostApp(sent);
  wire(app);
  assert.equal(typeof handler(), "function");
  handler()();
  await setTimeout(100);
  assert.deepEqual(sent, []);
  await setTimeout(300);
  assert.deepEqual(sent, [null]);
});

test("wire without the vhost ports does not crash", () => {
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
