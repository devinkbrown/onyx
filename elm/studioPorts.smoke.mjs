/* Studio ports smoke test — token-var commit with stale removal,
   share-link copy echo, import prompts, eye-dropper states,
   share-param strip, and cross-tab customs refresh. All best-effort:
   missing DOM APIs never throw.
   Run with:
     node --test elm/studioPorts.smoke.mjs
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

function appWith(handlers, senders) {
  const capture = (name) => ({
    subscribe(fn) { handlers[name] = fn; },
    send(payload) { senders[name].push(payload); },
  });
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
      appearanceApply: { subscribe(fn) { handlers.appearanceApply = fn; } },
      studioStoreCustomThemes: { subscribe(fn) { handlers.studioStoreCustomThemes = fn; } },
      studioShareCopy: { subscribe(fn) { handlers.studioShareCopy = fn; } },
      studioPromptRequest: { subscribe(fn) { handlers.studioPromptRequest = fn; } },
      studioEyeDropperRequest: { subscribe(fn) { handlers.studioEyeDropperRequest = fn; } },
      studioStripShareParam: { subscribe(fn) { handlers.studioStripShareParam = fn; } },
      studioCustomThemes: capture("studioCustomThemes"),
      clipboardResult: capture("clipboardResult"),
      studioPromptResult: capture("studioPromptResult"),
      studioEyeDropperResult: capture("studioEyeDropperResult"),
      appearanceSnapshot: stub(),
    },
  };
}

function fresh() {
  return [{}, { studioCustomThemes: [], clipboardResult: [], studioPromptResult: [], studioEyeDropperResult: [] }];
}

function withDocument(style, attrs) {
  globalThis.document = {
    documentElement: {
      dataset: {},
      style,
      setAttribute(k, v) { attrs.push([k, v]); },
    },
  };
}

function styleRecorder() {
  const calls = [];
  return {
    calls,
    setProperty(k, v) { calls.push(["set", k, v]); },
    removeProperty(k) { calls.push(["remove", k]); },
  };
}

test("apply commits token vars and removes stale ones", () => {
  const [handlers, senders] = fresh();
  const style = styleRecorder();
  const attrs = [];
  withDocument(style, attrs);
  try {
    wire(appWith(handlers, senders));
    handlers.appearanceApply({
      density: "cozy", fontScale: "md", hideEvents: false, width: "measured",
      reader: false, reduceMotion: false, reduceTransparency: false,
      highContrast: false, experienceMode: "standard",
      dataTheme: "ocean", scheme: "dark",
      tokens: [["--lapis", "#ff0000"], ["--paper", "#ffffff"]],
    });
    assert.ok(style.calls.some(([op, k, v]) => op === "set" && k === "--lapis" && v === "#ff0000"));
    handlers.appearanceApply({
      density: "cozy", fontScale: "md", hideEvents: false, width: "measured",
      reader: false, reduceMotion: false, reduceTransparency: false,
      highContrast: false, experienceMode: "standard",
      dataTheme: "ocean", scheme: "dark",
      tokens: [["--paper", "#ffffff"]],
    });
    assert.ok(style.calls.some(([op, k]) => op === "remove" && k === "--lapis"));
    // Non---prefixed keys never reach the CSSOM.
    handlers.appearanceApply({
      density: "cozy", fontScale: "md", hideEvents: false, width: "measured",
      reader: false, reduceMotion: false, reduceTransparency: false,
      highContrast: false, experienceMode: "standard",
      dataTheme: "ocean", scheme: "dark",
      tokens: [["color", "red"], ["--ok", "#00ff00"]],
    });
    assert.ok(!style.calls.some(([op, k]) => k === "color"));
  } finally {
    delete globalThis.document;
  }
});

test("share copies origin plus code and echoes ts:share", async () => {
  const [handlers, senders] = fresh();
  globalThis.window = { location: { origin: "https://onyx.local" } };
  try {
    wire(appWith(handlers, senders));
    handlers.studioShareCopy({ code: "abc123" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    // No clipboard in node: the copy reports false but still echoes.
    assert.deepEqual(senders.clipboardResult, [{ tag: "ts:share", ok: false }]);
  } finally {
    delete globalThis.window;
  }
});

test("prompt echoes kind and text; cancel yields null", () => {
  const [handlers, senders] = fresh();
  globalThis.window = { prompt(message) { return message.indexOf("seed") !== -1 ? "{\"a\":1}" : null; } };
  try {
    wire(appWith(handlers, senders));
    handlers.studioPromptRequest({ kind: "seed" });
    handlers.studioPromptRequest({ kind: "blob" });
    assert.deepEqual(senders.studioPromptResult, [
      { kind: "seed", text: "{\"a\":1}" },
      { kind: "blob", text: null },
    ]);
  } finally {
    delete globalThis.window;
  }
});

test("eye-dropper reports unsupported without the API", async () => {
  const [handlers, senders] = fresh();
  globalThis.window = {};
  try {
    wire(appWith(handlers, senders));
    handlers.studioEyeDropperRequest();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(senders.studioEyeDropperResult.length, 1);
    assert.equal(senders.studioEyeDropperResult[0].state, "unsupported");
    assert.equal(senders.studioEyeDropperResult[0].hex, "");
  } finally {
    delete globalThis.window;
  }
});

test("eye-dropper relays selected hex and cancellations", async () => {
  const [handlers, senders] = fresh();
  let mode = "selected";
  globalThis.window = {
    EyeDropper: function () {
      this.open = () => mode === "selected"
        ? Promise.resolve({ sRGBHex: "#ff0000" })
        : Promise.reject(Object.assign(new Error("abort"), { name: "AbortError" }));
    },
  };
  try {
    wire(appWith(handlers, senders));
    handlers.studioEyeDropperRequest();
    await new Promise((resolve) => setTimeout(resolve, 10));
    mode = "cancelled";
    handlers.studioEyeDropperRequest();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(senders.studioEyeDropperResult, [
      { state: "selected", detail: "", hex: "#ff0000" },
      { state: "cancelled", detail: "Screen colour sampling cancelled. The accent seed was not changed.", hex: "" },
    ]);
  } finally {
    delete globalThis.window;
  }
});

test("strip removes only the theme param; customs store and refresh", () => {
  const [handlers, senders] = fresh();
  const replaced = [];
  const store = {};
  let storageListener = null;
  globalThis.window = {
    location: { search: "?theme=abc&room=%23a", pathname: "/app", hash: "" },
    history: { state: null, replaceState(a, b, url) { replaced.push(url); } },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
    },
    addEventListener(type, fn) { if (type === "storage") storageListener = fn; },
  };
  try {
    wire(appWith(handlers, senders));
    handlers.studioStripShareParam();
    assert.deepEqual(replaced, ["/app?room=%23a"]);
    handlers.studioStoreCustomThemes({ json: "[1]" });
    assert.equal(store["onyx:custom-themes"], "[1]");
    assert.equal(typeof storageListener, "function");
    storageListener({ storageArea: globalThis.window.localStorage, key: "onyx:custom-themes" });
    assert.deepEqual(senders.studioCustomThemes, [{ json: "[1]" }]);
    // Unrelated keys never refresh.
    storageListener({ storageArea: globalThis.window.localStorage, key: "onyx:preferences" });
    assert.equal(senders.studioCustomThemes.length, 1);
  } finally {
    delete globalThis.window;
  }
});
