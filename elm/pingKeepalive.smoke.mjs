/* Ping-keepalive smoke test — 25s/15s oracle constants and the
   schedule/fire/re-arm/clear timer cycle with short delays.
   Run with:
     node --test elm/pingKeepalive.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { pingKeepalive } = globalThis.OnyxPorts;

assert.equal(pingKeepalive.idleMs, 25000);
assert.equal(pingKeepalive.timeoutMs, 15000);

function harness() {
  const sent = [];
  const closed = [];
  const app = { ports: { pingDue: { send: (v) => sent.push(v) } } };
  const sock = { close: (code, reason) => closed.push([code, reason]) };
  return { sent, closed, app, sock };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("idle fires the Elm probe then closes a dead peer", async () => {
  const h = harness();
  const keep = pingKeepalive.create(h.app, h.sock, { idleMs: 5, timeoutMs: 10 });
  keep.schedule();
  await wait(30);
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.closed, [[4001, "Ping timeout"]]);
});

test("observed PONG re-arms the cycle and cancels the close", async () => {
  const h = harness();
  const keep = pingKeepalive.create(h.app, h.sock, { idleMs: 5, timeoutMs: 30 });
  keep.schedule();
  await wait(12);
  assert.equal(h.sent.length, 1);
  keep.observed();
  await wait(30);
  assert.deepEqual(h.closed, []);
  assert.equal(h.sent.length, 2);
  keep.clear();
});

test("clear silences a scheduled probe", async () => {
  const h = harness();
  const keep = pingKeepalive.create(h.app, h.sock, { idleMs: 5, timeoutMs: 5 });
  keep.schedule();
  keep.clear();
  await wait(20);
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.closed, []);
});

test("reschedule resets the idle clock", async () => {
  const h = harness();
  const keep = pingKeepalive.create(h.app, h.sock, { idleMs: 15, timeoutMs: 50 });
  keep.schedule();
  await wait(8);
  keep.schedule();
  await wait(8);
  assert.deepEqual(h.sent, []);
  await wait(12);
  assert.equal(h.sent.length, 1);
  keep.clear();
});
