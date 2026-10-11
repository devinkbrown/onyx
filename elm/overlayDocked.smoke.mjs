/* v3/rx-convo — a docked overlay (the thread pane on wide layouts: its
   CSS sets `--overlay-docked: 1`) keeps the overlay focus bridge's
   focus-in and return-focus, but Tab is never trapped inside it, so
   the transcript and composer beside it stay reachable. A sheet that
   is not docked keeps wrapping Tab as before.
   Run with:
     node --test elm/overlayDocked.smoke.mjs
   (from the repo root). Needs the repo jsdom devDependency. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
require("./ports.js");
const { installOverlayFocus } = globalThis.OnyxPorts;

function setup() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { pretendToBeVisual: true });
  const doc = dom.window.document;
  const focus = installOverlayFocus(doc, null);
  const opener = doc.createElement("button");
  opener.textContent = "View thread";
  doc.body.appendChild(opener);
  opener.focus();
  return { dom, doc, focus, opener };
}

/* Mirrors View.Sheet.view: layer > backdrop + section[role=dialog]. */
function sheet(doc, scope, labels, docked) {
  const layer = doc.createElement("div");
  layer.className = "onyx-sheet-layer";
  if (docked) layer.setAttribute("style", "--overlay-docked: 1");
  const panel = doc.createElement("section");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", docked ? "false" : "true");
  panel.setAttribute("data-shortcut-scope", scope);
  panel.setAttribute("tabindex", "-1");
  if (docked) panel.setAttribute("style", "--overlay-docked: 1");
  const nodes = labels.map((label) => {
    const b = doc.createElement("button");
    b.textContent = label;
    panel.appendChild(b);
    return b;
  });
  layer.appendChild(panel);
  doc.body.appendChild(layer);
  return { layer, panel, nodes };
}

function tab(dom, doc) {
  const e = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  (doc.activeElement || doc.body).dispatchEvent(e);
  return e;
}

test("a docked pane takes focus but never traps Tab", () => {
  const { dom, doc, focus, opener } = setup();
  const pane = sheet(doc, "thread", ["Close thread", "Reply"], true);
  focus.settle();
  assert.equal(doc.activeElement, pane.panel, "focus moves into the pane");
  pane.nodes[1].focus();
  const e = tab(dom, doc);
  assert.equal(e.defaultPrevented, false, "Tab from the last control is left to the browser");
  pane.layer.remove();
  focus.settle();
  assert.equal(doc.activeElement, opener, "closing returns focus to the opener");
  dom.window.close();
});

test("an undocked sheet still wraps Tab", () => {
  const { dom, doc, focus } = setup();
  const s = sheet(doc, "thread", ["Close thread", "Reply"], false);
  focus.settle();
  s.nodes[1].focus();
  const e = tab(dom, doc);
  assert.equal(e.defaultPrevented, true);
  assert.equal(doc.activeElement, s.nodes[0]);
  dom.window.close();
});
