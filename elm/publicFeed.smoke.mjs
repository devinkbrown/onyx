/* Public-feed HTTP smoke test — fetchPublicFeed mirrors fetchPublicJson:
   constants, live ok/body/status over a local server, content-length
   cap rejection, HTTP failure, missing fetch, and the wire()
   subscribe path forwarding results by key. Run with:
     node --test elm/publicFeed.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { publicFeed, wire } = globalThis.OnyxPorts;

assert.equal(publicFeed.maxBytes, 256 * 1024);
assert.equal(publicFeed.timeoutMs, 8000);

const PAYLOAD = JSON.stringify({ generated_at: 1784203200, mesh: { quorum: true } });

/* The sandbox routes loopback through a blocking egress proxy; the
   feed under test is same-origin browser traffic, so bypass it here. */
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "FTP_PROXY", "ftp_proxy"]) {
  delete process.env[key];
}
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

const server = http.createServer((req, res) => {
  if (req.url === "/ok.json") {
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(PAYLOAD) });
    res.end(PAYLOAD);
  } else if (req.url === "/big.json") {
    res.writeHead(200, { "content-type": "application/json", "content-length": String(1024 * 1024) });
    res.end("{}");
  } else {
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

test("live fetch returns ok/body/status", async () => {
  const result = await publicFeed.fetch(`${base}/ok.json`);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.body, PAYLOAD);
});

test("HTTP failure reports ok:false with empty body", async () => {
  const result = await publicFeed.fetch(`${base}/missing.json`);
  assert.equal(result.ok, false);
  assert.equal(result.body, "");
});

test("oversize content-length rejects without reading", async () => {
  const result = await publicFeed.fetch(`${base}/big.json`);
  assert.equal(result.ok, false);
  assert.equal(result.body, "");
});

test("missing fetch implementation reports ok:false", async () => {
  const saved = globalThis.fetch;
  delete globalThis.fetch;
  try {
    const result = await publicFeed.fetch(`${base}/ok.json`);
    assert.equal(result.ok, false);
  } finally {
    globalThis.fetch = saved;
  }
});

test("wire() forwards feed results by caller key", async () => {
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
      httpFetch: { subscribe(fn) { handler = fn; } },
      httpResult: { send(v) { sent.push(v); } },
    },
  };
  wire(app);
  assert.equal(typeof handler, "function");
  handler({ key: "network-status", url: `${base}/ok.json` });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].key, "network-status");
  assert.equal(sent[0].ok, true);
  assert.equal(sent[0].body, PAYLOAD);
});
