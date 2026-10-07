/* E2EE device-identity smoke — the manual "publish this device key" leg
   resolves the registry id + public point ports-side. In headless node
   (no IndexedDB) the lookup fails and the bridge reports empty legs, so
   Elm stays silent instead of sending a malformed `E2EEKEY ADD`. Run with:
     node --test elm/e2eeDevice.smoke.mjs
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

test("identity request without a readable store reports empty legs", async () => {
  const sent = [];
  let handler = null;
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
      clipboardCopy: stub(),
      clipboardResult: { send() {} },
      e2eeDeviceIdentityRequest: { subscribe(fn) { handler = fn; } },
      e2eeDeviceIdentity: { send(v) { sent.push(v); } },
    },
  };
  wire(app);
  assert.equal(typeof handler, "function");
  handler();
  await setTimeout(50);
  assert.deepEqual(sent, [{ deviceId: "", publicKey: "" }]);
});

test("wire without the identity ports does not crash", () => {
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
