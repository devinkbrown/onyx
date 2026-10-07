/* Notify-bridge smoke test — `onyx:followed` persistence, the live
   permission push, `notifyAlert` desktop/sound performance (mirroring
   browser.ts: silent icon Notification, click focuses; 880→660Hz sine
   beep), the permission request round-trip, and the visibility feed.
   Run with:
     node --test elm/notifyAlerts.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

const FOLLOWED_KEY = "onyx:followed";

function memStore(initial) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

function harness({ store, permission = "granted", visibilityState = "visible", focused = true, noNotification = false }) {
  const notes = [];
  const sent = { permission: [], visibility: [] };
  let alertHandler = null;
  let followedHandler = null;
  let permissionRequestHandler = null;
  const audioCalls = [];

  function FakeOsc() {
    this.type = null;
    this.frequency = { setValueAtTime(v) { audioCalls.push("freq"); }, exponentialRampToValueAtTime(v) { audioCalls.push("ramp"); } };
  }
  function FakeGain() {
    this.gain = { setValueAtTime(v) { audioCalls.push("gain"); }, exponentialRampToValueAtTime(v) { audioCalls.push("gainRamp"); } };
  }
  function FakeCtx() {
    this.currentTime = 10;
    this.destination = {};
    this.created = [];
  }
  FakeCtx.prototype.createOscillator = function () { const o = new FakeOsc(); this.created.push("osc"); audioCalls.push("osc"); return o; };
  FakeCtx.prototype.createGain = function () { const g = new FakeGain(); this.created.push("gain"); audioCalls.push("gainNode"); return g; };

  const instances = [];
  function FakeNotification(title, opts) {
    notes.push({ title, opts, closed: false });
    instances.push(this);
    this.close = () => { notes[notes.length - 1].closed = true; };
  }
  FakeNotification.permission = permission;
  FakeNotification.requestPermission = () => Promise.resolve("granted");

  const listeners = {};
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
      guidesProgressRequest: stub(),
      guidesProgressStore: stub(),
      blocklistsSave: stub(),
      followedSave: { subscribe(fn) { followedHandler = fn; } },
      notifyAlert: { subscribe(fn) { alertHandler = fn; } },
      notifyPermissionRequest: { subscribe(fn) { permissionRequestHandler = fn; } },
      notifyPermissionChanged: { send(v) { sent.permission.push(v); } },
      visibilityChanged: { send(v) { sent.visibility.push(v); } },
    },
  };
  const fakeWindow = {
    localStorage: store,
    AudioContext: FakeCtx,
    focused: false,
    focus() { fakeWindow.focused = true; },
    addEventListener(name, fn) { listeners[name] = fn; },
  };
  if (!noNotification) fakeWindow.Notification = FakeNotification;
  globalThis.window = fakeWindow;
  globalThis.document = {
    visibilityState,
    hasFocus: () => focused,
    addEventListener(name, fn) { listeners["doc:" + name] = fn; },
  };
  wire(app);
  return { alertHandler, followedHandler, permissionRequestHandler, sent, notes, instances, audioCalls, listeners, fakeWindow };
}

function cleanup() {
  delete globalThis.window;
  delete globalThis.document;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("wire pushes the live permission and visibility at once", async () => {
  try {
    const h = harness({ store: memStore({}) });
    assert.deepEqual(h.sent.permission, ["granted"]);
    assert.deepEqual(h.sent.visibility, [{ visible: true, focused: true }]);
  } finally {
    cleanup();
  }
});

test("unsupported platform reports unsupported", async () => {
  try {
    const h = harness({ store: memStore({}), noNotification: true });
    assert.deepEqual(h.sent.permission, ["unsupported"]);
  } finally {
    cleanup();
  }
});

test("followed saves persist the validated key list", async () => {
  try {
    const store = memStore({});
    const h = harness({ store });
    h.followedHandler({ keys: ["#c", "#c/dev"] });
    assert.equal(store.data[FOLLOWED_KEY], JSON.stringify(["#c", "#c/dev"]));
    h.followedHandler({ keys: "nope" });
    assert.equal(store.data[FOLLOWED_KEY], JSON.stringify(["#c", "#c/dev"]));
  } finally {
    cleanup();
  }
});

test("granted desktop alerts render silent and focus on click", async () => {
  try {
    const h = harness({ store: memStore({}) });
    h.alertHandler({ title: "t", body: "b", tag: "onyx-#c", desktop: true, sound: false, volume: 0.5 });
    assert.equal(h.notes.length, 1);
    assert.equal(h.notes[0].opts.silent, true);
    assert.equal(h.notes[0].opts.tag, "onyx-#c");
    assert.equal(h.notes[0].opts.icon, "/icon-192.png");
    assert.equal(h.fakeWindow.focused, false);
    h.instances[0].onclick();
    assert.equal(h.fakeWindow.focused, true);
    assert.equal(h.notes[0].closed, true);
  } finally {
    cleanup();
  }
});

test("denied permission suppresses desktop but sound still beeps", async () => {
  try {
    const h = harness({ store: memStore({}), permission: "denied" });
    h.alertHandler({ title: "t", body: "b", tag: "onyx-#c", desktop: true, sound: true, volume: 0.5 });
    assert.equal(h.notes.length, 0);
    assert.ok(h.audioCalls.includes("osc"));
  } finally {
    cleanup();
  }
});

test("sound-only alerts skip Notification entirely", async () => {
  try {
    const h = harness({ store: memStore({}) });
    h.alertHandler({ title: "t", body: "b", tag: "onyx-x", desktop: false, sound: true, volume: 0.25 });
    assert.equal(h.notes.length, 0);
    assert.ok(h.audioCalls.includes("osc"));
    assert.ok(h.audioCalls.includes("gainNode"));
  } finally {
    cleanup();
  }
});

test("permission request round-trips the grant", async () => {
  try {
    const h = harness({ store: memStore({}), permission: "default" });
    assert.deepEqual(h.sent.permission, ["default"]);
    h.permissionRequestHandler();
    await wait(10);
    assert.deepEqual(h.sent.permission, ["default", "granted"]);
  } finally {
    cleanup();
  }
});

test("visibilitychange refires the feed", async () => {
  try {
    const h = harness({ store: memStore({}), visibilityState: "hidden", focused: false });
    assert.deepEqual(h.sent.visibility, [{ visible: false, focused: false }]);
    globalThis.document.visibilityState = "visible";
    h.listeners["doc:visibilitychange"]();
    assert.deepEqual(h.sent.visibility[1], { visible: true, focused: false });
  } finally {
    cleanup();
  }
});
