/* v3/calls-c1 — call dialog focus + voice trust-field smoke. The ports
   bridge gives any `[data-call-dialog]` (More call tools, call privacy
   sheet) initial focus on its `[data-initial-focus]` child, wraps Tab
   inside it, and returns focus to the opener on unmount. The voice
   feed forwards the engine trust fields only when present.
   Run with:
     node --test elm/callDialogFocus.smoke.mjs
   (from the repo root). Needs the repo jsdom devDependency. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire, voiceFeed } = globalThis.OnyxPorts;

const stub = () => ({ subscribe() {}, send() {} });

function harness() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
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
  target.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    shiftKey: !!opts.shiftKey,
  }));
}

function mount(dom) {
  const document = dom.window.document;
  const opener = document.createElement("button");
  opener.textContent = "Protected connection";
  document.body.appendChild(opener);
  opener.focus();
  const sheet = document.createElement("section");
  sheet.setAttribute("data-call-dialog", "privacy");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("tabindex", "-1");
  const close = document.createElement("button");
  close.textContent = "Close call privacy";
  close.setAttribute("data-initial-focus", "true");
  const other = document.createElement("button");
  other.textContent = "Other";
  sheet.appendChild(close);
  sheet.appendChild(other);
  document.body.appendChild(sheet);
  return { opener, sheet, close, other };
}

test("mount focuses the initial-focus child; unmount restores the opener", async () => {
  const dom = harness();
  try {
    const { opener, sheet, close } = mount(dom);
    await tick();
    assert.equal(dom.window.document.activeElement, close);
    sheet.remove();
    await tick();
    assert.equal(dom.window.document.activeElement, opener);
  } finally {
    cleanup(dom);
  }
});

test("Tab wraps at both edges of the call dialog", async () => {
  const dom = harness();
  try {
    const { close, other } = mount(dom);
    await tick();
    other.focus();
    keydown(dom, other, "Tab");
    assert.equal(dom.window.document.activeElement, close);
    close.focus();
    keydown(dom, close, "Tab", { shiftKey: true });
    assert.equal(dom.window.document.activeElement, other);
  } finally {
    cleanup(dom);
  }
});

test("voice feed forwards trust fields only when present", () => {
  const blank = voiceFeed.blank();
  const bare = voiceFeed.next(blank, { state: "in_call", channel: "#c" }, 5);
  assert.equal("securityLevel" in bare.snapshot, false);
  assert.equal("localFingerprint" in bare.snapshot, false);
  const rich = voiceFeed.next(blank, {
    state: "in_call",
    channel: "#c",
    securityLevel: "e2ee",
    localFingerprint: "3Qm7Kx9P2bVe",
    peerFingerprints: { mara: "8Hc2Tn4Q1zRw" },
    sfu: { localSfu: true },
  }, 5);
  assert.equal(rich.snapshot.securityLevel, "e2ee");
  assert.equal(rich.snapshot.localFingerprint, "3Qm7Kx9P2bVe");
  assert.deepEqual(rich.snapshot.peerFingerprints, { mara: "8Hc2Tn4Q1zRw" });
  const idle = voiceFeed.next(rich.feed, { state: "idle", securityLevel: "e2ee" }, 6);
  assert.equal("securityLevel" in idle.snapshot, false);
});
