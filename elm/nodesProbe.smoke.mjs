/* Node-probe smoke test — pin-wins, bounded-timeout Infinity, and the
   all-failed random-leg fallback over the real ports.js implementation.
   Live fastest-wins racing needs reachable HTTPS nodes, so the pure
   pick is covered by NodesTest vectors; here the bridge paths run.
   Run with:
     node --test elm/nodesProbe.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { nodeProbe } = globalThis.OnyxPorts;

assert.equal(nodeProbe.timeoutMs, 4000);
assert.equal(nodeProbe.maxConcurrency, 4);

const solo = [{ id: "a", host: "invalid.invalid", wss: "wss://invalid.invalid:8080" }];

test("recognized pin resolves the registry node without probing", async () => {
  const winner = await nodeProbe.selectBest(solo, { pin: "wss://invalid.invalid:8080" });
  assert.deepEqual(winner, solo[0]);
});

test("unknown pin synthesizes the env entry", async () => {
  const winner = await nodeProbe.selectBest(solo, { pin: "wss://localhost:9999" });
  assert.deepEqual(winner, { id: "env", host: "custom", wss: "wss://localhost:9999" });
});

test("unreachable host pings Infinity inside the bound", async () => {
  const start = Date.now();
  const ms = await nodeProbe.ping("invalid.invalid", 100);
  assert.equal(ms, Number.POSITIVE_INFINITY);
  assert.ok(Date.now() - start < 2000);
});

test("all-failed probes fall back to the single node", async () => {
  const winner = await nodeProbe.selectBest(solo, { timeoutMs: 100 });
  assert.deepEqual(winner, solo[0]);
});

test("pickFastest takes the finite minimum, ties keep first", () => {
  const a = { id: "a" };
  const b = { id: "b" };
  assert.equal(nodeProbe.pickFastest([{ node: a, ms: 120 }, { node: b, ms: 40 }]), b);
  assert.equal(nodeProbe.pickFastest([{ node: a, ms: 40 }, { node: b, ms: 40 }]), a);
  assert.equal(
    nodeProbe.pickFastest([{ node: a, ms: Number.POSITIVE_INFINITY }]),
    null
  );
});
