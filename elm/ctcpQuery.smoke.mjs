/* CTCP query bridge smoke — the owner-keyed `onyx:ctcp-config` slot
   mirrors `ctcpMemory.ts` (verbatim JSON back, 64 KiB cap, bare legacy
   key purges on access, latest owner wins), and the TIME query reply
   sends `NOTICE <to> :\x01TIME <Date>\x01` through the live socket
   with a re-validated target. Run with:
     node --test elm/ctcpQuery.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

function stub() {
  return { subscribe() {} };
}

function ctcpApp(sent) {
  const handlers = {};
  return {
    handlers,
    app: {
      ports: {
        wsConnect: { subscribe(fn) { handlers.wsConnect = fn; } },
        wsSend: stub(),
        wsClose: stub(),
        wsOpened: { send() {} },
        wsClosed: { send() {} },
        wsLines: { send() {} },
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
        clipboardResult: { send() {} },
        ctcpConfigRequest: { subscribe(fn) { handlers.ctcpConfigRequest = fn; } },
        ctcpConfigLoaded: { send(v) { sent.push(["config", v]); } },
        ctcpTimeReply: { subscribe(fn) { handlers.ctcpTimeReply = fn; } },
      },
    },
  };
}

test("config loads resolve null without storage; missing ports stay silent", () => {
  const sent = [];
  const { app, handlers } = ctcpApp(sent);
  wire(app);
  assert.equal(typeof handlers.ctcpConfigRequest, "function");
  assert.equal(typeof handlers.ctcpTimeReply, "function");
  handlers.ctcpConfigRequest({ serverUrl: "wss://irc.example", identity: "kai" });
  handlers.ctcpConfigRequest({ serverUrl: "", identity: "kai" });
  assert.deepEqual(sent, [["config", null]]);
  handlers.ctcpTimeReply({ to: "bob" });
  handlers.ctcpTimeReply({ to: "bad nick" });
  handlers.ctcpTimeReply({ to: "" });
  handlers.ctcpTimeReply(null);
  wire({
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
      clipboardCopy: stub(),
      clipboardResult: { send() {} },
    },
  });
});

test("config round-trips verbatim, purges legacy, caps oversize", () => {
  const store = new Map();
  const realWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem(k) { const v = store.get(k); return v === undefined ? null : v; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); },
    },
  };
  try {
    const sent = [];
    const { app, handlers } = ctcpApp(sent);
    wire(app);
    store.set("onyx:ctcp-config", '{"versionReply":"legacy","timeEnabled":true}');
    const ownerKey = "onyx:ctcp-config:owner:" + encodeURIComponent(JSON.stringify(["wss://irc.example", "kai"]));
    store.set(ownerKey, '{"versionReply":"Custom build","timeEnabled":false}');
    handlers.ctcpConfigRequest({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.deepEqual(sent, [["config", { versionReply: "Custom build", timeEnabled: false }]]);
    assert.equal(store.has("onyx:ctcp-config"), false);
    store.set(ownerKey, "{not json");
    handlers.ctcpConfigRequest({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.deepEqual(sent[1], ["config", null]);
    store.set(ownerKey, "x".repeat(64 * 1024 + 1));
    handlers.ctcpConfigRequest({ serverUrl: "wss://irc.example", identity: "kai" });
    assert.deepEqual(sent[2], ["config", null]);
  } finally {
    if (realWindow === undefined) delete globalThis.window;
    else globalThis.window = realWindow;
  }
});

test("TIME reply sends a well-formed NOTICE over the live socket", () => {
  class FakeSocket {
    constructor() { this.readyState = FakeSocket.OPEN; }
    addEventListener() {}
    send(line) { FakeSocket.sent.push(line); }
    close() {}
  }
  FakeSocket.OPEN = 1;
  FakeSocket.sent = [];
  const realWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket;
  try {
    const sent = [];
    const { app, handlers } = ctcpApp(sent);
    wire(app);
    handlers.wsConnect({ url: "wss://irc.example" });
    handlers.ctcpTimeReply({ to: "bob" });
    assert.equal(FakeSocket.sent.length, 1);
    const line = FakeSocket.sent[0];
    assert.match(line, /^NOTICE bob :\x01TIME .+\x01\r\n$/);
    handlers.ctcpTimeReply({ to: "bad nick" });
    handlers.ctcpTimeReply({ to: ":server" });
    handlers.ctcpTimeReply({ to: "a".repeat(257) });
    assert.equal(FakeSocket.sent.length, 1);
  } finally {
    if (realWebSocket === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = realWebSocket;
  }
});
