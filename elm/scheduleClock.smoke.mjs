/* Send-later clock + datetime-local parse smoke test — `scheduleClockRequest`
   and `scheduleParseRequest` bridge: Elm owns the schedulability window
   and the preset table; only this side can do local-zone wall-clock
   math. The clock answer carries the `tomorrow-9` epoch plus the
   datetime-local floor; the parse answer echoes the submitted value
   with the epoch (or null) and never applies the schedule window.
   Run with:
     node --test elm/scheduleClock.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

function harness(sent) {
  const stub = () => ({ subscribe() {} });
  const handlers = {};
  const app = { ports: {} };
  [
    "wsConnect", "wsSend", "wsClose", "vaultPut", "vaultGet", "passkeyCreate",
    "passkeyGet", "passkeySettleRequest", "dmSealRequest", "dmOpenRequest",
    "dmPublishKey", "roomSealRequest", "roomOpenRequest", "groupControlInstall",
    "groupDirectoryDerive", "guidesProgressRequest", "guidesProgressStore",
    "blocklistsSave", "highlightWordsSave", "dndSave", "scheduledSave",
  ].forEach((name) => { app.ports[name] = stub(); });
  app.ports.scheduleClockRequest = { subscribe(fn) { handlers.clock = fn; } };
  app.ports.scheduleClockResult = { send(payload) { sent.push({ kind: "clock", payload }); } };
  app.ports.scheduleParseRequest = { subscribe(fn) { handlers.parse = fn; } };
  app.ports.scheduleParseResult = { send(payload) { sent.push({ kind: "parse", payload }); } };
  globalThis.window = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
  wire(app);
  return handlers;
}

test("clock answers a next-9am epoch and a datetime-local floor", async () => {
  const sent = [];
  try {
    const before = Date.now();
    const h = harness(sent);
    h.clock();
    const after = Date.now();
    assert.equal(sent.length, 1);
    const { tomorrow9, minLocal } = sent[0].payload;
    assert.ok(Number.isFinite(tomorrow9), "tomorrow9 is finite");
    assert.ok(tomorrow9 > before, "tomorrow9 is strictly in the future");
    assert.ok(tomorrow9 <= after + 24 * 60 * 60 * 1000, "tomorrow9 is at most a day out");
    assert.match(minLocal, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const floorBack = new Date(minLocal).getTime();
    assert.ok(Math.abs(floorBack - before) < 120000, "floor parses back near now");
  } finally {
    delete globalThis.window;
  }
});

test("parse echoes the value with the epoch, or null for garbage", async () => {
  const sent = [];
  try {
    const h = harness(sent);
    h.parse({ value: "2030-01-01T10:00" });
    h.parse({ value: "not a time" });
    h.parse({ value: "   " });
    h.parse(null);
    assert.equal(sent.length, 4);
    assert.equal(sent[0].payload.value, "2030-01-01T10:00");
    assert.ok(Number.isFinite(sent[0].payload.epoch), "valid local time parses");
    assert.deepEqual(
      sent.slice(1).map((s) => s.payload),
      [
        { value: "not a time", epoch: null },
        { value: "   ", epoch: null },
        { value: "", epoch: null },
      ]
    );
  } finally {
    delete globalThis.window;
  }
});
