/* v3/dmsafety — ports-side safety evidence + key-change acceptance.
   Real WebCrypto between ports.js E2EE instances with in-memory stores.
     node elm/dmSafety.smoke.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { OnyxPorts } = globalThis;

function memDeps() {
  return {
    keyStore: OnyxPorts.memKV(),
    pinStore: OnyxPorts.memKV(),
    subtle: globalThis.crypto.subtle,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    random: (n) => {
      const bytes = new Uint8Array(n);
      globalThis.crypto.getRandomValues(bytes);
      return bytes;
    },
  };
}

const SN = /^(\d{5} ){11}\d{5}$/;

test("no pin yet: no current number, pending binds the presented key", async () => {
  const a = OnyxPorts.createE2ee(memDeps());
  const b = OnyxPorts.createE2ee(memDeps());
  const bPub = await b.devicePublicB64();
  const ev = await a.safetyEvidence("b", [bPub]);
  assert.equal(ev.current, null);
  assert.match(ev.pending, SN);
});

test("pinned and unchanged: current only, matching the pairwise number", async () => {
  const a = OnyxPorts.createE2ee(memDeps());
  const b = OnyxPorts.createE2ee(memDeps());
  const aPub = await a.devicePublicB64();
  const bPub = await b.devicePublicB64();
  assert.equal((await a.sealToDevices("b", [bPub], "hi")).status, "sealed");
  const ev = await a.safetyEvidence("b", [bPub]);
  assert.equal(ev.current, await a.safetyFor(aPub, [bPub]));
  assert.equal(ev.pending, null);
});

test("rotated key: both numbers differ; accept re-pins and unlocks sealing", async () => {
  const a = OnyxPorts.createE2ee(memDeps());
  const b = OnyxPorts.createE2ee(memDeps());
  const b2 = OnyxPorts.createE2ee(memDeps());
  const bPub = await b.devicePublicB64();
  const b2Pub = await b2.devicePublicB64();
  await a.sealToDevices("b", [bPub], "first");
  assert.equal((await a.sealToDevices("b", [b2Pub], "x")).status, "key-changed");

  const ev = await a.safetyEvidence("b", [b2Pub]);
  assert.match(ev.current, SN);
  assert.match(ev.pending, SN);
  assert.notEqual(ev.current, ev.pending);

  assert.equal(await a.acceptKeys("b", [b2Pub]), true);
  const after = await a.safetyEvidence("b", [b2Pub]);
  assert.equal(after.current, ev.pending);
  assert.equal(after.pending, null);
  assert.equal((await a.sealToDevices("b", [b2Pub], "again")).status, "sealed");
});

test("accept refuses empty / invalid key sets and invalid owners", async () => {
  const a = OnyxPorts.createE2ee(memDeps());
  assert.equal(await a.acceptKeys("b", []), false);
  assert.equal(await a.acceptKeys("b", ["not-a-key"]), false);
  const b = OnyxPorts.createE2ee(memDeps());
  const bPub = await b.devicePublicB64();
  assert.equal(await a.acceptKeys("b", [bPub], { serverUrl: " bad", identity: "x" }), false);
  const ev = await a.safetyEvidence("b", [bPub], { serverUrl: " bad", identity: "x" });
  assert.deepEqual(ev, { current: null, pending: null });
});
