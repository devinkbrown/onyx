/* v3/calls-c11 (C12) call-chord smoke test — ports.js forwards
   Ctrl/Cmd+Shift+{M,E,H,L,G,F,S} as `call-<name>` through the ONE
   `shortcut` port, but only while a call is live (an element carries
   `data-call-keys="on"`), never inside editable fields, never under a
   foreign modal, never during IME composition, and never without the
   modifier pair (WCAG 2.1.4: no single-key call shortcuts).
   Run with:
     node --test elm/callKeys.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { classifyShortcut } = globalThis.OnyxPorts;

function doc({ live = true, modal = false } = {}) {
  return {
    querySelector(sel) {
      if (sel.includes('data-call-keys="on"')) return live ? {} : null;
      if (sel.includes('aria-modal="true"')) return modal ? {} : null;
      return null;
    },
  };
}

const body = { tagName: "BODY", isContentEditable: false, getAttribute: () => null, closest: () => null };
const input = { tagName: "INPUT", isContentEditable: false, getAttribute: () => null, closest: () => null };

function key(overrides = {}) {
  return {
    key: "M",
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    altKey: false,
    isComposing: false,
    keyCode: 0,
    defaultPrevented: false,
    target: body,
    ...overrides,
  };
}

test("every chord maps to its call-<name> and preventDefaults", () => {
  const table = { M: "mute", E: "camera", H: "hand", L: "leave", G: "layout", F: "size", S: "speaker" };
  for (const [k, name] of Object.entries(table)) {
    assert.deepEqual(classifyShortcut(key({ key: k }), doc()), { name: "call-" + name, prevent: true });
    assert.deepEqual(classifyShortcut(key({ key: k.toLowerCase(), ctrlKey: false, metaKey: true }), doc()), {
      name: "call-" + name,
      prevent: true,
    });
  }
});

test("no live call, typing, a foreign modal or IME composition keeps the browser key", () => {
  assert.equal(classifyShortcut(key(), doc({ live: false })), null);
  assert.equal(classifyShortcut(key({ target: input }), doc()), null);
  assert.equal(classifyShortcut(key(), doc({ modal: true })), null);
  assert.equal(classifyShortcut(key({ isComposing: true }), doc()), null);
  assert.equal(classifyShortcut(key({ keyCode: 229 }), doc()), null);
  assert.equal(classifyShortcut(key({ defaultPrevented: true }), doc()), null);
});

test("chords need both modifiers and no Alt; unknown letters are ignored", () => {
  assert.equal(classifyShortcut(key({ shiftKey: false }), doc()), null);
  assert.equal(classifyShortcut(key({ ctrlKey: false }), doc()), null);
  assert.equal(classifyShortcut(key({ altKey: true }), doc()), null);
  assert.equal(classifyShortcut(key({ key: "Q" }), doc()), null);
  assert.equal(classifyShortcut(key({ key: "m", ctrlKey: false, shiftKey: false }), doc()), null);
});

test("ctrl+k and escape are unchanged by the call chords", () => {
  assert.deepEqual(classifyShortcut(key({ key: "k", shiftKey: false }), doc()), { name: "palette-toggle", prevent: true });
  assert.deepEqual(classifyShortcut(key({ key: "Escape", ctrlKey: false, shiftKey: false }), doc()), { name: "escape", prevent: false });
});
