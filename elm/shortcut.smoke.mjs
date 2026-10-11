/* v3/switcher global `shortcut` port smoke test — ports.js owns the
   scope rules: Ctrl/Cmd+K toggles the palette everywhere (inputs too)
   and preventDefaults; Escape is always delivered (never prevented);
   `?` / `/` only outside editable fields with no Ctrl/Meta/Alt; IME
   composition and already-claimed keys are never taken; a foreign
   modal dialog owns the keyboard except for Escape. The overlay focus
   helper lives in overlayFocus.smoke.mjs.
   Run with:
     node --test elm/shortcut.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { classifyShortcut, installShortcutFocus, wireShortcuts } = globalThis.OnyxPorts;

const noModal = { querySelector: () => null };
const foreignModal = { querySelector: () => ({}) };

function key(overrides = {}) {
  let prevented = false;
  return {
    key: "k",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    keyCode: 0,
    defaultPrevented: false,
    target: { tagName: "BODY", isContentEditable: false, getAttribute: () => null, closest: () => null },
    preventDefault() { prevented = true; },
    get prevented() { return prevented; },
    ...overrides,
  };
}

const input = { tagName: "INPUT", isContentEditable: false, getAttribute: () => null, closest: () => null };
const textarea = { tagName: "TEXTAREA", getAttribute: () => null, closest: () => null };
const editable = { tagName: "DIV", isContentEditable: true, getAttribute: () => null, closest: () => null };
const roleTextbox = { tagName: "DIV", getAttribute: (n) => (n === "role" ? "textbox" : null), closest: () => null };
const ignored = { tagName: "DIV", getAttribute: () => null, closest: (sel) => (sel === "[data-spotlight-ignore]" ? {} : null) };

test("ctrl+k and cmd+k toggle the palette, even inside inputs", () => {
  assert.deepEqual(classifyShortcut(key({ ctrlKey: true }), noModal), { name: "palette-toggle", prevent: true });
  assert.deepEqual(classifyShortcut(key({ metaKey: true, key: "K" }), noModal), { name: "palette-toggle", prevent: true });
  assert.deepEqual(classifyShortcut(key({ ctrlKey: true, target: input }), noModal), { name: "palette-toggle", prevent: true });
  assert.deepEqual(classifyShortcut(key({ metaKey: true, target: editable }), noModal), { name: "palette-toggle", prevent: true });
});

test("ctrl+k with shift/alt, composing or claimed never toggles the palette", () => {
  /* v3/gap-commands: plain K is message navigation now (gapShortcuts.smoke.mjs). */
  assert.notEqual(classifyShortcut(key({}), noModal)?.name, "palette-toggle");
  for (const e of [
    key({ ctrlKey: true, shiftKey: true }),
    key({ ctrlKey: true, altKey: true }),
    key({ ctrlKey: true, isComposing: true }),
    key({ ctrlKey: true, keyCode: 229 }),
    key({ ctrlKey: true, defaultPrevented: true }),
  ]) {
    assert.equal(classifyShortcut(e, noModal), null);
  }
});

test("escape is delivered everywhere and never prevented", () => {
  assert.deepEqual(classifyShortcut(key({ key: "Escape" }), noModal), { name: "escape", prevent: false });
  assert.deepEqual(classifyShortcut(key({ key: "Escape", target: input }), noModal), { name: "escape", prevent: false });
  assert.deepEqual(classifyShortcut(key({ key: "Escape" }), foreignModal), { name: "escape", prevent: false });
  assert.equal(classifyShortcut(key({ key: "Escape", ctrlKey: true }), noModal), null);
  // A handler that already claimed Escape (the palette input) wins.
  assert.equal(classifyShortcut(key({ key: "Escape", defaultPrevented: true }), noModal), null);
});

test("? opens shortcuts and / opens the palette outside editable fields", () => {
  assert.deepEqual(classifyShortcut(key({ key: "?", shiftKey: true }), noModal), { name: "shortcuts", prevent: true });
  assert.deepEqual(classifyShortcut(key({ key: "/" }), noModal), { name: "palette", prevent: true });
});

test("? and / are typed text inside editable fields", () => {
  for (const target of [input, textarea, editable, roleTextbox, ignored]) {
    assert.equal(classifyShortcut(key({ key: "?", shiftKey: true, target }), noModal), null);
    assert.equal(classifyShortcut(key({ key: "/", target }), noModal), null);
  }
});

test("? and / with ctrl/meta/alt, or composing, never fire", () => {
  for (const e of [
    key({ key: "?", ctrlKey: true }),
    key({ key: "/", metaKey: true }),
    key({ key: "/", altKey: true }),
    key({ key: "?", isComposing: true }),
  ]) {
    assert.equal(classifyShortcut(e, noModal), null);
  }
});

test("a foreign modal dialog owns ctrl+k, ? and /", () => {
  assert.equal(classifyShortcut(key({ ctrlKey: true }), foreignModal), null);
  assert.equal(classifyShortcut(key({ key: "?" }), foreignModal), null);
  assert.equal(classifyShortcut(key({ key: "/" }), foreignModal), null);
});

test("the foreign-modal probe excludes our own scoped overlays", () => {
  const seen = [];
  const doc = { querySelector: (sel) => { seen.push(sel); return null; } };
  classifyShortcut(key({ ctrlKey: true }), doc);
  // v3/frame: every sheet now carries a scope (View.Sheet), so only the
  // palette's own layers are exempt; any other modal sheet owns the keys.
  assert.match(seen[0], /:not\(\[data-shortcut-scope="palette"\]\)/);
  assert.match(seen[0], /:not\(\[data-shortcut-scope="shortcuts"\]\)/);
});

test("unrelated keys are ignored", () => {
  /* v3/gap-commands: Enter now focuses the composer (gapShortcuts.smoke.mjs). */
  for (const k of ["a", "ArrowDown", "Tab", "x", "1"]) {
    assert.equal(classifyShortcut(key({ key: k }), noModal), null);
  }
});

function wireHarness({ withPort = true } = {}) {
  const sent = [];
  const listeners = {};
  globalThis.window = { addEventListener(name, fn) { listeners[name] = fn; } };
  globalThis.document = { querySelector: () => null, __onyxShortcutFocus: true };
  const app = { ports: withPort ? { shortcut: { send(v) { sent.push(v); } } } : {} };
  wireShortcuts(app);
  return { sent, listeners };
}

function cleanup() {
  delete globalThis.window;
  delete globalThis.document;
}

test("wired listener preventDefaults handled combos and sends the name", () => {
  const h = wireHarness();
  try {
    const k = key({ ctrlKey: true });
    h.listeners.keydown(k);
    const esc = key({ key: "Escape" });
    h.listeners.keydown(esc);
    const plain = key({ key: "a" });
    h.listeners.keydown(plain);
    assert.deepEqual(h.sent, ["palette-toggle", "escape"]);
    assert.equal(k.prevented, true);
    assert.equal(esc.prevented, false);
    assert.equal(plain.prevented, false);
  } finally {
    cleanup();
  }
});

test("no shortcut port means no listener, no crash", () => {
  const h = wireHarness({ withPort: false });
  try {
    assert.equal(h.listeners.keydown, undefined);
  } finally {
    cleanup();
  }
});

/* The overlay focus helper (focus in, Tab wrap, restore, stacking)
   is covered with a real DOM in overlayFocus.smoke.mjs. */
test("installShortcutFocus is the generalised overlay helper", () => {
  assert.equal(installShortcutFocus, globalThis.OnyxPorts.installOverlayFocus);
});
