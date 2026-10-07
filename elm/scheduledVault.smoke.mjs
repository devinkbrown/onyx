/* Scheduled-queue durable smoke test — `scheduled` + `vault_meta` stores:
   Elm owns validation and claim tokens; the bridge enforces the
   same-origin CAS fences (erase epoch, owner generation, capacity,
   claim exclusivity, cancellation tombstones), mirroring
   `historyVault.ts` scheduled ops. Run with:
     node --test elm/scheduledVault.smoke.mjs
   (from the repo root). Needs the repo's fake-indexeddb dev dependency. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("fake-indexeddb/auto");
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

function ownerFor(tag) {
  return { serverUrl: "wss://" + tag + ".test", identity: "kai" };
}

function row(id, extra, owner) {
  return Object.assign(
    { id: id, channel: "#c", text: "later " + id, sendAt: 5000, owner: owner },
    extra || {}
  );
}

function harness() {
  const handlers = {};
  const stub = () => ({ subscribe() {} });
  const app = { ports: {} };
  const names = [
    "wsConnect", "wsSend", "wsClose", "vaultPut", "vaultGet", "passkeyCreate",
    "passkeyGet", "passkeySettleRequest", "dmSealRequest", "dmOpenRequest",
    "dmPublishKey", "roomSealRequest", "roomOpenRequest", "groupControlInstall",
    "groupDirectoryDerive", "guidesProgressRequest", "guidesProgressStore",
    "blocklistsSave", "highlightWordsSave", "dndSave",
    "scheduledSave", "scheduledSettle", "scheduledOwnerCancel",
  ];
  names.forEach((name) => {
    if (name !== "scheduledSettle" && name !== "scheduledOwnerCancel") app.ports[name] = stub();
  });
  ["scheduledFenceRequest", "scheduledAddRequest", "scheduledDispatchRequest", "scheduledCancelRequest", "scheduledSettle", "scheduledOwnerCancel"].forEach((name) => {
    app.ports[name] = { subscribe(fn) { handlers[name] = fn; } };
  });
  const sent = {};
  ["scheduledFenceResult", "scheduledAddResult", "scheduledDispatchResult", "scheduledCancelResult"].forEach((name) => {
    sent[name] = [];
    app.ports[name] = { send(payload) { sent[name].push(payload); } };
  });
  globalThis.window = { localStorage: null };
  wire(app);
  return { handlers, sent };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fence(h, owner) {
  h.handlers.scheduledFenceRequest({ tag: "t", owner: owner });
  for (let i = 0; i < 50 && h.sent.scheduledFenceResult.length === 0; i += 1) await sleep(10);
  return h.sent.scheduledFenceResult[h.sent.scheduledFenceResult.length - 1];
}

async function add(h, r, epoch, generation) {
  h.sent.scheduledAddResult.length = 0;
  h.handlers.scheduledAddRequest({ row: r, expectedEpoch: epoch, expectedGeneration: generation });
  for (let i = 0; i < 50 && h.sent.scheduledAddResult.length === 0; i += 1) await sleep(10);
  return h.sent.scheduledAddResult[h.sent.scheduledAddResult.length - 1];
}

async function dispatch(h, owner, rows, candidates) {
  h.sent.scheduledDispatchResult.length = 0;
  h.handlers.scheduledDispatchRequest({ rows: rows, owner: owner, candidates: candidates || [] });
  for (let i = 0; i < 50 && h.sent.scheduledDispatchResult.length === 0; i += 1) await sleep(10);
  return h.sent.scheduledDispatchResult[h.sent.scheduledDispatchResult.length - 1];
}

test("pristine fence reads zero, add admits, duplicate add succeeds", async () => {
  const h = harness();
  const owner = ownerFor("t1");
  try {
    await sleep(100);
    assert.deepEqual(await fence(h, owner), { tag: "t", ok: true, epoch: 0, generation: 0 });
    assert.deepEqual(await add(h, row("s1", null, owner), 0, 0), { id: "s1", ok: true });
    assert.deepEqual(await add(h, row("s1", null, owner), 0, 0), { id: "s1", ok: true });
    assert.deepEqual(await add(h, row("s2", null, owner), 5, 0), { id: "s2", ok: false });
  } finally {
    delete globalThis.window;
  }
});

test("reconcile migrates and claims exclusively", async () => {
  const h = harness();
  const owner = ownerFor("t2");
  try {
    await sleep(100);
    await add(h, row("c1", null, owner), 0, 0);
    const first = await dispatch(h, owner, [row("c1", null, owner), row("c2", null, owner)], [{ id: "c1", token: "claim-1", claimedAt: 100 }]);
    assert.deepEqual(first.granted, ["c1"]);
    const owned = first.queue.filter((r) => r.owner && r.owner.serverUrl === owner.serverUrl);
    assert.equal(owned.length, 2);
    const claimed = first.queue.find((r) => r.id === "c1");
    assert.deepEqual(claimed.claim, { token: "claim-1", claimedAt: 100 });
    const second = await dispatch(h, owner, first.queue, [{ id: "c1", token: "claim-2", claimedAt: 200 }]);
    assert.deepEqual(second.granted, []);
  } finally {
    delete globalThis.window;
  }
});

test("settle admitted tombstones and hides the row", async () => {
  const h = harness();
  const owner = ownerFor("t3");
  try {
    await sleep(100);
    await add(h, row("a1", null, owner), 0, 0);
    const first = await dispatch(h, owner, [row("a1", null, owner)], [{ id: "a1", token: "claim-9", claimedAt: 50 }]);
    assert.deepEqual(first.granted, ["a1"]);
    h.handlers.scheduledSettle({ id: "a1", owner: owner, token: "wrong", admitted: true });
    await sleep(100);
    h.handlers.scheduledSettle({ id: "a1", owner: owner, token: "claim-9", admitted: true });
    await sleep(100);
    const after = await dispatch(h, owner, [], []);
    assert.equal(after.queue.some((r) => r.id === "a1"), false);
  } finally {
    delete globalThis.window;
  }
});

test("settle rejected releases the claim and keeps the row", async () => {
  const h = harness();
  const owner = ownerFor("t4");
  try {
    await sleep(100);
    await add(h, row("r1", null, owner), 0, 0);
    await dispatch(h, owner, [row("r1", null, owner)], [{ id: "r1", token: "claim-7", claimedAt: 60 }]);
    h.handlers.scheduledSettle({ id: "r1", owner: owner, token: "claim-7", admitted: false });
    await sleep(100);
    const after = await dispatch(h, owner, [], []);
    const kept = after.queue.find((r) => r.id === "r1");
    assert.ok(kept);
    assert.equal(kept.claim, undefined);
  } finally {
    delete globalThis.window;
  }
});

test("cancel tombstones plaintext-free and acks", async () => {
  const h = harness();
  const owner = ownerFor("t5");
  try {
    await sleep(100);
    h.sent.scheduledCancelResult.length = 0;
    h.handlers.scheduledCancelRequest({ id: "ghost", owner: owner });
    for (let i = 0; i < 50 && h.sent.scheduledCancelResult.length === 0; i += 1) await sleep(10);
    assert.deepEqual(h.sent.scheduledCancelResult[0].ok, true);
    await add(h, row("k1", null, owner), 0, 0);
    h.handlers.scheduledCancelRequest({ id: "k1", owner: owner });
    await sleep(100);
    const after = await dispatch(h, owner, [row("k1", null, owner)], [{ id: "k1", token: "claim-3", claimedAt: 70 }]);
    assert.deepEqual(after.granted, []);
    assert.equal(after.queue.some((r) => r.id === "k1"), false);
  } finally {
    delete globalThis.window;
  }
});

test("owner cancel retires rows and turns the generation", async () => {
  const h = harness();
  const owner = ownerFor("t6");
  try {
    await sleep(100);
    await add(h, row("o1", null, owner), 0, 0);
    await add(h, row("o1", { owner: { serverUrl: "wss://t6.test", identity: "KAI" } }, owner), 0, 0);
    h.handlers.scheduledOwnerCancel({ owner: owner });
    await sleep(150);
    const fenced = await fence(h, owner);
    assert.equal(fenced.generation, 1);
    const after = await dispatch(h, owner, [row("o1", null, owner)], []);
    assert.equal(after.queue.some((r) => r.id === "o1"), false);
    assert.deepEqual(await add(h, row("o2", null, owner), 0, 0), { id: "o2", ok: false });
  } finally {
    delete globalThis.window;
  }
});
