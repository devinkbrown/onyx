/* Offline-memo notice smoke — the `offlineMemoNotice` bridge dispatches
   the oracle's `onyx:offlineMemo` CustomEvent with the memo aggregate
   ({ channel, count, firstMsgId }), best-effort and window-guarded.
   Run with:
     node --test elm/offlineMemo.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

function stubPort() {
  return { subscribe() {} };
}

function capturePort() {
  let handler = null;
  return {
    port: { subscribe(fn) { handler = fn; } },
    fire(payload) { handler(payload); },
    get wired() { return handler !== null; },
  };
}

test("offlineMemoNotice dispatches onyx:offlineMemo with the aggregate", () => {
  const memo = capturePort();
  const seen = [];
  const app = {
    ports: {
      offlineMemoNotice: memo.port,
    },
  };
  const realWindow = globalThis.window;
  const realCustomEvent = globalThis.CustomEvent;
  try {
    // Explicit stubs only: unguarded ports must exist, while every
    // other absent port stays falsy so no guarded poller starts (a
    // universal truthy stub would keep the runner alive).
    const stub = () => stubPort();
    const full = {
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
        offlineMemoNotice: memo.port,
      },
    };
    wire(full);
    assert.ok(memo.wired, "bridge subscribes");
    // Window exists only around the dispatch: wire() must not need it,
    // and no poller started under a fake window may keep node alive.
    globalThis.window = {
      dispatchEvent(event) { seen.push(event); return true; },
    };
    globalThis.CustomEvent = function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    };
    memo.fire({ channel: "bob", count: 2, firstMsgId: 7 });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].type, "onyx:offlineMemo");
    assert.deepEqual(seen[0].detail, { channel: "bob", count: 2, firstMsgId: 7 });
    // Empty payloads never dispatch.
    memo.fire(null);
    assert.equal(seen.length, 1);
  } finally {
    if (realWindow === undefined) delete globalThis.window;
    else globalThis.window = realWindow;
    if (realCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = realCustomEvent;
  }
});
