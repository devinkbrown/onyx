/* Account data verbs smoke — the `accountDownload` bridge mirrors the
   saved-searches blob-anchor download (custom filename honored, headless
   node swallows the DOM path), and `deviceHistoryCopyRequest` dumps the
   vault snapshot back as rows with the request seq echoed. Headless node
   has no IndexedDB vault, so the rows answer is the empty snapshot.
   Run with:
     node --test elm/accountData.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

function stub() {
  return { subscribe() {}, send() {} };
}

function stubApp(overrides) {
  return { ports: Object.assign(
    {
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
      clipboardCopy: stub(),
      clipboardResult: stub(),
    },
    overrides
  ) };
}

function capturePort() {
  let handler = null;
  return {
    port: { subscribe(fn) { handler = fn; } },
    fire(payload) { handler(payload); },
    get wired() { return handler !== null; },
  };
}

test("accountDownload subscribes and tolerates headless node", () => {
  const download = capturePort();
  wire(stubApp({ accountDownload: download.port }));
  assert.equal(download.wired, true);
  download.fire({ filename: "onyx-account-record-kai-2026-01-02.json", json: "{}\n" });
});

test("deviceHistoryCopyRequest echoes the seq with empty-snapshot rows", async () => {
  const request = capturePort();
  const sent = [];
  wire(
    stubApp({
      deviceHistoryCopyRequest: request.port,
      deviceHistoryCopyRows: { send(v) { sent.push(v); } },
    })
  );
  assert.equal(request.wired, true);
  request.fire({ seq: 3 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].seq, 3);
  assert.equal(typeof sent[0].exportedAt, "string");
  assert.deepEqual(JSON.parse(sent[0].json), []);
});
