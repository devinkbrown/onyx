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
  assert.deepEqual(Object.keys(snap.targets[1].messages[0]).sort(), ["from", "id", "target", "text", "time", "type"]);
  assert.deepEqual(
    snap.targets[1].messages.map((m) => [m.text, m.type, m.time]),
    ROWS.map((r) => [r.body, "msg", r.at]),
  );

  // Per-target cap holds.
  const many = [];
  for (let i = 0; i < 2000; i++) many.push(row("#big:" + i, i));
  const capped = vaultStore.exportSnapshot(many, stamp);
  assert.equal(capped.targets[0].messages.length, 1600);
});

test("exportSnapshot carries row types; legacy rows default to msg", () => {
  const stamp = "2026-01-01T00:00:00.000Z";
  const snap = vaultStore.exportSnapshot(
    [
      { id: "#c:1", target: "#c", from: "alice", body: "hi", at: 1000, rowType: "notice" },
      { id: "#c:2", target: "#c", from: "bob", body: "yo", at: 2000, rowType: "bogus" },
      row("#c:3", 3000),
    ],
    stamp,
  );
  assert.deepEqual(
    snap.targets[0].messages.map((m) => [m.id, m.type]),
    [["#c:1", "notice"], ["#c:2", "msg"], ["#c:3", "msg"]],
  );
});

test("tombstoned rows never surface in recall or time-travel", () => {
  const textRows = [
    { id: "#c:1", target: "#c", from: "alice", body: "hello world picnic", at: 1000 },
    { id: "#c:2", target: "#c", from: "bob", body: "hello world picnic plans", at: 2000, deleted: true },
    { id: "#c:3", target: "#c", from: "carol", body: "hello world picnic menu", at: 3000, redacted: true },
  ];

  // Exact recall skips tombstones newest-first.
  assert.deepEqual(
    vaultStore.searchRows(textRows, "picnic", 80).map((r) => r.id),
    ["#c:1"],
  );

  // Semantic + hybrid rank over the live slice only.
  assert.deepEqual(
    vaultStore.searchRowsSemantic(textRows, "hello world picnic", 80).map((r) => r.id),
    ["#c:1"],
  );
  assert.deepEqual(
    vaultStore.searchRowsHybrid(textRows, "hello world picnic", { limit: 80 }).map((r) => r.id),
    ["#c:1"],
  );

  // Time-travel windows skip tombstones before ranking.
  const window = vaultStore.aroundWindow(
    [...textRows, ...ROWS.map((r) => ({ ...r, target: "#d" }))],
    2500,
    10,
  );
  assert.ok(window.every((r) => !r.deleted && !r.redacted));
  assert.ok(window.some((r) => r.id === "#c:1"));
});

test("plainRow carries reply context; hostile shapes read back empty", () => {
  assert.deepEqual(
    vaultStore.plainRow({ ...row("#c:1", 1000), replyTo: { id: "m1", from: "alice", text: "hello" } }).replyTo,
    { id: "m1", from: "alice", text: "hello" },
  );
  assert.equal(vaultStore.plainRow({ ...row("#c:1", 1000), replyTo: { id: 7 } }).replyTo, null);
  assert.equal(vaultStore.plainRow(row("#c:1", 1000)).replyTo, null);
});

test("plainRow carries tombstone flags; legacy rows read back clear", () => {
  assert.deepEqual(
    vaultStore.plainRow({ id: "x", target: "#c", from: "a", body: "b", at: 1, deleted: 1, redacted: 0 }),
    { id: "x", target: "#c", from: "a", body: "b", at: 1, rowType: "msg", deleted: true, redacted: false, replyTo: null },
  );
  assert.deepEqual(
    vaultStore.plainRow(row("#c:1", 1000)),
    { ...row("#c:1", 1000), rowType: "msg", deleted: false, redacted: false, replyTo: null },
  );
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
