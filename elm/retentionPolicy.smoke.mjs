/* Retention policy bridge smoke test — `retentionPolicyRequest`
   replays the stored policy (sanitized, `keep: 400` fallback) and
   `retentionPolicySave` writes it, re-applies it across all targets,
   and reports the `{ saved, pruned }` receipt mirroring the oracle
   `applyRetentionPolicy` status branches. Without IndexedDB the vault
   is unavailable, so saves report `pruned: false` while a working
   localStorage still reports `saved: true`.
   Run with:
     node --test elm/retentionPolicy.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

const stub = () => ({ subscribe() {}, send() {} });

function memStore(seed = {}) {
  const data = { ...seed };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    _data: data,
  };
}

function harness({ seed } = {}) {
  const sent = { loaded: [], applied: [] };
  let saveHandler = null;
  let requestHandler = null;
  const ports = {
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
    retentionPolicyRequest: { subscribe(fn) { requestHandler = fn; } },
    retentionPolicySave: { subscribe(fn) { saveHandler = fn; } },
    retentionPolicyLoaded: { send(v) { sent.loaded.push(v); } },
    retentionPolicyApplied: { send(v) { sent.applied.push(v); } },
  };
  globalThis.window = { addEventListener() {}, localStorage: memStore(seed) };
  globalThis.global = globalThis;
  globalThis.localStorage = globalThis.window.localStorage;
  globalThis.document = { querySelector: () => null, addEventListener() {} };
  wire({ ports });
  assert.equal(typeof saveHandler, "function");
  return { sent, saveHandler, requestHandler, store: globalThis.window.localStorage };
}

function cleanup() {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.localStorage;
}

test("boot replays the stored policy sanitized", () => {
  const h = harness({ seed: { "onyx:vault-retention-policy": JSON.stringify({ keep: 200, maxAgeDays: 30 }) } });
  try {
    assert.deepEqual(h.sent.loaded, [{ keep: 200, maxAgeDays: 30 }]);
  } finally {
    cleanup();
  }
});

test("boot without storage falls back to the 400 default", () => {
  const h = harness();
  try {
    assert.deepEqual(h.sent.loaded, [{ keep: 400 }]);
  } finally {
    cleanup();
  }
});

test("save writes, then reports saved without a vault", () => {
  const h = harness();
  try {
    h.saveHandler({ json: JSON.stringify({ keep: 1000 }) });
    assert.deepEqual(JSON.parse(h.store._data["onyx:vault-retention-policy"]), { keep: 1000 });
    assert.deepEqual(h.sent.applied, [{ saved: true, pruned: false }]);
  } finally {
    cleanup();
  }
});

test("hostile save JSON fails closed to session-only", () => {
  const h = harness();
  try {
    h.saveHandler({ json: "{nope" });
    assert.equal("onyx:vault-retention-policy" in h.store._data, false);
    assert.deepEqual(h.sent.applied, [{ saved: false, pruned: false }]);
  } finally {
    cleanup();
  }
});
