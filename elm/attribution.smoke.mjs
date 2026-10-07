/* Account-attribution identity smoke test — daemon transcripts byte-matched
   to `src/lib/e2ee/deviceSign.ts`, the `sign-v1` read-or-create lifecycle,
   and the owner-scoped enrolled marker, all with in-memory stores and real
   WebCrypto. Run with:
     node --test elm/attribution.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
require("./ports.js");
const { OnyxPorts } = globalThis;

function memMarkers() {
  const map = {};
  return {
    get: (key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null),
    set: (key, value) => { map[key] = value; },
    remove: (key) => { delete map[key]; },
    keys: () => Object.keys(map),
  };
}

function memDeps(extra) {
  return {
    keyStore: OnyxPorts.memKV(),
    markerStore: memMarkers(),
    subtle: globalThis.crypto.subtle,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    random: (n) => {
      const bytes = new Uint8Array(n);
      globalThis.crypto.getRandomValues(bytes);
      return bytes;
    },
    ...(extra || {}),
  };
}

const SERVER = "wss://irc.example:6697";
const ACCOUNT = "alice";
const NODE = "0123456789abcdef";

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

/* Independent oracle for the enroll transcript:
   "ONYX-ACCOUNT-IDENTITY-v1" || 0x00 || account || 0x00 || label || 0x00 || pub(32). */
function expectedIdentityTranscript(account, label, pubRaw) {
  return Buffer.concat([
    Buffer.from("ONYX-ACCOUNT-IDENTITY-v1", "utf8"),
    Buffer.from([0]),
    Buffer.from(account, "utf8"),
    Buffer.from([0]),
    Buffer.from(label, "utf8"),
    Buffer.from([0]),
    Buffer.from(pubRaw),
  ]);
}

/* Independent oracle for the residence message:
   "ONYX-ACCOUNT-RESIDENCE-v1" || 0x00 || "ARP1" || len8(account) ||
   account || node:u64 BE || epoch:u64 BE || expiry:u64 BE. */
function expectedResidenceMessage(account, nodeHex, epoch, expiryMs) {
  const acct = Buffer.from(account, "utf8");
  const unsigned = Buffer.alloc(4 + 1 + acct.length + 8 + 8 + 8);
  unsigned.write("ARP1", 0, "ascii");
  unsigned[4] = acct.length;
  acct.copy(unsigned, 5);
  let off = 5 + acct.length;
  unsigned.writeBigUInt64BE(BigInt(`0x${nodeHex}`), off); off += 8;
  unsigned.writeBigUInt64BE(BigInt(epoch), off); off += 8;
  unsigned.writeBigUInt64BE(BigInt(expiryMs), off);
  return Buffer.concat([
    Buffer.from("ONYX-ACCOUNT-RESIDENCE-v1", "utf8"),
    Buffer.from([0]),
    unsigned,
  ]);
}

function expectedOwnerKey(serverUrl, account) {
  return "onyx:attribution-enrolled:owner:" + encodeURIComponent(JSON.stringify([serverUrl, account.toLowerCase()]));
}

test("transcripts match the independent byte vectors", async () => {
  const attr = OnyxPorts.createAttributionIdentity(memDeps());
  const pub = new Uint8Array(32).map((_, i) => (i * 11 + 5) & 0xff);
  const gotIdentity = attr.buildIdentityTranscript(ACCOUNT, "onyx-0102030405060708", pub);
  assert.deepEqual(
    Array.from(gotIdentity),
    Array.from(expectedIdentityTranscript(ACCOUNT, "onyx-0102030405060708", pub)),
  );

  const gotResidence = attr.buildResidenceMessage(ACCOUNT, NODE, 2000, 3000);
  assert.deepEqual(
    Array.from(gotResidence),
    Array.from(expectedResidenceMessage(ACCOUNT, NODE, 2000, 3000)),
  );

  // Malformed inputs fail closed.
  assert.equal(attr.buildIdentityTranscript("", "onyx-abc", pub), null);
  assert.equal(attr.buildIdentityTranscript(ACCOUNT, "bad label!", pub), null);
  assert.equal(attr.buildIdentityTranscript(ACCOUNT, "onyx-abc", pub.slice(0, 31)), null);
  assert.equal(attr.buildResidenceMessage(ACCOUNT, "xyz", 2000, 3000), null);
  assert.equal(attr.buildResidenceMessage(ACCOUNT, NODE, -1, 3000), null);
  assert.equal(attr.buildResidenceMessage(ACCOUNT, NODE, 2000, 1.5), null);

  // Owner key is lower-cased and URI-encoded like deviceMemoryOwner.
  assert.equal(attr.enrolledKey(SERVER, "Alice"), expectedOwnerKey(SERVER, ACCOUNT));
  assert.equal(attr.enrolledKey(" not a url ", ACCOUNT), null);
});

test("enroll round trip signs the transcript and confirms the marker", async () => {
  const deps = memDeps();
  const markers = deps.markerStore;
  const attr = OnyxPorts.createAttributionIdentity(deps);

  const reply = await attr.enroll({ serverUrl: SERVER, account: ACCOUNT, nodeHex: NODE, gen: 0 });
  assert.ok(reply, "enroll must succeed");
  assert.equal(reply.account, ACCOUNT);
  assert.equal(reply.nodeHex, NODE);
  assert.equal(reply.gen, 0);
  assert.equal(reply.alreadyEnrolled, false);
  assert.match(reply.label, /^onyx-[0-9a-f]{16}$/);
  assert.equal(reply.label, `onyx-${reply.publicHex.slice(0, 16)}`);
  assert.match(reply.publicHex, /^[0-9a-f]{64}$/);
  assert.match(reply.sig, /^[0-9a-f]{128}$/);

  // The signature verifies over the exact transcript with the device key.
  const stored = await deps.keyStore.get("sign-v1");
  const pubKey = stored.publicKey;
  const transcript = expectedIdentityTranscript(ACCOUNT, reply.label, Buffer.from(reply.publicHex, "hex"));
  const ok = await globalThis.crypto.subtle.verify(
    "Ed25519",
    pubKey,
    Buffer.from(reply.sig, "hex"),
    transcript,
  );
  assert.equal(ok, true);

  // A second factory over the same store reuses the key: stable identity.
  const attr2 = OnyxPorts.createAttributionIdentity(deps);
  const again = await attr2.enroll({ serverUrl: SERVER, account: ACCOUNT, nodeHex: NODE, gen: 0 });
  assert.equal(again.publicHex, reply.publicHex);

  // Confirming writes the owner-scoped marker; the next enroll skips ADD.
  assert.equal(attr2.confirmEnrolled({ serverUrl: SERVER, account: ACCOUNT, publicHex: reply.publicHex }), true);
  assert.equal(markers.get(expectedOwnerKey(SERVER, ACCOUNT)), reply.publicHex);
  const skipped = await attr2.enroll({ serverUrl: SERVER, account: ACCOUNT, nodeHex: NODE, gen: 0 });
  assert.equal(skipped.alreadyEnrolled, true);
  assert.equal(skipped.sig, "");
  assert.equal(skipped.publicHex, reply.publicHex);

  // The legacy ownerless marker is quarantined on enroll, never claimed.
  markers.set(`onyx:attribution-enrolled:${ACCOUNT}`, "deadbeef");
  await attr2.enroll({ serverUrl: SERVER, account: ACCOUNT, nodeHex: NODE, gen: 0 });
  assert.equal(markers.get(`onyx:attribution-enrolled:${ACCOUNT}`) ?? null, null);
});

test("residence round trip signs the residence message", async () => {
  const deps = memDeps();
  const attr = OnyxPorts.createAttributionIdentity(deps);
  const epoch = 2000;
  const expiryMs = 4802000;
  const reply = await attr.residence({ serverUrl: SERVER, account: ACCOUNT, nodeHex: NODE, epoch, expiryMs, gen: 3 });
  assert.ok(reply, "residence must succeed");
  assert.equal(reply.epoch, epoch);
  assert.equal(reply.expiryMs, expiryMs);
  assert.equal(reply.gen, 3);
  assert.match(reply.sig, /^[0-9a-f]{128}$/);

  const stored = await deps.keyStore.get("sign-v1");
  const message = expectedResidenceMessage(ACCOUNT, NODE, epoch, expiryMs);
  const ok = await globalThis.crypto.subtle.verify(
    "Ed25519",
    stored.publicKey,
    Buffer.from(reply.sig, "hex"),
    message,
  );
  assert.equal(ok, true);
});

test("malformed requests and stores fail closed", async () => {
  const deps = memDeps();
  const attr = OnyxPorts.createAttributionIdentity(deps);
  const good = { serverUrl: SERVER, account: ACCOUNT, nodeHex: NODE, gen: 0 };
  assert.equal(await attr.enroll({ ...good, nodeHex: "xyz" }), null);
  assert.equal(await attr.enroll({ ...good, account: "" }), null);
  assert.equal(await attr.enroll({ ...good, account: "x".repeat(65) }), null);
  assert.equal(await attr.enroll({ ...good, gen: -1 }), null);
  assert.equal(await attr.enroll({ ...good, serverUrl: "" }), null);
  assert.equal(await attr.residence({ ...good, epoch: 2000, expiryMs: 3000, nodeHex: "ZZZ" }), null);
  assert.equal(await attr.residence({ ...good, epoch: -5, expiryMs: 3000 }), null);
  assert.equal(await attr.residence({ ...good, epoch: 2000, expiryMs: NaN }), null);
  assert.equal(attr.confirmEnrolled({ serverUrl: SERVER, account: ACCOUNT, publicHex: "short" }), false);
  assert.equal(attr.confirmEnrolled({ serverUrl: "", account: ACCOUNT, publicHex: "a".repeat(64) }), false);

  // Corrupt sign-v1 row fails closed without rotating the identity.
  const e = await attr.enroll({ ...good });
  assert.ok(e, "baseline enroll must succeed");
  await deps.keyStore.set("sign-v1", { garbage: "not-a-keypair" });
  assert.equal(await attr.enroll({ ...good }), null);
  assert.equal(await attr.residence({ ...good, epoch: 1, expiryMs: 2 }), null);
  assert.deepEqual(await deps.keyStore.get("sign-v1"), { garbage: "not-a-keypair" });

  // Unreadable store and missing WebCrypto yield null.
  const unreadable = { get: () => Promise.resolve(undefined), set: () => Promise.resolve(false) };
  const blind = OnyxPorts.createAttributionIdentity({ ...memDeps(), keyStore: unreadable });
  assert.equal(await blind.enroll({ ...good }), null);
  const noSubtle = OnyxPorts.createAttributionIdentity({ ...memDeps(), subtle: null });
  assert.equal(await noSubtle.enroll({ ...good }), null);
  assert.equal(await noSubtle.residence({ ...good, epoch: 1, expiryMs: 2 }), null);
});
