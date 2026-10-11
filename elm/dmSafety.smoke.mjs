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
  assert.deepEqual(ev.pendingKeys, [bPub]);
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
  assert.deepEqual(ev.pendingKeys, []);
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
  assert.deepEqual(ev.pendingKeys, [b2Pub]);

  assert.equal(await a.acceptKeys("b", [b2Pub], undefined, { pendingKeys: ev.pendingKeys, pending: ev.pending }), true);
  const after = await a.safetyEvidence("b", [b2Pub]);
  assert.equal(after.current, ev.pending);
  assert.equal(after.pending, null);
  assert.equal((await a.sealToDevices("b", [b2Pub], "again")).status, "sealed");
});

test("accept refuses empty / invalid key sets and invalid owners", async () => {
  const a = OnyxPorts.createE2ee(memDeps());
  const b = OnyxPorts.createE2ee(memDeps());
  const bPub = await b.devicePublicB64();
  const fresh = await a.safetyEvidence("b", [bPub]);
  const review = { pendingKeys: fresh.pendingKeys, pending: fresh.pending };
  assert.equal(await a.acceptKeys("b", [], undefined, review), false);
  assert.equal(await a.acceptKeys("b", ["not-a-key"], undefined, review), false);
  assert.equal(await a.acceptKeys("b", [bPub], { serverUrl: " bad", identity: "x" }, review), false);
  const ev = await a.safetyEvidence("b", [bPub], { serverUrl: " bad", identity: "x" });
  assert.deepEqual(ev, { current: null, pending: null, pendingKeys: [] });
});

/* v3/gap-pwa-safety — acceptance trusts only the reviewed pending keys. */

async function peerWithDevices(n) {
  const a = OnyxPorts.createE2ee(memDeps());
  const devices = [];
  for (let i = 0; i < n; i++) devices.push(OnyxPorts.createE2ee(memDeps()));
  const pubs = [];
  for (const d of devices) pubs.push(await d.devicePublicB64());
  return { a, pubs, aPub: await a.devicePublicB64() };
}

test("accept without a review, or with a number the keys do not reproduce, pins nothing", async () => {
  const { a, pubs: [b1, b2] } = await peerWithDevices(2);
  await a.sealToDevices("b", [b1], "first");
  const ev = await a.safetyEvidence("b", [b1, b2]);
  assert.equal(await a.acceptKeys("b", [b1, b2]), false, "legacy whole-set call refused");
  assert.equal(await a.acceptKeys("b", [b1, b2], undefined, { pendingKeys: [b2], pending: ev.current }), false, "wrong number");
  assert.equal(await a.acceptKeys("b", [b1], undefined, { pendingKeys: [b2], pending: ev.pending }), false, "reviewed key no longer presented");
  assert.equal(await a.keyStatus("b", [b1, b2]), "changed", "still pending");
});

test("an added device: pending binds only the new key (the pairwise number it shows)", async () => {
  const { a, pubs: [b1, b2], aPub } = await peerWithDevices(2);
  await a.sealToDevices("b", [b1], "first");
  const ev = await a.safetyEvidence("b", [b1, b2]);
  assert.deepEqual(ev.pendingKeys, [b2]);
  assert.equal(ev.current, await a.safetyFor(aPub, [b1]));
  assert.equal(ev.pending, await a.safetyFor(aPub, [b2]));
  assert.equal(await a.acceptKeys("b", [b1, b2], undefined, { pendingKeys: ev.pendingKeys, pending: ev.pending }), true);
  assert.equal(await a.keyStatus("b", [b1, b2]), "unchanged");
  assert.equal((await a.sealToDevices("b", [b1, b2], "both")).status, "sealed");
});

test("a key the peer adds after the review is NOT trusted by that acceptance", async () => {
  const { a, pubs: [b1, b2, b3] } = await peerWithDevices(3);
  await a.sealToDevices("b", [b1], "first");
  const reviewed = await a.safetyEvidence("b", [b1, b2]);
  // b3 appears between the review and the click; the request presents it.
  assert.equal(
    await a.acceptKeys("b", [b1, b2, b3], undefined, { pendingKeys: reviewed.pendingKeys, pending: reviewed.pending }),
    true,
  );
  assert.equal(await a.keyStatus("b", [b1, b2]), "unchanged", "the reviewed key is trusted");
  assert.equal(await a.keyStatus("b", [b1, b2, b3]), "changed", "the late key stays pending");
  assert.equal((await a.sealToDevices("b", [b1, b2, b3], "x")).status, "key-changed", "no silent seal to it");
  const next = await a.safetyEvidence("b", [b1, b2, b3]);
  assert.deepEqual(next.pendingKeys, [b3], "the next review names only the late key");
});

test("a reinstall (old key gone) re-pins to exactly the reviewed key", async () => {
  const { a, pubs: [b1, b2] } = await peerWithDevices(2);
  await a.sealToDevices("b", [b1], "first");
  const ev = await a.safetyEvidence("b", [b2]);
  assert.equal(await a.acceptKeys("b", [b2], undefined, { pendingKeys: ev.pendingKeys, pending: ev.pending }), true);
  assert.equal(await a.keyStatus("b", [b2]), "unchanged");
  assert.equal(await a.keyStatus("b", [b1]), "changed", "the retired key is not kept trusted");
});

test("keyStatus is a pure read: first use pins nothing", async () => {
  const { a, pubs: [b1] } = await peerWithDevices(1);
  assert.equal(await a.keyStatus("b", [b1]), "first-use");
  assert.equal(await a.keyStatus("b", [b1]), "first-use");
});

/* Ports wiring: dmKeyCheckRequest / dmKeyAcceptRequest round trips. */

function capture() {
  let handler = null;
  return { port: { subscribe(fn) { handler = fn; } }, fire: (v) => handler(v) };
}

function wiredPorts(e2ee) {
  const check = capture();
  const accept = capture();
  const safety = capture();
  const sent = { checked: [], accepted: [], safety: [] };
  const noop = { subscribe() {} };
  const app = {
    ports: {
      dmSealRequest: noop,
      dmOpenRequest: noop,
      dmPublishKey: noop,
      dmSafetyRequest: safety.port,
      dmSafetyResult: { send: (v) => sent.safety.push(v) },
      dmKeyAcceptRequest: accept.port,
      dmKeyAccepted: { send: (v) => sent.accepted.push(v) },
      dmKeyCheckRequest: check.port,
      dmKeyChecked: { send: (v) => sent.checked.push(v) },
    },
  };
  OnyxPorts.wireE2ee(app, e2ee, () => {});
  return { check, accept, safety, sent };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

test("ports: a directory update on a pinned peer answers changed (and pins nothing)", async () => {
  const { a, pubs: [b1, b2] } = await peerWithDevices(2);
  await a.sealToDevices("b", [b1], "first");
  const w = wiredPorts(a);
  w.check.fire({ peer: "b", keys: [b2], owner: null });
  w.check.fire({ peer: "b", keys: [b1], owner: null });
  w.check.fire({ peer: "c", keys: [b2], owner: null });
  await settle();
  assert.deepEqual(w.sent.checked.map((c) => c.status), ["changed", "unchanged", "first-use"]);
  assert.equal(await a.keyStatus("c", [b2]), "first-use", "a check never pins");
});

test("ports: accept reports trusted only when every presented key is pinned", async () => {
  const { a, pubs: [b1, b2, b3] } = await peerWithDevices(3);
  await a.sealToDevices("b", [b1], "first");
  const w = wiredPorts(a);
  w.safety.fire({ peer: "b", keys: [b1, b2], owner: null });
  await settle();
  const ev = w.sent.safety[0];
  assert.deepEqual(ev.pendingKeys, [b2]);
  w.accept.fire({ peer: "b", keys: [b1, b2, b3], pendingKeys: ev.pendingKeys, pending: ev.pending, owner: null });
  await settle();
  assert.deepEqual(w.sent.accepted[0], { peer: "b", keys: [b1, b2, b3], pendingKeys: [b2], ok: true, trusted: false });
  w.safety.fire({ peer: "b", keys: [b1, b2, b3], owner: null });
  await settle();
  const ev3 = w.sent.safety[1];
  w.accept.fire({ peer: "b", keys: [b1, b2, b3], pendingKeys: ev3.pendingKeys, pending: ev3.pending, owner: null });
  await settle();
  assert.deepEqual(w.sent.accepted[1], { peer: "b", keys: [b1, b2, b3], pendingKeys: [b3], ok: true, trusted: true });
});
