/* Outbox ports smoke test — flush-plan classification, target guard,
   and row coercion for the durable offline queue.
   Run with:
     node --test elm/outbox.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { outboxStore } = globalThis.OnyxPorts;

assert.equal(outboxStore.maxEntries, 100);
assert.equal(outboxStore.maxAgeMs, 24 * 60 * 60 * 1000);

test("isOutboxTarget mirrors isSafeOutboxTarget", () => {
  assert.equal(outboxStore.isOutboxTarget("#c"), true);
  assert.equal(outboxStore.isOutboxTarget("dave"), true);
  assert.equal(outboxStore.isOutboxTarget(""), false);
  assert.equal(outboxStore.isOutboxTarget("  "), false);
  assert.equal(outboxStore.isOutboxTarget(" #c"), false);
  assert.equal(outboxStore.isOutboxTarget("#c "), false);
  assert.equal(outboxStore.isOutboxTarget("a b"), false);
  assert.equal(outboxStore.isOutboxTarget("a\tb"), false);
  assert.equal(outboxStore.isOutboxTarget("a\nb"), false);
  assert.equal(outboxStore.isOutboxTarget(null), false);
  assert.equal(outboxStore.isOutboxTarget(42), false);
});

test("plainEntry coerces stored rows to the Elm shape", () => {
  const row = outboxStore.plainEntry({
    id: "ob-1",
    target_key: "#c",
    target: "#c",
    text: "hi",
    queued_at: 1234,
  });
  assert.deepEqual(row, { id: "ob-1", target: "#c", text: "hi", queuedAt: 1234, wireAdmitted: false });
  const marked = outboxStore.plainEntry({ id: "ob-9", target: "#c", text: "x", queued_at: 5, wire_admitted: true });
  assert.equal(marked.wireAdmitted, true);
  const legacy = outboxStore.plainEntry({ id: "ob-2", target: "#c", text: "x" });
  assert.equal(legacy.queuedAt, 0);
});

const NOW = 2000000000000;
const FRESH = NOW - 1000;
const OLD = NOW - 24 * 60 * 60 * 1000 - 1;

function stored(id, target, text, queued_at) {
  return { id, target_key: String(target).toLowerCase(), target, text, queued_at };
}

test("open socket sends live rows and drops expired ones", () => {
  const plan = outboxStore.flushPlan(
    [
      stored("ob-1", "#c", "one", FRESH),
      stored("ob-2", "#c", "two", OLD),
      stored("ob-3", "#c", "", FRESH),
      { bogus: true },
    ],
    NOW,
    true
  );
  assert.deepEqual(plan.send.map((r) => r.id), ["ob-1"]);
  assert.deepEqual(
    plan.drop.map((r) => r.id).sort(),
    ["", "ob-2", "ob-3"]
  );
  assert.deepEqual(plan.hold, []);
});

test("closed socket holds live rows (pure plan)", () => {
  const plan = outboxStore.flushPlan([stored("ob-1", "#c", "one", FRESH)], NOW, false);
  assert.deepEqual(plan.send, []);
  assert.deepEqual(plan.hold.map((r) => r.id), ["ob-1"]);
  assert.deepEqual(plan.drop, []);
});

test("exact TTL boundary stays live", () => {
  const edge = NOW - 24 * 60 * 60 * 1000;
  const plan = outboxStore.flushPlan([stored("ob-1", "#c", "one", edge)], NOW, true);
  assert.deepEqual(plan.send.map((r) => r.id), ["ob-1"]);
  assert.deepEqual(plan.drop, []);
});

/* ── Flush-walk harness: cursor-capable fake IDB for outboxFlush. The
   shim is dumb storage; the waiting/pruneFailed report contract under
   test lives in ports.js. */
function fakeOutboxDb(initialRows, opts = {}) {
  const map = new Map(initialRows.map((r) => [r.id, r]));
  const failDelete = new Set(opts.failDeleteIds || []);
  const failTx2 = !!opts.failTx2;
  const failMarkTx = !!opts.failMarkTx;
  let txCount = 0;
  const db = {
    _map: map,
    _reset() { txCount = 0; },
    transaction() {
      txCount += 1;
      if (txCount === 2) {
        /* Durable wire-admitted mark transaction (put-only). */
        const tx = { oncomplete: null, onerror: null, onabort: null };
        tx.objectStore = function () {
          return {
            put(value) { map.set(value.id, value); },
          };
        };
        setTimeout(() => {
          if (failMarkTx) { if (tx.onerror) tx.onerror(); }
          else if (tx.oncomplete) tx.oncomplete();
        }, 0);
        return tx;
      }
      if (txCount === 1) {
        const tx = { oncomplete: null, onerror: null, onabort: null };
        tx.objectStore = function () {
          return {
            openCursor() {
              const req = { onsuccess: null, onerror: null };
              const keys = [...map.keys()];
              let i = 0;
              const step = () => {
                if (i >= keys.length) {
                  if (req.onsuccess) req.onsuccess({ target: { result: null } });
                  setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
                  return;
                }
                const key = keys[i++];
                const cursor = {
                  value: map.get(key),
                  delete() {
                    if (failDelete.has(key)) throw new Error("prune boom");
                    map.delete(key);
                  },
                  continue() { setTimeout(step, 0); },
                };
                if (req.onsuccess) req.onsuccess({ target: { result: cursor } });
              };
              setTimeout(step, 0);
              return req;
            },
          };
        };
        return tx;
      }
      const tx = { oncomplete: null, onerror: null, onabort: null };
      tx.objectStore = function () {
        return {
          delete(id) {
            if (failTx2) throw new Error("tx2 boom");
            map.delete(id);
          },
        };
      };
      setTimeout(() => {
        if (failTx2) { if (tx.onerror) tx.onerror(); }
        else if (tx.oncomplete) tx.oncomplete();
      }, 0);
      return tx;
    },
  };
  return db;
}

function fakeSock(open) {
  return {
    open,
    sent: [],
    isOpen() { return this.open; },
    send(line) { this.sent.push(line); },
  };
}

function flushAsync(db, sock) {
  /* Transaction kind dispatch is per-walk (walk, mark, prune), so each
     flush walk starts the count over. */
  if (db && typeof db._reset === "function") db._reset();
  return new Promise((resolve) => outboxStore.flush(db, sock, resolve));
}

const LIVE_AT = Date.now() - 1000;
const STALE_AT = Date.now() - 25 * 60 * 60 * 1000;

test("open socket flush sends live, drops expired, reports zero waiting", async () => {
  const db = fakeOutboxDb([
    stored("ob-1", "#c", "one", LIVE_AT),
    stored("ob-2", "#c", "two", STALE_AT),
  ]);
  const sock = fakeSock(true);
  const report = await flushAsync(db, sock);
  assert.deepEqual(report.sent, ["ob-1"]);
  assert.deepEqual(report.dropped, ["ob-2"]);
  assert.deepEqual(report.uncertain, []);
  assert.deepEqual(report.rows, []);
  assert.equal(report.waiting, 0);
  assert.equal(report.pruneFailed, 0);
  assert.deepEqual(sock.sent, ["PRIVMSG #c :one"]);
  assert.equal(db._map.size, 0);
  assert.equal(report.walkOk, true);
});

test("closed socket holds live rows as silent waiting, never uncertain", async () => {
  /* Rows never left the device: no "may have sent" toast may fire (the
     oracle's pre-delivery `waiting += 1; continue`). */
  const db = fakeOutboxDb([stored("ob-closed-1", "#c", "one", LIVE_AT)]);
  const report = await flushAsync(db, fakeSock(false));
  assert.deepEqual(report.sent, []);
  assert.deepEqual(report.uncertain, []);
  assert.equal(report.waiting, 1);
  assert.equal(report.pruneFailed, 0);
  assert.equal(report.rows.length, 1);
  assert.equal(report.walkOk, true);
  assert.equal(db._map.size, 1);
});

test("prune failure counts without losing the queue", async () => {
  const db = fakeOutboxDb(
    [
      stored("ob-1", "#c", "one", LIVE_AT),
      stored("ob-2", "#c", "two", STALE_AT),
    ],
    { failDeleteIds: ["ob-2"] }
  );
  const report = await flushAsync(db, fakeSock(true));
  assert.deepEqual(report.sent, ["ob-1"]);
  assert.deepEqual(report.dropped, ["ob-2"]);
  assert.equal(report.waiting, 1);
  assert.equal(report.pruneFailed, 1);
  assert.equal(report.expiredPruneFailed, 1);
  assert.equal(report.admittedPruneFailed, 0);
  assert.equal(report.walkOk, true);
  assert.equal(db._map.has("ob-2"), true);
});

test("admission prune failure still counts sent and stuck, never uncertain", async () => {
  /* Bytes reached the socket: the row is `sent` (user feedback) plus
     waiting/stuck (storage prune pending) — never "may have sent". */
  const db = fakeOutboxDb([stored("ob-stuck-1", "#c", "one", LIVE_AT)], { failTx2: true });
  const report = await flushAsync(db, fakeSock(true));
  assert.deepEqual(report.sent, ["ob-stuck-1"]);
  assert.deepEqual(report.uncertain, []);
  assert.equal(report.waiting, 1);
  assert.equal(report.pruneFailed, 1);
  assert.equal(report.expiredPruneFailed, 0);
  assert.equal(report.admittedPruneFailed, 1);
  assert.equal(db._map.has("ob-stuck-1"), true);
  /* The durable mark landed even though the prune failed: a later walk
     must not re-admit the row. */
  assert.equal(db._map.get("ob-stuck-1").wire_admitted, true);
});

test("wire-admitted rows never re-send, only retry the prune", async () => {
  const db = fakeOutboxDb([stored("ob-marked-1", "#c", "one", LIVE_AT)]);
  db._map.get("ob-marked-1").wire_admitted = true;
  const sock = fakeSock(true);
  const report = await flushAsync(db, sock);
  assert.deepEqual(sock.sent, []);
  assert.deepEqual(report.sent, []);
  assert.deepEqual(report.uncertain, []);
  assert.deepEqual(report.dropped, []);
  assert.deepEqual(report.rows, []);
  assert.equal(report.waiting, 0);
  assert.equal(report.pruneFailed, 0);
  assert.equal(db._map.size, 0);
});

test("wire-admitted prune failure counts stuck without re-sending", async () => {
  const db = fakeOutboxDb([stored("ob-marked-2", "#c", "one", LIVE_AT)], {
    failDeleteIds: ["ob-marked-2"],
  });
  db._map.get("ob-marked-2").wire_admitted = true;
  const sock = fakeSock(true);
  const report = await flushAsync(db, sock);
  assert.deepEqual(sock.sent, []);
  assert.deepEqual(report.sent, []);
  assert.deepEqual(report.uncertain, []);
  assert.equal(report.waiting, 1);
  assert.equal(report.pruneFailed, 1);
  assert.equal(report.admittedPruneFailed, 1);
  assert.equal(db._map.has("ob-marked-2"), true);
});

test("mid-send death reports uncertain once, then carries silently", async () => {
  const db = fakeOutboxDb([stored("ob-doomed-1", "#c", "one", LIVE_AT)]);
  const dying = fakeSock(true);
  const realSend = dying.send.bind(dying);
  dying.send = function (line) {
    realSend(line);
    this.open = false;
  };
  const first = await flushAsync(db, dying);
  assert.deepEqual(first.sent, []);
  assert.deepEqual(first.uncertain, ["ob-doomed-1"]);
  /* Second walk with the socket back: never re-sent, never re-toasted —
     the row just waits (the oracle's never-released claim). */
  const second = await flushAsync(db, fakeSock(true));
  assert.deepEqual(second.sent, []);
  assert.deepEqual(second.uncertain, []);
  assert.equal(second.waiting, 1);
  assert.equal(second.rows.length, 1);
});

test("mark-transaction failure still prunes and reports sent", async () => {
  const db = fakeOutboxDb([stored("ob-markfail-1", "#c", "one", LIVE_AT)], { failMarkTx: true });
  const sock = fakeSock(true);
  const report = await flushAsync(db, sock);
  assert.deepEqual(sock.sent, ["PRIVMSG #c :one"]);
  assert.deepEqual(report.sent, ["ob-markfail-1"]);
  assert.deepEqual(report.uncertain, []);
  assert.equal(report.waiting, 0);
  assert.equal(db._map.size, 0);
});

test("null db reports an empty flush", async () => {
  const report = await flushAsync(null, fakeSock(true));
  assert.deepEqual(report.sent, []);
  assert.equal(report.waiting, 0);
  assert.equal(report.pruneFailed, 0);
  assert.equal(report.walkOk, true);
});

test("broken walk reports walkOk false", async () => {
  const broken = {
    transaction() { throw new Error("idb boom"); },
  };
  const report = await flushAsync(broken, fakeSock(true));
  assert.deepEqual(report.sent, []);
  assert.equal(report.waiting, 0);
  assert.equal(report.walkOk, false);
});

function flushAsyncLabeled(db, sock) {
  return new Promise((resolve) => outboxStore.flush(db, sock, resolve, true));
}

test("labeled flush stamps @label and reports row labels", async () => {
  const db = fakeOutboxDb([
    stored("ob-1", "#c", "one", LIVE_AT),
    stored("ob-2", "#c", "two", LIVE_AT),
  ]);
  const sock = fakeSock(true);
  const report = await flushAsyncLabeled(db, sock);
  assert.deepEqual(report.sent, ["ob-1", "ob-2"]);
  assert.equal(report.sentLabels.length, 2);
  assert.deepEqual(
    report.sentLabels.map((e) => e.id),
    ["ob-1", "ob-2"]
  );
  const labels = report.sentLabels.map((e) => e.label);
  assert.equal(new Set(labels).size, 2);
  for (const label of labels) {
    assert.match(label, /^q[0-9a-z]+$/);
    assert.ok(label.length <= 64);
  }
  assert.deepEqual(
    sock.sent,
    ["one", "two"].map((text, i) => "@label=" + labels[i] + " PRIVMSG #c :" + text)
  );
  assert.equal(report.walkOk, true);
});

test("unlabeled flush reports no labels and sends bare lines", async () => {
  const db = fakeOutboxDb([stored("ob-1", "#c", "one", LIVE_AT)]);
  const sock = fakeSock(true);
  const report = await flushAsync(db, sock);
  assert.deepEqual(report.sentLabels, []);
  assert.deepEqual(sock.sent, ["PRIVMSG #c :one"]);
});
