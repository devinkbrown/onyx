/* Private scheduled-message editor port smoke.
   Run with: node --test elm/scheduledRuntimePorts.smoke.mjs */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers";
import { IDBFactory } from "fake-indexeddb";

const require = createRequire(import.meta.url);
require("./ports.js");

const wireTimers = [];
after(() => {
  for (const [kind, handle] of wireTimers) {
    if (kind === "interval") globalThis.clearInterval(handle);
    else globalThis.clearTimeout(handle);
  }
});

function harness(runtime, indexedDB = null) {
  const handlers = {};
  const sent = { ready: [], failed: [], clock: [], vaultStored: [] };
  const observed = [];
  const subscriptions = { scheduledRequest: 0 };
  const makePort = (name) => ({
    subscribe(fn) {
      if (name === "runtimePrivateScheduledMessageRequest") {
        subscriptions.scheduledRequest += 1;
        handlers.request = (value) => { observed.push(value); fn(value); };
      }
      if (name === "scheduleClockRequest") handlers.clock = fn;
      if (name === "vaultPut") handlers.vaultPut = fn;
    },
    send(value) {
      if (name === "runtimePrivateScheduledMessageReady") sent.ready.push(value);
      if (name === "runtimePrivateScheduledMessageFailed") sent.failed.push(value);
      if (name === "scheduleClockResult") sent.clock.push(value);
      if (name === "vaultStored") sent.vaultStored.push(value);
    },
  });
  const ports = new Proxy({}, { get(_target, name) { return makePort(String(name)); } });
  const originalTimeout = globalThis.setTimeout;
  const originalInterval = globalThis.setInterval;
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const originalIndexedDB = globalThis.indexedDB;
  if (indexedDB) globalThis.indexedDB = indexedDB;
  globalThis.BroadcastChannel = undefined;
  globalThis.setTimeout = function (...args) {
    const handle = originalTimeout(...args);
    wireTimers.push(["timeout", handle]);
    return handle;
  };
  globalThis.setInterval = function (...args) {
    const handle = originalInterval(...args);
    wireTimers.push(["interval", handle]);
    return handle;
  };
  let wired;
  try { wired = globalThis.OnyxPorts.wire({ ports }, { runtime }); }
  finally {
    globalThis.setTimeout = originalTimeout;
    globalThis.setInterval = originalInterval;
    globalThis.BroadcastChannel = originalBroadcastChannel;
    if (originalIndexedDB === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = originalIndexedDB;
  }
  return { handlers, sent, wired, observed, subscriptions };
}

function waitForRequest(request) {
  if (request.readyState === "done") {
    if (request.error) return Promise.reject(request.error);
    return Promise.resolve(request.result);
  }
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("indexeddb-open-failed")), { once: true });
    request.addEventListener("blocked", () => reject(new Error("indexeddb-upgrade-blocked")), { once: true });
  });
}

function observeOpen(factory) {
  const opened = [];
  const original = factory.open.bind(factory);
  factory.open = function (name, version) {
    const request = original(name, version);
    opened.push({ name, version, request });
    return request;
  };
  return opened;
}

const request = {
  requestId: "scheduledEdit000000000001",
  operationId: "scheduled_20261104_1",
  kind: "edit",
  ownerRef: "owner_ref_000000000001",
  accountGeneration: 4,
  connectionGeneration: 8,
  conversationId: "#room",
  initialDueAtMs: Date.now() + 60_000,
  prefillFromComposer: false,
};

test("scheduled editor request reaches private runtime and only returns a stamped opaque ref", async () => {
  const owner = { ownerRef: request.ownerRef, accountGeneration: request.accountGeneration, connectionGeneration: request.connectionGeneration };
  const runtime = {
    calls: 0,
    ownerSnapshot: () => owner,
    requestPrivateScheduledMessage: async function (input) { this.calls += 1; return ({
      requestId: input.requestId, operationId: input.operationId, kind: input.kind, inputRef: "private_input_opaque_123456",
      dueAtMs: input.initialDueAtMs, prefilledComposer: false, ownerRef: input.ownerRef,
      accountGeneration: input.accountGeneration, connectionGeneration: input.connectionGeneration,
    }); },
  };
  const h = harness(runtime);
  try {
    assert.equal(typeof h.handlers.request, "function");
    assert.equal(h.subscriptions.scheduledRequest, 1);
    h.handlers.request(request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(h.observed, [request]);
    assert.deepEqual(h.sent.ready, [{
      requestId: request.requestId, operationId: request.operationId, kind: "edit", inputRef: "private_input_opaque_123456",
      dueAtMs: request.initialDueAtMs, prefilledComposer: false, ownerRef: request.ownerRef,
      accountGeneration: request.accountGeneration, connectionGeneration: request.connectionGeneration,
    }]);
    assert.deepEqual(h.sent.failed, []);
    assert.equal(runtime.calls, 1);
    assert.equal("text" in h.sent.ready[0], false);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

test("a private editor result from a retired owner is ignored", async () => {
  let current = { ownerRef: request.ownerRef, accountGeneration: request.accountGeneration, connectionGeneration: request.connectionGeneration };
  const runtime = {
    ownerSnapshot: () => current,
    requestPrivateScheduledMessage: async (input) => {
      current = { ...current, connectionGeneration: current.connectionGeneration + 1 };
      return { ...input, inputRef: "private_input_opaque_123456", dueAtMs: input.initialDueAtMs, prefilledComposer: false };
    },
  };
  const h = harness(runtime);
  try {
    h.handlers.request(request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(h.sent.ready, []);
    assert.deepEqual(h.sent.failed, []);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

test("runtime startup leaves v5 upgrade unblocked and standalone v3 closes on versionchange", async () => {
  const runtimeIdb = new IDBFactory();
  const runtimeOpens = observeOpen(runtimeIdb);
  const runtime = { ownerSnapshot: () => null, requestPrivateScheduledMessage: async () => null };
  harness(runtime, runtimeIdb);
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runtimeOpens.some((entry) => entry.name === "onyx-vault" && entry.version === 3), false);
    const runtimeUpgradeRequest = runtimeIdb.open("onyx-vault", 5);
    runtimeUpgradeRequest.onupgradeneeded = () => runtimeUpgradeRequest.result.createObjectStore("runtime-v5");
    const runtimeDb = await waitForRequest(runtimeUpgradeRequest);
    assert.equal(runtimeDb.version, 5);
    runtimeDb.close();
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }

  const fallbackIdb = new IDBFactory();
  const fallbackOpens = observeOpen(fallbackIdb);
  const fallbackHarness = harness(null, fallbackIdb);
  try {
    await new Promise((resolve) => setImmediate(resolve));
    const legacyOpen = fallbackOpens.find((entry) => entry.name === "onyx-vault" && entry.version === 3);
    assert.ok(legacyOpen, "standalone compatibility still opens the v3 vault");
    const legacyDb = await waitForRequest(legacyOpen.request);
    assert.equal(legacyDb.version, 3);

    const newerRequest = fallbackIdb.open("onyx-vault", 4);
    newerRequest.onupgradeneeded = () => newerRequest.result.createObjectStore("next-version");
    const newerDb = await waitForRequest(newerRequest);
    assert.equal(newerDb.version, 4);
    newerDb.close();

    fallbackHarness.handlers.vaultPut({ target: "#room", rows: [] });
    assert.deepEqual(fallbackHarness.sent.vaultStored, [{ target: "#room", stored: 0 }]);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

test("schedule clock returns a local tomorrow-at-nine preset and local minute value", () => {
  const h = harness(null);
  const before = new Date();
  h.handlers.clock();
  const after = new Date();
  assert.equal(h.sent.clock.length, 1);
  const value = h.sent.clock[0];
  const tomorrow = new Date(value.tomorrow9);
  assert.equal(tomorrow.getHours(), 9);
  assert.equal(tomorrow.getMinutes(), 0);
  assert.ok(value.tomorrow9 > after.getTime());
  assert.match(value.minLocal, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u);
  const localMinute = new Date(value.minLocal);
  assert.ok(localMinute >= new Date(before.getFullYear(), before.getMonth(), before.getDate(), before.getHours(), before.getMinutes()));
  assert.ok(localMinute <= new Date(after.getFullYear(), after.getMonth(), after.getDate(), after.getHours(), after.getMinutes() + 1));
});
