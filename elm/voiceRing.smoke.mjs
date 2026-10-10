/* v3/calls-c6 smoke — DM ring commands, classified failures and the
   mini-view position bridge are headless-verifiable in node:
     - voiceRing routes start/accept/reject/hangup to a mounted engine;
       without an engine a start feeds the failed outcome (never a
       phantom ring) and an accept feeds `acceptFailed` on the ring;
     - getUserMedia error names classify to permission / no_device;
     - voicePipSave writes `onyx:voice-pip-position` and the stored
       value is replayed through voicePipLoaded.
   Run with: node --test elm/voiceRing.smoke.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setTimeout } from "node:timers/promises";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire, voiceErrorKind, voiceFeed } = globalThis.OnyxPorts;

function stub() {
  return { subscribe() {} };
}

function corePorts() {
  return {
    wsConnect: stub(), wsSend: stub(), wsClose: stub(), vaultPut: stub(), vaultGet: stub(),
    passkeyCreate: stub(), passkeyGet: stub(), passkeySettleRequest: stub(),
    dmSealRequest: stub(), dmOpenRequest: stub(), dmPublishKey: stub(),
    roomSealRequest: stub(), roomOpenRequest: stub(), groupControlInstall: stub(),
    groupDirectoryDerive: stub(), clipboardCopy: stub(), clipboardResult: { send() {} },
  };
}

function ringApp(sent, loaded) {
  const handlers = {};
  return {
    handlers,
    app: {
      ports: {
        ...corePorts(),
        voiceJoin: { subscribe(fn) { handlers.join = fn; } },
        voiceRing: { subscribe(fn) { handlers.ring = fn; } },
        voicePipSave: { subscribe(fn) { handlers.pipSave = fn; } },
        voicePipLoaded: { send(v) { loaded.push(v); } },
        voiceCallHub: { send(v) { sent.push(v); } },
      },
    },
  };
}

function memStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

test("start without an engine feeds the failed outcome", () => {
  const sent = [];
  const { handlers, app } = ringApp(sent, []);
  wire(app);
  handlers.ring({ verb: "start", peer: "mara" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].state, "idle");
  assert.equal(sent[0].outcome, "failed");
});

test("accept without an engine reports acceptFailed on the ring", () => {
  const sent = [];
  const { handlers, app } = ringApp(sent, []);
  wire(app);
  handlers.ring({ verb: "accept", peer: "mara" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].state, "ringing_in");
  assert.equal(sent[0].nick, "mara");
  assert.equal(sent[0].acceptFailed, true);
});

test("reject / hangup without an engine no-op", () => {
  const sent = [];
  const { handlers, app } = ringApp(sent, []);
  wire(app);
  handlers.ring({ verb: "reject", peer: "mara" });
  handlers.ring({ verb: "hangup", peer: "mara" });
  handlers.ring(null);
  assert.equal(sent.length, 0);
});

test("ring verbs route to a mounted engine", async () => {
  const sent = [];
  const calls = [];
  const { handlers, app } = ringApp(sent, []);
  globalThis.window = {
    OnyxVoiceEngine: {
      subscribe() {},
      startCall(nick, kind) { calls.push(["start", nick, kind]); return null; },
      acceptIncomingCall() { calls.push(["accept"]); return Promise.reject(new Error("no")); },
      rejectCall(nick) { calls.push(["reject", nick]); },
      hangup(nick) { calls.push(["hangup", nick]); },
    },
  };
  try {
    wire(app);
    handlers.ring({ verb: "start", peer: "mara" });
    handlers.ring({ verb: "accept", peer: "mara" });
    handlers.ring({ verb: "reject", peer: "mara" });
    handlers.ring({ verb: "hangup", peer: "mara" });
    await setTimeout(10);
  } finally {
    delete globalThis.window;
  }
  assert.deepEqual(calls, [["start", "mara", "voice"], ["accept"], ["reject", "mara"], ["hangup", "mara"]]);
  assert.equal(sent.length, 1, "the rejected accept reports back");
  assert.equal(sent[0].acceptFailed, true);
});

test("join failures carry a classified errorKind", async () => {
  const sent = [];
  const { handlers, app } = ringApp(sent, []);
  globalThis.window = {
    OnyxVoiceEngine: {
      subscribe() {},
      joinVoice() {
        const err = new Error("denied");
        err.name = "NotAllowedError";
        return Promise.reject(err);
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
  assert.equal(sent[0].outcome, "failed");
  assert.equal(sent[0].errorKind, "permission");
});

test("error names classify per spec §2.15", () => {
  assert.equal(voiceErrorKind({ name: "NotAllowedError" }), "permission");
  assert.equal(voiceErrorKind({ name: "SecurityError" }), "permission");
  assert.equal(voiceErrorKind({ name: "NotFoundError" }), "no_device");
  assert.equal(voiceErrorKind({ name: "OverconstrainedError" }), "no_device");
  assert.equal(voiceErrorKind({ name: "AbortError" }), "other");
  assert.equal(voiceErrorKind(null), "other");
});

test("ring fields ride non-idle snapshots", () => {
  const step = voiceFeed.next(voiceFeed.blank(), { state: "ringing_in", nick: "mara", acceptFailed: true }, 5);
  assert.equal(step.snapshot.acceptFailed, true);
  const idle = voiceFeed.next(voiceFeed.blank(), { state: "idle", joinFailed: true, errorKind: "no_device" }, 5);
  assert.equal(idle.snapshot.errorKind, "no_device");
});

test("pip position saves and replays through voicePipLoaded", async () => {
  const storage = memStorage();
  storage.setItem("onyx:voice-pip-position", JSON.stringify({ corner: "top-left", x: 16, y: 32 }));
  const loaded = [];
  const { handlers, app } = ringApp([], loaded);
  globalThis.window = { localStorage: storage };
  try {
    wire(app);
    await setTimeout(10);
    handlers.pipSave({ corner: "bottom-left", x: 48, y: 0 });
  } finally {
    delete globalThis.window;
  }
  assert.deepEqual(loaded, [{ corner: "top-left", x: 16, y: 32 }]);
  assert.deepEqual(JSON.parse(storage.map.get("onyx:voice-pip-position")), { corner: "bottom-left", x: 48, y: 0 });
});

test("oversized or corrupt stored positions are not replayed", async () => {
  const storage = memStorage();
  storage.setItem("onyx:voice-pip-position", "{broken");
  const loaded = [];
  const { app } = ringApp([], loaded);
  globalThis.window = { localStorage: storage };
  try {
    wire(app);
    await setTimeout(10);
  } finally {
    delete globalThis.window;
  }
  assert.deepEqual(loaded, []);
});
