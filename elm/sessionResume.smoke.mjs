/* Session-resume credential ports smoke test — slot store/load/clear and
   reclaim-timer constants for the SESSION RESUME handshake.
   Run with:
     node --test elm/sessionResume.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};

const require = createRequire(import.meta.url);
require("./ports.js");
const { resumeCredentials } = globalThis.OnyxPorts;

test("reclaim windows mirror the oracle confirm/dismiss timers", () => {
  assert.equal(resumeCredentials.reclaimConfirmMs, 2000);
  assert.equal(resumeCredentials.reclaimDismissMs, 3000);
});

test("store merges token kinds without clobbering", () => {
  mem.clear();
  assert.equal(resumeCredentials.store("irc.example", "alice", "token", "tok123", null), true);
  assert.equal(resumeCredentials.store("irc.example", "alice", "mtoken", "hex9", 99), true);
  assert.deepEqual(resumeCredentials.load("irc.example", "alice"), {
    sessionToken: "tok123",
    meshToken: "hex9",
    meshExpiresAtMs: 99000,
  });
});

test("clear drops one slot case-insensitively and keeps siblings", () => {
  mem.clear();
  resumeCredentials.store("irc.example", "Alice", "token", "tok123", null);
  resumeCredentials.store("irc.example", "bob", "token", "tok456", null);
  assert.equal(resumeCredentials.clear("irc.example", "alice"), true);
  assert.equal(resumeCredentials.load("irc.example", "alice"), null);
  assert.equal(resumeCredentials.load("irc.example", "BOB").sessionToken, "tok456");
  assert.equal(resumeCredentials.clear("irc.example", "alice"), false);
});

test("store refuses garbage fail-closed", () => {
  mem.clear();
  assert.equal(resumeCredentials.store("irc.example", "alice", "token", "", null), false);
  assert.equal(resumeCredentials.store("irc.example", "alice", "token", "has space", null), false);
  assert.equal(resumeCredentials.store("irc.example", "alice", "bogus", "tok123", null), false);
  assert.equal(resumeCredentials.load("irc.example", "alice"), null);
});
