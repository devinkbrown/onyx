/* Media save bridge smoke test — the `mediaSave` port mirrors
   `saveMediaFromUserGesture`: a transient <a download> click (never a
   gallery/background write), with the Elm-built filename
   (`mediaSaveName`) and an "image" default when none is given.
   Run with:
     node --test elm/mediaSave.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

const stub = () => ({ subscribe() {}, send() {} });

function harness() {
  let saveHandler = null;
  const anchors = [];
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
    mediaSave: { subscribe(fn) { saveHandler = fn; } },
  };
  globalThis.window = { addEventListener() {} };
  globalThis.document = {
    querySelector: () => null,
    createElement() {
      const anchor = { clicked: false, click() { anchor.clicked = true; }, remove() {} };
      anchors.push(anchor);
      return anchor;
    },
    body: { appendChild() {} },
  };
  wire({ ports });
  assert.equal(typeof saveHandler, "function");
  return { saveHandler, anchors };
}

function cleanup() {
  delete globalThis.window;
  delete globalThis.document;
}

test("save clicks a download anchor with the Elm-built filename", () => {
  const h = harness();
  try {
    h.saveHandler({ href: "https://cdn.example.test/a.png", name: "a.png" });
    assert.equal(h.anchors.length, 1);
    assert.equal(h.anchors[0].href, "https://cdn.example.test/a.png");
    assert.equal(h.anchors[0].download, "a.png");
    assert.equal(h.anchors[0].rel, "noopener noreferrer");
    assert.equal(h.anchors[0].target, "_blank");
    assert.equal(h.anchors[0].clicked, true);
  } finally {
    cleanup();
  }
});

test("missing href clicks nothing; missing name defaults to image", () => {
  const h = harness();
  try {
    h.saveHandler(null);
    h.saveHandler({});
    h.saveHandler({ href: "https://cdn.example.test/a.png", name: "" });
    assert.equal(h.anchors.length, 1);
    assert.equal(h.anchors[0].download, "image");
  } finally {
    cleanup();
  }
});
