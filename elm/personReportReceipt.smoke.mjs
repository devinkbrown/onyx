/* Person report receipt smoke test — the `personReportReceiptSave`
   port mirrors `savePersonReportReceipt` (owner-scoped key computed in
   Elm, newest-first journal capped at 20 rows, hostile journals degrade
   to a fresh write, missing storage never throws). Run with:
     node --test elm/personReportReceipt.smoke.mjs
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
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "https://example.test/", pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  let save = null;
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
    translationConfig: stub(),
    translateRequest: stub(),
    translateResult: stub(),
    translationTargetSave: stub(),
    personReportReceiptSave: { subscribe(fn) { save = fn; } },
  };
  wire({ ports });
  assert.equal(typeof save, "function");
  return { dom, save };
}

function cleanup(h) {
  h.dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
}

const KEY = "onyx:person-report-receipts:owner:test";

function read(h) {
  const raw = h.dom.window.localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}

test("saves a receipt newest-first with an id and timestamp", () => {
  const h = harness();
  try {
    h.save({ key: KEY, nick: "eve", reason: "spam", draft: "Report\nAbout: eve" });
    const rows = read(h);
    assert.equal(rows.length, 1);
    assert.match(rows[0].id, /^report-[0-9a-z]+$/);
    assert.equal(typeof rows[0].at, "number");
    assert.equal(rows[0].nick, "eve");
    assert.equal(rows[0].reason, "spam");
    assert.equal(rows[0].draft, "Report\nAbout: eve");
  } finally {
    cleanup(h);
  }
});

test("prepends and caps the journal at twenty rows", () => {
  const h = harness();
  try {
    for (let i = 0; i < 22; i++) {
      h.save({ key: KEY, nick: `eve${i}`, reason: "spam", draft: `Report ${i}` });
    }
    const rows = read(h);
    assert.equal(rows.length, 20);
    assert.equal(rows[0].nick, "eve21");
    assert.equal(rows[19].nick, "eve2");
  } finally {
    cleanup(h);
  }
});

test("a corrupt journal degrades to a fresh write", () => {
  const h = harness();
  try {
    h.dom.window.localStorage.setItem(KEY, "not-json{{{");
    h.save({ key: KEY, nick: "eve", reason: "spam", draft: "Report" });
    const rows = read(h);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].nick, "eve");
  } finally {
    cleanup(h);
  }
});

test("sanitizes fields and refuses empty nick or draft", () => {
  const h = harness();
  try {
    h.save({ key: KEY, nick: "  ", reason: "spam", draft: "Report" });
    assert.equal(read(h), null);
    h.save({ key: KEY, nick: "eve", reason: "spam", draft: "   " });
    assert.equal(read(h), null);
    h.save({ key: KEY, nick: "e\0ve", reason: "spam", draft: "Report" });
    const rows = read(h);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].nick, "eve");
  } finally {
    cleanup(h);
  }
});

test("missing key or storage never throws", () => {
  const h = harness();
  try {
    assert.doesNotThrow(() => h.save(null));
    assert.doesNotThrow(() => h.save({ key: "", nick: "eve", reason: "spam", draft: "Report" }));
    assert.doesNotThrow(() => h.save({ nick: "eve", reason: "spam", draft: "Report" }));
  } finally {
    cleanup(h);
  }
});
