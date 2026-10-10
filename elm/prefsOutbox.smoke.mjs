/* v3/prefs — Preferences queued-send review smoke test: the pure
   review plan (discard ids, listed rows) and the transaction wrapper's
   report-after-commit contract, against a tiny fake IndexedDB.
   Run with:
     node --test elm/prefsOutbox.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { outboxStore } = globalThis.OnyxPorts;

function stored(id, target, text, queued_at, extra) {
  return Object.assign({ id, target_key: String(target).toLowerCase(), target, text, queued_at }, extra || {});
}

test("reviewPlan lists unsent rows oldest first and removes only existing discard ids", () => {
  const plan = outboxStore.reviewPlan(
    [
      stored("ob-2", "#c", "two", 20),
      stored("ob-1", "#c", "one", 10),
      stored("ob-3", "#c", "sent", 30, { wire_admitted: true }),
      stored("ob-4", "bad target", "x", 40),
      { bogus: true },
    ],
    ["ob-2", "ob-missing", 7, ""],
  );
  assert.deepEqual(plan.remove, ["ob-2"]);
  assert.deepEqual(plan.keep, [{ id: "ob-1", target: "#c", text: "one", queuedAt: 10 }]);
});

test("reviewPlan with no discard is a pure listing", () => {
  const plan = outboxStore.reviewPlan([stored("ob-1", "dave", "hi", 5)], []);
  assert.deepEqual(plan.remove, []);
  assert.equal(plan.keep.length, 1);
});

function fakeDb(rows, opts) {
  const options = opts || {};
  const deleted = [];
  return {
    deleted,
    transaction() {
      const tx = {};
      const store = {
        getAll() {
          const req = {};
          setTimeout(() => {
            req.result = rows.slice();
            if (req.onsuccess) req.onsuccess();
            setTimeout(() => {
              if (options.abort) { if (tx.onabort) tx.onabort(); }
              else if (tx.oncomplete) tx.oncomplete();
            }, 0);
          }, 0);
          return req;
        },
        delete(id) { deleted.push(id); },
      };
      tx.objectStore = () => store;
      return tx;
    },
  };
}

test("review deletes then reports after commit, echoing the tag", async () => {
  const db = fakeDb([stored("ob-1", "#c", "one", 1), stored("ob-2", "#c", "two", 2)]);
  const report = await new Promise((resolve) => outboxStore.review(db, { discard: ["ob-1"], tag: "one" }, resolve));
  assert.deepEqual(db.deleted, ["ob-1"]);
  assert.deepEqual(report, { removed: ["ob-1"], rows: [{ id: "ob-2", target: "#c", text: "two", queuedAt: 2 }], ok: true, tag: "one" });
});

test("review reports failure without claiming removals when the transaction aborts", async () => {
  const db = fakeDb([stored("ob-1", "#c", "one", 1)], { abort: true });
  const report = await new Promise((resolve) => outboxStore.review(db, { discard: ["ob-1"], tag: "all" }, resolve));
  assert.deepEqual(report, { removed: [], rows: [], ok: false, tag: "all" });
});

test("review without a vault reports not ok", () => {
  let report = null;
  outboxStore.review(null, { discard: [], tag: "refresh" }, (r) => { report = r; });
  assert.deepEqual(report, { removed: [], rows: [], ok: false, tag: "refresh" });
});
