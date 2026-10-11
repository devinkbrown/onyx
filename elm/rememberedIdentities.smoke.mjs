/* Remembered-identities smoke test (v3/rx-public) — the "Stay signed in"
   catalogue over the `onyx:credentials` slot store: opt-in only, secret-
   free listing, select/use/forget by opaque id, the SASL holder armed
   without the password ever reaching an Elm-facing payload, and the
   `credentialsRequest` port answering with fresh listings. Run with:
     node --test elm/rememberedIdentities.smoke.mjs
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
const { rememberedIdentities: ids, resumeCredentials, sasl, wire } = globalThis.OnyxPorts;

const SECRET = "correct horse battery staple";
const TOKEN = "tok-abcdef0123456789";
const MESH = "mesh-9876543210";

function store() {
  return JSON.parse(mem.get("onyx:credentials") || "{}");
}

/* Sign in as `nick` (the SASL holder has the typed password), then the
   server accepts the account and Elm asks to remember it (or not). */
function signIn(nick, password, remember = true, server = "irc.example") {
  sasl.setCredentials(nick, password, false);
  return ids.remember({ server, nick: nick.toLowerCase(), display: nick, remember });
}

function assertNoSecrets(value) {
  const json = JSON.stringify(value);
  for (const secret of [SECRET, TOKEN, MESH, "hunter22"]) {
    assert.ok(!json.includes(secret), `payload leaked a secret: ${json}`);
  }
  for (const field of ["password", "sessionToken", "meshToken"]) {
    assert.ok(!json.includes(field), `payload names a secret field: ${json}`);
  }
}

test("token capture alone never lists an identity (opt-in only)", () => {
  mem.clear();
  resumeCredentials.store("irc.example", "kai", "token", TOKEN, null);
  assert.deepEqual(ids.list(), []);
});

test("remember lists sanitized metadata only", () => {
  mem.clear();
  resumeCredentials.store("irc.example", "kai", "token", TOKEN, null);
  assert.equal(signIn("Kai", SECRET), true);
  const listed = ids.list();
  assert.equal(listed.length, 1);
  const [entry] = listed;
  assert.match(entry.id, /^saved-[0-9a-z]+-[0-9a-z]+$/);
  assert.equal(entry.nick, "Kai");
  assert.equal(entry.server, "irc.example");
  assert.equal(entry.active, true);
  assert.equal(entry.access, "resume");
  assert.deepEqual(Object.keys(entry).sort(), ["access", "active", "id", "nick", "savedAt", "server"]);
  assertNoSecrets(listed);
  // The store itself keeps the password and the token in one slot.
  const slot = store().slots["irc.example|kai"];
  assert.equal(slot.password, SECRET);
  assert.equal(slot.sessionToken, TOKEN);
  assert.equal(slot.remembered, true);
});

test("access: resume > sign-in > identity-only; an expired mesh token is no resume", () => {
  mem.clear();
  signIn("ana", SECRET);
  assert.equal(ids.list()[0].access, "sign-in");
  mem.clear();
  sasl.clearCredentials();
  ids.remember({ server: "irc.example", nick: "bo", display: "bo", remember: true });
  assert.equal(ids.list()[0].access, "identity-only");
  resumeCredentials.store("irc.example", "bo", "mtoken", MESH, 10);
  assert.equal(ids.list(Date.now())[0].access, "identity-only");
  resumeCredentials.store("irc.example", "bo", "mtoken", MESH, Math.floor(Date.now() / 1000) + 3600);
  assert.equal(ids.list(Date.now())[0].access, "resume");
});

test("a password typed for another account is never stored", () => {
  mem.clear();
  sasl.setCredentials("mallory", SECRET, false);
  ids.remember({ server: "irc.example", nick: "kai", display: "kai", remember: true });
  assert.equal(store().slots["irc.example|kai"].password, undefined);
  assert.equal(ids.list()[0].access, "identity-only");
});

test("use arms the SASL holder and answers held without the password", () => {
  mem.clear();
  signIn("Kai", SECRET);
  sasl.clearCredentials();
  const [entry] = ids.list();
  const used = ids.use(entry.id);
  assert.deepEqual(used, { id: entry.id, nick: "Kai", held: true });
  assertNoSecrets(used);
  const blob = Buffer.from(sasl.plainPayload("Kai"), "base64").toString("utf8");
  assert.equal(blob, "\0Kai\0" + SECRET);
  assert.equal(ids.use("saved-nope-nope"), null);
});

test("select moves the active mark; listing puts the active first", () => {
  mem.clear();
  signIn("ana", SECRET);
  signIn("bo", "hunter22");
  assert.equal(ids.list()[0].nick, "bo");
  const ana = ids.list().find((e) => e.nick === "ana");
  assert.equal(ids.select(ana.id), true);
  assert.equal(ids.list()[0].nick, "ana");
  assert.equal(ids.list()[0].active, true);
  assert.equal(ids.select("saved-x-y"), false);
});

test("forget drops the slot, tokens included", () => {
  mem.clear();
  resumeCredentials.store("irc.example", "kai", "token", TOKEN, null);
  signIn("kai", SECRET);
  const [entry] = ids.list();
  assert.equal(ids.forget(entry.id), true);
  assert.deepEqual(ids.list(), []);
  assert.equal(resumeCredentials.load("irc.example", "kai"), null);
  assert.equal(ids.forget(entry.id), false);
});

test("opting out keeps resume tokens but drops the password and the listing", () => {
  mem.clear();
  resumeCredentials.store("irc.example", "kai", "token", TOKEN, null);
  signIn("kai", SECRET);
  signIn("kai", SECRET, false);
  assert.deepEqual(ids.list(), []);
  const slot = store().slots["irc.example|kai"];
  assert.equal(slot.password, undefined);
  assert.equal(slot.sessionToken, TOKEN);
});

test("the catalogue is bounded to 12, keeping the active identity", () => {
  mem.clear();
  for (let i = 0; i < 15; i += 1) signIn(`user${i}`, SECRET);
  const listed = ids.list();
  assert.equal(listed.length, 12);
  assert.equal(listed[0].nick, "user14");
});

test("hostile stored data reads fail-closed", () => {
  mem.clear();
  mem.set("onyx:credentials", JSON.stringify({
    v: 1,
    active: "nope",
    slots: {
      "irc.example|bad nick": { remembered: true, password: SECRET },
      "irc.example|ok": { remembered: true, nick: "<img src=x>", password: "a\u0000b" },
      "user:pw@irc.example?x=1|lee": { remembered: true, nick: "lee" },
      "irc.example|arr": [1, 2],
    },
  }));
  const listed = ids.list();
  assert.deepEqual(listed.map((e) => e.nick).sort(), ["lee", "ok"]);
  assert.equal(listed.find((e) => e.nick === "ok").access, "identity-only");
  assert.equal(listed.find((e) => e.nick === "lee").server, "irc.example");
  assert.ok(listed.every((e) => e.active === false));
  mem.set("onyx:credentials", "{not json");
  assert.deepEqual(ids.list(), []);
});

test("the credentialsRequest port answers every op with a fresh, secret-free listing", () => {
  mem.clear();
  signIn("Kai", SECRET);
  let handler = null;
  const listed = [];
  const ready = [];
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
      credentialsRequest: { subscribe(fn) { handler = fn; } },
      credentialsListed: { send(v) { listed.push(v); } },
      credentialsReady: { send(v) { ready.push(v); } },
    },
  };
  globalThis.window = { localStorage: globalThis.localStorage };
  try {
    wire(app);
    assert.equal(typeof handler, "function", "credentialsRequest subscribed");
    handler({ op: "list", id: "", server: "", nick: "", display: "", remember: false });
    assert.equal(listed.at(-1).length, 1);
    const id = listed.at(-1)[0].id;
    sasl.clearCredentials();
    handler({ op: "use", id, server: "", nick: "", display: "", remember: false });
    assert.deepEqual(ready.at(-1), { id, nick: "Kai", held: true });
    handler({ op: "use", id: "saved-zz-zz", server: "", nick: "", display: "", remember: false });
    assert.deepEqual(ready.at(-1), { id: "saved-zz-zz", nick: "", held: false });
    handler({ op: "forget", id, server: "", nick: "", display: "", remember: false });
    assert.deepEqual(listed.at(-1), []);
    assertNoSecrets(listed);
    assertNoSecrets(ready);
  } finally {
    delete globalThis.window;
  }
});

/* Solid-client compatibility: the oracle's `{ version: 2, activeKey,
   entries }` store (and its older bare-object form) must survive. */
const SOLID_V2 = {
  version: 2,
  activeKey: "wss://irc.example/ws|kai",
  entries: {
    "wss://irc.example/ws|kai": {
      nick: "Kai",
      server: "wss://irc.example/ws",
      password: SECRET,
      sessionToken: TOKEN,
      savedAt: "2026-09-01T10:00:00.000Z",
    },
    "wss://irc.example/ws|mara": {
      nick: "mara",
      server: "wss://irc.example/ws",
      meshToken: MESH,
      meshTokenExpiry: "2000-01-01T00:00:00.000Z",
      savedAt: "2026-08-01T10:00:00.000Z",
    },
    "wss://irc.example/ws|bad": { nick: "bad nick", server: "wss://irc.example/ws" },
  },
};

test("a Solid v2 store lists its identities (migrated, secrets kept ports-side)", () => {
  mem.clear();
  mem.set("onyx:credentials", JSON.stringify(SOLID_V2));
  const listed = ids.list();
  assert.deepEqual(listed.map((e) => [e.nick, e.access, e.active]), [["Kai", "resume", true], ["mara", "identity-only", false]]);
  assert.ok(listed.every((e) => e.server === "irc.example"));
  assertNoSecrets(listed);
  // The node probe (winner host) finds the migrated bearer.
  assert.equal(resumeCredentials.load("irc.example", "kai").sessionToken, TOKEN);
  // An expired mesh token never migrates.
  assert.deepEqual(resumeCredentials.load("irc.example", "mara"), {});
});

test("the first Elm write keeps every Solid entry intact", () => {
  mem.clear();
  mem.set("onyx:credentials", JSON.stringify(SOLID_V2));
  assert.equal(resumeCredentials.store("wss://irc.example/ws", "kai", "token", "tok-rotated", null), true);
  const stored = store();
  assert.equal(stored.version, 2);
  assert.equal(stored.activeKey, SOLID_V2.activeKey);
  assert.deepEqual(stored.entries, SOLID_V2.entries);
  assert.equal(stored.slots["irc.example|kai"].sessionToken, "tok-rotated");
  assert.equal(stored.slots["irc.example|kai"].password, SECRET);
});

test("once Elm owns slots, a forgotten Solid identity stays forgotten", () => {
  mem.clear();
  mem.set("onyx:credentials", JSON.stringify(SOLID_V2));
  const kai = ids.list().find((e) => e.nick === "Kai");
  assert.equal(ids.forget(kai.id), true);
  assert.deepEqual(ids.list().map((e) => e.nick), ["mara"]);
  // Solid's own entries are still there for a rollback.
  assert.deepEqual(store().entries, SOLID_V2.entries);
});

test("the oracle's bare single-credential object migrates and survives writes", () => {
  mem.clear();
  const single = { nick: "lee", server: "wss://irc.example/ws", password: SECRET, savedAt: "2026-07-01T00:00:00.000Z" };
  mem.set("onyx:credentials", JSON.stringify(single));
  assert.deepEqual(ids.list().map((e) => [e.nick, e.access]), [["lee", "sign-in"]]);
  resumeCredentials.store("wss://irc.example/ws", "lee", "token", TOKEN, null);
  const stored = store();
  assert.equal(stored.nick, "lee");
  assert.equal(stored.server, single.server);
  assert.equal(stored.password, SECRET);
  assert.equal(stored.slots["irc.example|lee"].sessionToken, TOKEN);
});

test("full endpoint URLs and probe hosts share one slot", () => {
  mem.clear();
  resumeCredentials.store("wss://Irc.Example/ws", "Kai", "token", TOKEN, null);
  assert.equal(resumeCredentials.load("irc.example", "kai").sessionToken, TOKEN);
  assert.deepEqual(Object.keys(store().slots), ["irc.example|kai"]);
});
