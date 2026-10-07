/* Stats ports smoke test — historyReplace swaps the shareable query
   without navigating, and statsRevealInspector scrolls + focuses the
   room inspector (smooth unless prefers-reduced-motion). Both are
   best-effort: missing DOM APIs never throw.
   Run with:
     node --test elm/statsPorts.smoke.mjs
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

function appWith(handlers) {
  return {
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
      clipboardCopy: stub(),
      clipboardResult: stub(),
      historyReplace: { subscribe(fn) { handlers.historyReplace = fn; } },
      statsRevealInspector: { subscribe(fn) { handlers.statsRevealInspector = fn; } },
    },
  };
}

test("historyReplace swaps the query without navigating", () => {
  const handlers = {};
  const replaced = [];
  globalThis.window = {
    history: { replaceState(a, b, url) { replaced.push(url); } },
  };
  try {
    wire(appWith(handlers));
    assert.equal(typeof handlers.historyReplace, "function");
    handlers.historyReplace("/stats/?room=%23b&compare=%23a,%23b");
    assert.deepEqual(replaced, ["/stats/?room=%23b&compare=%23a,%23b"]);
    handlers.historyReplace("");
    handlers.historyReplace(null);
    assert.deepEqual(replaced, ["/stats/?room=%23b&compare=%23a,%23b"]);
  } finally {
    delete globalThis.window;
  }
});

test("inspector reveal scrolls smooth and focuses with preventScroll", () => {
  const handlers = {};
  const calls = [];
  const target = {
    scrollIntoView(opts) { calls.push(["scroll", opts]); },
    focus(opts) { calls.push(["focus", opts]); },
  };
  globalThis.window = { matchMedia() { return { matches: false }; } };
  globalThis.document = { getElementById(id) { return id === "stats-room-inspector" ? target : null; } };
  try {
    wire(appWith(handlers));
    assert.equal(typeof handlers.statsRevealInspector, "function");
    handlers.statsRevealInspector();
    assert.deepEqual(calls, [
      ["scroll", { block: "start", behavior: "smooth" }],
      ["focus", { preventScroll: true }],
    ]);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

test("inspector reveal degrades to auto scroll under reduced motion", () => {
  const handlers = {};
  const calls = [];
  const target = {
    scrollIntoView(opts) { calls.push(["scroll", opts]); },
    focus(opts) { calls.push(["focus", opts]); },
  };
  globalThis.window = { matchMedia() { return { matches: true }; } };
  globalThis.document = { getElementById() { return target; } };
  try {
    wire(appWith(handlers));
    handlers.statsRevealInspector();
    assert.deepEqual(calls, [
      ["scroll", { block: "start", behavior: "auto" }],
      ["focus", { preventScroll: true }],
    ]);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

test("inspector reveal without a target or DOM never throws", () => {
  const handlers = {};
  globalThis.document = { getElementById() { return null; } };
  try {
    wire(appWith(handlers));
    handlers.statsRevealInspector();
  } finally {
    delete globalThis.document;
  }
  wire(appWith({}));
});
