/* Group device-publisher identity smoke test — real WebCrypto projection
   (Ed25519 `sign-v1` read-or-create, ECDH `dm-v1` pairing, `ogc1-…`
   derivation) with in-memory stores. Run with:
     node --test elm/groupPublisher.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

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

function fromB64url(text) {
  return new Uint8Array(Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
}

/* Independent oracle for the device id: node:crypto over
   "ONYX-OGC1-DEVICE-ID-v1" || 0x00 || "ODD1" || 0x01 || signer || enc. */
function expectedDeviceId(signer, enc) {
  const domain = Buffer.from("ONYX-OGC1-DEVICE-ID-v1", "utf8");
  const magic = Buffer.from("ODD1", "utf8");
  const material = Buffer.concat([domain, Buffer.from([0]), magic, Buffer.from([1]), Buffer.from(signer), Buffer.from(enc)]);
  return "ogc1-" + createHash("sha256").update(material).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 22);
}

const FIXED_SIGNER = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
const FIXED_ENC = new Uint8Array(65);
FIXED_ENC[0] = 0x04;
for (let i = 1; i < 65; i++) FIXED_ENC[i] = (i * 13 + 1) & 0xff;

test("deriveDeviceId matches the independent sha256 vector", async () => {
  const pub = OnyxPorts.createGroupPublisherIdentity(memDeps());
  const got = await pub.deriveDeviceId(FIXED_SIGNER, FIXED_ENC);
  assert.equal(got, expectedDeviceId(FIXED_SIGNER, FIXED_ENC));
  assert.match(got, /^ogc1-[A-Za-z0-9_-]{22}$/);
});

test("project() pairs sign-v1 with the live dm-v1 key and is stable", async () => {
  const deps = memDeps();
  const sharedKeys = deps.keyStore;
  const e2ee = OnyxPorts.createE2ee({ ...deps, keyStore: sharedKeys });
  const encB64 = await e2ee.devicePublicB64();
  assert.ok(encB64, "ECDH device key must exist");

  const pub = OnyxPorts.createGroupPublisherIdentity({
    ...deps,
    keyStore: sharedKeys,
    ecdhPublicB64: () => e2ee.devicePublicB64(),
  });
  const first = await pub.project();
  assert.ok(first, "projection must succeed");
  assert.equal(fromB64url(first.signerPub).length, 32);
  assert.deepEqual(Array.from(fromB64url(first.encryptionPub)), Array.from(fromB64url(encB64)));
  assert.equal(first.deviceId, expectedDeviceId(fromB64url(first.signerPub), fromB64url(first.encryptionPub)));

  // A second factory over the same store reads the existing pair: the
  // device id is stable, never rotated.
  const pub2 = OnyxPorts.createGroupPublisherIdentity({
    ...deps,
    keyStore: sharedKeys,
    ecdhPublicB64: () => e2ee.devicePublicB64(),
  });
  const second = await pub2.project();
  assert.equal(second.deviceId, first.deviceId);
  assert.equal(second.signerPub, first.signerPub);

  // Both key records coexist in the one `device` store.
  assert.ok(await sharedKeys.get("dm-v1"), "dm-v1 survives");
  assert.ok(await sharedKeys.get("sign-v1"), "sign-v1 persisted");
});

test("corrupt sign-v1 row fails closed without rotating", async () => {
  const deps = memDeps();
  const e2ee = OnyxPorts.createE2ee(deps);
  const mk = (extra) =>
    OnyxPorts.createGroupPublisherIdentity({
      ...deps,
      ...(extra || {}),
      ecdhPublicB64: () => e2ee.devicePublicB64(),
    });
  const good = await mk().project();
  assert.ok(good, "baseline projection must succeed");

  await deps.keyStore.set("sign-v1", { garbage: "not-a-keypair" });
  assert.equal(await mk().project(), null);

  // The corrupt row is untouched: still corrupt, not replaced.
  assert.deepEqual(await deps.keyStore.get("sign-v1"), { garbage: "not-a-keypair" });
});

test("unreadable store and missing ECDH yield null", async () => {
  const deps = memDeps();
  const e2ee = OnyxPorts.createE2ee(deps);
  const unreadable = {
    get: () => Promise.resolve(undefined),
    set: () => Promise.resolve(false),
  };
  const pub = OnyxPorts.createGroupPublisherIdentity({
    ...deps,
    keyStore: unreadable,
    ecdhPublicB64: () => e2ee.devicePublicB64(),
  });
  assert.equal(await pub.project(), null);

  const noEcdh = OnyxPorts.createGroupPublisherIdentity({ ...deps, ecdhPublicB64: () => Promise.resolve(null) });
  assert.equal(await noEcdh.project(), null);

  const noSubtle = OnyxPorts.createGroupPublisherIdentity({ ...deps, subtle: null });
  assert.equal(await noSubtle.project(), null);
});
