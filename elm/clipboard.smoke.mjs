/* Clipboard smoke test — invite-link copy mirrors writeClipboardText:
   empty text reports false with no DOM touch, headless node (no
   navigator/document) reports false gracefully, and the wire()
   subscribe path forwards the echoed { tag, ok } to clipboardResult.
   Run with:
     node --test elm/clipboard.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { clipboard, wire } = globalThis.OnyxPorts;

test("empty text reports false without touching the DOM", async () => {
  assert.equal(await clipboard.copy(""), false);
  assert.equal(await clipboard.copy(null), false);
});

test("without a clipboard API or document reports false gracefully", async () => {
  assert.equal(globalThis.navigator && globalThis.navigator.clipboard, undefined);
  assert.equal(await clipboard.copy("https://onyx.example/invite/?join=%23general"), false);
  assert.equal(clipboard.legacyCopy("https://onyx.example/invite/?join=%23general"), false);
});

test("wire() forwards the copy result to clipboardResult", async () => {
  let handler = null;
  const sent = [];
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
      clipboardCopy: { subscribe(fn) { handler = fn; } },
      clipboardResult: { send(v) { sent.push(v); } },
    },
  };
  wire(app);
  assert.equal(typeof handler, "function");
  handler({ text: "", tag: "invite" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(sent, [{ tag: "invite", ok: false }]);
  handler({ text: "https://onyx.example/invite/?join=%23general", tag: "dl:hash-linux" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(sent, [
    { tag: "invite", ok: false },
    { tag: "dl:hash-linux", ok: false },
  ]);
});
