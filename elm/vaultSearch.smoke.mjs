/* Device-wide vault search smoke test — exact-substring newest-first
   selection over plain rows (no IndexedDB).
   Run with:
     node --test elm/vaultSearch.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { searchRows } = globalThis.OnyxPorts.vaultStore;

function row(id, target, from, body, at) {
  return { id, target, from, body, at };
}

const ROWS = [
  row("#a:1", "#a", "alice", "hello world", 1000),
  row("#b:1", "#b", "bob", "HELLO again", 2000),
  row("#a:2", "#a", "carol", "unrelated", 3000),
  row("dave:1", "dave", "dave", "say hello dave", 4000),
  row("#a:3", "#a", "alice", "older hello", 0),
];

test("matches body and sender case-insensitively, newest first", () => {
  const hits = searchRows(ROWS, "hello", 80);
  assert.deepEqual(hits.map((r) => r.id), ["dave:1", "#b:1", "#a:1", "#a:3"]);
});

test("sender-only match counts", () => {
  const hits = searchRows(ROWS, "BOB", 80);
  assert.deepEqual(hits.map((r) => r.id), ["#b:1"]);
});

test("blank query matches nothing", () => {
  assert.deepEqual(searchRows(ROWS, "  ", 80), []);
  assert.deepEqual(searchRows(ROWS, "", 80), []);
});

test("limit slices the newest end", () => {
  const hits = searchRows(ROWS, "hello", 2);
  assert.deepEqual(hits.map((r) => r.id), ["dave:1", "#b:1"]);
});

test("rows without id or target are skipped", () => {
  const rows = [...ROWS, { id: "", target: "#a", from: "x", body: "hello ghost", at: 9999 }];
  const hits = searchRows(rows, "hello", 80);
  assert.deepEqual(hits.map((r) => r.id), ["dave:1", "#b:1", "#a:1", "#a:3"]);
});
