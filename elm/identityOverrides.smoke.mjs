/* Identity overrides bridge smoke test — the
   `identityOverridesRequest` port mirrors the owner-scoped journal
   reads in lib/identityOverrides (legacy ownerless journals purged
   on every read, oversized or corrupt journals land empty, null
   keys stay empty, and raw values pass through for Elm-side
   validation). Run with:
     node --test elm/identityOverrides.smoke.mjs
   (from the repo root). Needs the repo jsdom devDependency. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

const stub = () => ({ subscribe() {}, send() {} });

function harness() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "https://example.test/", pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  let request = null;
  let loaded = null;
  let save = null;
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
    transcriptDownload: stub(),
    mediaSave: stub(),
    translationConfig: stub(),
    translateRequest: stub(),
    translateResult: stub(),
    translationTargetSave: stub(),
    personReportReceiptSave: stub(),
    identityOverridesRequest: { subscribe(fn) { request = fn; } },
    identityOverridesLoaded: { send(payload) { loaded = payload; } },
    identityOverridesSave: { subscribe(fn) { save = fn; } },
  };
  wire({ ports });
  assert.equal(typeof request, "function");
  assert.equal(typeof save, "function");
  return { dom, request, getLoaded: () => loaded, getSave: () => save };
}

function cleanup(h) {
  h.dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
}

const SOFT = "onyx:soft-ignore:owner:k";
const COLORS = "onyx:nick-colors:owner:k";
const NAMES = "onyx:display-names:owner:k";

function keys() {
  return { softIgnoreKey: SOFT, nickColorsKey: COLORS, displayNamesKey: NAMES };
}

test("reads the three journals through untouched", () => {
  const h = harness();
  try {
    const store = h.dom.window.localStorage;
    store.setItem(SOFT, JSON.stringify(["alice"]));
    store.setItem(COLORS, JSON.stringify({ alice: "#abcdef" }));
    store.setItem(NAMES, JSON.stringify({ alice: "Ally" }));
    h.request(keys());
    assert.deepEqual(h.getLoaded(), {
      softIgnore: ["alice"],
      nickColors: { alice: "#abcdef" },
      displayNames: { alice: "Ally" },
    });
  } finally {
    cleanup(h);
  }
});

test("purges legacy ownerless journals on every read", () => {
  const h = harness();
  try {
    const store = h.dom.window.localStorage;
    store.setItem("onyx:soft-ignore", JSON.stringify(["legacy"]));
    store.setItem("onyx:nick-colors", JSON.stringify({ legacy: "#123456" }));
    store.setItem("onyx:display-names", JSON.stringify({ legacy: "Legacy" }));
    h.request(keys());
    assert.equal(store.getItem("onyx:soft-ignore"), null);
    assert.equal(store.getItem("onyx:nick-colors"), null);
    assert.equal(store.getItem("onyx:display-names"), null);
    assert.deepEqual(h.getLoaded(), { softIgnore: [], nickColors: {}, displayNames: {} });
  } finally {
    cleanup(h);
  }
});

test("corrupt, oversized, and missing journals land empty", () => {
  const h = harness();
  try {
    const store = h.dom.window.localStorage;
    store.setItem(SOFT, "{bad-json");
    store.setItem(COLORS, "x".repeat(256 * 1024 + 1));
    h.request(keys());
    assert.deepEqual(h.getLoaded(), { softIgnore: [], nickColors: {}, displayNames: {} });
  } finally {
    cleanup(h);
  }
});

test("null keys stay empty without touching storage", () => {
  const h = harness();
  try {
    h.request({ softIgnoreKey: null, nickColorsKey: null, displayNamesKey: null });
    assert.deepEqual(h.getLoaded(), { softIgnore: [], nickColors: {}, displayNames: {} });
    assert.equal(h.dom.window.localStorage.length, 0);
  } finally {
    cleanup(h);
  }
});

test("saves provided journals and purges legacy keys", () => {
  const h = harness();
  try {
    const store = h.dom.window.localStorage;
    store.setItem("onyx:soft-ignore", JSON.stringify(["legacy"]));
    h.getSave()({
      softIgnoreKey: SOFT,
      softIgnore: JSON.stringify(["trev"]),
      nickColorsKey: COLORS,
      nickColors: JSON.stringify({ trev: "#aabbcc" }),
      displayNamesKey: NAMES,
      displayNames: JSON.stringify({ trev: "Trusted teammate" }),
    });
    assert.equal(store.getItem(SOFT), JSON.stringify(["trev"]));
    assert.equal(store.getItem(COLORS), JSON.stringify({ trev: "#aabbcc" }));
    assert.equal(store.getItem(NAMES), JSON.stringify({ trev: "Trusted teammate" }));
    assert.equal(store.getItem("onyx:soft-ignore"), null);
  } finally {
    cleanup(h);
  }
});

test("emptied journals remove their keys and untouched slots stay", () => {
  const h = harness();
  try {
    const store = h.dom.window.localStorage;
    store.setItem(SOFT, JSON.stringify(["trev"]));
    store.setItem(COLORS, JSON.stringify({ trev: "#aabbcc" }));
    h.getSave()({
      softIgnoreKey: SOFT,
      softIgnore: "[]",
      nickColorsKey: null,
      nickColors: null,
      displayNamesKey: null,
      displayNames: null,
    });
    assert.equal(store.getItem(SOFT), null);
    assert.equal(store.getItem(COLORS), JSON.stringify({ trev: "#aabbcc" }));
  } finally {
    cleanup(h);
  }
});

test("save drops over-cap and non-string journals", () => {
  const h = harness();
  try {
    const store = h.dom.window.localStorage;
    store.setItem(SOFT, JSON.stringify(["trev"]));
    h.getSave()({
      softIgnoreKey: SOFT,
      softIgnore: "x".repeat(256 * 1024 + 1),
      nickColorsKey: COLORS,
      nickColors: null,
      displayNamesKey: null,
      displayNames: null,
    });
    assert.equal(store.getItem(SOFT), JSON.stringify(["trev"]));
    assert.equal(store.getItem(COLORS), null);
  } finally {
    cleanup(h);
  }
});
