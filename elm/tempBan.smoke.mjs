/* Timed-ban timer smoke — the `tempBanTimerStart` bridge waits the
   requested delay, then fires the key back through `tempBanTimerFired`
   (mirroring the oracle's keyed `setTimeout(fire, …)`); empty keys and
   missing payloads schedule nothing.
   Run with:
     node --test elm/tempBan.smoke.mjs
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("tempBan timer fires the key back after its delay", async () => {
  let handler = null;
  const sent = [];
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
      blocklistsSave: stub(),
      followedSave: stub(),
      tempBanTimerStart: { subscribe(fn) { handler = fn; } },
      tempBanTimerFired: { send(payload) { sent.push(payload); } },
    },
  };
  wire(app);
  assert.ok(handler, "bridge subscribes");
  handler({ key: "k1", delayMs: 5 });
  handler({ key: "", delayMs: 5 });
  handler(null);
  await sleep(50);
  assert.deepEqual(sent, [{ key: "k1" }]);
});
