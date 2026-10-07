/* OGW1 group-welcome smoke test — real WebCrypto prepare → open →
   install → seal/open round trip with in-memory stores. Run with:
     node --test elm/groupWelcome.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
require("./ports.js");
const { OnyxPorts } = globalThis;

function memDeps(extra) {
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
    ...(extra || {}),
  };
}

function toB64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function nonzero32() {
  for (;;) {
    const bytes = new Uint8Array(randomBytes(32));
    if (bytes.some((b) => b !== 0)) return bytes;
  }
}

function writeU64be(epoch) {
  const out = Buffer.alloc(8);
  out.writeUInt32BE(Math.floor(epoch / 4294967296), 0);
  out.writeUInt32BE(epoch >>> 0, 4);
  return out;
}

/* Independent oracle for the OGCMT2 epoch-key commitment. */
function expectedCommitment(room, epoch, commitId, membership, epochKey) {
  const material = Buffer.concat([
    Buffer.from("ONYX-OGCMT2-EPOCH-KEY-v1", "utf8"),
    Buffer.from([0]),
    Buffer.from(room.trim().toLowerCase(), "utf8"),
    writeU64be(epoch),
    Buffer.from(commitId),
    Buffer.from(membership),
    Buffer.from(epochKey),
  ]);
  return createHash("sha256").update(material).digest();
}

const FIELDS = {
  room: "#secure",
  fromAccount: "alice",
  fromDevice: "phone",
  toAccount: "bob",
  toDevice: "laptop",
  epoch: 3,
};

async function setup() {
  const deps = memDeps();
  const recipientE2ee = OnyxPorts.createE2ee(deps);
  const recipientRooms = OnyxPorts.createRoomCrypto(deps);
  const senderWelcome = OnyxPorts.createGroupWelcome(deps);
  const recipientWelcome = OnyxPorts.createGroupWelcome({
    ...deps,
    devicePrivateKey: async () => (await recipientE2ee.deviceKeys()).privateKey,
    roomProvision: (room, epoch, raw) => recipientRooms.provisionRoomKey(room, epoch, raw),
  });
  const encB64 = await recipientE2ee.devicePublicB64();
  assert.ok(encB64, "recipient ECDH key must exist");
  return { deps, recipientE2ee, recipientRooms, senderWelcome, recipientWelcome, encB64 };
}

function prepareInput(encB64, commitId, membership, epochKey) {
  return {
    ...FIELDS,
    commitIdB64: toB64url(commitId),
    membershipB64: toB64url(membership),
    epochKeyB64: toB64url(epochKey),
    recipientWrapB64: encB64,
  };
}

test("prepare → open → install → seal/open round trip", async () => {
  const { recipientRooms, senderWelcome, recipientWelcome, encB64 } = await setup();
  const commitId = nonzero32();
  const membership = nonzero32();
  const epochKey = nonzero32();

  const prepared = await senderWelcome.prepareWelcome(prepareInput(encB64, commitId, membership, epochKey));
  assert.equal(prepared.ok, true, "prepare must succeed: " + prepared.reason);
  assert.match(prepared.wire, /^[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(prepared.wire.replace(/-/g, "+").replace(/_/g, "/"), "base64").length, 207);

  const decoded = recipientWelcome.decodeEnvelope(prepared.wire);
  assert.ok(decoded, "envelope must decode structurally");
  assert.equal(decoded.ephemeral.length, 65);

  const commitment = await recipientWelcome.computeCommitment(FIELDS.room, FIELDS.epoch, commitId, membership, epochKey);
  assert.deepEqual(Buffer.from(commitment), expectedCommitment(FIELDS.room, FIELDS.epoch, commitId, membership, epochKey));

  const opened = await recipientWelcome.openAndInstall({
    ...FIELDS,
    commitIdB64: toB64url(commitId),
    membershipB64: toB64url(membership),
    commitmentB64: toB64url(commitment),
    welcomeB64: prepared.wire,
  });
  assert.deepEqual(opened, { ok: true, room: FIELDS.room, epoch: FIELDS.epoch });

  // The installed epoch key seals: proof the keyring holds it.
  const sealed = await recipientRooms.sealRoomMessage(FIELDS.room, "hello group");
  assert.equal(sealed.ok, true);
  const back = await recipientRooms.openRoomMessage(FIELDS.room, sealed.envelope);
  assert.equal(back.ok, true);
  assert.equal(back.plaintext, "hello group");
});

test("ODD1-wrapped recipient key opens too", async () => {
  const { senderWelcome, recipientWelcome, encB64 } = await setup();
  const signer = nonzero32();
  const enc = Buffer.from(encB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const odd1 = toB64url(Buffer.concat([Buffer.from("ODD1", "utf8"), Buffer.from([1]), Buffer.from(signer), enc]));
  const commitId = nonzero32();
  const membership = nonzero32();
  const epochKey = nonzero32();

  const prepared = await senderWelcome.prepareWelcome(prepareInput(odd1, commitId, membership, epochKey));
  assert.equal(prepared.ok, true);

  const commitment = await recipientWelcome.computeCommitment(FIELDS.room, FIELDS.epoch, commitId, membership, epochKey);
  const opened = await recipientWelcome.openAndInstall({
    ...FIELDS,
    commitIdB64: toB64url(commitId),
    membershipB64: toB64url(membership),
    commitmentB64: toB64url(commitment),
    welcomeB64: prepared.wire,
  });
  assert.equal(opened.ok, true);
});

test("tampered envelope, wrong commitment, and wrong room fail closed", async () => {
  const { senderWelcome, recipientWelcome, encB64 } = await setup();
  const commitId = nonzero32();
  const membership = nonzero32();
  const epochKey = nonzero32();
  const prepared = await senderWelcome.prepareWelcome(prepareInput(encB64, commitId, membership, epochKey));
  assert.equal(prepared.ok, true);
  const commitment = await recipientWelcome.computeCommitment(FIELDS.room, FIELDS.epoch, commitId, membership, epochKey);
  const base = {
    ...FIELDS,
    commitIdB64: toB64url(commitId),
    membershipB64: toB64url(membership),
    commitmentB64: toB64url(commitment),
    welcomeB64: prepared.wire,
  };

  const last = prepared.wire[prepared.wire.length - 1];
  const flip = last === "A" ? "B" : "A";
  const tampered = await recipientWelcome.openAndInstall({ ...base, welcomeB64: prepared.wire.slice(0, -1) + flip });
  assert.equal(tampered.ok, false);

  const wrongCommitment = await recipientWelcome.openAndInstall({ ...base, commitmentB64: toB64url(nonzero32()) });
  assert.deepEqual([wrongCommitment.ok, wrongCommitment.reason], [false, "commitment-mismatch"]);

  const wrongRoom = await recipientWelcome.openAndInstall({ ...base, room: "#other" });
  assert.deepEqual([wrongRoom.ok, wrongRoom.reason], [false, "welcome-open-failed"]);

  const badShape = await recipientWelcome.openAndInstall({ ...base, welcomeB64: "bm90LW9nZ3cx" });
  assert.deepEqual([badShape.ok, badShape.reason], [false, "invalid-welcome"]);
});

test("missing recipient key stays locked", async () => {
  const deps = memDeps();
  const senderWelcome = OnyxPorts.createGroupWelcome(deps);
  const lockedWelcome = OnyxPorts.createGroupWelcome({ ...deps, devicePrivateKey: async () => null });
  const recipientE2ee = OnyxPorts.createE2ee(deps);
  const encB64 = await recipientE2ee.devicePublicB64();
  const commitId = nonzero32();
  const membership = nonzero32();
  const epochKey = nonzero32();
  const prepared = await senderWelcome.prepareWelcome(prepareInput(encB64, commitId, membership, epochKey));
  assert.equal(prepared.ok, true);
  const out = await lockedWelcome.openAndInstall({
    ...FIELDS,
    commitIdB64: toB64url(commitId),
    membershipB64: toB64url(membership),
    commitmentB64: toB64url(nonzero32()),
    welcomeB64: prepared.wire,
  });
  assert.deepEqual([out.ok, out.reason], [false, "recipient-key-unavailable"]);
});
