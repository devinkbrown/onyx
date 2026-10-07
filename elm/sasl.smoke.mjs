/* SASL ports smoke test — PLAIN UTF-8 blob, SCRAM-SHA-256 exchange, and
   failure paths, cross-checked against an independent node:crypto
   implementation (not the oracle's bytes).
   Run with:
     node --test elm/sasl.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { sasl } = globalThis.OnyxPorts;

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const ub64 = (str) => Buffer.from(str, "utf8").toString("base64");

test("timeout mirrors the oracle 15s guard", () => {
  assert.equal(sasl.timeoutMs, 15000);
});

test("PLAIN blob is UTF-8 \\0nick\\0pass and refused without a password", () => {
  sasl.setCredentials("alice", "pässwörd", false);
  assert.equal(
    sasl.plainPayload("alice"),
    ub64("\0alice\0pässwörd"),
    "must match Buffer UTF-8 base64, not Latin-1 btoa"
  );
  sasl.setCredentials("alice", "", false);
  assert.equal(sasl.plainPayload("alice"), null);
  sasl.clearCredentials();
  assert.equal(sasl.plainPayload("alice"), null);
});

/* Independent SCRAM-SHA-256 client-final, straight from the RFC
   construction (PBKDF2 -> ClientKey/StoredKey/ServerKey, proof xor). */
function independentFinal({ password, clientBare, serverFirst }) {
  const attrs = Object.fromEntries(
    serverFirst.split(",").map((atom) => [atom[0], atom.slice(2)])
  );
  const salt = Buffer.from(attrs.s, "base64");
  const iterations = parseInt(attrs.i, 10);
  const salted = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = crypto.createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = crypto.createHash("sha256").update(clientKey).digest();
  const nonce = attrs.r;
  const withoutProof = `c=biws,r=${nonce}`;
  const authMessage = `${clientBare},${serverFirst},${withoutProof}`;
  const clientSig = crypto.createHmac("sha256", storedKey).update(authMessage).digest();
  const proof = Buffer.alloc(clientKey.length);
  for (let i = 0; i < proof.length; i++) proof[i] = clientKey[i] ^ clientSig[i];
  const serverKey = crypto.createHmac("sha256", salted).update("Server Key").digest();
  const serverSig = crypto.createHmac("sha256", serverKey).update(authMessage).digest();
  return { final: `${withoutProof},p=${b64(proof)}`, serverSig: b64(serverSig), nonce };
}

test("SCRAM full exchange matches the independent computation", async () => {
  sasl.setCredentials("user", "pencil", false);
  const first = sasl.scramFirst("user");
  assert.match(first.bare, /^n=user,r=[A-Za-z0-9\-_]+$/);
  assert.equal(Buffer.from(first.payload, "base64").toString("utf8"), `n,,${first.bare}`);

  const clientNonce = first.bare.split("r=")[1];
  const serverFirst = `r=${clientNonce}3rfcNHYJY1ZVvWVs7j,s=${b64(crypto.randomBytes(16))},i=4096`;
  const want = independentFinal({ password: "pencil", clientBare: first.bare, serverFirst });

  const out = await sasl.scramNext(ub64(serverFirst));
  assert.equal(out.kind, "send");
  assert.equal(Buffer.from(out.payload, "base64").toString("utf8"), want.final);

  const good = sasl.scramVerify(ub64(`v=${want.serverSig}`));
  assert.deepEqual(good, { kind: "verified" });

  const bad = sasl.scramVerify(ub64("v=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="));
  assert.equal(bad.kind, "fail");
  assert.match(bad.reason, /server signature mismatch/);
});

test("SCRAM fails closed on hostile challenges", async () => {
  sasl.setCredentials("user", "pencil", false);

  const noExchange = await sasl.scramNext(ub64("r=x,s=eA==,i=4096"));
  assert.equal(noExchange.kind, "fail");

  sasl.scramFirst("user");
  const badB64 = await sasl.scramNext("!!not-base64!!");
  assert.equal(badB64.kind, "fail");
  assert.match(badB64.reason, /invalid challenge encoding/);

  const first = sasl.scramFirst("user");
  const clientNonce = first.bare.split("r=")[1];
  const wrongNonce = await sasl.scramNext(ub64(`r=wrong,s=${b64(crypto.randomBytes(8))},i=4096`));
  assert.equal(wrongNonce.kind, "fail");
  assert.match(wrongNonce.reason, /server nonce mismatch/);
  assert.ok(!clientNonce.includes("wrong"));

  const first2 = sasl.scramFirst("user");
  const nonce2 = first2.bare.split("r=")[1];
  const serverFirst2 = `r=${nonce2}extra,s=${b64(crypto.randomBytes(8))},i=4096`;
  const ok = await sasl.scramNext(ub64(serverFirst2));
  assert.equal(ok.kind, "send");
  const rejected = sasl.scramVerify(ub64("e=invalid-proof"));
  assert.equal(rejected.kind, "fail");
  assert.match(rejected.reason, /server rejected proof/);
});

test("constant-time compare is length-strict", () => {
  assert.equal(sasl.equal("abc", "abc"), true);
  assert.equal(sasl.equal("abc", "abd"), false);
  assert.equal(sasl.equal("abc", "ab"), false);
});
