/* Vault semantic/hybrid smoke test — verbatim-pure mirrors of
   `src/lib/vault/embeddingIndex.ts` (hashing vectorizer, cosine,
   stable rank), `searchVaultHybrid.ts` (RRF k=60, newest-first ties,
   post-RRF boosts), `lib/search/rankingBoost.ts`, and the
   `onyx:vault-search-mode` save gate. Pure over plain rows, no
   IndexedDB.
   Run with:
     node --test elm/vaultSemantic.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const vs = globalThis.OnyxPorts.vaultStore;

function row(id, target, from, body, at) {
  return { id, target, from, body, at };
}

const OPS = [
  row("#ops:1", "#ops", "u", "the schema was reviewed by the whole database team today", 1000),
  row("#ops:2", "#ops", "u", "a schema change broke the nightly build", 2000),
  row("#ops:3", "#ops", "u", "lunch plans for saturday afternoon", 3000),
];

test("constants match the oracle (k=60, dim=256, boosts)", () => {
  assert.equal(vs.rrfK, 60);
  assert.equal(vs.embeddingDim, 256);
  assert.deepEqual(vs.vaultBoosts, { exact: 0.35, sameRoom: 0.15, recencyHalfLifeMs: 14 * 24 * 60 * 60 * 1000, selfPenalty: 0.05 });
});

test("tokenize lowercases, splits, drops singles, keeps unicode", () => {
  assert.deepEqual(vs.tokenize("Hello, WORLD!"), ["hello", "world"]);
  assert.deepEqual(vs.tokenize("a I go"), ["go"]);
  assert.deepEqual(vs.tokenize(""), []);
  assert.deepEqual(vs.tokenize("!!!"), []);
  assert.deepEqual(vs.tokenize("café 東京"), ["café", "東京"]);
});

test("embed is deterministic, unit-norm, zero on token-free text", () => {
  const a = vs.embed("hello world");
  const b = vs.embed("hello world");
  assert.equal(a.length, 256);
  assert.deepEqual(Array.from(a), Array.from(b));
  let norm = 0;
  for (const v of a) norm += v * v;
  assert.ok(Math.abs(Math.sqrt(norm) - 1) < 1e-6);
  assert.deepEqual(Array.from(vs.embed("")), Array(256).fill(0));
  assert.deepEqual(Array.from(vs.embed("!")), Array(256).fill(0));
  assert.notDeepEqual(Array.from(vs.embed("hello")), Array.from(vs.embed("world")));
});

test("cosine is 1 on identical vectors, 0 on zero/mismatch", () => {
  const a = vs.embed("hello world");
  assert.ok(Math.abs(vs.cosine(a, a) - 1) < 1e-9);
  assert.equal(vs.cosine(a, new Float32Array(256)), 0);
  assert.equal(vs.cosine(a, new Float32Array(3)), 0);
  assert.equal(vs.cosine(new Float32Array(0), new Float32Array(0)), 0);
});

test("rankBySimilarity is stable on ties", () => {
  const q = vs.embed("schema change");
  const ranked = vs.rankBySimilarity(q, [
    { id: "a", vector: vs.embed("schema change") },
    { id: "b", vector: vs.embed("schema change") },
    { id: "c", vector: vs.embed("unrelated lunch plans") },
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ["a", "b", "c"]);
  assert.ok(ranked[0].score >= ranked[2].score);
});

test("RRF scores rank-1 as 1/(k+1) and rewards agreement", () => {
  const id = (s) => s;
  const single = vs.reciprocalRankFusion([["a", "b", "c"]], id);
  assert.equal(single[0].item, "a");
  assert.ok(Math.abs(single[0].score - 1 / 61) < 1e-12);
  const disjoint = vs.reciprocalRankFusion([["a", "b", "c"], ["x", "y", "z"]], id);
  assert.deepEqual(disjoint.map((r) => r.item), ["a", "x", "b", "y", "c", "z"]);
  const agreed = vs.reciprocalRankFusion([["a", "b", "c"], ["a", "c", "b"]], id);
  assert.equal(agreed[0].item, "a");
  assert.ok(Math.abs(agreed[0].score - 2 / 61) < 1e-12);
  const broad = vs.reciprocalRankFusion([["hi", "mid", "x"], ["y", "mid", "z"]], id);
  assert.equal(broad[0].item, "mid");
  const custom = vs.reciprocalRankFusion([["a"]], id, { k: 0 });
  assert.ok(Math.abs(custom[0].score - 1) < 1e-12);
  const tied = vs.reciprocalRankFusion([["a"], ["b"]], id, { tieBreak: (x, y) => (x < y ? 1 : x > y ? -1 : 0) });
  assert.deepEqual(tied.map((r) => r.item), ["b", "a"]);
});

test("hybrid ranks the verbatim hit first with the neighbor behind", () => {
  const hits = vs.searchRowsHybrid(OPS, "schema change", { limit: 40, nowMs: 9999999 });
  assert.deepEqual(hits.map((r) => r.id), ["#ops:2", "#ops:1"]);
});

test("hybrid lexical leg finds substring-only rows first", () => {
  const hits = vs.searchRowsHybrid(OPS, "lunch plans", { limit: 40, nowMs: 9999999 });
  assert.equal(hits[0].id, "#ops:3");
});

test("hybrid returns [] for blank queries", () => {
  assert.deepEqual(vs.searchRowsHybrid(OPS, "", {}), []);
  assert.deepEqual(vs.searchRowsHybrid(OPS, "   ", {}), []);
  assert.deepEqual(vs.searchRowsSemantic([], "x", 40), []);
});

test("hybrid honors the limit", () => {
  const hits = vs.searchRowsHybrid(OPS, "schema", { limit: 1, nowMs: 9999999 });
  assert.equal(hits.length, 1);
});

test("hybrid boosts same-room hits when activeTarget is set", () => {
  const rooms = [
    row("#a:1", "#a", "u", "deploy the production server tonight", 1000),
    row("#b:1", "#b", "u", "deploy the production server tonight", 1000),
  ];
  const plain = vs.searchRowsHybrid(rooms, "deploy production", { limit: 40, nowMs: 2000 });
  assert.deepEqual(plain.map((r) => r.id), ["#a:1", "#b:1"]);
  const active = vs.searchRowsHybrid(rooms, "deploy production", { limit: 40, nowMs: 2000, activeTarget: "#b" });
  assert.deepEqual(active.map((r) => r.id), ["#b:1", "#a:1"]);
});

test("hybrid penalizes self authors so peers surface first", () => {
  const rows = [
    row("#a:1", "#a", "me", "deploy the production server tonight", 1000),
    row("#a:2", "#a", "peer", "deploy the production server tonight", 1000),
  ];
  const hits = vs.searchRowsHybrid(rows, "deploy production", { limit: 40, nowMs: 2000, selfNick: "me" });
  assert.deepEqual(hits.map((r) => r.id), ["#a:2", "#a:1"]);
});

test("hybrid recency-boosts the newer lexical twin", () => {
  const rows = [
    row("#a:1", "#a", "u", "deploy the production server tonight", 1000),
    row("#a:2", "#a", "u", "deploy the production server tonight", 9000),
  ];
  const hits = vs.searchRowsHybrid(rows, "deploy production", { limit: 40, nowMs: 10000 });
  assert.deepEqual(hits.map((r) => r.id), ["#a:2", "#a:1"]);
});

test("semantic ranks topical neighbors above unrelated rows", () => {
  const hits = vs.searchRowsSemantic(OPS, "schema change", 40);
  assert.deepEqual(hits.map((r) => r.id), ["#ops:2", "#ops:1"]);
});

test("semantic honors limit and minScore", () => {
  assert.equal(vs.searchRowsSemantic(OPS, "schema change", 1).length, 1);
  assert.deepEqual(vs.searchRowsSemantic(OPS, "schema change", 40, 1.5), []);
  assert.deepEqual(vs.searchRowsSemantic(OPS, "", 40), []);
});

test("boostedScore applies each axis like the oracle", () => {
  assert.equal(vs.boostedScore({ id: "x", score: 1, exact: true }), 1.35);
  assert.equal(vs.boostedScore({ id: "x", score: 1, sameRoom: true }), 1.15);
  assert.equal(vs.boostedScore({ id: "x", score: 1, fromSelf: true }), 0.95);
  assert.equal(vs.boostedScore({ id: "x", score: 1, ageMs: 0 }), 1.25);
  assert.equal(vs.boostedScore({ id: "x", score: 1, ageMs: -5 }), 1);
});

test("hitAgeMs reads epoch stamps defensively", () => {
  assert.equal(vs.hitAgeMs({ at: 9000 }, 10000), 1000);
  assert.equal(vs.hitAgeMs({ at: 99999 }, 10000), 0);
  assert.equal(vs.hitAgeMs({ at: "x" }, 10000), undefined);
});

test("mode saves persist only the three known modes", () => {
  const { wire } = globalThis.OnyxPorts;
  const store = {};
  let saveHandler = null;
  const stub = () => ({ subscribe() {} });
  const app = {
    ports: {
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
      followedSave: stub(),
      vaultSearchModeSave: { subscribe(fn) { saveHandler = fn; } },
    },
  };
  globalThis.window = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
  };
  try {
    wire(app);
    saveHandler({ mode: "semantic" });
    assert.equal(store["onyx:vault-search-mode"], "semantic");
    saveHandler({ mode: "bogus" });
    assert.equal(store["onyx:vault-search-mode"], "semantic");
    saveHandler(null);
    assert.equal(store["onyx:vault-search-mode"], "semantic");
  } finally {
    delete globalThis.window;
  }
});
