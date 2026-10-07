/* DM search-scope smoke test — pure mirrors of
   `classifyVaultDmSearchPrivacy`'s row verdict (`row.encrypted ||
   isEncryptedWireText(row.text)`, every retained row scanned, one
   encrypted row keeps the query off the server) plus the
   `vaultClassifyDm` bridge: Elm withholds the query, the host proves
   `plain`/`encrypted`/`unknown`, the user retries.
   Run with:
     node --test elm/dmSearchScope.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const vs = globalThis.OnyxPorts.vaultStore;
const { wire } = globalThis.OnyxPorts;

function row(body, extra) {
  return Object.assign({ id: "r", target: "dave", from: "dave", body, at: 1000 }, extra);
}

test("plain rows prove plain, empty history proves plain", () => {
  assert.equal(vs.classifyDmRows([]), "plain");
  assert.equal(vs.classifyDmRows([row("hello"), row("how are you")]), "plain");
});

test("one encrypted row anywhere proves encrypted", () => {
  assert.equal(vs.classifyDmRows([row("hello"), row("ONYXDM1 ciphertext"), row("bye")]), "encrypted");
  assert.equal(vs.classifyDmRows([row("ONYXDMN1 multi")]), "encrypted");
  assert.equal(vs.classifyDmRows([row("ONYXROOM1 room|1|cipher")]), "encrypted");
  assert.equal(vs.classifyDmRows([row("hello", { encrypted: true })]), "encrypted");
  assert.equal(vs.classifyDmRows([row("hello", { text: "ONYXDM1 legacy-field" })]), "encrypted");
});

test("row verdict never mistakes prefixes or shapes", () => {
  assert.equal(vs.dmPrivacyRowEncrypted(row("not ONYXDM1 prefixed")), false);
  assert.equal(vs.dmPrivacyRowEncrypted(row("")), false);
  assert.equal(vs.dmPrivacyRowEncrypted(null), false);
  assert.equal(vs.dmPrivacyRowEncrypted({}), false);
  assert.equal(vs.dmPrivacyRowEncrypted(row("hello", { encrypted: false })), false);
});

test("classify bridge answers through vaultDmPrivacyClassified", () => {
  const stub = () => ({ subscribe() {} });
  let classifyHandler = null;
  const sent = [];
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
      vaultClassifyDm: { subscribe(fn) { classifyHandler = fn; } },
      vaultDmPrivacyClassified: { send(payload) { sent.push(payload); } },
    },
  };
  wire(app);
  assert.ok(classifyHandler, "bridge subscribes");
  // No IndexedDB under node: nothing retained, so the proof is plain.
  classifyHandler({ target: "dave" });
  assert.deepEqual(sent, [{ target: "dave", privacy: "plain" }]);
  // Empty or missing targets never answer.
  classifyHandler({ target: "" });
  classifyHandler(null);
  assert.equal(sent.length, 1);
});
