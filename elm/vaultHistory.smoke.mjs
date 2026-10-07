/* Vault history-access smoke test — loadAround window selection,
   export snapshot shape/bounds, and fail-closed null-store paths.
   Run with:
     node --test elm/vaultHistory.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { vaultStore } = globalThis.OnyxPorts;

function row(id, at) {
  return { id, target: "#c", from: "alice", body: "m-" + id, at };
}

const ROWS = [
  row("#c:1", 1000),
  row("#c:2", 2000),
  row("#c:3", 3000),
  row("#c:4", 4000),
  row("#c:5", 5000),
];

test("aroundWindow mirrors loadAround: nearest-first, sliced, chronological", () => {
  const window = vaultStore.aroundWindow(ROWS, 2900, 3);
  assert.deepEqual(window.map((r) => r.id), ["#c:2", "#c:3", "#c:4"]);

  const exact = vaultStore.aroundWindow(ROWS, 3000, 1);
  assert.deepEqual(exact.map((r) => r.id), ["#c:3"]);

  const capped = vaultStore.aroundWindow(ROWS, 3000, 0);
  assert.deepEqual(capped, []);

  // Unknown-time rows order by clock distance like everything else
  // (no special case in the oracle order): the Δ0 row and the Δ1000
  // tie (older-first toward at=0) are selected, then returned
  // chronological.
  const withUnknown = vaultStore.aroundWindow([...ROWS, row("#c:0", 0)], 1000, 2);
  assert.deepEqual(withUnknown.map((r) => r.id), ["#c:0", "#c:1"]);
});

test("exportSnapshot mirrors exportVault shape and bounds", () => {
  const stamp = "2026-01-01T00:00:00.000Z";
  const snap = vaultStore.exportSnapshot(
    [...ROWS.map((r) => ({ ...r, target: "#b" })), ...ROWS, { id: "", target: "#x", from: "z", body: "skip", at: 1 }],
    stamp,
  );
  assert.equal(snap.kind, "onyx-vault");
  assert.equal(snap.version, 1);
  assert.equal(snap.exportedAt, stamp);
  assert.deepEqual(snap.targets.map((t) => t.target), ["#b", "#c"]);
  assert.deepEqual(snap.targets[1].messages.map((m) => m.id), ["#c:1", "#c:2", "#c:3", "#c:4", "#c:5"]);
  assert.deepEqual(Object.keys(snap.targets[1].messages[0]).sort(), ["at", "body", "from", "id"]);

  // Per-target cap holds.
  const many = [];
  for (let i = 0; i < 2000; i++) many.push(row("#big:" + i, i));
  const capped = vaultStore.exportSnapshot(many, stamp);
  assert.equal(capped.targets[0].messages.length, 1600);
});

test("null store fails closed with unavailable/empty results", async () => {
  const got = await new Promise((resolve) => vaultStore.get(null, "#c", 10, (rows, status) => resolve({ rows, status })));
  assert.deepEqual(got, { rows: [], status: "unavailable" });

  const around = await new Promise((resolve) =>
    vaultStore.getAround(null, "#c", 3000, 10, (rows, status) => resolve({ rows, status })),
  );
  assert.deepEqual(around, { rows: [], status: "unavailable" });

  const exported = await new Promise((resolve) => vaultStore.exportAll(null, resolve));
  assert.deepEqual(exported.targets, []);

  const put = await new Promise((resolve) => vaultStore.put(null, [{ id: "x" }], resolve));
  assert.equal(put, 0);
});

/* ── Retention policy: sanitize fail-closed bounds plus stricter-wins
   prune selection, mirroring `retentionPolicy.ts` (the Elm `Retention`
   module is the shared truth; this pins the ports-side mirror). */
const DAY = 24 * 60 * 60 * 1000;

function retRow(id, at) {
  return { id, at };
}

test("sanitizeRetentionPolicy fails closed and idempotent", () => {
  const { sanitizeRetentionPolicy } = vaultStore;
  assert.deepEqual(
    sanitizeRetentionPolicy({ keep: -5, perChannel: { "#C": 10.7, "#bad": NaN, "#neg": -2 }, maxAgeDays: 0 }),
    { keep: 400, perChannel: { "#c": 10 } }
  );
  assert.equal(sanitizeRetentionPolicy({ keep: 1e9 }).keep, 5000);
  assert.equal(sanitizeRetentionPolicy({ keep: 10.9 }).keep, 10);
  assert.equal(sanitizeRetentionPolicy({ maxAgeDays: 5000 }).maxAgeDays, 3650);
  assert.equal(sanitizeRetentionPolicy({ maxAgeDays: 1.5 }).maxAgeDays, 1.5);
  assert.equal("maxAgeDays" in sanitizeRetentionPolicy({ maxAgeDays: -3 }), false);
  assert.equal("perChannel" in sanitizeRetentionPolicy({ perChannel: { "#x": -1 } }), false);
  assert.equal(sanitizeRetentionPolicy(null).keep, 400);
  assert.equal(sanitizeRetentionPolicy("junk").keep, 400);
  const once = sanitizeRetentionPolicy({ keep: 25.9, perChannel: { "#C": 7.2 }, maxAgeDays: 30 });
  assert.deepEqual(sanitizeRetentionPolicy(once), once);
});

test("retentionEffectiveKeep resolves overrides case-insensitively", () => {
  const { retentionEffectiveKeep } = vaultStore;
  const policy = { keep: 400, perChannel: { "#c": 10 } };
  assert.equal(retentionEffectiveKeep(policy, "#C"), 10);
  assert.equal(retentionEffectiveKeep(policy, "#other"), 400);
});

test("selectPruneIds keeps newest by count, oldest-first out", () => {
  const { selectPruneIds } = vaultStore;
  const rows = [retRow("m3", 3000), retRow("m1", 1000), retRow("m5", 5000), retRow("m2", 2000), retRow("m4", 4000)];
  assert.deepEqual(selectPruneIds(rows, { keep: 2 }, 9999), ["m1", "m2", "m3"]);
  assert.deepEqual(selectPruneIds([], { keep: 0 }, 9999), []);
});

test("selectPruneIds age cutoff is strictly-older, boundary kept", () => {
  const { selectPruneIds } = vaultStore;
  const nowMs = 10 * DAY;
  const rows = [retRow("old", nowMs - 2 * DAY), retRow("edge", nowMs - DAY), retRow("new", nowMs)];
  assert.deepEqual(selectPruneIds(rows, { keep: 400, maxAgeDays: 1 }, nowMs), ["old"]);
  assert.deepEqual(selectPruneIds(rows, { keep: 400, maxAgeDays: 1 }, NaN), []);
});

test("selectPruneIds composes count and age by union, ties by id", () => {
  const { selectPruneIds } = vaultStore;
  const nowMs = 10 * DAY;
  assert.deepEqual(
    selectPruneIds([retRow("stale", 1000), retRow("a", nowMs - 1000), retRow("b", nowMs)], { keep: 1, maxAgeDays: 30 }, nowMs),
    ["stale", "a"]
  );
  assert.deepEqual(
    selectPruneIds([retRow("m-b", 1000), retRow("m-a", 1000), retRow("m-c", 1000)], { keep: 1 }, 0),
    ["m-a", "m-b"]
  );
  assert.deepEqual(selectPruneIds([retRow("weird", NaN)], { keep: 0 }, 9999), ["weird"]);
});

test("retentionPolicy falls back without browser storage", () => {
  assert.deepEqual(vaultStore.retentionPolicy(), { keep: 400 });
  assert.equal(vaultStore.retentionPolicyKey, "onyx:vault-retention-policy");
  assert.equal(vaultStore.vaultKeep, 400);
});
