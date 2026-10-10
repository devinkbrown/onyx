/* v3/frame — the ONE overlay focus mechanism (`installOverlayFocus`).
   Every View.Sheet (`data-shortcut-scope`), the palette / shortcuts
   overlay and the call dialogs (`data-call-dialog`) get: initial focus
   on their `data-onyx-autofocus` / `data-initial-focus` child (else
   the panel), Tab / Shift+Tab wrapping inside the topmost overlay,
   stacking (a sheet over a sheet), restore to the opener on unmount,
   opener inheritance across a same-render swap, and standing aside
   while the image lightbox (own isolating helper) is mounted.
   Run with:
     node --test elm/overlayFocus.smoke.mjs
   (from the repo root). Needs the repo jsdom devDependency. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
require("./ports.js");
const { installOverlayFocus, installOverlayFocusOnce } = globalThis.OnyxPorts;

function setup() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { pretendToBeVisual: true });
  const doc = dom.window.document;
  /* No MutationObserver: tests call settle() for deterministic steps. */
  const focus = installOverlayFocus(doc, null);
  const opener = button(doc, "Open");
  doc.body.appendChild(opener);
  opener.focus();
  return { dom, doc, focus, opener };
}

function button(doc, label, attrs = {}) {
  const b = doc.createElement("button");
  b.textContent = label;
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  return b;
}

/* Mirrors View.Sheet.view: layer > backdrop + section[role=dialog]. */
function sheet(doc, scope, children, { autofocus } = {}) {
  const layer = doc.createElement("div");
  layer.className = "onyx-sheet-layer";
  const backdrop = doc.createElement("div");
  backdrop.className = "onyx-sheet-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  const panel = doc.createElement("section");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("data-shortcut-scope", scope);
  panel.setAttribute("tabindex", "-1");
  const nodes = children.map((label) =>
    button(doc, label, label === autofocus ? { "data-onyx-autofocus": scope } : {}),
  );
  nodes.forEach((n) => panel.appendChild(n));
  layer.appendChild(backdrop);
  layer.appendChild(panel);
  doc.body.appendChild(layer);
  return { layer, panel, nodes };
}

function tab(dom, doc, shiftKey = false) {
  const e = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, shiftKey });
  (doc.activeElement || doc.body).dispatchEvent(e);
  return e;
}

test("a sheet takes initial focus on its autofocus child, else the panel", () => {
  const { dom, doc, focus } = setup();
  const a = sheet(doc, "prefs", ["Close", "Field"], { autofocus: "Field" });
  focus.settle();
  assert.equal(doc.activeElement, a.nodes[1]);
  a.layer.remove();
  focus.settle();
  const b = sheet(doc, "notify", ["Close", "Other"]);
  focus.settle();
  assert.equal(doc.activeElement, b.panel, "no autofocus mark: the tabindex=-1 panel");
  dom.window.close();
});

test("Tab and Shift+Tab wrap inside the topmost sheet", () => {
  const { dom, doc, focus } = setup();
  const s = sheet(doc, "pins", ["First", "Middle", "Last"]);
  focus.settle();
  s.nodes[2].focus();
  const fwd = tab(dom, doc);
  assert.equal(fwd.defaultPrevented, true);
  assert.equal(doc.activeElement, s.nodes[0]);
  const back = tab(dom, doc, true);
  assert.equal(back.defaultPrevented, true);
  assert.equal(doc.activeElement, s.nodes[2]);
  s.nodes[1].focus();
  const mid = tab(dom, doc);
  assert.equal(mid.defaultPrevented, false, "mid-list Tab is left to the browser");
  dom.window.close();
});

test("closing restores focus to the opener", () => {
  const { dom, doc, focus, opener } = setup();
  const s = sheet(doc, "media", ["Close"]);
  focus.settle();
  assert.notEqual(doc.activeElement, opener);
  s.layer.remove();
  focus.settle();
  assert.equal(doc.activeElement, opener);
  assert.equal(focus.depth(), 0);
  dom.window.close();
});

test("stacked sheets: the inner one traps, closing it returns into the outer", () => {
  const { dom, doc, focus, opener } = setup();
  const outer = sheet(doc, "moderation-cockpit", ["Close desk", "Kick"]);
  focus.settle();
  outer.nodes[1].focus();
  const inner = sheet(doc, "moderation-review", ["Cancel", "Confirm"], { autofocus: "Confirm" });
  focus.settle();
  assert.equal(focus.depth(), 2);
  assert.equal(doc.activeElement, inner.nodes[1]);
  tab(dom, doc);
  assert.equal(doc.activeElement, inner.nodes[0], "Tab wraps inside the inner sheet only");
  inner.layer.remove();
  focus.settle();
  assert.equal(doc.activeElement, outer.nodes[1], "focus returns to the inner sheet's opener");
  outer.layer.remove();
  focus.settle();
  assert.equal(doc.activeElement, opener);
  dom.window.close();
});

test("a same-render swap keeps the original opener (palette -> shortcuts)", () => {
  const { dom, doc, focus, opener } = setup();
  const palette = sheet(doc, "palette", ["Input"], { autofocus: "Input" });
  focus.settle();
  palette.layer.remove();
  const shortcuts = sheet(doc, "shortcuts", ["Close keyboard shortcuts"], { autofocus: "Close keyboard shortcuts" });
  focus.settle();
  assert.equal(doc.activeElement, shortcuts.nodes[0]);
  shortcuts.layer.remove();
  focus.settle();
  assert.equal(doc.activeElement, opener);
  dom.window.close();
});

test("call dialogs ride the same mechanism (data-call-dialog + data-initial-focus)", () => {
  const { dom, doc, focus, opener } = setup();
  const dlg = doc.createElement("section");
  dlg.setAttribute("data-call-dialog", "privacy");
  dlg.setAttribute("role", "dialog");
  dlg.setAttribute("tabindex", "-1");
  const close = button(doc, "Close call privacy", { "data-initial-focus": "true" });
  dlg.appendChild(close);
  doc.body.appendChild(dlg);
  focus.settle();
  assert.equal(doc.activeElement, close);
  dlg.remove();
  focus.settle();
  assert.equal(doc.activeElement, opener);
  dom.window.close();
});

test("the image lightbox owns focus while mounted", () => {
  const { dom, doc, focus } = setup();
  const s = sheet(doc, "media", ["Close", "Item"]);
  focus.settle();
  const lb = doc.createElement("div");
  lb.className = "shell-msg-lightbox-dialog";
  const lbClose = button(doc, "Close image");
  lb.appendChild(lbClose);
  doc.body.appendChild(lb);
  lbClose.focus();
  const e = tab(dom, doc);
  assert.equal(e.defaultPrevented, false, "the overlay trap stands aside");
  assert.equal(doc.activeElement, lbClose);
  lb.remove();
  s.layer.remove();
  dom.window.close();
});

test("installOverlayFocusOnce is idempotent per document", () => {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  const doc = dom.window.document;
  const a = installOverlayFocusOnce(doc);
  const b = installOverlayFocusOnce(doc);
  assert.ok(a);
  assert.equal(a, b);
  dom.window.close();
});
