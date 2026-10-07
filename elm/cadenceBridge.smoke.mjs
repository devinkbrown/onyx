/* Cadence binary bridge smoke — socket binary classification plus the
   media send/engine handoff, all with fakes. Run with:
     node --test elm/cadenceBridge.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { OnyxPorts } = globalThis;

const KAT_HEX = "0500000040443322110700000028230000000000000101766f696365";
const MEDIA_PROTOCOL = "onyx.irc-media.v1";
const TEXT_PROTOCOL = "text.ircv3.net";

function katBytes() {
  const out = [];
  for (let i = 0; i < KAT_HEX.length; i += 2) out.push(parseInt(KAT_HEX.slice(i, i + 2), 16));
  return out;
}

function fakeApp(extraPorts) {
  const received = [];
  const ports = {
    mediaBinaryReceived: { send: (msg) => received.push(msg) },
  };
  Object.assign(ports, extraPorts || {});
  return { ports, received };
}

function openSocket(protocol, buffered) {
  return {
    readyState: 1,
    protocol: protocol,
    bufferedAmount: buffered === undefined ? 0 : buffered,
    sent: [],
    send(data) { this.sent.push(data); },
  };
}

test("mediaReceiveRaw forwards KAT bytes on a media protocol", () => {
  const app = fakeApp();
  const buf = new Uint8Array(katBytes()).buffer;
  let closed = null;
  const outcome = OnyxPorts.mediaReceiveRaw(app, buf, MEDIA_PROTOCOL, (c, r) => { closed = [c, r]; });
  assert.equal(outcome, "forwarded");
  assert.equal(closed, null);
  assert.equal(app.received.length, 1);
  assert.deepEqual(app.received[0].bytes, katBytes());
});

test("mediaReceiveRaw leaves text for the line buffer", () => {
  const app = fakeApp();
  let closed = null;
  const outcome = OnyxPorts.mediaReceiveRaw(app, "PING :x", MEDIA_PROTOCOL, () => { closed = true; });
  assert.equal(outcome, "text");
  assert.equal(closed, null);
  assert.equal(app.received.length, 0);
});

test("mediaReceiveRaw closes 1002 on binary over the text subprotocol", () => {
  const app = fakeApp();
  const buf = new Uint8Array(katBytes()).buffer;
  let closed = null;
  const outcome = OnyxPorts.mediaReceiveRaw(app, buf, TEXT_PROTOCOL, (c, r) => { closed = [c, r]; });
  assert.equal(outcome, "closed");
  assert.deepEqual(closed, [1002, "Binary frame on text.ircv3.net"]);
  assert.equal(app.received.length, 0);
});

test("mediaReceiveRaw closes 1009 on oversized frames and drops empties", () => {
  const app = fakeApp();
  const big = new Uint8Array(OnyxPorts.mediaMaxBinaryBytes + 1);
  let closed = null;
  assert.equal(
    OnyxPorts.mediaReceiveRaw(app, big.buffer, MEDIA_PROTOCOL, (c) => { closed = c; }),
    "closed",
  );
  assert.equal(closed, 1009);
  assert.equal(app.received.length, 0);

  const empty = new Uint8Array(0);
  assert.equal(
    OnyxPorts.mediaReceiveRaw(app, empty.buffer, MEDIA_PROTOCOL, () => { closed = "x"; }),
    "dropped",
  );
  assert.equal(closed, 1009);
});

test("mediaReceiveRaw drops without a port", () => {
  const buf = new Uint8Array(katBytes()).buffer;
  assert.equal(OnyxPorts.mediaReceiveRaw({ ports: {} }, buf, MEDIA_PROTOCOL, () => {}), "dropped");
});

test("sendDatagram sends a fresh copy on an admitting socket", () => {
  const socket = openSocket(MEDIA_PROTOCOL);
  const media = OnyxPorts.createMediaBinary({ socket: () => socket, engine: () => null });
  const bytes = katBytes();
  assert.equal(media.sendDatagram(bytes), true);
  assert.equal(socket.sent.length, 1);
  assert.ok(socket.sent[0] instanceof Uint8Array);
  assert.deepEqual(Array.from(socket.sent[0]), bytes);
  assert.notEqual(socket.sent[0], bytes);
});

test("sendDatagram sheds closed, text, full, oversized, and misshapen sends", () => {
  const cases = [
    [{ readyState: 3, protocol: MEDIA_PROTOCOL, bufferedAmount: 0, sent: [], send(d) { this.sent.push(d); } }, katBytes()],
    [openSocket(TEXT_PROTOCOL), katBytes()],
    [openSocket(MEDIA_PROTOCOL, 8 * 1024 * 1024), katBytes()],
    [openSocket(MEDIA_PROTOCOL), new Array(OnyxPorts.mediaMaxBinaryBytes + 1).fill(0)],
    [openSocket(MEDIA_PROTOCOL), [1, 2, 300]],
    [openSocket(MEDIA_PROTOCOL), []],
    [openSocket(MEDIA_PROTOCOL), "nope"],
  ];
  for (const [socket, bytes] of cases) {
    const media = OnyxPorts.createMediaBinary({ socket: () => socket, engine: () => null });
    assert.equal(media.sendDatagram(bytes), false);
    assert.equal(socket.sent ? socket.sent.length : 0, 0);
  }
});

test("deliverToEngine hands a copy to the host hook only", () => {
  const seen = [];
  const engine = { receiveMediaFrame: (b) => seen.push(b) };
  const media = OnyxPorts.createMediaBinary({ socket: () => null, engine: () => engine });
  const bytes = katBytes();
  assert.equal(media.deliverToEngine(bytes), true);
  assert.equal(seen.length, 1);
  assert.deepEqual(Array.from(seen[0]), bytes);
  assert.notEqual(seen[0], bytes);

  const none = OnyxPorts.createMediaBinary({ socket: () => null, engine: () => null });
  assert.equal(none.deliverToEngine(bytes), false);
  const mute = OnyxPorts.createMediaBinary({ socket: () => null, engine: () => ({}) });
  assert.equal(mute.deliverToEngine(bytes), false);
});

test("wireMediaBinary routes both ports and tolerates missing ports", () => {
  const socket = openSocket(MEDIA_PROTOCOL);
  const seen = [];
  const media = OnyxPorts.createMediaBinary({
    socket: () => socket,
    engine: () => ({ receiveMediaFrame: (b) => seen.push(b) }),
  });
  const subs = {};
  const app = { ports: {
    mediaBinarySend: { subscribe: (fn) => { subs.send = fn; } },
    mediaEngineFrame: { subscribe: (fn) => { subs.engine = fn; } },
  } };
  OnyxPorts.wireMediaBinary(app, media);
  subs.send({ bytes: katBytes() });
  assert.equal(socket.sent.length, 1);
  subs.engine({ bytes: katBytes() });
  assert.equal(seen.length, 1);

  assert.doesNotThrow(() => OnyxPorts.wireMediaBinary({ ports: {} }, media));
});
