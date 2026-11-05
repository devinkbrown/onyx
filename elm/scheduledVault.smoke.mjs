/* Legacy scheduled-vault port retirement smoke.
   Encrypted custody, revisions, claims, cancellation, and concurrency are
   exercised by elm/runtime/scheduled-custody.test.ts. These former page
   ports accepted caller-owned plaintext rows and are intentionally absent. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");

const retiredPorts = [
  "scheduledFenceRequest", "scheduledAddRequest", "scheduledDispatchRequest",
  "scheduledCancelRequest", "scheduledSettle", "scheduledOwnerCancel",
  "scheduledFenceResult", "scheduledAddResult", "scheduledDispatchResult",
  "scheduledCancelResult", "scheduledSave", "scheduledPersisted",
];

test("legacy scheduled row and claim ports are not subscribed", () => {
  const subscriptions = new Map();
  const sends = [];
  const ports = new Proxy({}, {
    get(_target, name) {
      const key = String(name);
      return {
        subscribe() { subscriptions.set(key, (subscriptions.get(key) || 0) + 1); },
        send(value) { sends.push({ key, value }); },
      };
    },
  });
  const timers = [];
  const setTimeout = globalThis.setTimeout;
  const setInterval = globalThis.setInterval;
  const BroadcastChannel = globalThis.BroadcastChannel;
  globalThis.setTimeout = (...args) => { const handle = setTimeout(...args); timers.push(["timeout", handle]); return handle; };
  globalThis.setInterval = (...args) => { const handle = setInterval(...args); timers.push(["interval", handle]); return handle; };
  globalThis.BroadcastChannel = undefined;
  globalThis.window = { localStorage: null };
  try {
    globalThis.OnyxPorts.wire({ ports });
    for (const name of retiredPorts) assert.equal(subscriptions.get(name) || 0, 0, `${name} must remain retired`);
    assert.equal(sends.some(({ key }) => retiredPorts.includes(key)), false);
  } finally {
    globalThis.setTimeout = setTimeout;
    globalThis.setInterval = setInterval;
    globalThis.BroadcastChannel = BroadcastChannel;
    for (const [kind, handle] of timers) {
      if (kind === "interval") globalThis.clearInterval(handle);
      else globalThis.clearTimeout(handle);
    }
    delete globalThis.window;
  }
});
