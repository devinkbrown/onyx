/* Transcript download bridge smoke test — the `transcriptDownload`
   port mirrors `downloadConversationExport`: blob-anchor download with
   an allowlisted MIME (`text/plain` or `application/json`, anything
   else falls back to plain text), a default filename when none is
   given, and best-effort cleanup.
   Run with:
     node --test elm/transcriptDownload.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

const stub = () => ({ subscribe() {}, send() {} });

function harness() {
  let downloadHandler = null;
  const anchors = [];
  const revoked = [];
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
    transcriptDownload: { subscribe(fn) { downloadHandler = fn; } },
  };
  const blobs = [];
  globalThis.Blob = function (parts, opts) { blobs.push({ parts, type: opts && opts.type }); };
  globalThis.URL = {
    createObjectURL() { return "blob:fake"; },
    revokeObjectURL(url) { revoked.push(url); },
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
  assert.equal(typeof downloadHandler, "function");
  return { downloadHandler, anchors, blobs, revoked };
}

function cleanup() {
  delete globalThis.Blob;
  delete globalThis.URL;
  delete globalThis.window;
  delete globalThis.document;
}

test("txt download carries filename, body, and plain MIME", () => {
  const h = harness();
  try {
    h.downloadHandler({ filename: "onyx-#c-2026-01-01.txt", body: "hi", mime: "text/plain" });
    assert.equal(h.blobs.length, 1);
    assert.deepEqual(h.blobs[0].parts, ["hi"]);
    assert.equal(h.blobs[0].type, "text/plain");
    assert.equal(h.anchors[0].download, "onyx-#c-2026-01-01.txt");
    assert.equal(h.anchors[0].rel, "noopener");
    assert.equal(h.anchors[0].clicked, true);
  } finally {
    cleanup();
  }
});

test("json MIME passes; anything else falls back to plain text", () => {
  const h = harness();
  try {
    h.downloadHandler({ filename: "a.json", body: "{}", mime: "application/json" });
    assert.equal(h.blobs[0].type, "application/json");
    h.downloadHandler({ filename: "a.html", body: "<b>", mime: "text/html" });
    assert.equal(h.blobs[1].type, "text/plain");
  } finally {
    cleanup();
  }
});

test("missing fields fail closed with defaults", () => {
  const h = harness();
  try {
    h.downloadHandler(null);
    h.downloadHandler({});
    assert.equal(h.blobs.length, 2);
    assert.deepEqual(h.blobs[0].parts, [""]);
    assert.equal(h.anchors[1].download, "onyx-conversation.txt");
  } finally {
    cleanup();
  }
});
