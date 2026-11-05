/* Legacy scheduled plaintext persistence retirement smoke.
   Durable behavior is covered by elm/runtime/scheduled-custody.test.ts;
   this guard ensures the former localStorage writer cannot be wired back
   into the production ports. Run with node --test. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");

test("legacy scheduledSave cannot persist plaintext rows", () => {
  let writes = 0;
  let legacySubscriber = 0;
  const legacyStorage = {
    getItem() { return null; },
    setItem() { writes += 1; },
    removeItem() { writes += 1; },
  };
  const ports = new Proxy({}, {
    get(_target, name) {
      if (name === "scheduledSave") return { subscribe() { legacySubscriber += 1; } };
      if (name === "scheduledPersisted") return { send() { writes += 1; } };
      return { subscribe() {}, send() {} };
    },
  });
  const timers = [];
  const setTimeout = globalThis.setTimeout;
  const setInterval = globalThis.setInterval;
  const BroadcastChannel = globalThis.BroadcastChannel;
  globalThis.setTimeout = (...args) => { const handle = setTimeout(...args); timers.push(["timeout", handle]); return handle; };
  globalThis.setInterval = (...args) => { const handle = setInterval(...args); timers.push(["interval", handle]); return handle; };
  globalThis.BroadcastChannel = undefined;
  globalThis.window = { localStorage: legacyStorage };
  try {
    globalThis.OnyxPorts.wire({ ports });
    assert.equal(legacySubscriber, 0);
    assert.equal(writes, 0);
    assert.equal(legacyStorage.getItem("onyx:scheduled"), null);
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
