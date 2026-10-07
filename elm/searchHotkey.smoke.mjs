/* Ctrl/Cmd+F message-search hotkey smoke test — mirrors AppShell
   `handleMessageSearchHotkey` guard-for-guard: `f` with ctrl or meta,
   no shift/alt, not composing, never behind a modal dialog. The
   handler preventDefaults synchronously (browser find bar stays shut)
   and emits one `searchHotkey` inward send per accepted press.
   Run with:
     node --test elm/searchHotkey.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

function harness({ modal = false, withPort = true } = {}) {
  const sent = [];
  const listeners = {};
  const stub = () => ({ subscribe() {}, send() {} });
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
  };
  if (withPort) ports.searchHotkey = { send(v) { sent.push(v); } };
  const app = { ports };
  globalThis.window = {
    addEventListener(name, fn) { listeners[name] = fn; },
  };
  globalThis.document = modal
    ? { querySelector: () => ({}) }
    : { querySelector: () => null };
  wire(app);
  return { sent, listeners };
}

function cleanup() {
  delete globalThis.window;
  delete globalThis.document;
}

function key(overrides = {}) {
  let prevented = false;
  return {
    key: "f",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    keyCode: 70,
    defaultPrevented: false,
    preventDefault() { prevented = true; },
    get prevented() { return prevented; },
    ...overrides,
  };
}

function press(h, event) {
  assert.equal(typeof h.listeners.keydown, "function");
  h.listeners.keydown(event);
}

test("ctrl+f preventDefaults and emits once", () => {
  const h = harness();
  try {
    const e = key({ ctrlKey: true });
    press(h, e);
    assert.equal(e.prevented, true);
    assert.deepEqual(h.sent, [null]);
  } finally {
    cleanup();
  }
});

test("meta+F (shifted key) emits", () => {
  const h = harness();
  try {
    const e = key({ key: "F", metaKey: true });
    press(h, e);
    assert.equal(e.prevented, true);
    assert.deepEqual(h.sent, [null]);
  } finally {
    cleanup();
  }
});

test("plain f, shift/alt combos, and composing never fire", () => {
  const h = harness();
  try {
    const events = [
      key({}),
      key({ ctrlKey: true, shiftKey: true }),
      key({ ctrlKey: true, altKey: true }),
      key({ key: "g", ctrlKey: true }),
      key({ ctrlKey: true, isComposing: true }),
      key({ ctrlKey: true, keyCode: 229 }),
    ];
    for (const e of events) press(h, e);
    assert.deepEqual(h.sent, []);
    assert.equal(events.every((e) => !e.prevented), true);
  } finally {
    cleanup();
  }
});

test("a modal dialog owns the keyboard", () => {
  const h = harness({ modal: true });
  try {
    const e = key({ ctrlKey: true });
    press(h, e);
    assert.equal(e.prevented, false);
    assert.deepEqual(h.sent, []);
  } finally {
    cleanup();
  }
});

test("no searchHotkey port means no listener, no crash", () => {
  const heard = [];
  globalThis.window = { addEventListener(name, fn) { heard.push(name); } };
  globalThis.document = { querySelector: () => null };
  const h = harness({ withPort: false });
  try {
    assert.deepEqual(Object.keys(h.listeners).filter((name) => name === "keydown"), []);
  } finally {
    cleanup();
  }
});
