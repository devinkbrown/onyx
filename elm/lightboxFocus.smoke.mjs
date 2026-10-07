/* Lightbox dialog focus smoke test — the ports bridge mirrors
   `createDialogFocus` for `MessageImageLightbox`: while the
   `.shell-msg-lightbox-dialog` is mounted Tab cycles inside it,
   mounting moves focus into the dialog, and unmounting returns
   focus to the opener. Scroll lock and background isolation stay
   later slices.
   Run with:
     node --test elm/lightboxFocus.smoke.mjs
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
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  // Explicit stubs only: a catch-all stub would mark every optional
  // port present and start background work the harness never settles.
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
  };
  wire({ ports });
  return dom;
}

function cleanup(dom) {
  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function keydown(dom, target, key, opts = {}) {
  const event = new dom.window.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    shiftKey: !!opts.shiftKey,
    isComposing: !!opts.composing,
  });
  target.dispatchEvent(event);
}

/* Mount the oracle-shaped dialog: trigger stays in the body, the
   dialog carries Save/Close like the Elm `mediaLightboxDialog`. */
function mount(dom) {
  const document = dom.window.document;
  const trigger = document.createElement("button");
  trigger.id = "trigger";
  trigger.textContent = "Open image";
  document.body.appendChild(trigger);
  trigger.focus();
  const box = document.createElement("div");
  box.className = "shell-msg-lightbox";
  const dialog = document.createElement("div");
  dialog.className = "shell-msg-lightbox-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("tabindex", "-1");
  const save = document.createElement("button");
  save.textContent = "Save";
  const close = document.createElement("button");
  close.textContent = "Close";
  dialog.appendChild(save);
  dialog.appendChild(close);
  box.appendChild(dialog);
  document.body.appendChild(box);
  return { trigger, box, dialog, save, close };
}

test("mounting moves focus in and unmounting returns it", async () => {
  const dom = harness();
  try {
    const { trigger, box, dialog } = mount(dom);
    await tick();
    assert.equal(dom.window.document.activeElement, dialog);
    box.remove();
    await tick();
    assert.equal(dom.window.document.activeElement, trigger);
  } finally {
    cleanup(dom);
  }
});

test("Tab cycles at the dialog edges", async () => {
  const dom = harness();
  try {
    const { dialog, save, close } = mount(dom);
    await tick();
    assert.equal(dom.window.document.activeElement, dialog);
    close.focus();
    keydown(dom, close, "Tab");
    assert.equal(dom.window.document.activeElement, save);
    save.focus();
    keydown(dom, save, "Tab", { shiftKey: true });
    assert.equal(dom.window.document.activeElement, close);
    save.focus();
    keydown(dom, save, "Tab");
    assert.equal(dom.window.document.activeElement, save);
  } finally {
    cleanup(dom);
  }
});

test("outside targets and claimed events never trap", async () => {
  const dom = harness();
  try {
    const document = dom.window.document;
    const { close } = mount(dom);
    await tick();
    const outside = document.createElement("button");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);
    outside.focus();
    keydown(dom, outside, "Tab");
    assert.equal(document.activeElement, outside);
    close.focus();
    keydown(dom, close, "Tab", { composing: true });
    assert.equal(document.activeElement, close);
    keydown(dom, close, "Enter");
    assert.equal(document.activeElement, close);
  } finally {
    cleanup(dom);
  }
});
