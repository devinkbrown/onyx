/* Mooring DM crypto smoke test — real WebCrypto interop between two
   ports.js E2EE instances with in-memory stores. Run with:
     node --test elm/e2ee.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { OnyxPorts } = globalThis;

function memDeps() {
  return {
    keyStore: OnyxPorts.memKV(),
    pinStore: OnyxPorts.memKV(),
    subtle: globalThis.crypto.subtle,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    random: (n) => {
      const bytes = new Uint8Array(n);
      globalThis.crypto.getRandomValues(bytes);
      return bytes;
    },
  };
}

async function pubOf(e2ee) {
  const pub = await e2ee.devicePublicB64();
  assert.ok(pub, "device key must exist");
  return pub;
}

test("seal/open round-trips both directions with open-then-pin", async () => {
  const a = OnyxPorts.createE2ee(memDeps());
  const b = OnyxPorts.createE2ee(memDeps());
  const aPub = await pubOf(a);
  const bPub = await pubOf(b);

  const sealed = await a.sealToDevices("b", [bPub], "hello b");
  assert.equal(sealed.status, "sealed");
  assert.ok(sealed.envelope.startsWith("ONYXDM1 "));

  const opened = await b.openFrom("a", aPub, sealed.envelope);
  assert.equal(opened.status, "opened");
  assert.equal(opened.plaintext, "hello b");

  // And back: history replay derives identically in both directions.
  const back = await b.sealToDevices("a", [aPub], "hello a");
  assert.equal(back.status, "sealed");
  const backOpen = await a.openFrom("b", bPub, back.envelope);
  assert.equal(backOpen.status, "opened");
  assert.equal(backOpen.plaintext, "hello a");
});

test("safety numbers agree across directions and registry ids are stable", async () => {
  const a = OnyxPorts.createE2ee(memDeps());
  const b = OnyxPorts.createE2ee(memDeps());
  const aPub = await pubOf(a);
  const bPub = await pubOf(b);

  const ab = await a.safetyFor(aPub, [bPub]);
  const ba = await b.safetyFor(bPub, [aPub]);
  assert.ok(ab && ba);
  assert.equal(ab, ba, "order-independent conversation number");
  assert.match(ab, /^(\d{5} ){11}\d{5}$/);

  const id1 = await a.registryId(aPub);
  const id2 = await a.registryId(aPub);
  assert.equal(id1, id2);
  assert.ok(id1.startsWith("web-") && id1.length <= 32);
  assert.notEqual(id1, await b.registryId(bPub));
});

test("rotated peer key blocks with key-changed, never plaintext", async () => {
  const a = OnyxPorts.createE2ee(memDeps());
  const b = OnyxPorts.createE2ee(memDeps());
  const b2 = OnyxPorts.createE2ee(memDeps());
  const aPub = await pubOf(a);
  const bPub = await pubOf(b);
  const b2Pub = await pubOf(b2);
  assert.notEqual(bPub, b2Pub);

  // First contact pins b's key on a's side.
  const first = await a.sealToDevices("b", [bPub], "first");
  assert.equal(first.status, "sealed");

  // A seal naming the rotated key is refused outright.
  const rotated = await a.sealToDevices("b", [b2Pub], "mallory?");
  assert.equal(rotated.status, "key-changed");
  assert.ok(!rotated.envelope);

  // An envelope opened under the rotated key stays locked as key-changed.
  const forged = await b2.sealToDevices("a", [aPub], "forged");
  assert.equal(forged.status, "sealed");
  const open = await a.openFrom("b", b2Pub, forged.envelope);
  assert.equal(open.status, "locked");
  assert.equal(open.reason, "key-changed");
  assert.ok(!open.plaintext);
});

test("pins are namespaced per device-memory owner", async () => {
  const a = OnyxPorts.createE2ee(memDeps());
  const b = OnyxPorts.createE2ee(memDeps());
  const bPub = await pubOf(b);
  const alice = { serverUrl: "wss://irc.example", identity: "alice" };
  const mallory = { serverUrl: "wss://irc.example", identity: "mallory" };

  // Alice's first use pins b's key under her namespace.
  const first = await a.sealToDevices("b", [bPub], "hi", alice);
  assert.equal(first.status, "sealed");

  // Mallory's namespace is independent: same peer nick starts unpinned.
  const other = await a.sealToDevices("b", [bPub], "hi", mallory);
  assert.equal(other.status, "sealed");

  // A rotated key under Alice's namespace still reports key-changed.
  const c = OnyxPorts.createE2ee(memDeps());
  const cPub = await pubOf(c);
  assert.notEqual(bPub, cPub);
  const rotated = await a.sealToDevices("b", [cPub], "mallory?", alice);
  assert.equal(rotated.status, "key-changed");

  // An invalid owner fails closed instead of touching shared pins.
  const bad = await a.sealToDevices("b", [bPub], "hi", { serverUrl: "", identity: "alice" });
  assert.equal(bad.status, "unavailable");
  const badOpen = await a.openFrom("b", bPub, first.envelope, { serverUrl: "wss://irc.example", identity: "" });
  assert.equal(badOpen.status, "locked");
  assert.equal(badOpen.reason, "unavailable");
});

test("multi-device fan-out opens on every device", async () => {
  const a = OnyxPorts.createE2ee(memDeps());
  const b1 = OnyxPorts.createE2ee(memDeps());
  const b2 = OnyxPorts.createE2ee(memDeps());
  const aPub = await pubOf(a);
  const b1Pub = await pubOf(b1);
  const b2Pub = await pubOf(b2);

  const sealed = await a.sealToDevices("b", [b1Pub, b2Pub], "hello devices");
  assert.equal(sealed.status, "sealed");
  assert.ok(sealed.envelope.startsWith("ONYXDMN1 "));

  for (const [b, pub] of [[b1, b1Pub], [b2, b2Pub]]) {
    const opened = await b.openFrom("a", aPub, sealed.envelope);
    assert.equal(opened.status, "opened");
    assert.equal(opened.plaintext, "hello devices");
  }
});

test("room seal/open round-trips under the active epoch", async () => {
  const rooms = OnyxPorts.createRoomCrypto({
    subtle: globalThis.crypto.subtle,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    random: (n) => {
      const bytes = new Uint8Array(n);
      globalThis.crypto.getRandomValues(bytes);
      return bytes;
    },
  });
  const keyBytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(keyBytes);
  assert.equal(await rooms.provisionRoomKey("#room", 1, keyBytes), true);

  const sealed = await rooms.sealRoomMessage("#room", "hello room");
  assert.equal(sealed.ok, true);
  assert.ok(sealed.envelope.startsWith("ONYXROOM1 "));

  // Structural check: version 1, epoch 1 u32be, 12-byte nonce follow.
  const body = Buffer.from(sealed.envelope.slice("ONYXROOM1 ".length).replace(/-/g, "+").replace(/_/g, "/"), "base64");
  assert.equal(body[0], 1);
  assert.equal(body.readUInt32BE(1), 1);
  assert.equal(body.length, 5 + 12 + Buffer.byteLength("hello room") + 16);

  const opened = await rooms.openRoomMessage("#room", sealed.envelope);
  assert.equal(opened.ok, true);
  assert.equal(opened.plaintext, "hello room");
});

test("room crypto fails closed across rooms, epochs, and tampering", async () => {
  const rooms = OnyxPorts.createRoomCrypto({
    subtle: globalThis.crypto.subtle,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    random: (n) => {
      const bytes = new Uint8Array(n);
      globalThis.crypto.getRandomValues(bytes);
      return bytes;
    },
  });
  const keyBytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(keyBytes);
  await rooms.provisionRoomKey("#room", 1, keyBytes);

  // Unprovisioned room: nothing seals, nothing opens.
  assert.equal((await rooms.sealRoomMessage("#other", "x")).ok, false);
  assert.equal((await rooms.sealRoomMessage("#other", "x")).reason, "session-not-provisioned");

  const sealed = await rooms.sealRoomMessage("#room", "secret");
  assert.equal(sealed.ok, true);

  // AAD binds the room: opening as another room fails.
  await rooms.provisionRoomKey("#other", 1, keyBytes);
  assert.equal((await rooms.openRoomMessage("#other", sealed.envelope)).ok, false);

  // Tampered envelope fails.
  const tampered = sealed.envelope.slice(0, -4) + "AAAA";
  const open = await rooms.openRoomMessage("#room", tampered);
  assert.equal(open.ok, false);
  assert.equal(open.reason, "undecryptable");

  // Old epochs stay openable after rotation; seals use the newest.
  const key2 = new Uint8Array(32);
  globalThis.crypto.getRandomValues(key2);
  await rooms.provisionRoomKey("#room", 2, key2);
  const sealed2 = await rooms.sealRoomMessage("#room", "second");
  assert.equal(sealed2.ok, true);
  const body2 = Buffer.from(sealed2.envelope.slice("ONYXROOM1 ".length).replace(/-/g, "+").replace(/_/g, "/"), "base64");
  assert.equal(body2.readUInt32BE(1), 2);
  assert.equal((await rooms.openRoomMessage("#room", sealed.envelope)).plaintext, "secret");
  assert.equal((await rooms.openRoomMessage("#room", sealed2.envelope)).plaintext, "second");

  // Empty and oversize plaintext never seal.
  assert.equal((await rooms.sealRoomMessage("#room", "")).ok, false);
  assert.equal((await rooms.sealRoomMessage("#room", "x".repeat(3032))).ok, false);
});

test("tampered envelopes and garbage keys fail locked", async () => {
  const a = OnyxPorts.createE2ee(memDeps());
  const b = OnyxPorts.createE2ee(memDeps());
  const aPub = await pubOf(a);
  const bPub = await pubOf(b);

  const sealed = await a.sealToDevices("b", [bPub], "secret");
  assert.equal(sealed.status, "sealed");
  const tampered = sealed.envelope.slice(0, -4) + "AAAA";
  const open = await b.openFrom("a", aPub, tampered);
  assert.equal(open.status, "locked");
  assert.equal(open.reason, "undecryptable");

  assert.equal((await b.openFrom("a", "AAAA", sealed.envelope)).status, "locked");
  assert.equal((await a.sealToDevices("b", ["AAAA"], "x")).status, "unavailable");
  assert.equal((await a.sealToDevices("b", [], "x")).status, "unavailable");
});

/* OGC1 control-record verification: build a signed envelope with real
   Ed25519, then exercise the ports verifier. Layout mirrors
   GroupControl.buildGroupControlTranscript. */
function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function u8(str) {
  return new TextEncoder().encode(str);
}

function controlTranscript(routing, kind, epoch, body, signerPub) {
  const domain = u8("ONYX-GROUP-CONTROL-v2");
  const f = [u8(routing.channel), u8(routing.fromAccount), u8(routing.fromDevice), u8(routing.toAccount), u8(routing.toDevice)];
  const out = new Uint8Array(
    domain.length + 1 + 1 + f[1].length + 1 + f[0].length + 1 + 1 + f[2].length + 1 + f[3].length + 1 + f[4].length + 1 + 4 + 2 + body.length + signerPub.length
  );
  let o = 0;
  out.set(domain, o); o += domain.length;
  out[o++] = 0;
  out[o++] = f[1].length; out.set(f[1], o); o += f[1].length;
  out[o++] = f[0].length; out.set(f[0], o); o += f[0].length;
  out[o++] = kind;
  out[o++] = f[2].length; out.set(f[2], o); o += f[2].length;
  out[o++] = f[3].length; out.set(f[3], o); o += f[3].length;
  out[o++] = f[4].length; out.set(f[4], o); o += f[4].length;
  out[o++] = 2;
  out[o++] = (epoch >>> 24) & 0xff; out[o++] = (epoch >>> 16) & 0xff;
  out[o++] = (epoch >>> 8) & 0xff; out[o++] = epoch & 0xff;
  out[o++] = (body.length >>> 8) & 0xff; out[o++] = body.length & 0xff;
  out.set(body, o); o += body.length;
  out.set(signerPub, o);
  return out;
}

async function signedControl({ kind, epoch, body, routing, version = 2 }) {
  const subtle = globalThis.crypto.subtle;
  const kp = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const signerPub = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  const transcript = controlTranscript(routing, kind, epoch, body, signerPub);
  const signature = new Uint8Array(await subtle.sign({ name: "Ed25519" }, kp.privateKey, transcript));
  const raw = new Uint8Array(108 + body.length);
  raw.set([0x4f, 0x47, 0x43, 0x31], 0);
  raw[4] = version;
  raw[5] = kind;
  raw[6] = (epoch >>> 24) & 0xff; raw[7] = (epoch >>> 16) & 0xff;
  raw[8] = (epoch >>> 8) & 0xff; raw[9] = epoch & 0xff;
  raw[10] = (body.length >>> 8) & 0xff; raw[11] = body.length & 0xff;
  raw.set(body, 12);
  raw.set(signerPub, 12 + body.length);
  raw.set(signature, 12 + body.length + 32);
  return { payload: b64url(raw), signerB64: b64url(signerPub), epoch, kind };
}

const CONTROL_ROUTING = { channel: "#secure", fromAccount: "alice", fromDevice: "phone", toAccount: "", toDevice: "" };

function controlReq(signed, kindName, overrides = {}) {
  return {
    channel: "#secure",
    kind: kindName,
    fromAccount: "alice",
    fromDevice: "phone",
    toAccount: null,
    toDevice: null,
    payload: signed.payload,
    epoch: signed.epoch,
    signerB64: signed.signerB64,
    localAccount: "me",
    endpoint: "wss://irc.example",
    ...overrides,
  };
}

function pinDeps() {
  return {
    subtle: globalThis.crypto.subtle,
    TextEncoder: globalThis.TextEncoder,
    pinStore: OnyxPorts.memKV(),
  };
}

test("control-record signature verifies over a real Ed25519 envelope", async () => {
  const gc = OnyxPorts.createGroupControlVerify({ subtle: globalThis.crypto.subtle, TextEncoder: globalThis.TextEncoder });
  const signed = await signedControl({ kind: 3, epoch: 7, body: u8("commit-body"), routing: CONTROL_ROUTING });
  const verdict = await gc.verifyDelivery(controlReq(signed, "commit"));
  assert.equal(verdict.signatureValid, true);
  assert.equal(verdict.epoch, 7);
  assert.equal(verdict.signerB64, signed.signerB64);
  assert.equal(verdict.channel, "#secure");
  assert.equal(verdict.kind, "commit");
  assert.equal(verdict.payload, signed.payload);
  assert.equal(verdict.fromAccount, "alice");
  assert.equal(verdict.fromDevice, "phone");
});

test("control-record verification fails closed on tampering and garbage", async () => {
  const gc = OnyxPorts.createGroupControlVerify({ subtle: globalThis.crypto.subtle, TextEncoder: globalThis.TextEncoder });
  const signed = await signedControl({ kind: 3, epoch: 7, body: u8("commit-body"), routing: CONTROL_ROUTING });

  // Tampered body keeps its shape but breaks the signature.
  const raw = Buffer.from(signed.payload.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  raw[12] ^= 0x01;
  const tampered = { ...signed, payload: b64url(new Uint8Array(raw)) };
  assert.equal((await gc.verifyDelivery(controlReq(tampered, "commit"))).signatureValid, false);

  // Routing is bound into the transcript: a different channel fails.
  assert.equal((await gc.verifyDelivery(controlReq(signed, "commit", { channel: "#other" }))).signatureValid, false);

  // Kind and epoch must agree with the envelope.
  assert.equal((await gc.verifyDelivery(controlReq(signed, "welcome"))).signatureValid, false);
  assert.equal((await gc.verifyDelivery(controlReq(signed, "commit", { epoch: 8 }))).signatureValid, false);

  // Garbage, legacy versions, and structural violations never verify.
  assert.equal((await gc.verifyDelivery(controlReq(signed, "commit", { payload: "not+base64url" }))).signatureValid, false);
  const legacy = await signedControl({ kind: 3, epoch: 7, body: u8("commit-body"), routing: CONTROL_ROUTING, version: 1 });
  assert.equal((await gc.verifyDelivery(controlReq(legacy, "commit"))).signatureValid, false);
  assert.equal(gc.parseOgc1("AQIDBA"), null);
  assert.equal(gc.parseOgc1(""), null);
});

/* ODD1 derivation: strict re-decode plus the SHA-256 device id, all
   against real generated keys. */
async function odd1Entry() {
  const subtle = globalThis.crypto.subtle;
  const enc = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const encryptionPub = new Uint8Array(await subtle.exportKey("raw", enc.publicKey));
  const sig = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const signerPub = new Uint8Array(await subtle.exportKey("raw", sig.publicKey));
  const raw = new Uint8Array(102);
  raw.set([0x4f, 0x44, 0x44, 0x31], 0);
  raw[4] = 1;
  raw.set(signerPub, 5);
  raw.set(encryptionPub, 37);
  return { raw, signerB64: b64url(signerPub), publicKey: b64url(raw) };
}

async function expectedDeviceId(raw) {
  const domain = new TextEncoder().encode("ONYX-OGC1-DEVICE-ID-v1");
  const material = new Uint8Array(domain.length + 1 + raw.length);
  material.set(domain, 0);
  material[domain.length] = 0;
  material.set(raw, domain.length + 1);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", material));
  return "ogc1-" + b64url(digest).slice(0, 22);
}

test("directory derivation trusts only derived-id matches", async () => {
  const dir = OnyxPorts.createGroupDirectory({ subtle: globalThis.crypto.subtle, TextEncoder: globalThis.TextEncoder });
  const entry = await odd1Entry();
  const deviceId = await expectedDeviceId(entry.raw);

  const verdict = await dir.deriveSnapshot({
    account: "alice",
    rows: [{ deviceId, publicKey: entry.publicKey }],
  });
  assert.equal(verdict.account, "alice");
  assert.equal(verdict.rows.length, 1);
  assert.equal(verdict.rows[0].trusted, true);
  assert.equal(verdict.rows[0].directoryKey, entry.signerB64);
  assert.equal(verdict.rows[0].derivedId, deviceId);

  // Advertised id mismatch keeps the strict key but withholds trust.
  const mismatch = await dir.deriveSnapshot({
    account: "alice",
    rows: [{ deviceId: "ogc1-wrong", publicKey: entry.publicKey }],
  });
  assert.equal(mismatch.rows[0].trusted, false);
  assert.equal(mismatch.rows[0].directoryKey, entry.signerB64);
});

test("directory derivation fails closed on bad keys and over-cap snapshots", async () => {
  const dir = OnyxPorts.createGroupDirectory({ subtle: globalThis.crypto.subtle, TextEncoder: globalThis.TextEncoder });
  const entry = await odd1Entry();
  const deviceId = await expectedDeviceId(entry.raw);

  // Off-curve deterministic point (1, 1): shape-valid, curve-invalid.
  const offCurve = new Uint8Array(entry.raw);
  offCurve.fill(0, 38, 102);
  offCurve[38] = 1;
  offCurve[101] = 1;
  assert.equal(dir.isValidP256(offCurve.slice(37, 102)), false);

  // Zero signer.
  const zeroSigner = new Uint8Array(entry.raw);
  zeroSigner.fill(0, 5, 37);

  for (const bad of [b64url(offCurve), b64url(zeroSigner), "AQIDBA", ""]) {
    const verdict = await dir.deriveSnapshot({ account: "alice", rows: [{ deviceId, publicKey: bad }] });
    assert.equal(verdict.rows.length, 1);
    assert.equal(verdict.rows[0].trusted, false);
    assert.equal(verdict.rows[0].directoryKey, null);
    assert.equal(verdict.rows[0].derivedId, null);
  }

  // Over-cap snapshots resolve to no rows rather than truncating.
  const many = Array.from({ length: 65 }, () => ({ deviceId, publicKey: entry.publicKey }));
  assert.deepEqual((await dir.deriveSnapshot({ account: "alice", rows: many })).rows, []);
});

test("signer pins first-use, pin, rotate, and forget", async () => {
  const gc = OnyxPorts.createGroupControlVerify(pinDeps());
  const scope = { endpoint: "wss://irc.example", localAccount: "me" };
  const signed = await signedControl({ kind: 3, epoch: 7, body: u8("commit-body"), routing: CONTROL_ROUTING });

  // First use pins, the same signer stays pinned.
  assert.equal((await gc.verifyDelivery(controlReq(signed, "commit"))).trust, "first-use");
  assert.equal((await gc.verifyDelivery(controlReq(signed, "commit"))).trust, "pinned");

  // A rotated signer on the same owner reports key-changed and keeps the old pin.
  const other = await signedControl({ kind: 3, epoch: 8, body: u8("commit-body"), routing: CONTROL_ROUTING });
  assert.equal((await gc.verifyDelivery(controlReq(other, "commit"))).trust, "key-changed");
  assert.equal((await gc.verifyDelivery(controlReq(signed, "commit"))).trust, "pinned");

  // Forgetting tombstones the owner: even the original signer is refused, without re-pinning.
  assert.equal(await gc.forgetSigner(scope, "alice", "phone"), true);
  assert.equal((await gc.verifyDelivery(controlReq(signed, "commit"))).trust, "device-absent");
  assert.equal((await gc.verifyDelivery(controlReq(signed, "commit"))).trust, "device-absent");

  // Missing identity closes the store without touching it.
  const noIdent = controlReq(signed, "commit", { localAccount: "" });
  assert.equal((await gc.verifyDelivery(noIdent)).trust, "store-unavailable");
});

test("invalid signatures never touch pins", async () => {
  const store = OnyxPorts.memKV();
  const gc = OnyxPorts.createGroupControlVerify({ subtle: globalThis.crypto.subtle, TextEncoder: globalThis.TextEncoder, pinStore: store });
  const signed = await signedControl({ kind: 3, epoch: 7, body: u8("commit-body"), routing: CONTROL_ROUTING });

  // Tampered first: rejected with no pin created, so the valid retry still first-uses.
  const raw = Buffer.from(signed.payload.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  raw[12] ^= 0x01;
  const tampered = { ...signed, payload: b64url(new Uint8Array(raw)) };
  assert.equal((await gc.verifyDelivery(controlReq(tampered, "commit"))).trust, "unverified");
  assert.equal((await gc.verifyDelivery(controlReq(signed, "commit"))).trust, "first-use");

  // A corrupt stored row closes the store instead of trusting or pinning.
  await store.set(["wss://irc.example", "me", "alice", "phone"].join("\u0000"), "garbage");
  assert.equal((await gc.verifyDelivery(controlReq(signed, "commit"))).trust, "store-unavailable");
});

test("wire bridge flags seal-time key changes, surfaces other failures", async () => {
  const { wire } = OnyxPorts;
  const stub = () => ({ subscribe() {}, send() {} });
  let sealHandler = null;
  const failedSends = [];
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
      dmSealRequest: { subscribe(fn) { sealHandler = fn; } },
      dmSealed: stub(),
      dmSealFailed: { send(v) { failedSends.push(v); } },
      dmOpenRequest: stub(),
      dmPublishKey: stub(),
      roomSealRequest: stub(),
      roomOpenRequest: stub(),
      groupControlInstall: stub(),
      groupDirectoryDerive: stub(),
      clipboardCopy: stub(),
      clipboardResult: stub(),
    },
  };
  wire(app);
  assert.equal(typeof sealHandler, "function");
  // No usable keys: seal is unavailable, so the failure surfaces with
  // keyChanged false (a real rotation reports true at the engine layer,
  // covered by the "rotated peer key" test above).
  sealHandler({ target: "peer", keys: [], plaintext: "hi" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(failedSends, [{ target: "peer", keyChanged: false, schedId: null }]);
});
