/* v3/calls-c4 — call-media bridge smoke (calls C4 + C5).
   - Tile binding: Elm renders `<video data-voice-tile="{id}">`
     placeholders; ports.js binds each to its MediaStream (pushed local
     stream, engine screen stream, or the peer's decode canvas via
     captureStream), rebinding on DOM mutations and stream changes.
   - The ONE `voiceCommand` port: camera / share / deafen / pip route to
     the engine and every outcome comes back as an engine-confirmed
     snapshot field on `voiceCallHub`.
   - The `voicePeerState` feed: per-peer flags, sanitised, cleared idle.
   Run with:
     node --test elm/voiceTiles.smoke.mjs
   (from the repo root). Needs the repo jsdom devDependency. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire, voiceTiles } = globalThis.OnyxPorts;

const stub = () => ({ subscribe() {}, send() {} });

function fakeStream(label) {
  return { label, getTracks() { return []; } };
}

function harness(engine, extra = {}) {
  const dom = new JSDOM("<!DOCTYPE html><html><body><main id=root></main></body></html>", { pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  if (engine) dom.window.OnyxVoiceEngine = engine;
  const hub = [];
  const peers = [];
  const handlers = {};
  const ports = {
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
    voiceCallHub: { send(v) { hub.push(v); } },
    voicePeerState: { send(v) { peers.push(v); } },
    voiceCommand: { subscribe(fn) { handlers.command = fn; } },
    ...extra,
  };
  wire({ ports });
  return { dom, hub, peers, handlers };
}

function cleanup(dom) {
  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function addVideo(dom, tile) {
  const video = dom.window.document.createElement("video");
  video.setAttribute("data-voice-tile", tile);
  dom.window.document.getElementById("root").appendChild(video);
  return video;
}

function engineWith(overrides = {}) {
  const engine = {
    feed: null,
    calls: [],
    subscribe(fn) { engine.feed = fn; },
    ...overrides,
  };
  return engine;
}

test("binds the pushed local stream to the self tile and clears it", async () => {
  const engine = engineWith();
  const { dom } = harness(engine);
  try {
    const self = addVideo(dom, "self");
    const local = fakeStream("local");
    engine.feed({ localStream: local });
    await tick();
    assert.equal(self.srcObject, local);
    assert.equal(self.muted, true);
    assert.equal(self.getAttribute("data-bound"), "true");
    engine.feed({ localStream: null });
    await tick();
    assert.equal(self.srcObject, null);
    assert.equal(self.getAttribute("data-bound"), "false");
  } finally {
    cleanup(dom);
  }
});

test("binds tiles Elm adds later: peer canvas capture and screen stream", async () => {
  const captured = fakeStream("mara-cam");
  const screen = fakeStream("kit-screen");
  const canvas = { captureStream() { return captured; } };
  const engine = engineWith({
    getPeers() {
      return new Map([
        ["Mara", { nick: "Mara", canvas }],
        ["Kit", { nick: "Kit", canvas: null }],
      ]);
    },
    getScreenStream(nick) { return nick === "Kit" ? screen : null; },
  });
  const { dom } = harness(engine);
  try {
    const mara = addVideo(dom, "peer:mara");
    const kit = addVideo(dom, "screen:kit");
    const ghost = addVideo(dom, "peer:ghost");
    await tick();
    assert.equal(mara.srcObject, captured);
    assert.equal(kit.srcObject, screen);
    assert.equal(ghost.srcObject || null, null);
    // Re-keying an element rebinds it (Elm reuses the node).
    mara.setAttribute("data-voice-tile", "screen:kit");
    await tick();
    assert.equal(mara.srcObject, screen);
  } finally {
    cleanup(dom);
  }
});

test("explicit tile streams win over engine fallbacks", async () => {
  const engine = engineWith({ getScreenStream() { return fakeStream("engine"); } });
  const { dom } = harness(engine);
  try {
    const share = addVideo(dom, "screen:mara");
    const pushed = fakeStream("pushed");
    engine.feed({ stream: { tile: "screen:mara", media: pushed } });
    await tick();
    assert.equal(share.srcObject, pushed);
  } finally {
    cleanup(dom);
  }
});

test("resolver is null without an engine or a known tile", () => {
  assert.equal(voiceTiles.resolve("peer:mara", null, null), null);
  assert.equal(voiceTiles.resolve("", null, {}), null);
  assert.equal(voiceTiles.resolve("weird", null, { getPeers() { return new Map(); } }), null);
});

test("camera command routes to the engine and reports the confirmed flag", async () => {
  const calls = [];
  const engine = engineWith({
    startCamera(channel) { calls.push(["start", channel]); return Promise.resolve(); },
    stopCamera() { calls.push(["stop"]); },
  });
  const { dom, hub, handlers } = harness(engine);
  try {
    engine.feed({ state: "in_call", nick: "", channel: "#harbor" });
    handlers.command({ verb: "camera", on: true, channel: "#harbor", tile: "" });
    await tick();
    handlers.command({ verb: "camera", on: false, channel: "#harbor", tile: "" });
    assert.deepEqual(calls, [["start", "#harbor"], ["stop"]]);
    const flags = hub.filter((s) => "camera" in s).map((s) => [s.state, s.channel, s.camera]);
    assert.deepEqual(flags, [["in_call", "#harbor", true], ["in_call", "#harbor", false]]);
    // The first in_call snapshot carries the browser capabilities.
    assert.equal(hub[0].shareSupported, false);
    assert.equal(hub[0].pipSupported, false);
  } finally {
    cleanup(dom);
  }
});

test("a rejected camera start reports camera off; idle drops reports", async () => {
  const engine = engineWith({ startCamera() { return Promise.reject(new Error("denied")); } });
  const { dom, hub, handlers } = harness(engine);
  try {
    handlers.command({ verb: "camera", on: true, channel: "#harbor", tile: "" });
    await tick();
    assert.equal(hub.length, 0, "no call, nothing to confirm");
    engine.feed({ state: "in_call", channel: "#harbor" });
    handlers.command({ verb: "camera", on: true, channel: "#harbor", tile: "" });
    await tick();
    assert.equal(hub.at(-1).camera, false);
  } finally {
    cleanup(dom);
  }
});

test("share without getDisplayMedia is refused; with it the engine confirms", async () => {
  const started = [];
  const engine = engineWith({
    startScreenShare(channel) { started.push(channel); return Promise.resolve(); },
    stopScreenShare() { return undefined; },
  });
  const { dom, hub, handlers } = harness(engine);
  const hadNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    engine.feed({ state: "in_call", channel: "#harbor" });
    handlers.command({ verb: "share", on: true, channel: "#harbor", tile: "" });
    let last = hub.at(-1);
    assert.equal(last.screen, false);
    assert.equal(last.screenError, true);
    assert.deepEqual(started, []);

    Object.defineProperty(globalThis, "navigator", {
      value: { mediaDevices: { getDisplayMedia() {} } },
      configurable: true,
      writable: true,
    });
    handlers.command({ verb: "share", on: true, channel: "#harbor", tile: "" });
    await tick();
    last = hub.at(-1);
    assert.equal(last.screen, true);
    assert.deepEqual(started, ["#harbor"]);
    handlers.command({ verb: "share", on: false, channel: "#harbor", tile: "" });
    await tick();
    assert.equal(hub.at(-1).screen, false);
  } finally {
    if (hadNavigator) Object.defineProperty(globalThis, "navigator", hadNavigator);
    cleanup(dom);
  }
});

test("stopping a share without an engine stop verb stays honest", async () => {
  const engine = engineWith();
  const { dom, hub, handlers } = harness(engine);
  try {
    engine.feed({ state: "in_call", channel: "#harbor" });
    handlers.command({ verb: "share", on: false, channel: "#harbor", tile: "" });
    assert.equal(hub.at(-1).screen, true);
  } finally {
    cleanup(dom);
  }
});

test("deafen routes to setDeafened and reports the confirmed flag", async () => {
  const seen = [];
  const engine = engineWith({ setDeafened(on) { seen.push(on); } });
  const { dom, hub, handlers } = harness(engine);
  try {
    engine.feed({ state: "in_call", channel: "#harbor" });
    handlers.command({ verb: "deafen", on: true, channel: "#harbor", tile: "" });
    assert.deepEqual(seen, [true]);
    assert.equal(hub.at(-1).deafened, true);
  } finally {
    cleanup(dom);
  }
});

test("pip command asks the matching tile video for Picture-in-Picture", async () => {
  const engine = engineWith();
  const { dom, handlers } = harness(engine);
  try {
    const other = addVideo(dom, "peer:jun");
    const target = addVideo(dom, "peer:mara");
    let asked = null;
    other.requestPictureInPicture = () => { asked = "jun"; return Promise.resolve(); };
    target.requestPictureInPicture = () => { asked = "mara"; return Promise.resolve(); };
    handlers.command({ verb: "pip", on: true, channel: "", tile: "peer:mara" });
    assert.equal(asked, "mara");
  } finally {
    cleanup(dom);
  }
});

test("peer events feed voicePeerState sanitised, idle clears them", () => {
  const engine = engineWith();
  const { dom, peers } = harness(engine);
  try {
    engine.feed({ state: "in_call", channel: "#harbor" });
    engine.feed({ peer: { nick: "Mara", kind: "video", hasVideo: true, speaking: "yes", muted: false, canvas: {}, quality: 7 } });
    engine.feed({ peer: { nick: "Kit", kind: "screen", hasVideo: true } });
    engine.feed({ peer: { nick: "", kind: "video" } });
    assert.deepEqual(peers.at(-1), {
      peers: [
        { nick: "Mara", kind: "video", hasVideo: true, speaking: false, muted: false, videoPaused: false },
        { nick: "Kit", kind: "screen", hasVideo: true, speaking: false, muted: false, videoPaused: false },
      ],
    });
    engine.feed({ peerLeft: "kit" });
    assert.deepEqual(peers.at(-1).peers.map((p) => p.nick), ["Mara"]);
    engine.feed({ state: "idle" });
    assert.deepEqual(peers.at(-1), { peers: [] });
  } finally {
    cleanup(dom);
  }
});

test("snapshot forwards local media fields only when present", () => {
  const blank = globalThis.OnyxPorts.voiceFeed.blank();
  const bare = globalThis.OnyxPorts.voiceFeed.next(blank, { state: "in_call", channel: "#c" }, 5);
  assert.equal("qualityTier" in bare.snapshot, false);
  assert.equal("camera" in bare.snapshot, false);
  const rich = globalThis.OnyxPorts.voiceFeed.next(blank, { state: "in_call", channel: "#c", qualityTier: 3, camera: true, screen: false }, 5);
  assert.equal(rich.snapshot.qualityTier, 3);
  assert.equal(rich.snapshot.camera, true);
  assert.equal(rich.snapshot.screen, false);
});
