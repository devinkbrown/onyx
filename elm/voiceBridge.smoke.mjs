/* Voice bridge + passkey-support smoke — the engine command direction is
   headless-verifiable in node: without `window.OnyxVoiceEngine` a join feeds
   the joinFailed snapshot (never a phantom call) and leave/mute no-op; with
   a fake engine the commands route to it. passkeySupport is reported once
   at wire() time. Run with:
     node --test elm/voiceBridge.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setTimeout } from "node:timers/promises";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

function stub() {
  return { subscribe() {} };
}

/* wire() owns the socket/vault core, so every harness provides the core
   stub set (mirroring clipboard.smoke.mjs) plus the ports under test. */
function corePorts() {
  return {
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
  };
}

function voiceApp(capture) {
  const handlers = {};
  return {
    handlers,
    app: {
      ports: {
        ...corePorts(),
        voiceJoin: { subscribe(fn) { handlers.join = fn; } },
        voiceLeave: { subscribe(fn) { handlers.leave = fn; } },
        voiceMute: { subscribe(fn) { handlers.mute = fn; } },
        voiceCallHub: { send(v) { capture.push(v); } },
      },
    },
  };
}

test("join without an engine feeds the failed outcome, never a phantom call", () => {
  const sent = [];
  const { handlers, app } = voiceApp(sent);
  wire(app);
  handlers.join({ channel: "#c", video: false });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].state, "idle");
  assert.equal(sent[0].outcome, "failed");
});

test("blank join channel sends nothing", () => {
  const sent = [];
  const { handlers, app } = voiceApp(sent);
  wire(app);
  handlers.join({ channel: "", video: false });
  handlers.join(null);
  assert.equal(sent.length, 0);
});

test("leave and mute without an engine no-op without crashing", () => {
  const sent = [];
  const { handlers, app } = voiceApp(sent);
  wire(app);
  handlers.leave({ channel: "#c" });
  handlers.mute({ muted: true });
  assert.equal(sent.length, 0);
});

test("commands route to a mounted engine, rejections fail closed", async () => {
  const sent = [];
  const calls = [];
  const { handlers, app } = voiceApp(sent);
  globalThis.window = {
    OnyxVoiceEngine: {
      subscribe() {},
      joinVoice(channel, opts) {
        calls.push(["join", channel, opts]);
        return null;
      },
      leaveRoom(channel) {
        calls.push(["leave", channel]);
      },
      setMuted(muted) {
        calls.push(["mute", muted]);
      },
    },
  };
  try {
    wire(app);
    handlers.join({ channel: "#c", video: true });
    handlers.leave({ channel: "#c" });
    handlers.mute({ muted: true });
  } finally {
    delete globalThis.window;
  }
  assert.deepEqual(calls, [
    ["join", "#c", { video: true }],
    ["leave", "#c"],
    ["mute", true],
  ]);
  assert.equal(sent.length, 0);
});

test("rejecting engine join feeds joinFailed", async () => {
  const sent = [];
  const { handlers, app } = voiceApp(sent);
  globalThis.window = {
    OnyxVoiceEngine: {
      subscribe() {},
      joinVoice() {
        return Promise.reject(new Error("nope"));
      },
    },
  };
  try {
    wire(app);
    handlers.join({ channel: "#c", video: false });
    await setTimeout(10);
  } finally {
    delete globalThis.window;
  }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].state, "idle");
  assert.equal(sent[0].outcome, "failed");
});

test("passkeySupport is reported once at wire time", () => {
  const sent = [];
  const app = { ports: { ...corePorts(), passkeySupport: { send(v) { sent.push(v); } } } };
  wire(app);
  assert.deepEqual(sent, [{ supported: false }]);
});

test("wire without the passkeySupport port does not crash", () => {
  wire({ ports: { ...corePorts() } });
});
