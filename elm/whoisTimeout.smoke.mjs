/* WHOIS request-timeout smoke — the `whoisTimeoutStart` bridge waits the
   requested delay, then fires the nick+generation back through
   `whoisTimeoutFired` (mirroring the oracle's single re-armed
   `setTimeout`); a newer request supersedes the pending fire, and
   empty nicks, bad generations, and missing payloads schedule nothing.
   Run with:
     node --test elm/whoisTimeout.smoke.mjs
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

function bridge() {
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
      whoisTimeoutStart: { subscribe(fn) { handler = fn; } },
      whoisTimeoutFired: { send(payload) { sent.push(payload); } },
    },
  };
  wire(app);
  assert.ok(handler, "bridge subscribes");
  return {
    fire(payload) { handler(payload); },
    sent,
  };
}

test("whois timeout fires nick and generation back after its delay", async () => {
  const { fire, sent } = bridge();
  fire({ nick: "ghost", gen: 1, delayMs: 5 });
  await sleep(50);
  assert.deepEqual(sent, [{ nick: "ghost", gen: 1 }]);
});

test("a newer request supersedes the pending fire", async () => {
  const { fire, sent } = bridge();
  fire({ nick: "ghost", gen: 1, delayMs: 40 });
  await sleep(5);
  fire({ nick: "ghost", gen: 2, delayMs: 5 });
  await sleep(60);
  assert.deepEqual(sent, [{ nick: "ghost", gen: 2 }]);
});

test("empty nicks, bad generations, and missing payloads schedule nothing", async () => {
  const { fire, sent } = bridge();
  fire({ nick: "", gen: 1, delayMs: 5 });
  fire({ nick: "ghost", gen: -1, delayMs: 5 });
  fire({ nick: "ghost", gen: NaN, delayMs: 5 });
  fire(null);
  await sleep(50);
  assert.deepEqual(sent, []);
});
