/* Upload + preview bridge smoke test — multipart `file` field POST,
   bounded error/oversize responses, same-origin preview boundary,
   and the preview query shape, all against local HTTP servers.
   Run with:
     node --test elm/uploadBridge.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";

// Hermetic loopback: sandbox proxy env (with an empty no_proxy) would
// otherwise route 127.0.0.1 through the proxy and hang the servers.
// Undici honors the bypass list per request, so setting it here suffices.
process.env.no_proxy = "127.0.0.1,localhost";
process.env.NO_PROXY = "127.0.0.1,localhost";

const require = createRequire(import.meta.url);
require("./ports.js");
const { uploadBridge } = globalThis.OnyxPorts;

assert.equal(uploadBridge.maxBytes, 65536);

function serve(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("binary")));
  });
}

test("posts the file field as multipart and returns the JSON url", async () => {
  const { server, origin } = await serve(async (req, res) => {
    assert.equal(req.method, "POST");
    const body = await readBody(req);
    assert.match(body, /name="file"; filename="a.png"/);
    assert.match(body, /PNG-DATA/);
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ path: "/uploads/a.png" }));
  });
  try {
    const file = new File(["PNG-DATA"], "a.png", { type: "image/png" });
    const outcome = await uploadBridge.send(file, `${origin}/upload`, "file");
    assert.equal(outcome.ok, true);
    assert.equal(outcome.status, 201);
    assert.match(outcome.contentType, /application\/json/);
    assert.deepEqual(JSON.parse(outcome.body), { path: "/uploads/a.png" });
  } finally {
    server.close();
  }
});

test("non-2xx uploads report status without a body", async () => {
  const { server, origin } = await serve(async (req, res) => {
    res.writeHead(413, { "content-type": "text/plain" });
    res.end("too big");
  });
  try {
    const outcome = await uploadBridge.send(new Blob(["x"]), `${origin}/upload`, "file");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 413);
    assert.equal(outcome.body, "");
  } finally {
    server.close();
  }
});

test("oversize bodies fail closed", async () => {
  const { server, origin } = await serve(async (req, res) => {
    res.writeHead(200, {
      "content-type": "application/json",
      "content-length": String(70000),
    });
    res.end(JSON.stringify({ url: "/uploads/a.png" }));
  });
  try {
    const outcome = await uploadBridge.send(new Blob(["x"]), `${origin}/upload`, "file");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.body, "");
  } finally {
    server.close();
  }
});

test("preview fetches the same-origin endpoint with the url query", async () => {
  const { server, origin } = await serve(async (req, res) => {
    assert.match(req.url, /^\/linkpreview\?url=https%3A%2F%2Fexample\.test%2Fa$/);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ title: "Example", url: "https://example.test/a" }));
  });
  try {
    const outcome = await uploadBridge.preview(
      `${origin}/linkpreview`,
      "https://example.test/a",
      undefined,
      origin
    );
    assert.equal(outcome.ok, true);
    assert.equal(JSON.parse(outcome.body).title, "Example");
  } finally {
    server.close();
  }
});

test("preview refuses cross-origin endpoints", async () => {
  const outcome = await uploadBridge.preview(
    "https://evil.example/linkpreview",
    "https://example.test/a",
    undefined,
    "http://127.0.0.1:9"
  );
  assert.equal(outcome.ok, false);
});
